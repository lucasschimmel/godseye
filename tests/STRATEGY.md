# G.O.D.S.E.Y.E V1 verification strategy

Generated: 2026-11-11. Criticity: production intent. Current state: local control foundations, owner-access and service-broker suites exist, including real PGlite, native OpenBao and browser WebAuthn cases. Final continuation evidence is recorded per run; no case count certifies complete V1 or infrastructure qualification. Coverage and mutation percentages are not inferred from a test count.

This is a Gauntlet strategy for the target contracts, not a suite mirroring implementation. It traces [F01-F46](../docs/spec/v1.md), [I01-I16/D01-D10](../docs/spec/isolation.md) and [epics E00-E12](../docs/plan/v1-development.md). The local subset is mapped separately below; future provider modules in the plan remain proposed ownership boundaries.

## Harness and evidence

Use isolated test projects A/B with production/development cells, synthetic credentials/data, an attacker/RCE fixture in A, an external client and a disposable task guest. Tests assert observable access denials and surviving data/state, not internal function calls. Never target the user's unrelated services or production accounts. Run destructive/fuzz/resource tests in isolated lab capacity.

Every test below is a named scenario family; implementation will split cases without changing the stable family ID. Record release/provider versions, fixture manifest, input, expected/observed outcome, UTC timestamps, sanitized logs/artifact references and result. Raw credentials, full private prompts and unredacted personal data are excluded. Attach denial evidence as well as the corresponding legitimate allowed action.

| ID | Layer | Behavioral acceptance and required negative/failure case |
| --- | --- | --- |
| T01 | Integration/E2E | Owner login/passkey lifecycle works over private access; public/unauthenticated/non-owner/application identities cannot administer; revoked sessions fail and independent recovery restores the owner. |
| T02 | Real infrastructure | Execute every allow/deny in the connection matrix over IPv4/IPv6 and NAT/published-port paths. Project-container and optional task-guest IP/MAC spoofing, DNS rebinding/redirects and known private/metadata targets do not bypass host policy. |
| T03 | Real infrastructure | A and B have distinct effective gVisor application sandboxes, private networks and quota-managed data allocations inside one professional VM. Container-root A cannot access B or VM administration. Professional guest-root is a shared compromise, not a claimed tenant boundary. Optional task-guest root cannot access the professional/games VM or host; teardown removes protected task data. |
| T04 | Contract/infrastructure | Reject privileged/host namespace/device/socket/path and unapproved Compose options, including nested/template bypasses; legitimate app profile runs under verified capabilities/seccomp/write-path restrictions. |
| T05 | Integration/load | Concurrent capacity reservations do not over-admit; guest/container memory/CPU/process/disk/connection limits enforce, exhausted queues return bounded errors and protected headroom remains. |
| T06 | PostgreSQL integration | Different cells use different PostgreSQL clusters/volumes; API/worker/auth roles have only intended grants. Test PUBLIC defaults, owner membership, RLS bypass attempts, TLS identity/hostname failure, wrong database/user and connection limits. |
| T07 | Recovery | Restore A to before an already-completed external effect. Keep recovered jobs/outbox paused, fence old-cell producers, reconcile against non-rewound/provider evidence and prove the effect is not repeated. Check business/auth data and B unchanged; corrupt/missing WAL fails visibly; measure actual database RPO/RTO. |
| T08 | Integration/recovery | Rotate/revoke one service credential and broker grant without disclosing others; old access fails after transition and intended service resumes. Recover sealed credential store from the documented off-host material. |
| T09 | Fault injection | Crash/retry project provisioning at each external step; request replay returns one operation/resource mapping, conflicts return 409, orphans become visible/quarantined and suspend/resume preserves data. |
| T10 | Integration/E2E | PR preview uses separate sandbox/network/data/identity, receives synthetic data and selected artifact, expires at TTL and cleans up; failed cleanup is visible and production remains untouched. |
| T11 | Integration/E2E | Git change builds in disposable guest, produces immutable scanned artifact, deploys with progress/readiness/smoke evidence and keeps serving while console is offline. Failed readiness never promotes. |
| T12 | Integration/recovery | Eligible retained image rollback works with compatible config/schema; incompatible migration prevents promotion and runtime credentials cannot migrate. Failed DDL/promotion resumes safely; image rollback never rewinds unrelated data. |
| T13 | Integration | Owned domain verification/binding/TLS renewal routes to the intended registered web service. Unknown host, expired certificate, ownership failure and hidden management paths remain denied or visibly failed. |
| T14 | Integration | App auth/session/OAuth fixture works per cell; A tokens, issuer/audience/origin/cookie tricks and owner-console tokens cannot grant B end-user or platform authority. Revocation is effective. |
| T15 | Contract/integration | SDK contracts and local-dev template run auth/file/event/API flows against self-hosted services with Supabase Cloud blocked. Unsupported versions and invalid/oversize payloads fail predictably. |
| T16 | Property/integration | File grants enforce identity/resource/expiry/quota; traversal, encoded paths, forged references, symlink/redirect and cross-cell object names cannot leak files. Interrupt/resume uploads and oversize handling stay bounded. |
| T17 | Integration/load | Realtime channel scope/revocation holds across reconnect; cursors replay or request refetch on gaps, slow clients cannot cause unbounded buffering and B events are never delivered to A. |
| T18 | Fault injection/property | Cron/event jobs checkpoint/retry/cancel correctly; duplicate events, idempotency collisions, controller restart and stale worker leases cannot silently duplicate a protected external effect. Unknown effects require reconciliation. |
| T19 | PostgreSQL/integration | Crash before/after business commit, send and delivery acknowledgement; outbox recovers committed intent, never emits rolled-back intent and deduplication handles redelivery. |
| T20 | Contract/infrastructure | Cell A cannot trigger, register, sign, inspect or cancel B/platform workflow jobs using A keys, event labels or direct callbacks; legitimate A work persists across its engine restart. |
| T21 | Contract/integration | Selected Hermes release exposes required run/capability/SSE surfaces; API/CLI fallback explicitly loads chosen skill version. One writer per profile and correct per-cell context are enforced. |
| T22 | Property/adversarial integration | Prompt injection cannot expand grants, mount other homes, read B/controller credentials, approve itself or invoke forbidden tools. Exercise every action-policy row, missing approval, stale passkey step-up, changed parameters/revision and expired/replayed IDs; exact owner authorization is required where specified. |
| T23 | Fault injection | Disconnect/kill agent authority and adapters before/after submission; persist/recover the same run when knowable, show unknown when not, reconcile before retry and fence stale completions. |
| T24 | Integration/infrastructure | Cancellation, expiry and budget stop revoke grants and halt active process/workers before reporting cancelled. Cleanup failures, unavailable brokers and late writes remain observable. |
| T25 | Integration | Logs/metrics bind labels to authenticated cell; A cannot relabel/query/export B. Redaction, retention, stale/missing data and provider outages display correctly; Overview does not confuse unknown with healthy. |
| T26 | Property/integration | Attempt ledger handles input/output/cache categories, streaming, failed retries/fallbacks, missing usage and tool/local costs. Concurrent budget reservations enforce admission; reconcile against deterministic provider invoice fixtures. |
| T27 | Integration | Recurring security/log skill uses approved targets and scanner fixtures, preserves evidence, distinguishes repeated/new findings and preserves critical escalation; unavailable scan input produces incomplete status rather than a clean audit. |
| T28 | Integration | Market/competitor research yields source/time-linked deltas and marketing drafts use assigned brand context. Forbidden/unentitled publication is blocked; unknown delivery cannot be blindly repeated. |
| T29 | Evaluation/load | Freeze the numeric Laya policy in V1 before held-out evaluation; verify dataset separation/class/language counts, macro-F1/precision, zero critical suppression, sample review and exact CPU/RAM/latency/throughput limits. Reject unqualified use cases, prove fallback and require fresh held-out data after tuning to observed results. |
| T30 | Recovery/integration | Back up and restore file/auth/config/skill/credential-store recovery sets; show database versus file timestamp gaps. Retention preserves required base/WAL generations and off-host recovery access without leaking credentials. |
| T31 | Recovery drill | Rebuild clean replacement capacity with original host unavailable; recover owner/credentials/control/apps and data, but keep jobs paused until activation fencing/reconciliation. Simulate a gap in recovered effect history and require unknown/manual resolution, not blind replay; verify objectives and external outage detection. |
| T32 | Integration | Games/bots adapter lists correct resources/ports, performs authorized lifecycle/log operations, preserves data on restart and cannot reach professional data/admin paths. Unknown/deprecated API capability is explicit. |
| T33 | E2E/accessibility | All required views/critical owner flows work on desktop/mobile and keyboard; loading/empty/error/stale and approval states are useful. Server task continues after PC disconnect/reconnect. |
| T34 | Schema/contract | Validate draft/final DTOs/OpenAPI and fake plus real provider contracts; reject extra fields, hostile refs/provider IDs, duplicate environment IDs, unknown actions and capability mismatch. Revision/identity checks accompany shape validation. |
| T35 | Migration/recovery | Fixture Supabase migration checks schema/data/auth/files/API behavior, reversible traffic cutover and backup compatibility. Failed migration leaves source available and destinations isolated. |
| T36 | Load/soak | Run qualified reference workload for 72 hours: two projects with separate prod/dev cells, representative games/bot load and one bounded heavy task. Measure p95 API acceptance/read latency, <=5s connected updates, archive lag, headroom, error rate and queues; reject unqualified capacity claims. |
| T37 | State/property/fault | Operation state machine, idempotency/revision/fencing and approval binding hold through restart/reordering. Off-host protected audit copy exposes missing/reordered/tampered privileged records; expiry never auto-approves. |
| T38 | Integration/recovery | Exported project can be inspected/imported with intended scope. Deletion first revokes/stops, quarantines and then purges only after policy; failed prerequisites preserve recovery and expose residual resources. |
| T39 | CI/supply-chain | CI independently runs lint/typecheck/contracts/security and meaningful tests even if hooks are bypassed. Artifact provenance/pins and credential scans fail the pipeline on fixture violations. |
| T40 | Integration/fault | Deduplicate/ack/mute incident notifications and expire mutes; injected mail/webhook/provider failures stay visible, external uptime catches host loss and archive/credential-store outages raise scoped incidents. |
| T41 | Integration/fault | Verify raw-byte GitHub HMAC, exact repository/installation/branch binding, retry deduplication and shared-repository project fanout. Reject stale head before dispatch/promotion, deleted/tag/unbound events, altered signed bytes and delivery-ID collisions; out-of-order delivery cannot replace a newer accepted release. |
| T42 | CI/infrastructure | Execute recurring and source-triggered Jenkins checks on a qualified isolated agent, not the zero-executor controller. Verify private access, no production credentials/socket in builds, locked install, retained tests/artifacts, missed schedule/runner outage visibility and submission/result reconciliation after controller interruption. |
| T43 | Policy/integration/fault | Owner creates/revokes a bounded standing production delivery policy. Enforce exact source/target/policy revision, successful required checks, immutable artifact/provenance and fresh current head at promotion. Stale builds, policy edits/revocation, failed readiness, incompatible/destructive migrations and restored-cell activation cannot bypass the required gate; unknown external outcomes reconcile before retry. |

## Quality and release gates

All T01–T43 families are mandatory for V1; some run at story integration and others only on lab infrastructure. E00 qualifies the risky assumptions before infrastructure capabilities are enabled. The release runs the complete suite and a 72-hour soak. Local application tests have run; real isolation, recovery, capacity and Jenkins runtime qualification have not.

Coverage targets for implemented first-party business/policy code are >=85% lines and >=80% branches; mutation target >=70% on policy/operation/usage invariants. Report excluded generated/vendor code and surviving mutations. A high percentage does not waive a failed access-denial, recovery or critical journey test. Targets are planned gates, not existing results.

Property tests focus on policy scope, reference ownership, state transitions, leases, deduplication and budget arithmetic. Fuzz manifests/events/file paths/SDK inputs and external provider responses with bounded resources. One-IPv4 and direct numeric IPv6 probes, DNS A/AAAA readiness and IPv4-only fallback are required N01-N08 evidence. Contract tests verify supported pinned APIs; do not test internal framework rendering/ORM mechanics. Use real PostgreSQL and lab guests for their security boundaries rather than mocks pretending to prove isolation.

## Initial order and cost calibration

First author high-risk fixtures T02/T03/T06 and the operation/adapter skeleton T09/T34/T37. These are not trivial quick wins: they require actual VM/network/storage access. A cheap early documentation/schema check is useful but cannot substitute for them. Add backend/API scenarios after E03-E04, then durable/agent fault injection after E06-E07. Whole-host recovery and soak require admitted replacement/lab capacity.

Test writing effort is not estimated in hours before the infrastructure and providers are qualified. Every scenario references an actual proposed feature/contract; once source exists, bind the family IDs to concrete tests and record gaps rather than inventing implementation coverage.

## Local checkpoint evidence and exclusions

Family references below identify verified local slices, never blanket family completion. The earlier owner-access checkpoint on 2026-11-11 passed the then-current `pnpm check`: lint checked 134 files, generated OpenAPI matched runtime schemas, TypeScript passed, and Vitest passed 153/153 cases across thirteen files in 110.48 seconds. All seven runtime cases passed in that combined run. These historical commands identify the recorded run; active verification now uses Bun as described below. Neither checkpoint constitutes V1 release qualification.

| Source | Local slice |
| --- | --- |
| `tests/control.test.ts` | Planned project/environment creation, concurrent replay/conflict handling, scope, repository-write keys/revisions, local validation and disk persistence; T01/T09/T25/T34/T37 |
| `tests/webhook.test.ts` | Raw HMAC bytes, signature rejection, exact source/branch binding, deduplication and delivery collisions; T41 intake |
| `tests/policy-audit.test.ts` | Unknown/terminal guards, local audit corruption checks, persisted replay and monorepo fanout; T37/T41 |
| `tests/api.test.ts` | Real owner-session HTTP admission, Host/Origin denial, JSON syntax400/schema422, strict mutation input and raw signed webhook bytes; T01/T34/T41 |
| `tests/contracts.test.ts` | Design manifest/action/operation valid and negative shape cases; T34 |
| `tests/foundations-admission.test.ts`, `foundations-authority.test.ts` | Scoped reference ancestry, atomic admission/idempotency, exact fresh approval and grant/budget restrictions; T09/T22/T26/T34/T37 |
| `tests/foundations-execution.test.ts`, `foundations-evidence.test.ts` | Real consumer ticks/restart, lease/epoch fencing, unknown outcomes/evidence, overrun reconciliation, retention and trusted-anchor gap/tail verification; T18/T23/T24/T26/T37 |
| `tests/owner-auth.test.ts` | Passkey-only admission, endpoint allowlist, enrollment proof/ticket expiry/replay, sanitized sessions, freshness/revocation and recovery; T01 |
| `tests/owner-runtime.test.ts` | Seven passing local Windows cases covering private directory permissions, process exclusion, offline recovery and unsafe-path refusal; this does not qualify the future server OS |
| `tests/control-contract.test.ts`, `control-client.test.ts` | Fourteen passing current owner HTTP/OpenAPI and strict typed-client cases; no project SDK or real external-provider compatibility claim |
| `tests/e2e/console.spec.ts` | Actual owner enrollment before project/repository journeys, mobile/keyboard behavior and owner key/session UI; T01/T33 |
| `tests/e2e/owner-auth.spec.ts` | Native WebAuthn with virtual authenticators: registration/login, UV/origin rejection, ticket races/recovery and final-key guard; T01 |

The initial checkpoint recorded 74 passing Vitest cases and four browser journeys. The current 153-case run includes 32 foundation cases, 26 owner HTTP cases, seven local runtime cases and fourteen contract/client cases. These counts describe overlapping layers of the local checkpoint, not completed release families. Reports under `artifacts/test-results/` remain ignored run-specific outputs. Preserve the exact command/revision and sanitized report in the continuation ledger.

The earlier owner-access checkpoint passed the then-current `pnpm test:e2e` with 14/14 browser cases in 54.4 seconds, `pnpm build` for the client/SSR/bundled API, and `pnpm smoke:built`. Twelve local traceability criteria passed separately; they do not close all F01–F46 requirements. A local development probe returned 200 for the console and health, with `serverConnected: false`, and 401 for unauthenticated project access. These checks do not enroll a real owner or connect a server.

The earlier owner-access checkpoint reran the then-current `pnpm test:mutation`: all nine selected mutations were killed, with nine baseline/restored checks passing and original source unchanged. These experiments cover owner/project scope, unknown-state reconciliation, conflicting idempotency, stale revisions, HMAC/source identity and audit hash/link checks using temporary source copies. They do not establish mutation coverage of the new owner/runtime/contract modules. No full mutation, line or branch coverage score is inferred.

## Bun migration and service-access continuation

Bun 1.4.4 now manages the workspace and scripts, while Node.js 24 remains the application/test runtime. Use `bun install --frozen-lockfile`, `bun run bao:install`, `bun run check`, `bun run build`, `bun run smoke:built` and `bun run test:e2e`. The complete Vitest suite requires the pinned native OpenBao tool after a clean checkout. `bun run test` selects the existing Vitest suite; plain `bun test` selects a different runner.

After a clean Bun dependency installation without the old package-manager links, the migration passed `bun run check`: 153/153 Vitest cases across thirteen files in 112.15 seconds, with lint, generated-contract consistency and TypeScript also passing. The same migration passed fourteen browser cases in 39.4 seconds, client/SSR/API build and built-API smoke. A frozen reinstall preserved the lockfile; the dependency audit reported zero advisories and no untrusted dependency scripts. These are package-manager regression results, not evidence that Bun's runtime or the OpenBao broker is qualified.

The final combined continuation passed `bun run check`: lint checked 161 files, generated OpenAPI matched runtime schemas, TypeScript passed, and Vitest passed 215/215 cases across twenty files in 190.22 seconds. Client/SSR/API build and built-API smoke passed after the final security fixes. The following new groups are included in that combined suite; the complete browser run passed 16/16 cases in 53.8 seconds.

The final browser run contains five console, two service-access and nine native owner-authentication journeys. Console and service-access projects use separate application processes, temporary databases/state directories and ports; owner-authentication ceremonies retain their per-test servers. The empty-registry overview assertion remains intact. No fallback to the real owner's state or default owner authority is used.

| Source | Passing local slice |
| --- | --- |
| `tests/openbao-provider.test.ts` | Eight real native OpenBao 2.7.2 non-dev cases: compiled cell policy denial, KV CAS/prior versions, exact limited controller policy/root rejection, TTL/revocation, sealed denial/unseal and cold Raft recovery |
| `tests/access-provider-faults.test.ts` | Five transport/provider fault cases with bounded, sanitized failure |
| `tests/access-authority.test.ts` | Thirteen identity/proof scope, broker authority and durable failed-handoff cases |
| `tests/access-task.test.ts` | Ten task grant/worker/scope/lease/epoch/fence/cancellation, detached-context and private handoff cases |
| `tests/access-rotation.test.ts` | Eleven staged/qualified transition, pre-dispatch authority recheck, revocation evidence and uncertainty/reconciliation cases |
| `tests/access-http.test.ts` | Twelve strict owner-only metadata/API admission cases |
| `tests/e2e/access.spec.ts` | Two real console journeys for metadata management and unavailable-provider/transition state; screenshots retained under ignored artifacts |
| `tests/access-cli.test.ts` | Three private CLI cases for limited provider authority/explicit replacement, exact material staging/replay, proof issuance/replay, private handoffs and held-controller-lock refusal |

The native laboratory uses private temporary one-node Raft storage rather than dev mode or the unsupported file backend, with three in-memory Shamir shares and a two-share threshold. Initialization/unseal material stays out of reports. The official archive's published SHA-256 was verified; signatures were not. Installer paths exist for Windows/Linux/macOS x64/arm64, but only native Windows was executed. This proves the listed local provider behaviors; in-memory/fixture target adapters do not qualify real PostgreSQL credential transition or deployed service rotation. Normal startup admits no target transition adapter.

The final curated mutation run killed all eighteen selected mutations, with eighteen baseline/restored cases passing and original sources unchanged (finished 2026-11-11T17:27:38.164Z). Its selection covers the nine earlier invariants plus broker authority/uncertainty/handoff guards; it is not a full mutation score or inferred line/branch coverage. Eighteen local acceptance criteria traced to tests; full V1 trace completion is not claimed.

Fresh security review passed after three confirmed findings were fixed and independently rechecked: rotation authority after provider reads, detached task/use binding, and durable handoff attempts across failed callbacks. No confirmed findings remain open. The source-hashed report is retained under `.codex/crafts/g-o-d-s-e-y-e-cfe8/reviews/access-security.json`.

Portable Gitleaks 8.30.1 was checked against its published checksum; full history and the final 232-file source snapshot reported no findings. Bun's all-scope dependency audit reported zero advisories; frozen installation was unchanged and no untrusted dependency scripts remained. Semgrep and a complete SBOM generator were unavailable. These checks are not comprehensive SAST, a complete supply-chain assessment or a production penetration test.

These local cases do not qualify private remote networking or real hardware recovery, protected off-host anchor transport/storage, real PostgreSQL multi-process behavior, project container/VM isolation, DNS/IPv6/firewall behavior, Jenkins/agent execution, real external-provider outcomes, project backup/PITR, standing auto-deploy enforcement or capacity/soak objectives. A local hash chain plus an anchor obtained from the same compromised host is not a trusted off-host audit boundary. T42/T43 remain planned, and T41 current-head/delivery execution remains incomplete. All original T01–T40 release behaviors remain mandatory.

## Local E02.S03 infrastructure continuation

Infrastructure source is frozen and independently reviewed. The final `bun run check` passed **325/325 cases across thirty files in 244.70 seconds**, including lint on 203 files, TypeScript and generated-contract consistency. Build and built-API smoke passed on the frozen source. The previous 215-case unit/integration and sixteen-case browser results remain the preceding baseline. The final browser run passed **18/18 journeys in 73.155046 seconds (JUnit)** after the final French helper-copy change. [ADR-006](../docs/adr/ADR-006-local-inventory-and-cell-provisioning.md) and the [operator guide](../docs/development/infrastructure.md) preserve the accepted inventory/effect boundary.

New scenarios must distinguish owner declarations from trusted, fresh collector observations; local-PC data from actual AX41/guest inventory; preparation from admission; and reservation arithmetic from actual runtime/storage enforcement. Negative cases cover escape options, provider IDs/paths, unknown manifest fields, finite headroom, hierarchical accounting without double counting, IPv4/IPv6 aliases and overlaps, atomic collisions, service/cross-cell authority and unavailable qualification.

Execution cases must drive the real FoundationEngine consumer. Check actual effective configuration before application start and again before verified state; bind every step to current scope, immutable preparation, observation/policy revisions and live lease/epoch/fence. Inject lost receipts, restart, cancellation, post-read authority changes and provider drift. Uncertain resources retain their reservations. Exact owned resource evidence is required before adoption or cleanup; labels and name prefixes alone are insufficient, and foreign/orphan resources remain quarantined.

| Source | Tested local slice |
| --- | --- |
| `tests/infra-policy.test.ts`, `infra-network.test.ts` | Strict immutable application profile, pinned image identity, private canonical IPv4/ULA allocation and overlap/collision refusal |
| `tests/infra-inventory.test.ts`, `infra-admission.test.ts` | Desired/observed distinction, truthful local collector metadata, freshness, finite hierarchical accounting and atomic admission/reservations |
| `tests/infra-execution.test.ts`, `infra-authority.test.ts` | Actual Foundation consumer, scoped manifest/approval, live authority/fence checks and inspection gates before verified readiness |
| `tests/infra-recovery.test.ts`, `infra-persistence.test.ts` | Stable provider effects across lost receipts/restart, retained uncertainty/reservations, late-start protective stops and unresolved-intent refusal |
| `tests/infra-docker.test.ts` | Bounded Engine protocol/renderer/inspection plus private helper proof contracts; fixture transport is not live Docker enforcement evidence |
| `tests/infra-http.test.ts` | Owner/freshness/strict DTO/replay/version boundaries and absence of caller-authored qualification |
| `tests/e2e/infrastructure.spec.ts` | Real owner infrastructure UI declaration, native local refresh, immutable preparation and visible unavailable admission |

Fresh source-hashed security review passed after four confirmed defects were fixed and independently reproduced before/after: a late start outliving a prior protective stop; runtime proof freshness/target binding; reservation release on apparent absence while a provider mutation remained unresolved; and stopped Docker configuration being confused with running operational addresses. Verified infrastructure readiness and the Foundation terminal success now settle atomically. The minor French UI-copy change passed a supplementary scoped review. The reviews do not certify unavailable real helpers or remote hosts.

The final curated mutation experiment killed **31/31 selected mutations**, with 31 baseline and 31 restored cases passing, zero survivors/invalid cases and original target sources unchanged (finished 2026-11-11T18:58:43.117Z). This extends the earlier selection with infrastructure admission/evidence/uncertainty guards; it is not a full mutation score, line/branch coverage result or blanket qualification of T02-T05.

The dedicated rootless OCI laboratory first passed **4/4 checks in 14.65 seconds** on Windows/WSL Ubuntu. The final standard `bun run test:infra:lab` alias passed **4/4 checks in 17.027 seconds (17.26 seconds total)** on the same environment, using pinned gVisor `release-20261102.0` and Alpine 3.24.4 BusyBox/musl. It verifies the actual gVisor kernel/version marker, guest UID 1000 without capabilities, own/foreign fixture-root separation, a read-only root, a 1 MiB tmpfs rejecting a 2 MiB write with ENOSPC, and failed guest IPv4/IPv6 connections to fixture-owned listeners after successful control connections outside the guest. It never probes real administration endpoints or uses `runsc do`/host-root mounts.

The lab is invoked with `bun run runsc:install` followed by `bun run test:infra:lab`, separate from the default Vitest include set. Its installer verifies published archive SHA-256 values; signatures were not verified. Only Windows/WSL was executed. It explicitly uses `ignore-cgroups`, so these results do **not** prove CPU/RAM/PID enforcement, persistent-data quotas, Docker network/firewall behavior, the professional VM, Proxmox/Hetzner routing or outer KVM containment. A bounded temporary tmpfs is not a persistent project-data quota. Unsupported requirements must remain unqualified and prevent admission. The prepared Jenkins lab stage uses its own compatible Linux agent and stage-local JUnit/artifact collection; Jenkins has not been executed.

All **26/26 local traceability criteria** passed for this continuation; this is not completion of the full V1 traceability matrix. No full F/I/N family, coverage percentage or complete V1 qualification is inferred from the laboratory or fixture providers.

## Local E03 independent PostgreSQL continuation

The preceding baseline remains 325 unit/integration and eighteen browser cases; the new PostgreSQL-targeted slice passed 96 cases. Final verification passed **421/421 unit/integration cases across 37 files in 676.45 seconds** using `bun run test --maxWorkers=1`. Lint checked 238 files; TypeScript and generated OpenAPI `1.3.0` consistency passed separately. This was a split static-check/test run, not a literal invocation of `bun run check`. Final build and built-API smoke passed after all UI/version changes.

```sh
bun run lint
bun run contracts:check
bun run typecheck
bun run test --maxWorkers=1
bun run build
bun run smoke:built
bun run test:e2e
```

The final browser suite passed **21/21 journeys in 112.584583 seconds (JUnit)**. Its initial 20/21 run exposed missing repository-association success feedback; the UI was fixed and the complete existing journey passed without weakening its assertion. Fresh backend review passed after six confirmed findings were fixed and reverified, including private CIDR restrictions, complete ACL inspection, expiry validity, allocation-preserving renewal, operation/physical generation separation and dispatch checks after private connection establishment. Two independent UI findings (allocation-to-preparation mapping and stale revision form state) and the final feedback fix passed scoped rechecks. The final reviewed manifest covers 44 files. Do not add the separate laboratory count to the default suite or infer coverage percentages.

The curated mutation run executed 47 baseline/restored scenarios in 392.43 seconds. An initial M40 survived because the database unique constraint still denied admission after removing the application duplicate guard. Strengthening the public conflict assertion to require HTTP/domain 409 made the same-harness M40 reevaluation kill the mutation in 21.401 seconds, with its baseline/restored scenario passing. Final result: **47/47 selected mutations killed, zero survivors or invalid cases**, 47 baseline/restored cases passed, and original source unchanged. The earlier 90-second baseline timeout is preserved; the bounded harness default is now 180 seconds. These selected experiments are not a full mutation score or line/branch coverage result.

The frozen Bun install preserved the lockfile (246 installs, 362 packages), with zero untrusted scripts and zero dependency-audit advisories. Gitleaks found no findings in history or the allowlisted 286-file source snapshot. Final staged scanning is tracked separately; these checks do not constitute comprehensive SAST or a production penetration test.

The explicit `bun run postgres:install` and `bun run test:database:lab` path passed **10/10 native PostgreSQL checks in 15.08 seconds** across project A development/production and project B development, using PostgreSQL 18.6 on Windows/WSL Ubuntu 26.04. This extends the initial seven-check/11.15-second checkpoint with existing/default/column ACL drift denial. `vitest.pg-lab.config.ts` selects this separate suite and writes JUnit to `artifacts/test-results/pg-lab.xml`.

| Source | Evidence scope |
| --- | --- |
| `tests/pg-policy.test.ts`, `pg-projects.test.ts` | Strict independent-cell policy and revision/idempotency-safe project/environment metadata, finite named previews |
| `tests/pg-admission.test.ts` | Exact preparation/hash admission, current scope/revisions, capacity and actual Foundation queue; generic-plan bypass refusal |
| `tests/pg-bootstrap.test.ts`, `pg-recovery.test.ts`, `pg-renewal.test.ts` | Dispatch authority after private connection, uncertainty/restart/cancellation, allocation/profile-preserving preparation renewal and monotonic operation generations distinct from verified physical scope |
| `tests/pg-http.test.ts` | Owner/freshness, strict metadata DTO/client/OpenAPI boundaries and unavailable default execution |
| `tests/pg-lab-native.test.ts` | Production bootstrap/catalog inspection against three independent real instances; cross-project and development/production denials, TLS chain/hostname/no-TLS denial, DML versus DDL/role/program restrictions, auth/reader/workflow scope, actual role connection ceiling, restart persistence and existing/default/column ACL drift denial |

The current sanitized report `artifacts/test-results/pg-lab-report.json` records `status`, `checks`, `qualification`, `provenance.version`, `provenance.containment`, signed `provenance.sources` and hashed `provenance.packages`. The ten-check report is retained in `.codex/crafts/g-o-d-s-e-y-e-cfe8/reviews/database-lab.json`; `database-lab-initial.json` preserves the initial seven-check provenance checkpoint. The installer verifies Ubuntu `InRelease` using the archive keyring, then verifies index and package SHA-256/size; it extracts only into the project cache. No `apt install`, service or system configuration edit is performed. [Operator prerequisites and commands](../docs/development/project-databases.md)

The first expanded lab run passed nine cases and failed the existing post-restart worker connection; an unchanged repetition passed ten in 15.13 seconds. `artifacts/test-results/pg-lab-flakiness.json`, retained as `reviews/database-lab-flakiness.json`, preserves this intermittent WSL transport observation. The fixture now uses a five-second readiness bound for expected verify-full TLS/API-role connection establishment and `SELECT 1`; only connection establishment is retried. No DDL, DML, bootstrap or provider mutation is retried, and no authentication check is weakened. The final 15.08-second run passed all ten; this is fixture readiness evidence, not a production recovery guarantee.

This native-process lab shares its WSL host and UID. Its report explicitly marks production containment, Docker networking, VM isolation, hard CPU/memory/disk quotas and backup/PITR false. Independent system identifiers, distinct data/WAL and successful role/transport tests prove the listed PostgreSQL mechanisms only. Physical backup/PITR, protected off-host recovery and old-credential revocation/rotation still need their own actual evidence. Coverage and mutation fields are unmeasured, not zero or implied success.

## Local E03.S03 held-recovery continuation

The 421-unit/21-browser/47-selected-mutation result above is the preceding independent-database checkpoint. Recovery adds strict full/differential and archive-check preparation, Foundation admission/uncertainty, encrypted material, exact physical lineage/configuration and a durable runtime hold. The continuation adds 175 recovery-focused unit/integration cases. The first full run passed 595/596: one existing authority test observed 403 instead of its required 409 for a forged known-run context. Structural context/lease validation now runs first, followed by HOLD validation using trusted recorded IDs before authority can return or mutation/charging occurs. The unchanged failing test and the affected HOLD/authority slice passed after correction. The final standard `bun run test` rerun (default two workers) passed **596/596 cases across 45 files in 408.36 seconds**. Final build and built-API smoke passed after the ordering fix. Lint checked 274 files; TypeScript and generated OpenAPI `1.4.0` consistency passed separately. This is split static/test verification, not a literal `bun run check`, and no coverage percentage is inferred.

The three new recovery browser journeys passed in 54.8 seconds after fixing two colliding form-key prefixes, before the later held-environment label/selector refinement. They exercise owner security and mobile behavior. The first full browser run passed 23/24; its only failure was the previous feature-placeholder assertion after recovery was implemented. GAUNTLET replaced that single assertion block with checks for the actual unqualified backup heading, physical-server qualification warning, blocked activation and disabled backup/restore actions. Other journey assertions were unchanged. The final rerun passed **24/24 browser journeys in 140.767398 seconds (JUnit)** after the held-selector refinement and lease-order fix.

Independent frozen backend review passed after three confirmed findings were fixed and reverified: crossed source/destination data/WAL aliases, advertised intervals beyond supported history, and broker-backed read-only reconciliation with revoked mutation grants. The final schema-v3 manifest matched all 126 backend hashes before/after review. Its narrow lease-order supplement also passed (13 existing authority/HOLD tests in 26.50 seconds); 125 other backend hashes and all eight UI hashes stayed unchanged. Independent UI review passed after fixing held-environment labels and filtering recovery/held environments from ordinary database/access/infrastructure selectors. Preparation metadata remains visibly distinct from physical restore evidence. Retained reports are `reviews/recovery-security.json` and `reviews/recovery-ui-review.json` under the current context bus.

The curated experiment killed **61/61 selected mutations**, with 61 baseline and 61 restored checks passing, no survivor/invalid cases and original source unchanged. That report is retained as `reviews/mutations-recovery-before-lease-order.json`. After the lease-order correction, the two affected M52/M56 mutations were rechecked separately: both killed, both baseline/restored cases passed and original source unchanged. These are two executions of the same selected cases, not 63 distinct mutations or a full mutation/coverage score.

The frozen installation preserved the lockfile (246 installs, 362 packages), with zero untrusted scripts and zero JavaScript dependency-audit advisories. The generated OpenAPI `1.4.0` consistency check passed. Gitleaks found no findings in history or the 327-file allowlisted first-party source snapshot; final staged scan passed with zero findings; see review audit. This is scoped scanning, not comprehensive production certification.

| Source | Evidence scope |
| --- | --- |
| `tests/recovery-policy.test.ts`, `recovery-provider.test.ts` | Bounded private pgBackRest policy/protocol; exact scope/lineage, chain/manifest/LSN/timeline and independent inspection |
| `tests/recovery-admission.test.ts`, `recovery-faults.test.ts` | Exact owner/hash/Foundation admission, finite aggregate source/target/repository/staging/headroom commitments, lost ACK/cancellation and read-only reconciliation |
| `tests/recovery-archive.test.ts` | Fresh continuous archive check updates an existing backup interval without replacing manifest/chain identity |
| `tests/recovery-hold.test.ts`, `recovery-material.test.ts` | Durable hold across runtime/grant/broker/tool boundaries and private material authority without mutation-grant reuse |
| `tests/recovery-http.test.ts`, `tests/e2e/recovery.spec.ts` | Strict metadata-only owner API/client/OpenAPI `1.4.0`, unavailable default execution, blocked activation and French desktop/mobile flow |
| `tests/recovery-lab-native.test.ts` | Separate actual PostgreSQL/pgBackRest process integration, explicit older chain PITR, source preservation and real-tool negative cases |

The initial explicit native run passed **11/11 in 40.45 seconds**; the coordinator recheck passed **11/11 in 49.52 seconds total (48.245 seconds tests)**, using PostgreSQL `18.6-0ubuntu0.26.04.1` and pgBackRest `2.60.0-1.pgdg26.04+1`. The installer verifies the official pinned PGDG signing key and signed index/package hashes for pgBackRest, and signed Ubuntu metadata/packages for PostgreSQL/dependencies. Extraction stays under `artifacts/tools`; there is no `apt install`, root service or global configuration edit.

```sh
bun run postgres:install
bun run postgres:recovery:install
bun run test:recovery:lab
```

`vitest.recovery-lab.config.ts` selects the separate lab, excluded from default Vitest. Actual `ManagedPgBackRestProvider` dispatch creates two full generations and a dependent differential in an encrypted repository. Transactions before/after a known target, forced WAL archival and explicit backup/timeline/time selection prove a finite interval. The target reports actual recovery/read-only/paused state, original physical/catalog lineage and exact reached target; source state and subsequent writes survive. Replacement HBA rejects runtime credentials and inherited archive hooks are disabled before startup. Wrong scope/stanza/repository/cipher, corrupt manifest, unrelated source identity, nonempty target, missing WAL and unreachable-target cases fail closed.

The suite writes `artifacts/test-results/recovery-lab.xml` and `artifacts/test-results/recovery-lab-observation.json`. The sanitized retained record is `.codex/crafts/g-o-d-s-e-y-e-cfe8/reviews/recovery-lab.json`. The prepared Jenkins stage collects those two actual outputs, not a nonexistent recovery report. Native provider qualification intentionally remains `null`.

The lab's earlier iterations exposed production compatibility fixes: pgBackRest 2.60 rejects `--repo` on stanza-create/check/archive-push, and PostgreSQL target-time configuration needs normalized explicit UTC syntax. Negative unreachable-target assertions await actual bounded shutdown/fatal target evidence instead of relying on startup readiness. These observations are not transport retry or arbitrary historical-recovery guarantees.

Local native processes share the host/UID. No off-host durability, Docker/VM/firewall isolation, hard quotas or measured production RPO/RTO is qualified. Weekly/daily scheduling remains prepared-only and automatic expiration is disabled. Database coverage does not imply files/auth/config coverage. All-service activation is always blocked: actual producer fencing and a complete non-rewound business-effect journal remain absent; the existing Foundation per-run journal cannot substitute. Complete T07/T18/T30/T31 and D07-D10 release evidence remains open. See [held recovery operations](../docs/development/postgresql-recovery.md).

## Local E05 delivery continuation — spec-first GAUNTLET strategy

Generated by GAUNTLET, run `godseye-local-delivery`, 2026-11-11. Production criticity; TypeScript strict, Node 24, Bun 1.4.4, Vitest 5.1.0 and Playwright 1.65.0. Preserve the preceding **596-unit/integration and 24-browser** checkpoint. New acceptance IDs will be taken from the coordinator's frozen delivery design; this draft traces the existing T10/T11/T12/T39/T41/T42/T43 families and E05.S01–S07 instead of inventing completion claims. Strategy precedes delivery implementation inspection and mass test authoring.

### Current evidence and highest risks

`tests/webhook.test.ts` already checks exact-byte HMAC, malformed/missing signatures, delivery-ID collisions/concurrent deduplication, numeric repository/installation/name/branch scope and truthful `pending_verification`. Existing shared-repository fanout and HTTP intake cases must remain valid. `packages/core/src/github.ts` currently accepts push intentions; it does not verify GitHub's current head or execute builds. `autoDeploy` currently stores preference, not F46 authority. Existing Foundation/broker/infrastructure/recovery tests establish reusable durability, scope, budgets and HOLD behavior; they do not qualify GitHub, Jenkins, registry or deployment providers. The prepared Jenkins files and a successful platform CI report do not prove hosted application delivery.

The highest risks are accepting repository-authored claims as trusted provenance, leaking production authority into a PR build, promoting an older green build over a newer accepted head, bypassing a recovery HOLD through generic Foundation paths, and erasing preview/source resources after an ambiguous effect. Tests will verify preserved serving artifacts/data and exact durable states as well as expected denials.

### Priority fault matrix

All rows are high priority unless stated otherwise. Each test will use a stable T-family/local acceptance tag and GAUNTLET provenance. One scenario per test; generated/provider metadata alone cannot satisfy a real-process acceptance row.

| Family and target boundary | Observable acceptance and negative/fault cases | Layer / effort |
| --- | --- | --- |
| T34/T41 — delivery DTOs and immutable policy/compiler | Strict IDs, revisions, numeric repository/installation binding, branch/ref/head, web/backend type and finite source/build/artifact/preview/TTL/resource bounds. Reject browser paths/URLs, shell/SQL/CLI snippets, provider/job/registry IDs, credentials, hidden fields, nonfinite/fractional/overflow limits and arbitrary domain/target adoption. Hashes bind the complete immutable plan, policy revision and registered references. | Unit/property/HTTP / medium |
| T41 — raw push and PR intake | Retain exact-byte HMAC and body caps before parsing. Signed `pull_request` open/reopen/synchronize/close events bind base repository, installation, PR number and actual head identity. Wrong installation/repository, tags/deleted branches, unauthorized forks, base/head confusion, malformed SHA/actions, duplicate/colliding delivery IDs and transactionally fanned-out shared repositories never widen scope. PR close revokes that preview generation without authorizing a build. | Existing intake plus new integration / medium |
| T41/T43 — independent source verification | Actual current repository/installation/branch or PR head and access are checked before build selection and immediately before promotion. Event timestamps/order and payload `after` are insufficient. Missing/stale/foreign proof, suspended/revoked installation, force-push, branch delete, access loss and out-of-order old events fail closed. Recheck after awaited source/material/provider I/O; mutable caller input cannot swap authority. | Core/provider fault contract / large |
| T22/T43 — owner standing policy and shared Foundation | One existing Foundation queue, exact source/target/action/policy generation, lease/fence/epoch, fresh passkey policy creation/revocation and atomic bounded capacity. Service actors and repository code cannot create/widen standing production policy. Generic Foundation enqueue/grants, ordinary app lifecycle and broker handoff cannot bypass policy or durable recovery HOLD. Editing/revoking a policy invalidates queued/running authority before effects; production rollback and destructive/incompatible migration retain separate fresh approval. | Actual Foundation/broker/core/HTTP / large |
| T39/T42 — disposable build dispatch | Build consumes a fixed accepted commit and trusted pipeline definition with frozen dependency install and bounded time/output/disk/resources. Repository Jenkinsfile/config cannot control the privileged controller pipeline. No controller executor, host socket, production database/runtime identity or deployment material reaches build/PR execution. Missing qualified provider/agent/scanner is visible unavailability, never successful readiness. Lost submission ACK reconciles the same durable task, not a second build. | Provider contract plus real disposable lab / large |
| T11/T39/T43 — immutable artifact and trusted evidence | Rehash actual artifact bytes; content-addressed digest, accepted source commit/repository/installation, build inputs, pipeline/tool/scanner policy and output provenance remain exact and immutable. Reject modified bytes, mutable tags, mismatched/duplicate provenance, missing tests/scans, repository-authored green claims, outdated scan policy, malformed results and unknown scanner outcome. A publish/process exit alone cannot establish a deployable artifact. | Unit/property/core plus real byte harness / large |
| T11/T12/T43 — deployment lock/readiness/promotion | Per-target serialization and migration compatibility lock prevent competing promotions. Bound artifact/config/schema/source/policy/provider generations survive dispatch and settle gates. Actual readiness and smoke checks precede traffic selection; failure leaves the prior artifact serving. Race newer head/build against old completion, revoked policy during readiness, stale/cancelled worker, changed target/config/schema and lost traffic-switch ACK. Eligible image rollback changes artifact only and never rewinds database state. | Core/provider fault integration plus local serving fixture / large |
| T10/T03/T24 — isolated previews and bounded cleanup | New server-owned preview environment/allocation/network/data/identities per exact PR generation, synthetic data only, finite TTL/count/budget and atomic reservations shared with source/database/recovery commitments. Repeated synchronize updates the intended generation without adopting production or a nonempty foreign target. TTL/PR-close/manual cleanup revoke authority before teardown; only owned resources are removed. Late create/start after close, partial cleanup, wrong-scope observation, unavailable provider and absence during an in-flight effect retain uncertainty/reservations and expose residual resources. Production and other PRs remain unchanged. | Core/property/provider integration plus disposable lab / large |
| T18/T23/T37/T42 — restart and receipt reconciliation | Persist intent before source checkout/build/publish/deploy/cleanup. Crash before/after each effect, lost ACK/result, lease expiry/cancellation, duplicate scheduler ticks and out-of-order receipts never repeat uncertain mutations or accept foreign resources. Reconstruct controllers against persistent store; read-only reconciliation can inspect exact resources without renewing revoked mutation authority. Retain unresolved history/resources and distinguish desired/prepared, observed, ready, failed, unknown, stale and unavailable. | Fault-injection integration / large |
| T33/T34/T43 — private owner API/client/OpenAPI | Real owner sessions and typed client cover preparations, policy commands/revocation, run/artifact/preview status and explicitly unavailable default execution. Verify fresh passkey where required, service/unauthenticated denial, strict version/body/request/response schemas, idempotency conflict/replay, revisions/foreign references and safe exception/material redaction. No direct promote/force/restore-activation or credential/body escape route. Browser adds desktop/mobile empty/error/stale/revoked/HOLD and live progress journeys after API freeze. | HTTP/client contract; browser later / medium |

### Contract critique to settle before test authoring

1. Freeze one immutable source identity including repository ID, installation ID, accepted branch/PR head and policy generation. A GitHub signature authenticates received bytes; it does not independently establish current head or installation access. The production source-verifier default must remain unavailable without an actual qualified private adapter.
2. Separate source/build authority from artifact publication and deployment authority. PR code, build logs and scanner JSON emitted by the repository cannot supply their own trusted successful provenance. The deployment broker alone receives exact target authority; build jobs never receive production credentials.
3. Define the exact linearization/lock rule for two green builds completing out of order. Promotion rechecks a fresh authoritative head and current accepted target generation after awaited checks and immediately before the external switch; matching historical timestamps or a previously green result cannot win. Unknown traffic switches require reconciliation rather than a new switch.
4. Persist durable cleanup/generation intent for PR close or TTL expiry. A close arriving before an older synchronize/open event cannot recreate a preview from stale event metadata. Confirm the actual authoritative PR state/head and fence late provider completion; absence does not prove an in-flight create cannot materialize.
5. Reuse shared Foundation leases, effect receipts, idempotency, pool reservations and HOLD gates. A second delivery queue, a caller boolean `autoDeploy`, fake empty journal or actor/project membership alone cannot confer production or restored-environment activation authority.
6. Default all-service recovery activation remains blocked. A deployment/preview/rollback path must not clear HOLD or implicitly execute recovered jobs/outbox; missing E04 file/auth/config support cannot be manufactured through a delivery success DTO.
7. The actual local harness must run the production compiler/provider against disposable real bytes/processes and independently inspect artifact hashes/readiness/source preservation. Trusted temporary fixture processes demonstrate protocol and byte handling only. Untrusted repository code requires the existing qualified isolated runner boundary; no native-process fallback may be labeled gVisor/VM/Jenkins/firewall/hard-quota qualification. Cleanup is confined to checked disposable paths/resources.

### Execution order, selected mutation plan and boundaries

After the producer freezes DTOs/methods/provider seams: (1) strict schema/policy and raw event/source cases; (2) exact Foundation authority/HOLD/reservation and policy revocation; (3) artifact/provenance/readiness and source/promotion races; (4) preview lifecycle/TTL/uncertainty and reconstruction; (5) owner HTTP/client/OpenAPI; (6) disposable actual-provider evidence and browser journeys. The first quick wins are strict execution-field rejection, no execution from an unqualified provider or preference-only `autoDeploy`, and old-head/held-target promotion denial.

Use typed synthetic fault providers for controlled races and separate real-process evidence for mechanism claims. Reuse existing isolated A/B stores, owner session helpers, Foundation clock/deferred controls and capacity/broker fixtures. Keep new sources under `tests/delivery*`; preserve unrelated tests and production code. Run focused files while the producer works; coordinator owns global suite/build/browser/mutation scheduling. No external GitHub/Jenkins/registry/deployment effects, private environment/material reads, global installation, actual production resources or credentials are needed.

Later add selected mutants to the existing curated harness, with coordinator authorization: remove current-head/installation/policy-generation checks; trust caller scan/provenance; drop digest rehash; bypass HOLD/pre-dispatch fence; remove per-target generation lock; ignore preview TTL/close epoch; release unknown reservations; repeat a lost-ACK publish/deploy; or accept foreign artifact/preview resources. Every mutant needs one distinct observable scenario, clean baseline/restoration and unchanged original-source hashes. Existing 61 cases remain preserved; survivors are analyzed as gaps or redundant/equivalent defenses without weakening production code.

Starting result: `{coverage:{line:null,branch:null},mutation:{score:null,survivors:[]},flaky:[],layers_run:[],baseline:{unit:596,browser:24},gaps:["Delivery design/API/provider contract freeze pending","Actual disposable delivery-provider evidence pending","Remote GitHub/Jenkins/registry/deployer qualification remains separate","No new delivery implementation or execution claim"]}`.

### Final measured delivery checkpoint

The frozen AC-44–52 continuation adds **255 unit/integration cases** across thirteen delivery test files, including twelve actual trusted-process/byte/loopback-HTTP lab cases. The coordinator's global unit run passed **851/851 across 58 files in 569.99 seconds**. Actual shared Foundation, first-party GitHub source composition, owner HTTP/client, immutable build/rollback, preview cleanup and read-only uncertainty reconciliation are exercised independently of browser presentation fixtures.

The complete browser run passed **28/28 in 163.404282 seconds**. Visual review subsequently exposed clipped mobile actions that a document-overflow assertion missed. After delivery-only styles were corrected, the same four delivery journeys passed **4/4 in 58.082768 seconds** with whole-button/text/ancestor-clipping assertions. Refreshed synthetic desktop/mobile screenshots were personally inspected. These post-style checks supplement the preceding full run rather than claiming another full-suite execution.

`bun run test:mutation:delivery` selects affected historical M07 plus new M62–M73 through the existing temporary-copy harness. **13 baseline / 13 killed / 13 restored**, zero survivors/invalids, original-source SHA-256 comparison unchanged, **132.631 seconds**. Historical default61 remains preserved; the selected experiment does not establish exhaustive mutation or code coverage. Detailed per-file counts, reproduced/resolved findings, qualification boundaries and typed results are retained in `.codex/crafts/g-o-d-s-e-y-e-cfe8/reviews/delivery-test-strategy.md` and `reviews/mutations-delivery.json`.

Actual trusted lab evidence does not qualify untrusted repository execution, genuine scanner trust, Jenkins/registry integration, remote runtime/source providers, hard quotas or network/VM containment. Their default execution remains unavailable; held all-service recovery activation remains blocked. Line/branch coverage percentages remain unmeasured.

Final delivery staged Gitleaks scan passed with zero findings; see `.codex/crafts/g-o-d-s-e-y-e-cfe8/reviews/delivery-aegis.json` for the timestamped review audit.

## Local E04 application backend continuation — 2026-11-12

The per-cell application backend and separate TypeScript SDK have121 new scenarios
across fourteen focused files. Their risk matrix and precise execution/failure
history live in
`.codex/crafts/g-o-d-s-e-y-e-cfe8/reviews/backend-test-strategy.md`.
The first complete focused execution passed118/121 in258.67seconds; three fixture
expectations predated new instance-lock metadata/file-list pagination. The exact
affected three passed afterward in22.30seconds with authorization and preservation
assertions intact. The coordinator owns the final old+new regression.

Actual mechanisms include independent PGlite stores, real BetterAuth identity and
session revocation, private filesystem streaming/resumable bytes and commit-fault
recovery, scoped durable SSE and slow/unread subscriber cleanup, an actual local
OAuth2/PKCE provider exchange, and auth/file/config restore into a new held target
with component timestamps and unknown external recovery-point gaps. The runnable
template test verifies source startup, actual SDK/loopback HTTP and then compiled
backend startup against retained state. Built SDK JavaScript is imported and an
independent TypeScript consumer is checked. These are included within121 cases.

Three new owner browser journeys cover persisted per-environment configuration,
mobile controls and browser-supplied material/wildcard denial. Their initial3/3
execution passed55.6seconds. Actual screenshot review found panel padding needing
refinement; the root's final browser suite covers the corrected styles.
Selected mutants M74–M86 reuse the isolated-copy runner, retaining historical and
delivery suites separately. The selected execution passed13 baseline /13 killed
/13 restored with zero survivors/invalids, unchanged original sources and
257.091seconds wall time; evidence is `reviews/mutations-backend.json` in the
CRAFTS state directory. No exhaustive mutation score, line/branch coverage,
remote containment, live OAuth enrollment, off-host recovery or full V1 completion
is inferred. Native app stores on a shared host do not prove production cell
isolation; recovery activation and remote providers remain separately qualified.
