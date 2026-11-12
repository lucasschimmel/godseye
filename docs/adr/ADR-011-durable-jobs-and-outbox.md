# ADR-011: Durable jobs, cron and transactional outbox

Status: accepted (local-first stage; remote engine pending)
Scope: E06.S01-S03 backend; F20, F21; T18, T19, T20.

## Context

Applications need scheduled, event-driven and manual work plus reliable external notifications. The
specification calls for per-cell Inngest/Redis. No such engine exists locally, and the constitution
forbids presenting local configuration as deployed infrastructure (rule 3) or treating unknown effects
as success (rule 4).

## Decision

1. **No second queue.** A job run is a thin projection over the existing Foundation journal. The
   scheduler creates an ordinary plan with the existing `job.operation` command and the `local.jobs`
   adapter, enqueues it, and derives job state from the Foundation operation. Leases, fencing, epochs,
   budgets, audit and reconciliation are inherited.
2. **Explicit local fixture engine.** The engine is `unconfigured` unless a handler registry or outbox
   sender registry is injected (tests only). Overview reports `unconfigured` or `local_fixture`, never
   `deployed`. Unconfigured: definitions are retained, `trigger` returns 503, ticks do nothing.
3. **Registry per cell.** A definition belongs to one project+environment, is unique by name there,
   carries a revision and content hash, and registers a `job-definition` resource so plans can only
   reference same-cell definitions. Re-registration with different content bumps the revision.
   Registration and outbox reconciliation require a recent owner session.
4. **Idempotent run creation.** `(definition, dedupeKey)` is unique. Cron keys are the fire time, event
   keys the event ID, manual keys the caller key. Duplicate ticks, events and triggers collapse to one
   run; the same key with a different payload is an `IDEMPOTENCY_CONFLICT`. Cron fires are claimed with
   compare-and-set on `nextFireAt`; missed fires are not backfilled beyond one catch-up.
5. **Effect policies.** `read_only` and `idempotent` jobs retry (bounded by `maxAttempts`) after a
   confirmed failure, timeout or unknown outcome, reusing a stable effect key `job:<runId>`. `protected`
   jobs never retry after execution started: uncertainty becomes `unknown`, then `reconciling` through
   owner-driven reconciliation using a read-only handler probe. Only failures that provably never
   started (for example an unavailable handler) are retried for protected jobs.
6. **Cancellation.** Queued runs cancel immediately. Started runs become `cancel_requested`, the
   Foundation run is cancelled (grants revoked, lease cleared, effect marked unknown), and the job is
   reported `cancelled` only after fencing and after the local handler has stopped. A late worker result
   is rejected by the lease check and can never write success or new outbox intent.
7. **Transactional outbox.** `enqueueOutbox(tx, ...)` joins the caller's transaction, so intent commits
   with the business change or not at all. Rows are unique per `(environment, effectKey)`; the same key
   with a different payload is a conflict. The dispatcher claims a row (`dispatching`, attempt counted)
   before sending. Definite rejection retries up to a bound then `failed`. A thrown or ambiguous send is
   `unknown` and is never repeated automatically. An abandoned claim (crash) is redelivered only when the
   destination declares it deduplicates by effect key; otherwise it becomes `unknown`. An optional
   read-only probe can prove delivery or move the row to `reconciling`. The owner resolves with
   `observed_delivered`, `observed_absent_retry` or `abandon` plus an evidence reference.
8. **Hold.** Recovery-hold environments, suspended projects, expired environments and closing/expired
   previews block cron scheduling, run dispatch and triggers. Pending outbox rows become `held` and are
   released only by an explicit owner reconciliation after the hold clears. `heldEnvironmentIds` is
   exposed in the overview.
9. **Cell isolation.** Every lookup checks project (and environment) scope. Events only match
   definitions in the stated cell. Handlers write outbox intent only into the cell of their own run, and
   only while their lease is valid. The scheduler's delegated authority covers only unpaused definitions
   in the plan's own cell.

## Event ingestion

`JobEngine.ingestEvent` is an internal control-side method. The independent application backend
(`publishApplicationEvent`) is intentionally not modified. Event-triggered jobs will consume a
control-side event ingestion path in a later stage; today no backend event reaches the job engine.

## Consequences

- No real Inngest, Redis, remote worker or network sender exists; handlers and senders are in-process
  fixtures. Remote qualification of the engine, ingress authentication and worker registration (E06.S01)
  remain open.
- Handlers run in the controller process in this stage; production isolation will use the remote worker.
- The background pump `runJobScheduler` exists but is not started by `server.ts` while no engine is
  configured.
