# ADR-010: Independent application backend and project SDK

- Status: verified local implementation, frozen defensive source review and selected mutations; hosted qualification remains open
- Date: 2026-11-12
- Related decisions: [ADR-004](ADR-004-owner-authority-and-foundations.md), [ADR-007](ADR-007-independent-postgresql-cells.md), [ADR-008](ADR-008-local-postgresql-held-recovery.md), [ADR-009](ADR-009-local-application-delivery.md)

## Context

The owner console already controls projects, independent PostgreSQL preparations, held recovery and application delivery. Its owner identity and private control client cannot become the authentication or SDK of a hosted application. E04 must supply application user sessions, private files and domain events without a Supabase Cloud runtime dependency.

The accepted cell boundary is one project/environment. Development, production and previews must not share user/session tables, file mappings or event history. Local PGlite stores and filesystem roots can demonstrate application behavior, but cannot establish Docker/VM containment, persistent host quotas or production recovery guarantees.

## Decision

Implement a dedicated `@godseye/app-backend` package with Hono, Zod, Drizzle and the pinned Better Auth transaction adapter. Each runtime receives a server-owned scope, independent application store, private file root, exact allowed origins, finite limits and a lifecycle guard. It runs on a separate application listener; the owner API never mounts application authentication or file protocols.

Use email/password for application identity and explicit optional OAuth provider configuration. Owner passkeys remain the dashboard login. Application cookies and signing configuration bind the exact cell; users cannot claim a controller actor or select a different store. Native Better Auth endpoints are explicitly allowed rather than exposing its complete API. OAuth fixtures use disposable local provider authority; no real external account is enrolled by this local stage.

Provide private per-user files with server-owned physical names, bounded resumable staging, integrity checks, quota reservations and revision/idempotency handling. Expiring download access does not confer a permanent public URL or authorize another user's files. Deletion and recovery preserve visible metadata and distinguish committed objects from unfinished or missing data.

Use authenticated SSE for durable application domain events, with scoped cursors, bounded history/connections and explicit refetch on gaps. Trusted application code publishes events; clients do not gain generic database feeds or authority to emit system/job events. Inngest job producers remain E06 work.

Ship `@godseye/sdk` separately from the internal `@godseye/control-client`. It targets the versioned application API and supplies typed authentication, files, events and application-route access. A local backend template composes these packages and leaves server paths, private auth material and lifecycle authority outside browser configuration.

Owner project pages store revision-bound desired backend settings through control API `1.6.0`. A prepared configuration is not an observed running backend. Recovery HOLD, project suspension, expired or closing previews, configuration drift and epoch changes block ordinary application use. Local file/auth/config recovery remains separate from activation and from the qualified off-host/all-service recovery required for V1.

## Consequences

- Project applications receive their own identity/data plane and browser SDK without owner credentials or Supabase Cloud dependencies.
- Separate cell stores and file roots require explicit operator composition and later deployment/provider qualification.
- Application API `1.0.0` and control API `1.6.0` are independent version contracts; control-client compatibility does not imply application SDK compatibility.
- Interrupted uploads, unknown or missing recovery objects and stale event cursors remain visible rather than appearing healthy.
- OAuth integration, native file permissions and real PostgreSQL transports require their own deployed compatibility checks beyond local fixtures.
- E00 host qualification, E06 jobs, off-host custody and complete all-service restore activation remain open.

## Alternatives considered

### Reuse the controller database and owner identity

Rejected because application users and workloads would inherit a shared identity/data boundary with platform administration.

### Preserve Supabase protocol compatibility

Rejected as an unnecessary constraint: the owner accepted a custom TypeScript SDK and case-by-case migration. The required backend behavior remains in scope.

### Expose generic table writes and database change feeds

Rejected because V1 requires typed application APIs and authorized domain/job events. Arbitrary browser-to-table CRUD, generic change feeds and presence remain outside V1.

### Treat local application startup as hosted qualification

Rejected because a process on the developer workstation does not prove professional-VM isolation, network policy, physical quotas, TLS or off-host recovery.

## Verification and references

The local acceptance contract is AC-53–AC-62, covering actual application identity, private file operations, held recovery, scoped SSE, SDK/runtime composition and owner configuration. Recorded executable evidence is maintained in the [verification strategy](../../tests/STRATEGY.md); only completed runs may be reported as passed.

The full browser regression passed 31/31 journeys in 181.393319 seconds (JUnit). All thirteen selected M74–M86 mutation experiments were killed in 257.091 seconds, with passing baseline/restored checks and unchanged original sources. Frozen source reviews passed against 78 backend/code and twelve UI hashes. Canonical builds, final affected backend rebuild, actual compiled-template HTTP/restart and SDK-consumer checks passed, together with lint (381 files), types, generated control OpenAPI `1.6.0` and 62/62 local acceptance trace links. Final combined unit/integration verification passed 972/972 cases across 72 files in 751.83 seconds (Vitest; 752.705 seconds for the whole command). These local results do not complete hosted E04, E00, full T30 or V1 release qualification.

See [application backend operations](../development/application-backend.md), [V1 requirements](../spec/v1.md) and [development plan](../plan/v1-development.md).
