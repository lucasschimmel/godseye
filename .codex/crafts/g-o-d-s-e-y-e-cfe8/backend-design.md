# E04 — local application backend and TypeScript SDK

Authorized continuation, 2026-11-12. Baseline d3902e1. Local-only: no host/server/account setup. Existing V1 requirements F16–F19 and tests T14–T17/T30/T34 govern this tranche. Automatic continuation follows the owner's explicit request and accepted architecture; no additional approval gate is inferred.

## Assumptions and boundaries

- ASSUMED: an application cell is exactly one project/environment. Application identities, sessions, objects and events live in that cell's independent application database/filesystem, never the controller's owner database. PGlite is a local stand-in for its existing independent PostgreSQL profile, not physical containment evidence.
- ASSUMED: email/password provides the first working application identity journey with Better Auth; OAuth is opt-in server configuration with exact origins/providers and a local configured OAuth fixture, without real provider enrollment. There is no public owner enrollment or application-to-controller authority.
- ASSUMED: private per-user files are the default. All object keys/physical names are server-owned. Expiring download access remains bounded and revocable. There is no arbitrary bucket/public filesystem exposure.
- ASSUMED: SSE suffices for versioned application domain events; generic database change feeds, presence and arbitrary browser-to-table CRUD remain outside V1. Trusted backend code publishes events; users cannot forge arbitrary system/job events.
- ASSUMED: the SDK is a separate package from packages/control-client. Browser usage carries application sessions, never owner credentials. The template accepts typed route extensions under explicit application authentication.
- Recovery HOLD, suspended projects, expired previews and incompatible configuration deny normal application work. A local explicit runtime registration is not proof of installed Docker/VM quotas, TLS/IPv6, off-host recovery or automatic release activation.

## Architecture and reuse

Reuse installed Hono, Zod, Drizzle, Better Auth/transaction adapter and existing checksummed-migration approach; no new runtime dependency unless justified. Query graph/reusables before introducing helpers. Keep owner routes and application listener separate. Server-owned immutable cell configuration establishes project/environment, allowed hosts/origins, independent store and file root, finite quotas and runtime guard. Public callers cannot select a database, physical path or claim an actor/role.

packages/app-backend owns application contracts/store/auth/files/events and the Hono runtime. packages/sdk owns the versioned browser/server SDK. apps/backend-template supplies a runnable example with authenticated typed application route and local configuration. The owner console adds a project/backend view and strict owner-only metadata configuration through the existing control client/API. These controls describe desired configuration and references; they cannot fabricate qualified execution, expose auth material or initialize remote providers.

Single sequential production implementation; GAUNTLET tests, gitsmith git and fresh review/documentation satellites own disjoint responsibilities. No parallel epic swarm. Root owns console/control integration, state and cross-layer verification.

## Story checkpoints and traceability

| Criterion | Contract / failure behavior | Test ID |
| --- | --- | --- |
| AC-53 | Independent per-cell application store, schema and runtime configuration; owner identity never authenticates an app; cross-cell/env requests fail. | T-AC-53 |
| AC-54 | Actual Better Auth signup/signin/session/signout, configured local OAuth fixture and revocation persist; exact origin/host checks, bounded auth endpoints and registration policy apply; no caller privilege escalation. | T-AC-54 |
| AC-55 | Lifecycle/recovery guard fences requests and post-I/O mutations; invalid/held/stale configuration is visible and cannot silently activate a restored runtime. | T-AC-55 |
| AC-56 | Private streaming/resumable file API validates finite reservations/chunks/hash/commit, user scope and object/aggregate quotas under concurrency; incomplete uploads never appear committed. File mutations provide idempotency/revision conflict semantics; native auth follows its own protocol. | T-AC-56 |
| AC-57 | File paths/symlinks and cross-user/cell grants fail; bounded expiring access and deletion revoke future reads; actual file/auth/config recovery to a separate held destination preserves committed metadata and identifies timestamp gaps/missing/incomplete files, without activating the destination. | T-AC-57 |
| AC-58 | Trusted domain publishing and authenticated durable SSE bind cell/user, bounded cursor/retention and explicit refetch gaps, never arbitrary table/control events. | T-AC-58 |
| AC-59 | Streams enforce bounded connections/buffers, cancellation/revocation/lifecycle checks and reconnection semantics; slow/closed streams do not leak capacity or acknowledge dropped events. | T-AC-59 |
| AC-60 | Separate versioned typed SDK supports auth/files/events/custom typed routes, abort/error/version handling and actual runtime composition with no Supabase runtime dependency. | T-AC-60 |
| AC-61 | Runnable local backend template and owner metadata/API/UI expose configuration, health/coverage truthfully, with owner freshness and no application material or executor authority. | T-AC-61 |
| AC-62 | Actual disposable per-cell store/filesystem/HTTP/browser journeys prove auth/file/event/restart behavior; generated API/build/static checks and independent defensive review preserve prior regressions. | T-AC-62 |

Order: E04.S01 identity/store → focused gate; E04.S02 files → focused gate; E04.S03 events → focused gate; E04.S04 SDK/template → combined gate. Owner metadata/UI accompanies the runtime contracts. Final gate: full unit/integration + browser suite, build/smoke, bounded selected mutations, scans, traceability and independently reviewed frozen source. Record unavailable tooling and unsupported remote qualifications explicitly.

Fresh FABER plan review BPL-001–003 accepted and incorporated: explicit app mutation replay/conflict semantics, actual configured OAuth fixture and actual held file/auth/config recovery round trip. These supplement existing inherited V1 obligations rather than reducing them.
