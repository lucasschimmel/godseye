# Application jobs, Inngest and outbox (local)

Backend for E06: per-cell durable jobs, cron, application-event triggers and transactional outboxes.
See [ADR-011](../adr/ADR-011-durable-jobs-and-outbox.md). The original fixture engine remains available;
the local integration adds an authenticated Inngest SDK worker and independent engine binding per
project/environment. Foundation remains the operation/effect authority. The embedded compatibility launcher, detached external-persistence runtime and prepared Compose
profile have different evidence boundaries. The detached runtime below uses real PostgreSQL/Redis;
native process execution does not qualify containers or the dedicated server.

## API

Owner-only, under `/api/v1/jobs` (contracts in `packages/contracts/src/jobs*.ts`):
`GET /jobs`, `POST /jobs/definitions`, `/jobs/definitions/:id/{pause,resume,trigger}`,
`/jobs/runs/:id/cancel`, `/jobs/outbox/:id/reconcile`. Mutations need an `Idempotency-Key`; registration
and outbox reconciliation need a recent passkey session.

## Engine states

| State | Meaning |
| --- | --- |
| `unconfigured` (default) | Definitions are stored; triggers return 503; no tick does work. |
| `local_fixture` | A handler or sender registry was injected explicitly, including the opt-in local server fixtures. |
| `local_inngest` | Inngest-backed cells are configured beside trusted Foundation handlers; this is composition metadata, not live health or qualified hosting. |

`InfrastructureEngine` accepts `jobs: { handlers, senders, timeoutMs, dispatchTimeoutMs, maxOutboxAttempts, inngestEnvironmentIds, applicationEventLoader }`.
`infrastructure.jobs.tick()` runs one controller iteration (cron scheduling, dispatch, state sync, outbox
dispatch); `infrastructure.foundation.tick(worker)` is the consumer that executes the handler.

The current control API is `1.9.0`; the application API remains `1.0.0`. The added engine state is a
versioned owner-contract change, not evidence that saving configuration started an engine.

## Run the independent local demonstration

Use the existing pinned Bun/Node workspace. The project-local installer currently supports Windows
x64 and verifies the pinned Inngest 1.52.0 archive SHA-256 before extraction; it installs no system
service. SDK `inngest` 4.26.2 is a separately pinned workspace dependency.

```sh
node scripts/install-inngest.mjs
node --import tsx apps/jobs-local/src/server.ts --help
node --import tsx apps/jobs-local/src/server.ts --demo --name sample
```

Equivalent workspace aliases are `bun run inngest:install`, `bun run jobs:local --help` and
`bun run jobs:local --demo --name sample`. `bun run inngest:compose` runs the separate manifest compiler.

The explicit `--demo` process creates an independent private store under `.local/jobs/sample`, with
separate `control`, `application` and `engine` directories and retained private runtime material.
It does not open the dashboard owner's controller store. Reuse the same directory to restart that
source; deleting it discards the demonstration's data and authority. The launcher prints safe scope
IDs/listener URLs, starts the native engine, explicitly registers the signed SDK through `PUT`, and
runs the application bridge plus Foundation consumer/scheduler. Upstream diagnostic output and
private keys are not printed. Ctrl+C stops these local processes.

| Flag | Default | Listener |
| --- | --- | --- |
| `--engine-port` | 4510 | Native engine API/dashboard |
| `--worker-port` | 4511 | Signed SDK `/api/inngest` |
| `--app-port` | 4512 | Independent `/api/app/v1` backend |
| `--gateway-port` | 4513 | Inngest Connect WebSocket |
| `--gateway-grpc-port` | 4514 | Inngest Connect gateway gRPC |
| `--executor-grpc-port` | 4515 | Inngest Connect executor gRPC |

All listeners bind loopback. Override all six ports and use a different `--name` or `--directory`
for a simultaneous second cell. Every port in one cell must be distinct. Inngest uses ten queue
workers: the pinned server internally requires at least five free workers to scan partitions; a
smaller setting can start healthy while never dispatching. The public v2 sync endpoint returns 501
in this OSS build, so SDK `PUT` is the actual tested registration path.

Register an application user with `@godseye/sdk` using the scope printed by the launcher. Then call
authenticated `POST /api/app/v1/custom/emit` with `{ "payload": { "revision": 1 } }` and an
`Idempotency-Key`. The trusted demo maps `document.updated` to its `application.archive` handler,
which reads the scoped payload and records a Foundation result. It does not implement an external
archive service or execute arbitrary repository code. HTTP acceptance is not job completion.

## Embedded compatibility profile beside the owner dashboard

The normal local control server also accepts the opt-in `GODSEYE_INNGEST_CELLS` environment variable.
It is a strict JSON array of at most twenty existing project/environment pairs and six listener ports
per cell. No private keys, arbitrary paths or application code belong in this JSON. Every port must
be unique across all cells and different from the owner API/console ports. Unset or `[]` starts no
native cells; combining nonempty cells with `GODSEYE_JOBS_LOCAL_FIXTURES=enabled` refuses startup.

First use the ordinary local dashboard to create the intended project/environment and save its
enabled **Backend applicatif** configuration with the owner passkey. Settings must be current and
`prepared`; missing, disabled, held or stale configuration refuses connection. Then stop the local
server and restart it with the selected IDs and free ports. For example, in PowerShell, replace
the example UUIDs with the IDs of that existing environment:

```powershell
$env:GODSEYE_INNGEST_CELLS='[{"projectId":"11111111-1111-4111-8111-111111111111","environmentId":"22222222-2222-4222-8222-222222222222","enginePort":4510,"workerPort":4511,"applicationPort":4512,"gatewayPort":4513,"gatewayGrpcPort":4514,"executorGrpcPort":4515}]'
bun run dev
```

The existing owner store is now the Foundation/job journal used by `/jobs`. The runtime opens
independent application data under the configured owner root's `applications/<project>/<environment>`
and engine/material state under the owner state directory's `inngest/<project>/<environment>`. It
uses the saved allowed origins, registration/file/event limits and a revision-bound lifecycle guard,
starts loopback application/SDK listeners and its native engine, performs SDK `PUT` registration,
and starts bridge/scheduler consumers. It creates no owner account, project, environment or job
definition. Register the intended same-cell definitions explicitly through the existing `/jobs`
owner UI; the current trusted runtime handler is `application.archive`.

The managed backend provides built-in auth/files/SSE. Trusted application code must compose its
event publication or typed custom routes; there is no default public event-ingestion endpoint and
the demonstration's `/custom/emit` route is not added to owner-managed applications. Existing
`createInngestCell`/`prepareLocalInngest` composition supplies the private producer/loader boundary.
Cron definitions are registered when the process starts; restart/re-register after changing that
catalog. A later saved-configuration change, HOLD or disable parks the producer and makes application
requests return 423 without stopping the owner controller or silently rebinding authority. Disabled
or unprepared settings before connection instead refuse preparation.

Stopping this browser does not stop the local server. Stopping the control process stops its native
children/listeners and consumers; reopen the same state to resume. A native child failure stops local
admission rather than leaving a falsely healthy pump. `local_inngest` means configured composition,
not a live per-cell health measurement; desired backend `runtimeConnected` observations are not
automatically qualified by starting the process. Normal remote/production mode remains refused.

Offline owner recovery and private access administration remain independent of this optional runtime:
their configuration path does not parse or start cells. Malformed `GODSEYE_INNGEST_CELLS` therefore
cannot block those CLI procedures, while ordinary runtime startup still rejects it. Existing local-mode
and exclusive owner-state process checks remain mandatory; this is not a recovery-lock bypass.

## Prepare external-service cell manifests

```sh
node scripts/inngest-compose.mjs --help
node scripts/inngest-compose.mjs path/to/profiles.json existing-directory/cell
```

The input is a JSON array of profiles. Each profile requires UUID `projectId`/`environmentId`, unique
loopback `httpPort`, a private `workerUrl` using the service DNS name `worker` or `worker-<suffix>`
and path `/api/inngest`, three
digest-pinned `images` (`inngest`, `redis`, `postgres`), and five distinct absolute private material
paths (`material.event`, `.signing`, `.postgres`, `.postgresBootstrap`, `.redis`). `queueWorkers` defaults to ten and accepts
5–100. Material contents are not read by the compiler; the generated engine wrapper requires each
mounted value to be 64 lowercase hexadecimal characters at runtime. Do not place real values in the
profile JSON. Caller-supplied image digests must be independently qualified; a syntactically valid
digest is not verified provenance or a version guarantee. The external worker network is derived
from the scoped cell name (`<manifest.name>-worker`); optional `workerNetwork` must match that exact
derived name, so callers cannot substitute a shared arbitrary network.

`compileInngestCell`/`compileInngestCells` generate separate Compose JSON documents with deterministic
cell names, an internal storage network, independent workflow PostgreSQL/Redis volumes, a separate bootstrap role and non-superuser workflow
role initialized through a private Compose config, explicit PGDATA under the mounted parent volume,
SCRAM host authentication, Redis AUTH/AOF `appendfsync always`/no-eviction policy, file-mounted
material, memory/CPU/process limits and
loopback-only engine HTTP publication. Batch compilation rejects reused scopes, HTTP ports or
material paths, and each cell derives its own worker network. That private network must already exist when an operator
later deploys the profile; it is not a shared multi-cell worker network.

The prepared profile requires Docker Compose 2.23.1 or newer for inline config content.
Compilation writes new files only and starts no Docker service, creates no network/account and
checks no target image, volume layout, TLS or enforced quota. Its metadata stays `prepared-only`
and `qualified: false`. The current local SDK factory accepts loopback endpoints; a deployed private
worker transport/runtime still needs implementation and qualification before those profiles become
an enabled hosted capability. The external profile uses private-network unencrypted service links;
it does not establish encrypted transport merely by isolating the desired network.

## Server pump, fixtures and retention

The local server starts `runJobScheduler` (the existing Foundation worker already consumes the
`local.jobs` adapter) when either `GODSEYE_JOBS_LOCAL_FIXTURES=enabled` or explicit nonempty
`GODSEYE_INNGEST_CELLS` is selected. The modes cannot be combined; with neither, the engine stays
`unconfigured` and starts no job pump. The simulated handlers are `fixture.noop`, `fixture.fail`
and `fixture.unknown`. Each tick prunes eligible terminal runs (`succeeded|failed|cancelled`) and `delivered|failed`
outbox rows older than `limits.retentionDays` (outbox rows use the longest retention of their cell); unknown,
reconciling, held, pending, live runs and runs still referenced by an outbox row are never deleted.
A cancelled run retaining an unknown fenced effect is also preserved despite its terminal UI state.
`POST /jobs/runs/:id/reconcile` (owner, fresh passkey, protected runs in `unknown`) runs the read-only probe;
there is no "retry" of a failed run: a new run is triggered with a new dedupe key.

## Run states

A changed definition is rejected with `JOB_DEFINITION_BUSY` (409) while it has any run outside
`succeeded|failed|cancelled`, including queued, running, cancellation-requested, unknown or reconciling
work. Re-registering identical content remains safe. Resolve existing work first, then change the
definition; a new effect policy must never reclassify an old unknown effect as retryable. A rejected
change leaves the stored definition revision and mutation receipt unchanged.

`queued` -> `running` -> `succeeded | failed`; `cancel_requested` -> `cancelled` after fencing;
`unknown` -> `reconciling` -> terminal after owner reconciliation (`JobEngine.reconcileRun`).

## Outbox states

`pending` -> `dispatching` -> `delivered | failed | unknown`; `unknown` -> `reconciling` (read-only probe)
or owner resolution; `held` while the cell is held. Unknown deliveries are never repeated automatically.

`dispatchTimeoutMs` bounds the central wait for both `sender.send` and read-only `sender.inspect`.
It defaults to 60,000 ms and must be a positive safe integer no greater than 2,147,483,647 ms.
A timed-out send remains `unknown`; a probe that cannot establish delivery moves the row to
`reconciling`. A late acknowledgement cannot overwrite that decision. The pump forwards its abort
signal, and senders/probes may accept an optional cooperative `AbortSignal`.

Timeout or abort does not prove a physical effect stopped. Each engine retains one active-call slot
per environment/destination until the underlying provider promise actually settles, with a maximum
of 50 active calls across its cells. Busy scopes are excluded before the pending-row batch limit so
other destinations can progress. Capacity exhaustion leaves new rows pending rather than starting
unbounded calls or repeating uncertain work. A non-cooperative provider may retain its slot until
operator/provider reconciliation; the controller does not report physical cancellation merely because
its own wait ended.

## Writing intent transactionally

```ts
await jobs.transact(async (tx) => {
  // business change using tx ...
  await jobs.enqueueOutbox(tx, { projectId, environmentId, effectKey, destination, payload });
});
```

## Application events and durable job intent

The independent application database owns `app_job_events`, separate from bounded SSE history.
When jobs are configured, trusted `publishEvent({ userId, type, payload, idempotencyKey })` commits
the user event and its bridge intent in the same application transaction. SSE pruning cannot remove
unacknowledged job intent. The envelope carries a server-derived project/environment, stable store
producer ID and captured activation epoch; browsers cannot supply that authority.

Authenticated custom POST handlers also receive `emitEvent({ type, payload, idempotencyKey })` beside
`user`, `input` and the current transaction `db`. This emits job intent within the business mutation's
transaction; it does not publish an SSE event. GET handlers cannot emit. Keep all business SQL in
`db`; a network call or a separate transaction cannot be made atomic by `emitEvent`.

The private runtime's `flushJobs({ signal?, limit? })` dispatches committed intent. With the supplied
Inngest transport, delivery is acknowledged only after the signed worker commits a durable Foundation
admission receipt, not merely after Inngest accepts `/e`. The default batch is 50, with an explicit
maximum of 200. Unsettled backlog, including acknowledged but uncertain work, counts against
`jobs.maxPending` (default 1,000); refusal rolls back the new publication or business mutation.
`jobs.timeoutMs` bounds send and settlement-probe waits (default 10,000 ms). Timeout/abort retains
intent, and an unresolved actual call retains the runtime's in-flight slot. A late response does not
retroactively acknowledge a timed-out attempt. Reopening the same store preserves its producer ID and
pending intent; an old epoch is not silently upgraded after fencing or recovery.

The receiver deduplicates the immutable domain envelope ID and rejects changed content. Each
transport redrive uses a fresh Inngest event ID while keeping that domain ID stable, so finite SDK
retry exhaustion or a prolonged HOLD cannot permanently lose an unacknowledged source intent.
The retained controller receipt prevents redrive from recreating work after normal run pruning.
An unknown or reconciling Foundation effect remains unresolved. No matching definition creates no
business job; missing history for a previously correlated run cannot establish success.

Full business payloads remain in the cell-owned application store and its private Inngest state;
the shared controller stores only receipt metadata, payload hash and correlated IDs. Configure
`applicationEventLoader(authority, eventId)` to select the exact trusted source runtime and call its
private `readJobEvent(eventId)`. Handler `context.event` is populated only after the returned envelope
matches the receipt hash and current Foundation lease. Payload acquisition is inside the job deadline;
a late loader cannot start a handler after timeout. Actual loader calls retain bounded per-cell and
global capacity until they settle. Never implement the loader as a browser-selected database lookup.

The transport's settlement probe permits application payload cleanup only when every correlated run,
retained attempt and related outbox effect has resolved. Cancelled work with unknown external effects
remains unresolved, as does missing correlated history. The source scans past older unknown rows so
they cannot starve later settled work. `jobs.retentionDays` defaults to 30 days and removes only
payloads whose confirmed settlement is older than that interval. Metadata receipts remain to
deduplicate later redrive. Custom transports without a settlement probe retain accepted payloads;
operators must account for the finite unsettled-capacity limit.

## Cell SDK and calendar composition

`createInngestCell` from `@godseye/core` composes a cell-specific `inngest` client, a Hono worker
endpoint and the application bridge transport. Its private inputs bind the server-selected authority,
engine URL, worker URL, event/signing material and Foundation job engine. The local implementation
requires exact loopback HTTP URLs and explicit signed mode (`isDev: false`); it never falls back to
the managed Inngest cloud. Private event/signing material must not enter SDK/browser responses,
source control, diagnostics or owner HTTP metadata.

Use one engine instance, private keys, state directory and worker registration per cell. The native
server's HTTP, Connect WebSocket and two Connect gRPC listeners all need unique ports across local
instances. The SDK endpoint permits loopback aliases only at the exact configured port; execution
requires Inngest signatures and the exact project/environment/producer before Foundation admission.
The pinned native engine normalizes callback `127.0.0.1` to `localhost`; permitting that alias does
not disable signatures. A caller-selected project field or an SDK environment name is not isolation.

Pass the configured cell IDs through `JobOptions.inngestEnvironmentIds`. For those cells, Inngest's
registered cron functions are the only calendar: the old fixture scheduler skips them. Cron worker
registration binds the exact definition hash and cell; pause, revision drift, HOLD or suspension
invalidates admission. Re-register the worker after changing its cron catalog. The Foundation
scheduler/consumer still performs admission, fencing, effects, state sync and outbox delivery; it is
not a second cron producer.

The embedded compatibility worker coordinates trusted handlers inside the owner process. Stopping
that process interrupts its consumer. The detached runtime below moves first-party handlers into
cell subprocesses and the consumer into a separate supervisor with independent platform storage.
Neither profile qualifies arbitrary hostile repository code, deployed container/network enforcement
or coordinated recovery.

## Storage migration and recovery limits

The additive control migration `0016_application_job_events.sql` records accepted application
metadata/hashes and correlated job IDs, without business payloads. Application startup separately
applies the additive
`APPLICATION_JOBS_MIGRATION` from `packages/app-backend/src/jobs-migration.ts`; the original E04
schema fingerprint remains unchanged so an existing cell can reopen. Preserve both databases and
Inngest state for same-source restart. Do not delete unresolved intent or receipt history to clear a
blocked queue.

Application recovery export does not establish a shared restore point for these bridge receipts,
Inngest state, PostgreSQL, files and external effects. Restored destinations remain held; complete
E03/E12 activation, producer fencing and non-rewound business-effect reconciliation remain open.
Embedded Redis-compatible state with SQLite proves a local engine path only; an external-service
profile must fail closed when its configured dependencies are unavailable.

## Tests

The preceding application-event/embedded-engine continuation passed the fresh complete 1,191-case default suite (the two opt-in
native cases were disabled there), both explicit native Inngest cases, 41 browser journeys and six
selected mutation experiments. Lint/types/OpenAPI 1.9.0, independent frozen source/security review,
canonical artifacts and actual built-API smoke passed. The
[final evidence table](../../tests/STRATEGY.md#final-frozen-local-evidence) retains timings, overlapping
counts, failed diagnostic/initial runs, Windows startup/build corrections and scanner limits. These
results cover the local composition and leave the deployment/recovery boundaries above intact.

`bunx vitest run tests/jobs-*.test.ts` (engine, T18 faults, T19 outbox, T20 isolation and hold, HTTP).
The initial `bun run test:mutation:jobs` checkpoint killed five curated behavioral mutants in an isolated copy (protected timeout, redelivery to a non-deduplicating receiver, conflicting effect-key payload, hold parking, stale-lease outbox intent). The separate audit-correction experiment, `node scripts/mutation-audit-check.mjs`, killed five selected mutants with green baseline/restored checks and unchanged original source. The preceding [remediation record](../reviews/2026-11-12-e01-e06-audit.md#remediation-tranche--2026-11-12) includes sixteen then-new regressions, its full 1,146-case suite, 41 browser journeys and independent source review; selected mutations are not an exhaustive coverage score.

## Detached autonomous runtime — locally verified

The earlier launcher and embedded `GODSEYE_INNGEST_CELLS` path remain compatibility profiles: their owner
process still owns the consumer and their embedded storage is not the external-persistence profile.
The implemented detached topology separates a trusted supervisor from owner HTTP. Both access the same
PostgreSQL control journal, while one first-party subprocess per cell owns its application backend,
signed SDK endpoint and handlers. PGlite is refused for this multi-process topology. The owner
consumer must exclude `local.jobs` before validation and reconciliation; the supervisor must exclude
unrelated adapters at the same boundaries.

Children receive an explicit environment and scoped OS-created IPC capability, without the owner
DSN, owner identity material, other cell keys or global queries. Handler code loads only in its
cell process. This limits accidental authority propagation between trusted first-party processes;
it is not an OS sandbox for untrusted repository code. The supervisor retains Foundation leases,
approvals, effect policy and outbox authority. An IPC timeout or lost child cannot establish that
an external effect stopped, and a late response cannot settle an expired grant.

Each application engine and the separate trusted platform engine require explicit authenticated
PostgreSQL workflow and Redis bindings. Application data, workflow history, queue state and the
owner control journal remain different stores. Missing, malformed, reused or unavailable external
services must fail startup instead of silently selecting embedded storage. Storage URIs and key
material are private process configuration; never put actual values into source, this guide or
ordinary startup diagnostics.

PostgreSQL stores Inngest configuration/history; Redis stores live queue and run state. Configure
persistent Redis AOF with an explicit fsync/RPO policy and `noeviction`, and retain PostgreSQL data
and Redis AOF directories when restarting. Inngest's initial event stream remains in-memory even
with external storage: a successful `/e` response is insufficient. The application's transactional
outbox still redrives the same domain ID until the durable Foundation receipt exists.

The detached runtime reconciles the current cron catalog into signed SDK registration. Current
pause, lifecycle, definition hash and activation epoch remain admission checks; an obsolete engine
registration cannot authorize work. Inngest remains the only cron calendar for those environments.
The platform engine accepts trusted maintenance functions and has no generic application-envelope
admission path.

The requested local runtime scope is complete: full regression, native process/persistence, selected
mutations, frozen source review and canonical build/smoke pass. Consult the [completion contract](../spec/v1.md#autonomous-workers-and-external-persistence-continuation)
and [test strategy](../../tests/STRATEGY.md#autonomous-workers-and-external-persistence--final-local-evidence).
No dedicated-server setup, background system service or Git publication occurs in this local slice.


### Start and stop persistent local services

Use the existing Ubuntu26.04 WSL distribution as a non-root user on Windows. Install the signed
project-local tools, then provide an application cell array and a separate platform cell object.
Each cell uses the existing six-port LocalInngestCell shape. Application UUIDs must identify
existing prepared cells in the selected owner journal; the platform UUIDs are an independent
sentinel scope, not an automatically created owner project.

```sh
bun run postgres:install
bun run redis:install
bun run inngest:install
bun run jobs:services start --directory .local/jobs-services --cells path/to/cells.json --platform path/to/platform.json
```

The helper creates a separate owner-control PostgreSQL cluster and a PostgreSQL workflow
cluster/Redis process for each application and platform cell. It writes private `control.json`
and `storage.json` under the selected strict workspace `.local` descendant; actual native data
persists under the non-root WSL user's `~/.local/share/godseye-jobs/<derived-id>`. Both roots are
ownership-bound and protected. No material is printed. Redis uses AUTH, AOF `appendfsync always`
and `noeviction`; workflow roles have no cluster-superuser or role/database-creation privilege.

This helper provisions services, not owner accounts, application projects or definitions. Its new
control database is empty. Existing PGlite state is untouched and is **not migrated automatically**;
selecting a new PostgreSQL binding does not copy old accounts or projects. Explicitly prepare the
intended owner journal through the normal setup/project/backend flows before starting its workers.
The supervisor refuses missing, disabled or unprepared cells.

Set these variables in each intended local process environment, using absolute paths for private
files. Values of the cell/platform variables contain IDs and ports only, never material:

| Setting | Purpose |
| --- | --- |
| `GODSEYE_MODE=local` | Explicit local mode; production/remote admission remains refused. |
| `GODSEYE_JOBS_RUNTIME=autonomous` | Owner HTTP excludes job consumption; the separate CLI is the sole jobs supervisor. |
| `GODSEYE_JOBS_CONTROL_FILE` | Absolute private helper `control.json`; mutually exclusive with `GODSEYE_DATABASE_URL`. |
| `GODSEYE_INNGEST_CELLS` | JSON array of existing application cells and six unique ports each. |
| `GODSEYE_JOBS_PLATFORM` | Independent platform LocalInngestCell object with distinct scope and ports. |
| `GODSEYE_JOBS_STORAGE_FILE` | Absolute private `storage.json` containing exact bindings for applications **and** platform. |
| `GODSEYE_JOBS_WORKER_MODULE` | Optional absolute owner-selected first-party module exporting `createWorker({scope})`. |

Start owner HTTP with `bun run dev` and the independent supervisor with `bun run jobs:start`
in separate terminals using the same explicit control/data/state bindings. The supervisor creates
no owner, project or definition. Built execution uses `bun run build:jobs`, then
`node dist/jobs-runtime/server.mjs`, retaining the normal installed external runtime dependencies.
Use `bun run jobs:start --help` to check the command without starting services.

The supervisor keeps leases/effects and a separate exclusive local/advisory lock. Cell handlers
receive only scoped broker callbacks; platform maintenance cannot ingest application envelopes.
Current cron catalogs reconcile through SDK PUT, while admission still checks current definition
hash, pause, lifecycle and epoch. IPC disconnect and a native guardian release only owned worker/
engine listeners after supervisor death; an unrelated listener is never a cleanup target. Node's
[disconnect lifecycle](https://nodejs.org/docs/latest-v24.x/api/process.html#event-disconnect)
provides the channel-closure signal; asynchronous cleanup cannot be deferred to an exit listener.

Stop the supervisor before stopping its storage:

```sh
bun run jobs:services stop --directory .local/jobs-services
```

Stop verifies actual owned service identity and authenticates before requesting graceful shutdown.
It attempts each Redis/PostgreSQL cleanup independently and reports incomplete cleanup after visiting
all resources. It preserves database/AOF/source files. Starting again with the same directory and
scope configuration reuses them; scope rebinding is refused. The helper installs no system service,
performs no raw PID kill and deletes no persistent data. Private native ownership-state updates use
exclusive sibling staging, fsync and atomic replacement to preserve restart/stop authority.


### Native Redis provenance and licensing

The local Redis tool is Redis8.0.5 from the patched Ubuntu package
`5:8.0.5-1ubuntu0.1`. `bun run redis:install` verifies Ubuntu archive signatures, signed package-index
SHA256/size and each package hash, then extracts into the ignored project cache without system
installation. The provenance record is `artifacts/tools/redis/8.0.5/provenance.json`; package copyright
notices are retained under the extracted `root/usr/share/doc` tree. Redis8 offers RSALv2, SSPLv1 or
AGPLv3 choices according to [Redis's licensing overview](https://redis.io/legal/licenses/).
These version/provenance observations do not select a legal interpretation for future hosting or
redistribution; Inngest server, TypeScript SDK, Redis and packaged dependencies have separate terms.

### Final local verification

The requested local autonomous/persistence slice is complete: **1,225 default cases**, all **eleven
native opt-ins executed separately**, eight Python helper regressions and seven selected mutation
kills passed, along with static/contracts, dependency audit, frozen source/security review and the
canonical full build/built smoke. Actual cron firing, owner HTTP absence, worker/supervisor death,
read-only reconciliation, PostgreSQL advisory-lock loss and external-store restarts are covered.
No UI source changed and no browser suite was rerun; the earlier browser checkpoint remains historical.
The [final evidence table](../../tests/STRATEGY.md#final-aggregate-gates-for-local-e06-completion)
records timings and overlapping counts. Host containment/quota/network/capacity and coordinated
E03/E12 recovery remain separate qualification, with no dedicated-server action or implicit migration.
