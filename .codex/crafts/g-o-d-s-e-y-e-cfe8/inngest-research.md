# Inngest integration research — 2026-11-12

Mode: SCOUT `--docs`, sequential official-source research. Context7 is unavailable.
Scope: pinned self-hosted server, TypeScript worker, event ingress and local qualification.
Coverage: current upstream docs/source/registry checked; no native executable was installed or started by this research satellite. No remote or system changes.

## Verified versions and licensing

- Server and CLI: **1.52.0**, release published **2026-11-10T20:13:15Z**. Live GitHub API verified the assets rather than relying on a stale search index. [Release](https://github.com/inngest/inngest/releases/tag/v1.52.0), [API](https://api.github.com/repos/inngest/inngest/releases/latest).
- Windows AMD64 asset: `inngest_1.52.0_windows_amd64.zip`, 34,321,940 bytes; SHA256 `92c67bfcbad2fd142f7d7248884c9f4dc06127527208c0dccfdb43e0b84a343b`. [Asset](https://github.com/inngest/inngest/releases/download/v1.52.0/inngest_1.52.0_windows_amd64.zip).
- TypeScript package: **inngest 4.26.2**, published **2026-10-29T22:01:46.817Z**, Node >=20. SDK license is **Apache-2.0**. [Pinned registry metadata](https://registry.npmjs.org/inngest/4.26.2).
- Server license is **SSPL 1.0 with an additional future Apache 2.0 grant after three years**, not currently Apache-2.0 for the new release. This is a source-license observation, not a conclusion about a future service's obligations. [Pinned server license](https://github.com/inngest/inngest/blob/v1.52.0/LICENSE.md).

## Server and cell boundary

`inngest start` is the authenticated self-hosted mode. The pinned source rejects absent event/signing keys, requires an even-length hexadecimal signing key, enables persistence and `RequireKeys:true`. Flags include `--host`, `--port`, `--sdk-url`, `--sqlite-dir`, `--redis-uri`, `--postgres-uri`, `--queue-workers`, plus **three** Connect ports: `--connect-gateway-port`, `--connect-gateway-grpc-port`, `--connect-executor-grpc-port`. Two instances require distinct values for all four listener ports, not merely their HTTP ports. Explicitly bind loopback in native local qualification. [Pinned startup source](https://github.com/inngest/inngest/blob/v1.52.0/cmd/start/start.go), [flags](https://github.com/inngest/inngest/blob/v1.52.0/cmd/start/cmd.go).

Without external services, the real server uses an embedded Redis-compatible state store and SQLite persistence, including periodic/shutdown state snapshots. This is a useful local real-engine qualification mode; it does **not** prove external Redis/PostgreSQL persistence or container isolation. Production-intended cells need independent URLs, keys, workflow database, queue store, volumes and network authority. A distinct SDK `env` string or Redis numeric database is not a network/security boundary. Dashboard/API/metrics need private network controls; metrics are unauthenticated by default. Historical PostgreSQL events/runs/traces need a separately planned retention policy. [Official self-hosting guide](https://www.inngest.com/docs/self-hosting).

Recommended native lab shape: project-local checksum-pinned ZIP extraction, generated in-memory fixture keys passed through a child-only environment, two `start` processes, unique temporary storage directories, four reserved loopback ports each, separate worker listeners, and explicit process cleanup. An external-service profile must refuse absent Redis/PostgreSQL configuration instead of silently using embedded persistence. These are integration recommendations inferred from the documented configuration, not claims of completed execution.

## TypeScript v4 API

```ts
import { Inngest } from "inngest";
import { serve } from "inngest/hono";

const client = new Inngest({
  id: cellAppId,
  baseUrl: cellEngineUrl,
  eventKey: privateEventMaterial,
  signingKey: privateSigningMaterial,
  isDev: false,
});
const worker = client.createFunction(
  { id: workerId, triggers: { event: eventName }, retries: configuredRetries },
  async ({ event, step, runId }) => step.run("admit-and-observe", () => work(event, runId)),
);
app.on(["GET", "PUT", "POST"], workerPath, serve({ client, functions: [worker] }));
```

The v4 function constructor takes **two arguments**; trigger configuration lives inside the first object. `concurrency`, `timeouts.start/finish`, `cancelOn` and cron trigger objects are supported. Explicit `isDev:false` retains request signature validation for local self-hosting. `baseUrl` directs communication away from managed cloud. Set `serveOrigin` and `servePath` explicitly behind a proxy. [Client](https://www.inngest.com/docs/reference/typescript/v4/client/create), [createFunction](https://www.inngest.com/docs/reference/typescript/functions/create), [serve](https://www.inngest.com/docs/reference/typescript/v4/serve), [pinned Hono adapter](https://github.com/inngest/inngest-js/blob/inngest%404.26.2/packages/inngest/src/hono.ts).

Send with `await client.send({id:stableEventKey,name:eventName,data:payload})`, returning `{ids:string[]}`. Returned IDs are engine-internal event IDs; use them for run lookup. Event IDs/function idempotency suppress duplicate run creation within a limited period; they do not replace GODSEYE's durable effect journal, leases or uncertainty reconciliation. `step.run` checkpoints work, but external side effects still require domain deduplication. [Send](https://www.inngest.com/docs/reference/typescript/events/send), [idempotency](https://www.inngest.com/docs/durable-execution/guides-and-advanced/idempotency).

## Registration and run observation

Registration can use startup `--sdk-url`, SDK `PUT`, or `POST /v2/apps/{app_id}/syncs` with `{url:workerUrl}`. Sync response `data.status` is `pending`, `success`, `duplicate` or `error`; only success/duplicate mean registered. REST uses `Authorization: Bearer <signing-key>`; pinned authentication supports both the plain signing key and its SHA256 over hexadecimal-decoded material. [Authentication](https://api-docs.inngest.com/authentication), [pinned authentication source](https://github.com/inngest/inngest/blob/v1.52.0/pkg/authn/signing_key_strategy.go).

The pinned v1.52.0 API contract provides:

| Operation | Request | Relevant response |
|---|---|---|
| Sync worker | `POST /v2/apps/{app_id}/syncs`, `{url}` | `data.status`, `data.appId` |
| Invoke | `POST /v2/apps/{app_id}/functions/{function_id}/invoke`, `{data,idempotencyKey}` | `data.runId` |
| Observe event | `GET /v2/events/{event_id}/runs?include=output` | `data[]`, pagination |
| Observe run | `GET /v2/runs/{run_id}?include=output` | `data.status`, `data.output` |

Wire statuses include `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`, `SKIPPED`, `PAUSED`, `UNKNOWN`; unknown/fetch failure must retain uncertainty. Verify returned app/function/run binding before accepting output. Do not treat an accepted event or empty run list as completed work. [Pinned protobuf](https://github.com/inngest/inngest/blob/v1.52.0/proto/api/v2/service.proto), [run implementation](https://github.com/inngest/inngest/blob/v1.52.0/pkg/api/v2/endpoints_runs.go), [enum serialization](https://github.com/inngest/inngest/blob/v1.52.0/pkg/api/v2/enum_json.go).

## Contradictions and integration decisions

- The live API docs mention synchronous invocation mode, but pinned v1.52.0 `InvokeFunctionRequest` has no `mode` field. Implement asynchronous acceptance and durable run observation; do not assume a synchronous HTTP return proves completion.
- One calendar must own each cron. If Inngest native cron is enabled, exclude that definition from the Foundation fixture cron scheduler. Keeping both enabled duplicates scheduling. The Inngest worker should request the existing scoped Foundation operation and observe it, preserving Foundation admission/HOLD/cancellation/effect authority rather than bypassing them.
- Self-hosted instance keys are broad instance authority. GODSEYE should select the trusted cell configuration server-side and reject caller-supplied project/environment overrides; worker signature validation and cell-specific producer authentication are separate checks.
- Browser/user SSE publication must not provide arbitrary backend-to-job publishing authority. Only trusted business events should enter the bridge, transactionally persisted before network dispatch, with bounded backlog and explicit retention/replay rules.

## Method and limits

Official docs browsed on 2026-11-12; pinned server and SDK source fetched; npm and GitHub release metadata fetched live. Search index initially advertised older v1.45.1, while live release API proves v1.52.0. No comparative performance claims, no external deployment, no public service creation, no native engine execution in this research task. Pure API digest skips FABER; implementation architecture and verification still require fresh review. Parent owns any SYNAPSE export beyond this scoped context-bus artifact.

## Native execution diagnosis — 2026-11-12

The first native integration attempt accepted SDK registration and events but did not invoke either
cell's worker. Its bounded configuration used `--queue-workers 2`. Pinned upstream source establishes
a deterministic configuration problem: `pkg/execution/queue/consts.go` sets `minWorkersFree = 5`, and
the scanner in `pkg/execution/queue/scan.go` skips every poll while `q.capacity() < minWorkersFree`.
An entirely idle two-worker queue therefore never scans its pending partitions. The CLI accepts the
value despite this internal liveness constraint. This is not evidence of unsupported Windows clocks
or a native-platform deadlock. [Threshold source](https://github.com/inngest/inngest/blob/v1.52.0/pkg/execution/queue/consts.go),
[scanner source](https://github.com/inngest/inngest/blob/v1.52.0/pkg/execution/queue/scan.go).

Configure at least five queue workers for this pinned version; ten provides bounded room above the
scan threshold. GODSEYE should reject smaller configured values and test that refusal, rather than
advertise a service which starts healthy but cannot dispatch. This diagnosis was sent to the root,
implementation and native-test satellites before a rerun; subsequent execution results belong to
their evidence records, not this source-only diagnosis. `inngest start --help` was inspected locally
and confirms the relevant flags, but it does not document the internal five-worker minimum.

The subsequent native test found a second concrete interoperability detail: the self-hosted engine
rewrites its loopback callback hostname from `127.0.0.1` to `localhost` while preserving the worker
port. A literal hostname-only check rejected that legitimate callback with 403 before the SDK ran.
The corrected local worker accepts only loopback aliases at the exact configured port and retains
mandatory SDK request signatures. The native test owner reports successful complete two-cell
application → signed worker → Foundation terminal execution after both corrections, with wrong-cell
event material and unsigned invocation still rejected. This outcome is reported from the test owner;
the canonical command/timings and frozen-source proof belong to the parent verification ledger.

The pinned OSS server's v2 sync route returned **501** in the actual lab despite the public API
contract advertising it. Explicit SDK-endpoint `PUT` completed real registration (200) and is the
tested local path. API-shaped references above remain useful upstream contracts, but this integration
must not treat the advertised v2 sync endpoint as an implemented capability of this exact OSS build.

The pinned server [Dockerfile](https://github.com/inngest/inngest/blob/v1.52.0/Dockerfile) uses an
`alpine:3.24` final stage with `/bin/inngest`, CA certificates and timezone data. This supports a
`/bin/sh` material-file wrapper in a prepared profile. It does not verify a caller's eventual image
digest or certify that a future image preserves that shell/layout; target-image qualification
remains mandatory. No Docker daemon was available for execution in this tranche.

## Native execution correction — 2026-11-12
The actual pinned OSS1.52.0 binary returned HTTP501 for POST /v2/apps/{app_id}/syncs with the message App sync not implemented in OSS. The protobuf documents an API shape but does not establish an implemented OSS capability. Do not use that route as the launcher registration mechanism. GAUNTLET is testing the SDK PUT registration path and explicit ready-function observation; final runtime evidence supersedes the preliminary API digest above.
