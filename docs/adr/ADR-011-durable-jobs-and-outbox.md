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

## Implementation status amendment — 2026-11-12

The accepted decisions above describe the original local checkpoint. The server now starts the
fixture scheduler only with `GODSEYE_JOBS_LOCAL_FIXTURES=enabled`; history/retention and owner run
reconciliation are implemented. Default startup remains unconfigured. This amendment does not
qualify Inngest/Redis, authenticated application ingress or remote workers. See the current
[jobs operator guide](../development/application-jobs.md) and
[E01–E06 audit/remediation record](../reviews/2026-11-12-e01-e06-audit.md) for the local hardening
tranche and its separate verification evidence.

## Application-event/Inngest continuation amendment — 2026-11-12

The original decisions and checkpoint above are retained as history. This continuation connects the
independent application backend to per-cell Inngest coordination while preserving Foundation's sole
effect authority; it does not replace the existing lease, approval, HOLD or protected-effect journal.

1. The application store persists a separate `app_job_events` bridge intent in the transaction that
   publishes a trusted event. A custom POST route's `emitEvent` joins its business transaction. SSE
   pruning is independent of unresolved intent; no browser endpoint gains generic job-publication
   authority. The captured scope, store producer and epoch are server-owned.
2. A bounded sender forwards committed immutable envelopes to the cell's configured event ingress.
   Engine acceptance alone is insufficient: source delivery is acknowledged only after a durable
   Foundation admission receipt exists. Transport attempts use fresh Inngest IDs but keep immutable
   domain identity across redrive, including after SDK retry exhaustion or a long HOLD. Timeout does
   not release an actual unresolved call or invent business completion.
3. A real signed Inngest SDK worker verifies its configured cell and producer, admits matching
   Foundation jobs once and durably observes their results. Unknown/reconciling effects remain
   unresolved; the Inngest worker cannot independently authorize external side effects. The additive
   controller receipt records immutable event identity, hash and correlated job IDs, without copying
   business payloads into the shared controller database. A trusted cell-specific loader retrieves
   the source payload under the job deadline and rechecks hash/lease before handler execution.
4. Inngest owns cron scheduling for explicitly configured cells; the fixture cron scheduler excludes
   them. Worker registration binds the exact definition hash. Definition changes, pause and lifecycle
   restrictions remain authoritative at admission, including after an old registration fires.
5. Source payload retention begins only after confirmed settlement of the correlated runs, all
   retained attempts and related outbox effects. Unknown and cancelled-but-uncertain effects preserve
   payload/history. Settlement scans advance past older unknown rows. Retained metadata receipts
   continue suppressing replay after settled payloads or ordinary terminal run history are pruned.
6. The present local worker coordinates trusted registered handlers that still execute through
   Foundation in the controller. It does not qualify arbitrary tenant-code execution, production
   worker isolation or managed process supervision. Independent native engine directories/keys are
   useful evidence without proving container/network boundaries.

The pinned SDK is `inngest` 4.26.2 (Apache-2.0). The pinned native server is 1.52.0; its current license
is SSPL 1.0 with an additional Apache 2.0 grant effective after three years. Source availability and
SDK licensing are not a claim that the new server release is already Apache-2.0. See the
[server license](https://github.com/inngest/inngest/blob/v1.52.0/LICENSE.md) and
[SDK package metadata](https://registry.npmjs.org/inngest/4.26.2).

The [operator guide](../development/application-jobs.md) describes the explicit native local launcher,
prepared per-cell external-service manifests, composition and migrations. The configured
`local_inngest` owner status is not a health attestation. Actual native SDK registration uses `PUT`;
the advertised v2 sync route returns 501 in the pinned OSS server. Queue capacity is at least five
workers because that version's scanner requires five free slots; the launcher uses ten.
External Redis/workflow PostgreSQL, host/network/quota enforcement, supervision, complete retention
and E03/E12 coordinated recovery/activation remain separately owned work. Neither a native embedded
state profile nor engine-event acceptance proves these release obligations.

Local verification for this continuation is now recorded in the
[final evidence table](../../tests/STRATEGY.md#final-frozen-local-evidence): the fresh complete default
suite and both explicit native Inngest cases passed, including actual owner-store composition and
post-start disable without controller failure. Static checks, selected mutations, browser regression,
independent source/security review and canonical build/smoke passed. Initial failures and their
corrections remain recorded. This local result does not change the future qualification boundaries
or the original decisions preserved above.

## Autonomous-worker/external-persistence amendment — 2026-11-12

This appended amendment preserves the accepted decisions and preceding checkpoints above.
The local completion contract moves jobs consumption into a trusted supervisor independent of
owner HTTP, with one first-party application/SDK/handler subprocess per cell. Foundation remains
the sole authority for lease/effect/approval/outbox decisions; IPC is scoped to the parent-created
child channel and never selects authority from arbitrary project/grant fields. Children receive
no owner DSN, owner identity material or other cell's keys.

The shared control journal must be PostgreSQL for independent processes. Owner HTTP and supervisor
filter their designated adapters before validating queued work or reconciling leases, preventing
one consumer from failing or fencing another's jobs. The supervisor holds both its own process lock and a PostgreSQL advisory runtime lock; a second
supervisor is refused, and loss of the advisory-lock session stops authority.
Current cron catalogs reconcile into signed registration without a second calendar, while stale
hashes, pause and lifecycle/HOLD/epoch checks remain authoritative.

Both external PostgreSQL and Redis are mandatory per engine in this topology, including the
independent platform engine. Configured service failure cannot select an embedded fallback.
PostgreSQL holds workflow configuration/history and Redis holds queue/run state. The upstream
initial event stream remains in-memory, so the application transactional outbox and durable
Foundation receipt remain necessary through engine crashes. Acknowledgement of `/e` is insufficient.

The implementation now has scoped actual waiting-workflow restart, owner-HTTP-independent execution,
protected uncertainty, live-cron and supervisor-hard-kill evidence plus frozen source review. Full
regression, selected mutation and canonical build/smoke gates now pass as recorded in the final
[local evidence](../../tests/STRATEGY.md#autonomous-workers-and-external-persistence--final-local-evidence).
The requested local software slice is complete; deployed whole-epic acceptance remains separate.
Trusted subprocesses do not qualify arbitrary-code containment, deployed quotas/network controls,
off-host custody or coordinated recovery/activation. The [operator guide](../development/application-jobs.md)
and [E06 completion criteria](../spec/v1.md#autonomous-workers-and-external-persistence-continuation)
record the current boundary.
