# Local implementation checkpoint contract

This is an acceptance contract for the local development tranche authorized on 2026-11-11, not the V1 release contract. Full F01–F46, I01–I16, D01–D10 and N01–N08 requirements remain under `docs/spec`; their provider-dependent test families are incomplete. No remote host is connected.

| Criterion | Observable acceptance | Verification |
| --- | --- | --- |
| AC-01 | The explicit local API rejects foreign Hosts/Origins, non-JSON mutations, forged owner input and malformed resource IDs. Production configuration is refused. | T-AC-01; `tests/api.test.ts`, `tests/policy-audit.test.ts` |
| AC-02 | Registration creates one draft and two distinct planned environments; concurrent identical requests converge, conflicting requests/slugs fail, and data/idempotency survive reopening storage. Scoped services cannot read another project or administer the registry. | T-AC-02; `tests/control.test.ts`, `tests/policy-audit.test.ts` |
| AC-03 | Local configuration validation records one operation and advances the project revision once. Stale revisions fail, unavailable provisioning performs no effect, terminal/unknown state guards and audit chain checks reject invalid use. | T-AC-03; `tests/control.test.ts`, `tests/policy-audit.test.ts` |
| AC-04 | GitHub intake authenticates exact raw bytes through HTTP, deduplicates concurrent deliveries, rejects collisions and invalid input, filters source bindings and fans out to every matching project. Runs remain pending verification. | T-AC-04; `tests/webhook.test.ts`, `tests/api.test.ts`, `tests/policy-audit.test.ts` |
| AC-05 | Versioned JSON design contracts accept representative fixtures and reject missing/invalid immutable artifacts, unknown command surfaces, invalid identities and invalid journal shapes. | T-AC-05; `tests/contracts.test.ts` |
| AC-06 | Browser journeys create, reload, validate and associate a project, navigate actual local views, expose disconnected states and support a mobile viewport and keyboard skip navigation. | T-AC-06; `tests/e2e/console.spec.ts` |
| AC-07 | Strict scoped references, immutable plans, fresh exact owner approvals and qualified adapter admission prevent unauthorized execution; default providers remain unavailable. | T-AC-07; `tests/foundations-admission.test.ts`, `tests/control-contract.test.ts` |
| AC-08 | The durable consumer resumes queued work, fences expired workers and prior epochs, and reconciles uncertain external effects without blind resubmission. | T-AC-08; `tests/foundations-execution.test.ts` |
| AC-09 | Atomic budgets and worker-bound grants constrain cumulative use; cancellation revokes authority and uncertain or overrun effects remain visible. | T-AC-09; `tests/foundations-authority.test.ts` |
| AC-10 | Retention preserves unresolved effects; paginated audit export verifies against an independent trusted anchor and detects gaps, changes and truncation. | T-AC-10; `tests/foundations-evidence.test.ts` |
| AC-11 | Only the fixed owner can authenticate through verified resident passkeys; absolute sessions, fresh sensitive actions, key/session revocation and trusted local recovery work without public signup or leaked session values. Private filesystem and offline recovery fixtures preserve project data. | T-AC-11; `tests/owner-auth.test.ts`, `tests/owner-runtime.test.ts`, `tests/e2e/owner-auth.spec.ts`, `tests/e2e/console.spec.ts` |
| AC-12 | Generated OpenAPI and the private typed client match strict versioned runtime request/response schemas; producer faults are bounded and hidden, and executor authority is absent from HTTP. | T-AC-12; `tests/control-contract.test.ts`, `tests/control-client.test.ts` |

Scaffold evidence additionally requires `bun run lint`, `bun run typecheck`, `bun run build` and `bun run smoke:built`. Jenkins/Compose preparation has configuration-parse/source-review evidence only; image build, Configuration as Code loading, agents, schedules and automatic site deployment are explicitly unqualified and are not part of a passing local runtime claim.

## Bun and service-authority continuation

| Criterion | Observable acceptance | Verification |
| --- | --- | --- |
| AC-13 | Bun replaces pnpm in active workspace, scripts, hooks and CI; frozen install reproduces pins/security override and original runtime/build/browser behavior. | T-AC-13; migration commands and baseline suites |
| AC-14 | Owner-only metadata management rejects caller authority, wrong project/environment ancestry, stale freshness/revisions and conflicting replay; no values appear in DTOs or audit. | T-AC-14; broker HTTP/core and browser |
| AC-15 | Verified service identities are exact-cell/purpose scoped, revocable and cannot administer owner APIs; private lookup derives provider scope from the identity. | T-AC-15; broker authority |
| AC-16 | Short task access checks real worker/lease/grant/epoch/fence/cancellation before and after provider I/O; expired/cancelled/forged/cross-cell grants cannot deliver values. | T-AC-16; actual FoundationEngine integration |
| AC-17 | Static rotation preserves the old connection on failed pre-transition readiness; unsupported or uncertain operations cannot claim activation. Lost revocation receipts preserve uncertainty without assuming the old access still works, and replay reconciles. | T-AC-17; rotation faults/restart |
| AC-18 | Real OpenBao per-cell ACL/CAS/revocation and non-dev seal/unseal/cold recovery pass with disposable fixture data; unavailable state preserves existing static consumer material. | T-AC-18; pinned native lab |

## Local infrastructure continuation

| Criterion | Observable acceptance | Verification |
| --- | --- | --- |
| AC-19 | Desired inventory and collector observations are distinct, versioned and scoped; real local-PC data is labeled local, stale/forged observation cannot admit execution. | T-AC-19; inventory/core/HTTP/browser |
| AC-20 | Immutable compiler rejects container escapes, caller paths/IDs and unbounded resources; exact runsc/systrap/non-root/security/network/data policy is server-owned and drift blocks readiness. | T-AC-20; compiler/provider inspection |
| AC-21 | Atomic host/guest/pro-pool reservations preserve headroom without double counting; dual-stack pools and address/protocol/port uniqueness reject overlaps/collisions. | T-AC-21; concurrent admission/IP policy |
| AC-22 | Accepted preparation drives actual FoundationEngine consumer with durable steps and exact scoped mappings; only complete inspected profile can become verified. | T-AC-22; real pump/provider contract |
| AC-23 | Lost receipts/restart/cancel retain unknown effects and reservations; reconcile adopts only exact owned resources, quarantines drift/foreign resources and never repeats blindly or prunes globally. | T-AC-23; fault/restart/cleanup |
| AC-24 | Strict owner API/client/OpenAPI and infrastructure UI manage inventory/preparation/admission/status honestly; service/cross-cell/caller authority and missing freshness fail. | T-AC-24; HTTP/client/browser |
| AC-25 | Available local runtime evidence and unsupported quota/network/runtime denial are reproducible with pinned tools and isolated fixtures; no simulated result certifies real containment. | T-AC-25; Linux lab + capability refusal |
| AC-26 | Input snapshots and post-I/O dispatch/inspection gates fence revocation, cancellation, stale observation/policy and epoch/lease changes; durable intent/evidence survives failure. | T-AC-26; race/fault/mutation |

## Project/environment and PostgreSQL continuation

| Criterion | Observable acceptance | Verification |
| --- | --- | --- |
| AC-27 | Revision/idempotency-safe project metadata and scoped environment registration/update, finite preview policy and accurate requested/verified lifecycle | T-AC-27; project lifecycle |
| AC-28 | Strict immutable independent PostgreSQL cell profile, server-owned mappings, distinct PGDATA/WAL, scoped roles and finite resources | T-AC-28; compiler |
| AC-29 | Durable Foundation-based database lifecycle with exact fresh owner authority, atomic reservations and generic API bypass refusal | T-AC-29; admission/consumer |
| AC-30 | Effective PostgreSQL bootstrap/inspection, PUBLIC/default-grant restrictions and per-service connection/schema authority | T-AC-30; actual SQL/driver |
| AC-31 | Private reference-only material; TLS/SCRAM/HBA and negative cross-cell authorization | T-AC-31; broker/transport |
| AC-32 | Idempotent restart/reconciliation, stale-authority/unknown-effect quarantine and no cross-cell adoption/deletion | T-AC-32; fault/restart |
| AC-33 | Authenticated French project/environment/database UI, HTTP/client/OpenAPI contract and honest unavailable/recovery states | T-AC-33; HTTP/browser |
| AC-34 | Explicit actual PostgreSQL independent-instance laboratory with negative role/transport/cross-cell checks, separate from production containment | T-AC-34; native laboratory |

## PostgreSQL backup and recovery continuation

| Criterion | Observable acceptance | Verification |
| --- | --- | --- |
| AC-35 | Exact per-cell backup/repository policy, finite budgets, strict owner inputs and truthful freshness/degradation | T-AC-35 |
| AC-36 | Concrete pgBackRest physical full/differential/WAL provider independently validates backup/recovery metadata | T-AC-36 |
| AC-37 | Restore creates a distinct held environment/allocation, retaining source and authenticated physical-clone catalog lineage | T-AC-37 |
| AC-38 | Shared Foundation fresh authority/reservations, idempotency and generic paths enforce exact recovery scope/capacity | T-AC-38 |
| AC-39 | Recovery-set database/file/auth/config timestamps and missing coverage remain explicit | T-AC-39 |
| AC-40 | Durable recovery hold/activation assessment blocks normal resume, producers, stale epochs and unknown/missing/truncated journal coverage | T-AC-40 |
| AC-41 | Lost receipts/restart/cancel/provider drift reconcile exact resources without repeats or premature release | T-AC-41 |
| AC-42 | French owner backup/restore UI and strict HTTP/client/OpenAPI expose references and honest state | T-AC-42 |
| AC-43 | Actual signed-tool PostgreSQL/pgBackRest lab demonstrates full/differential/archive/PITR into a paused new destination and negative cases | T-AC-43 |

## Local application-delivery continuation

| Criterion | Observable acceptance | Verification |
| --- | --- | --- |
| AC-44 | Signed push/PR intake preserves transactional replay/fanout; exact independent installation/repository/ref/current-head verification rejects stale, revoked, fork or closed sources | T-AC-44; delivery source/intake |
| AC-45 | Fresh owner creates/revokes bounded exact-cell standing delivery policies; preferences, services, expiry/revision drift or generic commands cannot widen authority | T-AC-45; delivery authority |
| AC-46 | Trusted builds produce immutable digest/size/source/recipe/check/scan/provenance evidence; foreign or browser-asserted artifacts cannot promote | T-AC-46; delivery artifact |
| AC-47 | Shared Foundation admission/lease/capacity/hold and serialized target lane protect durable deployment steps; cancellation/revocation/stale-head races cannot activate stale work | T-AC-47; delivery execution |
| AC-48 | Readiness/smoke/compatibility gate traffic promotion; history supports only eligible exact-authorized immutable image rollback without data restore | T-AC-48; delivery release |
| AC-49 | Verified PR previews have separate server-owned finite environments and empty/synthetic data; TTL/close cleanup preserves source/production and retains unknown resources | T-AC-49; delivery preview |
| AC-50 | Lost acknowledgments/restart/provider drift reconcile exact owned resources without blind mutation retries, foreign adoption or premature capacity release | T-AC-50; delivery faults |
| AC-51 | Strict owner HTTP/client/OpenAPI and French browser journeys expose policies, synchronization, releases/previews and honest unavailable/held states without material or executor authority | T-AC-51; delivery HTTP/client/browser |
| AC-52 | Disposable trusted local fixture builds and real loopback serving/readiness/promotion/rollback/cleanup demonstrate effect behavior separately from unqualified remote build containment | T-AC-52; delivery laboratory |

## E04 local application backend continuation

| Criterion | Observable acceptance / failure behavior | Verification |
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
