# Local application backend and TypeScript SDK

Status: verified local E04 implementation, 2026-11-12; combined tests, browser journeys, builds, source reviews and selected mutations passed. The application API is separate from owner administration. Hosted runtime/provider qualification, off-host recovery and full V1 acceptance remain open. See [ADR-010](../adr/ADR-010-independent-application-backend.md).

## Boundaries and packages

| Package | Responsibility |
| --- | --- |
| `@godseye/app-backend` | Independent cell store, application authentication, private files and domain-event runtime |
| `@godseye/sdk` | Typed application client; never the dashboard owner client |
| `apps/backend-template` | Local application composition and authenticated application-route example |
| `@godseye/control-client` | Private owner administration of desired project/backend settings |

An application cell is exactly one project/environment. Its application database and private file root are independent of the controller's owner store and other cells. PGlite is the local development driver; the intended hosted database remains the cell's independent PostgreSQL instance. Local directory/process separation does not qualify Docker/VM containment or host quotas.

The dedicated application listener uses `/api/app/v1`; its version is `1.0.0`. The owner control API is `1.6.0`. Requests bind `X-Godseye-Project` and `X-Godseye-Environment` to the runtime's server-owned cell. `X-Godseye-App-Version`, when supplied, must match the supported application API version. OAuth redirects use their fixed listener and provider/state binding because browsers cannot attach these custom headers to redirects.

## Run a standalone local fixture

From the repository root, use the pinned Bun/Node setup in [local development](local.md). Inspect the command without creating state:

```sh
bun run backend:dev --help
```

The following UUIDs are example fixture identities. Use a new pair for an independent local test application:

```sh
bun run backend:dev --standalone --project 11111111-1111-4111-8111-111111111111 --environment 22222222-2222-4222-8222-222222222222
```

The default origin is `http://localhost:4400`; `--port` or `GODSEYE_APP_PORT` changes it. `--directory` selects a private state directory; the default is `.local/applications/<project>/<environment>`. The helper creates its application database, private identity state and files within that directory. Preserve them together for a source restart, and do not print or commit their contents.

`--standalone` explicitly selects an always-available local fixture lifecycle. It does not register a controller project or bypass a managed project's recovery hold. Omitting that switch refuses startup. Managed composition must supply a trusted lifecycle guard rather than using this fixture entry point.

The template includes authenticated `GET /api/app/v1/custom/hello`. Direct browser navigation to it has no cell headers and is not an authentication test; use the SDK. The standalone template trusts its own exact origin. When composing a frontend at a different local origin, supply that explicit origin through `trustedOrigins` in the server-side factory.

```sh
bun run build:sdk
bun run build:backend
```

The SDK build writes a browser ESM bundle, declarations and its package manifest under `dist/sdk`; its build checks forbid controller/server imports. The backend build writes `dist/backend-template/server.mjs`, targeting Node.js 24 and retaining external runtime dependencies. Neither command publishes a package or deploys a service. The SDK artifact remains private and can be consumed as a local package; no registry release is implied.

The canonical `bun run build` also includes both artifacts after the console and owner API builds.

## Owner configuration

Open a project's detail page and use **Backend applicatif**. Select the intended environment, confirm the owner passkey and configure exact allowed origins, registration policy, file limits and event retention. HTTPS origins are required except for loopback HTTP development. Wildcard origins are rejected.

The owner-only GET/PUT path is:

```text
/api/v1/projects/:id/environments/:environmentId/backend
```

PUT requires `Idempotency-Key`, recent owner confirmation and expected backend/project/environment revisions. Saving records desired configuration and audit history. It does not provision a database, start a process or connect a hosted runtime. The response truthfully keeps `runtimeConnected: false` and distinguishes unconfigured, prepared, disabled, held and stale settings.

Held recovery environments, suspended projects, expired previews and lifecycle/configuration drift cannot be activated through this form. A private operator-composed lifecycle guard also checks the current controller state when an application runtime uses these settings; the browser cannot supply this authority.

For managed local composition, `applicationLifecycleGuard(controlStore, { projectId, environmentId, configurationRevision })` from `@godseye/core` returns the private lifecycle callback. Pass it to `openLocalApplication` or the template's `createTemplateApplication`. The callback checks current desired configuration, matching project/environment revisions, activation epoch and lifecycle protections. Paths, auth material and runtime limits remain private operator inputs; saving the owner form does not automatically launch this composition.

## Application authentication

Application users sign up/sign in independently of dashboard owner passkeys. Email/password authentication uses Better Auth with transactional database operations, finite sessions and cell-specific HttpOnly cookies. Browser responses omit raw session values. Neither an owner cookie nor another application's cookie authenticates this cell.

Registration is an explicit configuration choice. Exact origins/hosts, a bounded native authentication endpoint allowlist and finite request/authentication limits apply. Optional OAuth providers require explicit server configuration and compatible callback/state behavior; they are not created or enrolled through owner metadata. Local fixture evidence does not certify a real external provider account.

The runtime accepts an `oauthProviders` array with fixed provider IDs, explicit authorization/exchange/user-info URLs, client authority, optional scopes and an explicit supported exchange-auth method. Provider discovery and arbitrary callback functions are not public configuration. PKCE is enabled. Real provider credentials stay outside owner HTTP responses, SDK options and source control. Password reset/email verification delivery is not advertised as an installed email service.

The SDK exposes signup, signin, current session, signout, session listing/revocation, password change and optional OAuth initiation. Revocation identifies a session by its safe ID; raw session authority is not returned to browser JSON. Native authentication requests follow Better Auth's protocol rather than the application's file idempotency contract.

## Use the project SDK

In a frontend using the workspace package or built local SDK package:

```ts
import { createGodseyeClient } from "@godseye/sdk";
import { z } from "zod";

const client = createGodseyeClient({
  baseUrl: "http://localhost:4400",
  scope: {
    projectId: "11111111-1111-4111-8111-111111111111",
    environmentId: "22222222-2222-4222-8222-222222222222",
  },
});

await client.auth.signUp({
  name: "Local example",
  email: "local-example@example.test",
  password: "REPLACE_WITH_A_UNIQUE_LONG_VALUE",
});
const hello = await client.request(
  "/hello",
  { method: "GET" },
  z.object({ message: z.string(), userId: z.string() }).strict(),
);
```

The client attaches exact cell/version headers and uses application cookies with `credentials: "include"`. Server-side callers may supply a private cookie-aware `fetch` or dynamic headers function; Node's global fetch does not maintain a browser cookie jar. Do not forward owner cookies or global controller headers. `GodseyeHttpError` exposes a bounded safe code/status/request ID; incompatible versions, oversized JSON or invalid response schemas fail visibly.

Cookies use `SameSite=Lax`: the browser frontend and backend must share a site, or use an appropriate same-origin proxy. Exact CORS allowlisting alone does not enable third-party cookies between unrelated domains. The localhost example uses the same site across ports. There is no application bearer/JWT issuance API; native session values remain intentionally absent from JSON. Real domain/proxy/cookie deployment is still an E05 qualification step.

Custom backend routes register fixed relative paths with input/output Zod schemas and receive authenticated `{ user, input, db }`. POST handlers run inside the application transaction/idempotency boundary and should confine mutations to that transaction. External side effects need the durable job/effect integration from E06 rather than untracked retries inside an HTTP handler.

## Private files

Files are private to the authenticated user. Object identifiers and physical names are server-owned; callers cannot select filesystem paths. Resumable staging, final integrity verification and quota accounting distinguish unfinished uploads from committed objects.

| Operation under `/api/app/v1` | Contract |
| --- | --- |
| `POST /files` | Reserve an upload using name, content type, declared size and optional SHA-256; requires `Idempotency-Key` |
| `GET /files` | List committed files for this user, at most 100 per page; pass `after=nextCursor` for the next page |
| `GET /files/:id` | Read owned metadata, current offset, status and revision |
| `PUT /files/:id/content` | Append one bounded binary chunk using `Upload-Offset` and `If-Match` revision |
| `POST /files/:id/complete` | Verify complete bytes/integrity and commit using `expectedRevision` plus `Idempotency-Key` |
| `DELETE /files/:id` | Tombstone an owned file using `expectedRevision` plus `Idempotency-Key`; revoke grants and track physical cleanup |
| `GET /files/:id/download` | Stream an owned committed file; supports one explicit `Range: bytes=start-end` |
| `POST /files/:id/grants` | Create a bounded grant with expected file revision, optional `expiresInMs` and an idempotency key |
| `DELETE /files/:id/grants/:grantId` | Revoke an owned grant with an idempotency key and empty JSON body |
| `GET /downloads/:grantId` | Download through a live grant while authenticated as its owning user |

JSON mutation keys are 8–128 characters from letters, digits, colon, underscore and hyphen. Reusing a key with different parameters or a stale revision returns 409. Chunk retries use the recorded offset/revision and byte digest; inspect current metadata after an interrupted transfer rather than starting a duplicate upload.

`storageBytes`, `objectBytes`, `maxFiles`, chunk size and upload lifetime are finite runtime limits. Upload reservations and uncertain/unfinished cleanup continue consuming quota; expiry alone does not pretend bytes were removed. An expired unfinished upload must be explicitly deleted before its reservation can be released. Local application accounting does not prove an operating-system disk quota.

Download grants are **authenticated expiring references**, not anonymous public links or permission to share an object with another user. The runtime rechecks session, lifecycle, file status and grant authority while streaming. File deletion or grant revocation prevents continued authorization. Downloads use attachment/octet-stream responses, not active inline content.

Use `client.files.downloadGrant(grant.id)` and consume the returned `Response` for a granted download. A bare browser link to the returned URL does not attach the required cell headers and is not a supported one-click public download. For a browser save action, fetch through the SDK, create a local Blob URL from the response and revoke that Blob URL when finished.

```ts
const file = await client.files.upload(
  { name: "example.txt", contentType: "text/plain", data: new TextEncoder().encode("Local example") },
  { idempotencyKey: "example-upload-0001" },
);
const response = await client.files.download(file.id);
const text = await response.text();
```

The convenience `upload` computes the actual SHA-256 and is capped at **16 MiB** to bound its in-memory input. Larger objects use `initiate`, repeated bounded `append` calls and `complete`, persisting returned ID/offset/revision for resumption. Provide a stable initiation key when retrying the same upload; different content requires a different key.

## Domain events

Domain events use authenticated SSE with durable cursors and bounded retention. A client encountering missing history refetches application state instead of assuming no events were lost. Trusted backend code publishes domain events; there is no generic browser event-publication or database-change-feed endpoint. Production Inngest job updates are a separate E06 integration.

Trusted runtime code calls `publishEvent({ userId, type, payload, idempotencyKey })`; publication verifies the recipient and finite payload limits. Event cursors are signed for the exact cell and user. `Last-Event-ID` cannot be copied to another user's stream or another environment.

```ts
const abort = new AbortController();
for await (const message of client.events.subscribe({ signal: abort.signal })) {
  if (message.kind === "event") {
    // Apply message.event; persist message.cursor only after successful processing.
  } else if (message.kind === "refetch") {
    // Reload authoritative application state, then start a new subscription.
    break;
  } else {
    // The current subscription lost authorization; stop and refresh identity.
    break;
  }
}
// Call abort.abort() when the view unmounts or the subscription is no longer needed.
```

`subscribe` accepts a saved `cursor`, requires an `AbortSignal` and reconnects after transport loss unless `reconnect: false`. A `refetch` or `revoked` message terminates that subscription; the caller decides when to restart. It does not silently acknowledge durable application processing. Stream lifetime/connections, event retention and frame bytes are bounded. Slow consumers use pull-based delivery rather than an unbounded in-memory queue.

## Held application recovery

The runtime's private `snapshot()` reports committed/missing/incomplete/deleted objects, retained residuals, auth/configuration coverage and capture time. `exportRecovery({ directory })` writes a separate protected recovery set containing committed file bytes, application users/account hashes and configuration metadata. Integrity authentication uses private source authority; it is not archive encryption. These archives contain sensitive authentication state; keep their contents out of logs, HTTP, SDK responses and commits. Off-host encryption and custody remain separately qualified work.

`importRecovery({ directory, sourceAuthMaterial })` is a private operator method, with no browser/SDK/owner-HTTP endpoint. It accepts only a separate empty destination in a new environment of the same project while the supplied lifecycle is unavailable. The destination persists its own recovery HOLD before copying; the hold survives partial failures and restart. Imported configuration remains recovery metadata rather than replacing the destination's current private origin/authority automatically.

Sessions, download grants, event history and provider access/refresh/ID values are not restored. Users must establish new sessions only after a future qualified activation procedure. The local import never activates a destination: `activationAllowed` and external-effect reconciliation remain false, even if an external callback later reports availability. Inspect captured timestamps, file coverage and the retained source before planning any broader recovery.

`snapshot().timeCoverage` records local `databaseCapturedAt`, `filesInspectedAt` and `configurationCapturedAt`. Export/import retain `databaseCapturedAt`, `configurationCapturedAt`, `fileCopyStartedAt` and `fileCopyCompletedAt` in their authenticated recovery metadata. All belong to `clockDomain: "local-runtime"`; `postgresRecoveryPointAt` remains null and `gapAssessment` is explicitly `"external-recovery-point-unknown"`. These fields expose the finite local inspection/copy interval and an unknown cross-service gap rather than reporting an invented zero gap. `activationAllowed` remains false.

This application snapshot does not establish a shared PostgreSQL PITR point, database-versus-files consistency window, off-host custody or safe activation of all producers. The [PostgreSQL recovery guide](postgresql-recovery.md) documents the independent physical database chain and all-service activation limits. E03/E12 still own complete cross-service recovery and timestamp-gap qualification.

## Verification and remaining qualification

The full browser regression passed **31/31 journeys in 181.393319 seconds (JUnit)**. Selected backend mutations **M74–M86 all thirteen killed in 257.091 seconds**, with thirteen baseline and thirteen restored checks passing and original source hashes unchanged. Frozen source reviews passed with 78 backend/code hashes and twelve UI hashes verified stable by the coordinator. Canonical console/API/SDK/template builds, the final affected backend rebuild, actual compiled-template HTTP/restart and SDK-consumer checks passed. Lint checked 381 files; types, generated control OpenAPI `1.6.0` and 62/62 local acceptance trace links passed. Final combined unit/integration verification passed 972/972 cases across 72 files in 751.83 seconds (Vitest; 752.705 seconds for the whole command).

The unit JUnit root value, 1386.4307773 seconds, sums worker execution and is not elapsed wall time. The full run XML is retained locally as `artifacts/test-results/backend-unit-full.xml`. Native PostgreSQL/pgBackRest laboratories from prior tranches were not rerun for this E04 checkpoint. Local E04 completion does not certify every full V1 scenario family.

Use the repository's [local verification commands](local.md#verification). `bun run test` selects Vitest; plain `bun test` selects a different runner. The [verification strategy](../../tests/STRATEGY.md) is the source of completed run counts and retained failure/rerun history. This guide does not treat the preceding E05 851-unit/28-browser checkpoint as proof of E04.

`bun run test:mutation:backend` runs selected behavior-changing experiments for this tranche; a passing selected set is not an exhaustive mutation or coverage score. The runnable template/SDK build checks do not enroll a personal owner or OAuth account.

Actual dedicated-server setup, qualified Docker/gVisor/runtime helpers, persistent quotas, dual-stack firewall policy, private material injection, hosted PostgreSQL, real OAuth accounts, public DNS/TLS, off-host recovery and full V1 release evidence remain separate work. No dedicated server is changed and no personal owner or external OAuth identity is enrolled by the local E04 runtime implementation.
