# Changelog

## [Unreleased]

### Added

- Added the local E04 application backend with an independent cell-bound store/listener, Better Auth application users, exact origin/cookie scope, optional configured PKCE OAuth and lifecycle/recovery-HOLD enforcement.
- Added private resumable file uploads with finite quota reservations, integrity/revision/idempotency gates, scoped pagination, authenticated expiring download grants, streaming/range reads and visible tombstones/cleanup.
- Added durable per-user domain-event SSE with signed cell/user cursors, bounded retention/connections, revocation and explicit refetch on gaps; trusted publication remains a private runtime method.
- Added the separate `@godseye/sdk` authentication/file/event/typed-route client, standalone browser bundle/declarations and explicit `backend:dev --standalone` template. No Supabase Cloud runtime path or owner/control code is included in the SDK artifact.
- Added private file/auth/config export/import into a separate empty recovery-held environment, preserving source data and refusing activation; sessions and provider access values are not restored. Cross-service/off-host recovery remains unqualified.
- Added owner project backend configuration through strict control API `1.6.0`, independently versioned from application API `1.0.0`. Saving desired settings does not start a hosted runtime. See [application backend operations](docs/development/application-backend.md).
- Verified 31/31 full browser journeys in 181.393319 seconds (JUnit), thirteen selected M74–M86 mutation kills in 257.091 seconds with green baseline/restored checks and unchanged original sources, frozen source reviews, canonical console/API/SDK/template builds and actual compiled-template HTTP/restart plus SDK-consumer checks. Lint (381 files), types, control OpenAPI `1.6.0` and 62/62 local trace links passed. Final combined unit/integration verification passed 972/972 cases across 72 files in 751.83 seconds (Vitest; 752.705 seconds for the whole command).

- Added local E05 policy/source/build/release/preview management through the existing FoundationEngine and the `/pipelines` owner console, with strict owner API `1.5.0` contracts/client.
- Added exact expiring standing delivery policy, independently verified GitHub App source protocol, immutable artifact/check/scan/provenance evidence, serialized release lanes and current-source-authorized retained-image rollback.
- Added bounded synthetic-only same-repository PR previews and protective TTL/verified-close stop/unpublish, preserving persistent data and uncertain reservations. Default source/executor remain unconfigured.
- Added `bun run test:delivery:lab` for twelve actual trusted managed-provider fixture checks (focused run: 4.21 seconds), also included in default Vitest. The combined run passed 851/851 unit/integration cases across 58 files in 569.99 seconds wall time and 28/28 browser journeys in 163.404282 seconds (JUnit), including four delivery journeys. Static checks (320 linted files, types and API `1.5.0` consistency), build/smoke and frozen backend/UI source reviews passed. The narrow responsive-CSS follow-up passed four delivery browser journeys in 58.082768 seconds with refreshed desktop/mobile visual checks; all thirteen selected delivery mutations were killed with green baseline/restored checks and unchanged original sources. Final build/smoke passed after the stylesheet change. No remote GitHub/Jenkins/Coolify/guest/registry/domain-TLS qualification or full E05 completion is claimed. See [application delivery](docs/development/application-delivery.md).

- Added passkey-only owner access, key/session management and explicit local enrollment and recovery procedures.
- Added durable execution foundations with exact approvals, scoped grants, fencing, budget reservations and evidence-based reconciliation.
- Added retained effect evidence, checksummed control migrations and independently anchored audit-export verification.
- Added a versioned control API, generated OpenAPI contract and internal typed owner client.
- Added metadata-only service identities/slots, purpose- and cell-bound private broker access, and a limited OpenBao KV v2 adapter.
- Added offline private provider-authority installation/renewal, material staging and service-proof handoff commands, plus the checksum-verified OpenBao laboratory installer.
- Added exact FoundationEngine task checks before/after material reads and qualified static-transition/reconciliation gates; local startup admits no target transition adapter.
- Added a pinned, dedicated rootless gVisor OCI laboratory for selected non-root, filesystem, temporary-storage and network-none checks, without a system installation.
- Added desired/observed infrastructure inventory, native local-controller metadata, strict immutable application preparation and hierarchical capacity/dual-stack reservations.
- Added FoundationEngine-backed cell admission, exact provider mappings, stopped-container inspection before start, protective quarantine and uncertainty-preserving reconciliation.
- Added a bounded Docker Engine transport with private quota/firewall/runtime/artifact helper contracts, control API `1.2.0` and the `/infrastructure` owner workflow. Default startup has no qualified execution provider.
- Added revision/idempotency-protected project/environment metadata management and named bounded persistent preview registration.
- Added immutable independent PostgreSQL 18 cell profiles with separate data/WAL, application/workflow databases and scoped role/bootstrap/inspection policy.
- Added exact prepare/admit database lifecycle through the existing FoundationEngine, with capacity reservations, durable effects, fencing and uncertainty-preserving reconciliation; default execution remains unconfigured.
- Added a project-local PostgreSQL 18.6 installer verified against signed Ubuntu metadata/package hashes and a separate three-cluster native laboratory. See [project/database operations](docs/development/project-databases.md).
- Added exact physical full/differential backup, archive-check and new-environment restore preparations through the existing FoundationEngine, with bounded repository/staging/headroom reservations and durable uncertainty.
- Added a concrete private pgBackRest protocol, encrypted repository material delivery, immutable chain/manifest/WAL evidence and a server-owned recovery hold; default execution remains unconfigured and activation blocked.
- Added signed PGDG pgBackRest 2.60.0 extraction and an explicit eleven-case actual PostgreSQL/pgBackRest recovery laboratory. Its local run passed in 49.52 seconds; off-host durability, containment, quotas and production recovery objectives remain unqualified. See [held recovery](docs/development/postgresql-recovery.md).

### Changed

- Replaced pnpm with pinned Bun 1.4.4 workspace/package management and a frozen `bun.lock`; retained Node.js 24 as the application/test runtime.
- Required owner authentication for private console/control routes; first use now requires `bun run owner:setup` and a human passkey ceremony. See [owner access](docs/development/owner-access.md).
- Required idempotency keys for repository updates and returned 422 for schema-invalid input while retaining 400 for malformed JSON.
- Advanced the generated owner control contract through `1.3.0` project/environment/database operations to `1.4.0` recovery preparation, admission, archive freshness and blocked-activation assessment DTOs/routes.
- Advanced the owner control contract to `1.5.0` for delivery policy, synchronization, preparation/admission, preview cleanup and metadata history; the hosted-application SDK is a separate E04 package.

### Security

- Protected local identity/database state with private OS permissions, unsafe-path rejection and exclusive controller/recovery locking.
- Recorded authentication changes in a durable audit outbox and withheld raw session values from browser JSON responses.
- Kept broker values/proofs out of owner HTTP responses and recorded uncertain provider/rotation outcomes without claiming old upstream access was revoked.
- Bound infrastructure execution to fresh exact target proofs and immutable preparation approval, and kept reservations/protective stops pending while a dispatched effect may still complete.
- Distinguished stopped Docker configuration from running assigned addresses; effective runtime, ports, mounts and ownership are checked before verified readiness.
- Required PostgreSQL SCRAM/private HBA, CA-chain/hostname-verified TLS, existing/default/column ACL inspection, least-privilege runtime identities and metadata-only owner responses. The native laboratory passed ten checks; production containment, hard quotas, physical backup/PITR and rotation remain unqualified.
- Preserved physical allocation identity during preparation renewal, separated cancelled-operation generations from verified physical scope, and reserved aggregate per-backend temporary disk with parallel workers disabled. Expired previews cannot provision/resume; protective suspension remains allowed.
- Blocked ordinary runtime/database/grant/broker/tool paths for held recovery environments. Physical clones retain source system/catalog identity, use a new allocation/data/WAL/network, and replace all inherited configuration/HBA/TLS/hooks before first startup.
- Kept read-only recovery reconciliation separate from revoked mutation authority, retained at least two full generations and dependent chains, disabled automatic expiration and kept scheduling prepared-only. Complete business-effect history, real producer fencing and coordinated hosted file/auth/config recovery remain unqualified; E04 adds a separate local held application recovery set.

The earlier local implementation passed 215 unit/integration cases and 16/16 browser cases in 53.8 seconds. The preceding E02.S03 combined check passed 325/325 cases across thirty files in 244.70 seconds, together with build/smoke and all thirty-one selected mutation experiments. Source review passed after four defects were fixed and independently reverified; the French UI-copy delta also passed scoped review. Its browser run passed 18/18 journeys in 73.155046 seconds (JUnit); the explicit gVisor laboratory alias passed 4/4 bounded checks in 17.027 seconds (17.26 seconds total), following its earlier 14.65-second run. All 26 local traceability criteria passed.

Final E03 verification passed 421/421 unit/integration cases across 37 files in 676.45 seconds using `bun run test --maxWorkers=1`, with lint (238 files), type checking and generated API `1.3.0` consistency checked separately. Final build/smoke and 21/21 browser journeys passed; browser JUnit duration was 112.584583 seconds after fixing missing repository-association confirmation without weakening the existing journey. The native PostgreSQL lab passed 10/10 in 15.08 seconds. All 47 selected mutation experiments were killed after strengthening the public 409 assertion for the initially surviving M40; baseline/restored checks passed and original sources were unchanged. Fresh backend, UI and final feedback reviews passed. See [verification history](tests/STRATEGY.md) for retained timeout/flakiness/retest evidence. These results do not qualify dedicated-server installation, private remote admission, Docker firewall/persistent-quota enforcement, real target credential transition/revocation, Jenkins runtime or protected off-host storage.

Those aggregate results precede the recovery continuation. Its native recovery coordinator recheck passed 11/11 in 49.52 seconds (initial run: 40.45 seconds), and three early recovery browser journeys passed in 54.8 seconds before the held-selector refinement. Independent backend/UI reviews passed and 61 selected mutations were killed, with two affected post-fix cases rechecked separately. The first full unit/browser runs passed 595/596 and 23/24; a lease-error classification fix and an updated obsolete feature-placeholder assertion are recorded in [verification history](tests/STRATEGY.md). The final run passed 596/596 unit/integration cases across 45 files in 408.36 seconds with `bun run test` (default two workers), 24/24 browser journeys in 140.767398 seconds (JUnit), lint on 274 files, types, generated API `1.4.0` consistency and final build/smoke after the lease-order fix. Complete D08 activation qualification is not inferred.
