# E06 local completion: autonomous runtime

Status: implemented contract; final verification in progress. Existing accepted Foundation and
application-event invariants remain binding.

## Authority and process topology

The owner HTTP API and the trusted jobs supervisor are separate processes sharing the
existing PostgreSQL control journal. A supervisor is not an application worker. It owns
Foundation leases/effects and is the only detached jobs consumer. PGlite is refused for
this topology. The dashboard can stop without stopping the supervisor, native engines,
application listeners or application worker processes.

Each cell has one application/SDK/handler child, its own application directory, SDK
material, engine instance, PostgreSQL workflow database and authenticated Redis state.
An OS-created IPC channel is the local capability: no public admission RPC is added.
The supervisor derives the cell from the child connection. The worker receives no
owner database URL, owner authentication material, other cell keys or global queries.
Child environment and exec arguments are explicit allowlists. Local first-party
subprocesses are not claimed as hostile-code OS containment; Docker/gVisor remains a
separate host qualification.

## Reuse and public composition

- Reuse `JobEngine`, `FoundationEngine`, `createInngestCell`, `openLocalApplication`,
  current revision-bound backend lifecycle and the existing transactional event bridge.
- Narrow `createInngestCell` to a typed jobs port, allowing a scoped IPC proxy.
- `apps/jobs-runtime/src/runtime.ts`: `prepareAutonomousJobs(options)` returns
  `{ infrastructure, start({signal,onFailure}), close(), cells }`.
- Options bind the existing PostgreSQL `Store`, root/state directories, strict cells,
  cell storage bindings `{projectId,environmentId,postgresUri,redisUri}` and an optional
  owner-selected trusted worker module. No owner/project/definition is auto-created.
- A trusted worker module exports `createWorker({scope})`, returning optional application
  routes and a typed handler map. It loads only inside the cell process.
- `apps/jobs-runtime/src/ipc.ts` exports the canonical serialized protocol. Method handlers
  validate strict schemas; response errors expose only safe codes. Pending calls,
  actual inbound executions and message bytes are independently bounded. Timeouts
  do not imply physical cancellation; disconnect/late results cannot settle a grant.
- Handler outbox requests reference only an active parent-held execution callback;
  workers cannot select authority by supplying project/environment/grant fields.

The versioned source contract is the discriminated strict `Message` schema in `ipc.ts`:
requests contain `{kind:'request',id,method,payload}` and responses contain
`{kind:'response',id,ok,result?,code?}`. Correlation IDs are positive safe integers,
monotonic per inherited channel; lower/repeated requests fail the channel. JSON messages
are bounded to 524,288 bytes and pending/outstanding actual requests to 64 in either
direction. A deadline retains the actual-call slot until response or disconnect.
Only redacted uppercase error codes cross the channel.

`WorkerSettings` in `config.ts` is the strict initialization schema; only the selected
cell, its private application/engine directories, own event/signing material, typed
backend settings and optional trusted module path enter the cell. The worker receives
its own workflow DSNs only in `engine-start`, never owner/foreign-cell authority.
Worker-side methods are `initialize`, `catalog`, `engine-start`, `read-event`, `execute`,
`deliver-outbox`, `abort`, `close`. Application-to-supervisor methods are `lifecycle`,
`ingest`, `runs`, `accepted`, `settled`, `cron`, `outbox`, `authorize-execution`,
`check-execution`, `check-reconciliation`, `authorize-outbox`; `broker.ts` pins their strict inputs and binds
authority to the child connection. `Execution` and `Delivery` schemas in `worker.ts`
reuse existing JobDefinition/JobRun/ApplicationJobEnvelope contracts. Outbox callbacks
exist only while the original parent-held attempt remains active; current lease,
lifecycle, deadline and actual durable outbox claim are rechecked before dispatch.
Read-only reconciliation has its own matching Foundation reconciliation lease; its
context cannot assert a live mutation grant or enqueue new outbox effects.
The parent captures execution versus read-only mode in its active context, rather
than accepting a mode from worker requests. Both modes require current lifecycle and
a last-moment child `authorize-execution` round trip; read-only mode revalidates its
own exact reconciliation lease. `assertReconciliation` exposes only that checkpoint.
Admission is rechecked after awaited lifecycle/lease/lookup guards, so losing the
supervisor singleton during a wait cannot admit a late physical call.

## Shared-journal consumption and calendar

Detached owner configuration excludes `local.jobs` before queued adapter validation
and lease reconciliation. The supervisor selects only that adapter before either
operation; unrelated infrastructure/delivery runs cannot be consumed or fenced.
Both processes retain the existing transactional control write lock.
The supervisor has its own exclusive local process lock, separate from owner HTTP.
Concurrent PostgreSQL migration/startup remains serialized.
Its independent PostgreSQL session singleton also prevents a second supervisor using
another local directory; session error/end synchronously fences IPC admission before
cleanup. Migration bootstrap uses a session advisory lock before creating lock tables.

Cron catalogs are re-read from the durable owner journal, scoped and reconciled into
the signed SDK endpoint with an explicit PUT registration after changes. Admission
still checks exact current hash, pause, HOLD, epoch and project lifecycle. No fixture
calendar runs for Inngest cells.

The separate platform engine is supervisor-owned, has independent workflow PostgreSQL,
Redis and key material, and accepts only trusted platform maintenance functions. It
cannot ingest application envelopes or route arbitrary tenant payloads.
The platform child permits only `initialize`, `engine-start`, `close` from its parent,
and `maintenance` toward the supervisor. That maintenance function reuses Foundation
expired-lease reconciliation; it never introduces a second jobs dispatch calendar.

Cell/platform children own engine guardians over a second inherited IPC channel.
Guardians retain the actual native ChildProcess handle and stop it on IPC disconnect.
Hard-killing the supervisor disconnects children; hard-killing an application child
disconnects its guardian. Termination uses owned handles with bounded SIGTERM/SIGKILL
escalation, never a remembered numeric PID. Startup refuses occupied resources and
preserves source state; unrelated process identities are never adopted or terminated.

## External persistence

The production local supervisor requires both PostgreSQL and Redis bindings for each
engine, including platform. Neither may silently fall back to embedded storage.
Inngest 1.52.0 external storage uses the upstream PostgreSQL and Redis URI options;
workflow state is distinct from application databases and from the control journal.
Storage URI validation is local-only, paths/material are private, errors are redacted.
Restart tests must prove actual pending work and history survive engine/Redis/PostgreSQL
process restarts; a generated Compose document is insufficient evidence.

## Acceptance trace (GAUNTLET canonical IDs)

| ID | Observable proof / failure behavior |
| --- | --- |
| T-E06-W04 | Detached controller never consumes/fences jobs, supervisor never consumes unrelated adapters/environments. |
| T-E06-W01/W03 | Cell child environment/config omit owner material; foreign scope, replay and unsupported RPC are refused. |
| T-E06-W02 | Real cell event and handler finish while owner HTTP is stopped; same journal result survives supervisor/worker restart. |
| T-E06-W05/W06 | Dead child, deadline, cancellation/HOLD, authority loss and late results preserve Foundation fencing/unknown semantics. |
| T-E06-C01 | New/changed/paused cron catalogs reconcile without process restart and stale registration cannot admit. |
| T-E06-P01 | Missing/malformed/reused external stores are refused; no embedded fallback. |
| T-E06-P02 | Actual external PG/Redis engine persists pending workflow and terminal history across restart. |
| T-E06-P03 | Distinct cell keys/stores and independent platform engine reject cross-cell/application-to-platform dispatch. |
| T-E06-P04 | Hard-kill supervisor/worker disconnects guardian, releases only owned listeners/processes, preserves source and permits safe restart. |

Earlier provisional D01/D02/D03/D04/D05 identifiers map respectively to W04,
W01+W03, W02, W05+W06, C01. Executable native cases retain some provisional aliases
for continuity; GAUNTLET strategy IDs above are canonical for final trace.

Plan review remediation: E06-PLAN-01 canonical IDs/crosswalk above; E06-PLAN-02 pinned
strict source schemas/methods/capacity/lifetime above; E06-PLAN-03 guardian ownership,
hard-kill and safe-restart contract above. Final runtime evidence remains the root gate.

ASSUMED: local-only operator-selected first-party modules; no arbitrary repository code
is admitted into the controller or implicitly trusted. No dedicated server, Git mutation,
global installation or system service changes are authorized by this continuation.
