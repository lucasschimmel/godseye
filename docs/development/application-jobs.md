# Application jobs and outbox (local)

Backend for E06: per-cell durable jobs, cron, event triggers and a transactional outbox. See
[ADR-011](../adr/ADR-011-durable-jobs-and-outbox.md). This is a local fixture stage: nothing here is a
deployed Inngest or Redis engine.

## API

Owner-only, under `/api/v1/jobs` (contracts in `packages/contracts/src/jobs*.ts`):
`GET /jobs`, `POST /jobs/definitions`, `/jobs/definitions/:id/{pause,resume,trigger}`,
`/jobs/runs/:id/cancel`, `/jobs/outbox/:id/reconcile`. Mutations need an `Idempotency-Key`; registration
and outbox reconciliation need a recent passkey session.

## Engine states

| State | Meaning |
| --- | --- |
| `unconfigured` (default) | Definitions are stored; triggers return 503; no tick does work. |
| `local_fixture` | A handler or sender registry was injected explicitly (tests). |

`InfrastructureEngine` accepts `jobs: { handlers, senders, timeoutMs, dispatchTimeoutMs, maxOutboxAttempts }`.
`infrastructure.jobs.tick()` runs one controller iteration (cron scheduling, dispatch, state sync, outbox
dispatch); `infrastructure.foundation.tick(worker)` is the consumer that executes the handler.

## Server pump, fixtures and retention

The local server starts `runJobScheduler` (the existing Foundation worker already consumes the
`local.jobs` adapter) only when `GODSEYE_JOBS_LOCAL_FIXTURES=enabled`; any other value, or none, leaves
the engine `unconfigured` and starts nothing. The simulated handlers are `fixture.noop`, `fixture.fail`
and `fixture.unknown`. Each tick prunes terminal runs (`succeeded|failed|cancelled`) and `delivered|failed`
outbox rows older than `limits.retentionDays` (outbox rows use the longest retention of their cell); unknown,
reconciling, held, pending, live runs and runs still referenced by an outbox row are never deleted.
`POST /jobs/runs/:id/reconcile` (owner, fresh passkey, protected runs in `unknown`) runs the read-only probe;
there is no "retry" of a failed run: a new run is triggered with a new dedupe key.

## Run states

`queued` -> `running` -> `succeeded | failed`; `cancel_requested` -> `cancelled` after fencing;
`unknown` -> `reconciling` -> terminal after owner reconciliation (`JobEngine.reconcileRun`).

## Outbox states

`pending` -> `dispatching` -> `delivered | failed | unknown`; `unknown` -> `reconciling` (read-only probe)
or owner resolution; `held` while the cell is held. Unknown deliveries are never repeated automatically.

## Writing intent transactionally

```ts
await jobs.transact(async (tx) => {
  // business change using tx ...
  await jobs.enqueueOutbox(tx, { projectId, environmentId, effectKey, destination, payload });
});
```

## Tests

`bunx vitest run tests/jobs-*.test.ts` (engine, T18 faults, T19 outbox, T20 isolation and hold, HTTP).
`bun run test:mutation:jobs` runs five curated behavioral mutants in an isolated copy (protected timeout, redelivery to a non-deduplicating receiver, conflicting effect-key payload, hold parking, stale-lease outbox intent); all are killed.
