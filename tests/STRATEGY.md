# G.O.D.S.E.Y.E V1 verification strategy

Latest local Inngest continuation gate (2026-11-12): **1,191 default cases passed**, with two
opt-in native cases disabled there; **both native cases passed separately**, alongside **41 browser
journeys**, six selected mutation kills, static checks, independent review and canonical build/smoke.
The [final frozen evidence](#final-frozen-local-evidence) records exact counts/timings, scope,
initial failures and corrections. E03/E05/E06 remain partial and no dedicated server is changed.

Preceding local audit-remediation gate (2026-11-12): 1,146/1,146 unit/integration cases across
93 files passed in 1,033.11 seconds (Vitest); 41/41 browser journeys passed in 315.46236
seconds (JUnit). This includes sixteen R1–R4 regressions. Five selected mutations were
killed with baseline/restored passes and unchanged source; independent source review,
lint/types/contracts/build/smoke passed. Reports: `artifacts/test-results/audit-remediation-unit.xml`,
`artifacts/test-results/audit-remediation-e2e.xml`, and the current
[audit/remediation record](../docs/reviews/2026-11-12-e01-e06-audit.md).
Historical checkpoints below retain their own scope. Earlier infrastructure/PostgreSQL/recovery
laboratory evidence remains historical; the Inngest native checks are reported separately here.

Created: 2026-11-11; updated 2026-11-12. Criticity: production intent. Local control, owner/broker, infrastructure/data/delivery, application and job suites include real PGlite, native OpenBao/Inngest, Windows permissions and browser WebAuthn cases. Final continuation evidence is recorded per run; no case count certifies complete V1 or infrastructure qualification. Coverage and mutation percentages are not inferred from a test count.

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

## Local E03.S01 project lifecycle continuation

`tests/lifecycle-http.test.ts` (15 cases) covers suspension gating, idempotent replay, stale
revisions, resume, deterministic export digests with no data claims, quarantine preconditions
(current-revision export, unresolved operations/jobs/rotations, passkey step-up), immutability of
quarantined projects, release, refused early purge with audit, residual-resource blocking and
the retention-expired purge tombstone. `tests/e2e/lifecycle.spec.ts` (3 browser journeys) covers
the French panel, the disabled purge until the slug is typed, and a 390px mobile layout.
The full unit/integration run ended with 1128 passing cases and two child-process timeouts
(`access-cli`, `owner-runtime`); both files passed when rerun alone (10/10). Mutation,
coverage and source review were not run for this stage. Physical suspension, application data
export and purge of provisioned allocations remain unqualified (ADR-012).

## E01–E06 audit remediation — 2026-11-12

The pre-remediation source audit passed 1,130/1,130 unit/integration cases across 89 files
(1,004.04 seconds) and 41/41 browser journeys (294.89689 seconds). These are the audit
baseline, not proof of the subsequent fixes. The default Vitest configuration excludes the
three explicit infrastructure/database/recovery native laboratory files.

Regression acceptance is frozen in [Audit-R1–R4](../docs/spec/v1.md#current-implementation-boundary--2026-11-12):
mutable live-job definitions must not relax unknown effects; outbox sends/probes must have
finite central waits and reject stale completion; approval renewal must preserve bounded
heavy admission atomically; and prepared CI must retain actual browser artifacts. Tests
must demonstrate the relevant old failure before the correction, then pass with the fixed
source. Run the affected behavioral files first, followed by static/contracts/types and the
appropriate integrated build/regression checks. Any mutation results are selected experiments,
not exhaustive coverage percentages. The [remediation record](../docs/reviews/2026-11-12-e01-e06-audit.md#remediation-tranche--2026-11-12)
contains the final scenario bindings, fresh counts and explicitly unexecuted qualification.

The focused correction gate passed 16/16 scenarios across four files in 17.73 seconds:
`jobs-definition-regression.test.ts` (six), `jobs-outbox-deadline.test.ts` (six),
`infra-approval-capacity.test.ts` (three) and `jenkins-artifacts.test.ts` (one). Each regression
file first reproduced its old failure. Static/contracts/types, canonical build and built-API
smoke passed separately. Final post-fix verification passed **1,146/1,146 cases across 93
files in 1,033.11 seconds** (Vitest) and **41/41 browser journeys in 315.46236 seconds**
(Playwright JUnit). Five selected mutations were killed in 60.542 seconds, with five
baseline/restored passes and unchanged original sources; replay with
`node scripts/mutation-audit-check.mjs`. Independent review passed and all fourteen reviewed
source/test hashes were rechecked. Final lint checked 471 files; TypeScript, generated
OpenAPI `1.8.0`, canonical build and built-API smoke passed. The expanded seventeen-file
redacted Gitleaks snapshot had zero findings. Bun audit found no vulnerabilities across 325
checked packages. Native laboratories, comprehensive Semgrep/SBOM and external qualification
were not rerun or claimed; the remediation record retains the exact scoped evidence.

## Application events and per-cell Inngest continuation — 2026-11-12

This tranche extends F18/F20/F21 and T17–T20/T24/T37. The preceding 1,146-case/41-browser
audit checkpoint remains historical evidence; its success is not reused as proof of new source.
The [local continuation criteria](../docs/spec/v1.md#application-events-and-per-cell-engine-continuation)
require the actual application-to-engine-to-Foundation chain rather than separate green mocks.

| Test source | Required observable proof |
| --- | --- |
| `backend-jobs-bridge.test.ts` | Application publication/intent atomicity, idempotent replay/conflict, SSE pruning versus intent retention, actual store reopen, captured epoch/HOLD denial, bounded capacity and actual send lifetime, lost acknowledgements, and custom transaction rollback |
| `backend-jobs-ingress.test.ts` | Exact project/environment/producer/epoch, metadata-only control receipts, stable replay after history pruning, prolonged HOLD, source payload hash/availability, bounded loader deadline, protected effects and cancelled uncertainty |
| `inngest-cell.test.ts` | Signed SDK refusal paths, wrong producer/host/port denial, Foundation-receipt acknowledgement rather than engine acceptance, and sole-calendar exclusion |
| `inngest-compose.test.ts` | Prepared-only independent cell profiles, pinned image requirements, minimum functional queue capacity, distinct authority/network/listeners and unsafe worker/path refusal |
| `inngest-config.test.ts` | Explicit finite main-server configuration, strict metadata, distinct/reserved ports and conflicting-mode refusal |
| `inngest-runtime.test.ts` | Existing owner-store scope/settings checks, preparation/startup/cleanup, no owner/project/definition creation, and an opt-in native main-process business-route path |
| `inngest-native.test.ts` | Two real authenticated native servers and signed SDK endpoints: trusted app publication reaches only its cell's terminal Foundation job; another cell's event key and unsigned worker invocation are rejected |

The native lab must be explicitly enabled and supplied the checksum-pinned project-local Inngest
1.52.0 tool. It must not start the cloud service, use the owner's application state, or silently
substitute a fake engine when the executable is missing. Generate fixture keys privately and drain
upstream diagnostics without publishing authority. Use independent temporary state directories and
unique HTTP, Connect WebSocket, gateway gRPC, executor gRPC and worker ports; stop all child
processes/listeners in cleanup. Pin the SDK to the separately versioned 4.26.2 API.

Native diagnostic runs exposed two integration faults before a successful full-chain execution:
Inngest 1.52.0 silently skips scanning with fewer than five free queue workers, and its callback
normalizes `127.0.0.1` to `localhost` at the same port. The launcher/profile uses ten workers and
rejects profile values under five; the SDK wrapper permits only loopback aliases at the configured
port while preserving mandatory signature checks. The actual OSS v2 sync route returned 501;
explicit SDK `PUT` performed registration. None of these corrections enables unsigned/dev-mode
execution. Failed diagnostic runs remain history and are not represented as successful evidence.

Negative cases must bind project, environment, producer and epoch, preserve immutable event identity,
and distinguish engine acceptance from correlated business completion. Inngest-backed cron cells
must not also be scheduled by fixture cron. Unknown/protected business effects retain the existing
Foundation reconciliation policy; retrying a transport cannot constitute approval to repeat them.

Native embedded Redis-compatible state/SQLite and shared development-process privileges do not
qualify external Redis/PostgreSQL durability, Docker/gVisor containment, quotas, private deployed
networking, off-host recovery, complete producer fencing or a 72-hour soak. Selected mutation
experiments are reported with baseline/restored/source-integrity evidence, never as an exhaustive
mutation or line/branch coverage score. The final frozen evidence is recorded below.

The explicit native command (`GODSEYE_INNGEST_LAB=enabled` in the process environment, then
`bunx vitest run tests/inngest-native.test.ts`) passed **1/1 case in 59.695 seconds test time,
70.82 seconds command wall time**. It traversed two actual independent engine processes and
signed workers to their own terminal Foundation jobs with real scoped payloads, and rejected a
foreign event key and unsigned invocation. JUnit is retained as
`artifacts/test-results/inngest-native.xml`. This opt-in case is not counted again as a default-suite
pass when disabled.

`node scripts/mutation-inngest-check.mjs` killed **six selected mutants in 232.656 seconds**, with
six baseline/six restored checks and unchanged original sources. The selected set probes publication
atomicity, exact producer scope, immutable receipt identity, epoch fencing, false timeout acknowledgement
and missing retained history; its result is recorded in `reviews/mutations-inngest.json` in the CRAFTS
state directory. It is not a full mutation score. The test owner's `reviews/inngest-tests.json`
retains earlier focused-run results, additional review regressions and the overwritten focused-artifact
limitation rather than presenting a later invalid concurrent-cache run as valid evidence.

The full existing browser regression passed **41/41 journeys in 502.140759 seconds** (JUnit;
`artifacts/test-results/inngest-e2e.xml`, zero failures/errors/skips). These journeys cover the
dashboard's existing owner flows; they do not substitute for the native engine path or claim a new
browser test of every managed-cell startup option.

### Verification history and Windows startup correction

The initial combined Inngest batch was **not green**: it recorded 1,170 passing, two failing and four
skipped cases, plus an OpenBao `beforeAll` failure. The two 45-second CLI child-process timeouts also
recurred serially; they were not dismissed as ordinary concurrent-load failures. Phase profiling of
1,301 PostgreSQL files measured 44.736 seconds in private-directory preparation versus 0.416 seconds
opening the store: repeated per-file Windows ACL reset processes dominated startup.

The correction batches read-only ACL inspection, skipping a reset only for an exact canonical
inherited current-operator FullControl rule. Drifted entries still use the guarded repair path;
link/hard-link/containment checks and failure refusal remain in place. A repeat diagnostic measured
2.993 seconds for private-directory preparation on the same file population. These are local
diagnostic timings, not qualified performance or relaxed test deadlines. Three additional Windows
ACL regressions exercise this boundary; the final serialized and full-suite results below supersede,
without concealing, the initial failures.

A separate actual compiled-backend failure revealed the new workspace-contract dependency was left
unresolved in the built artifact. `scripts/build-backend.mjs` now bundles that workspace boundary;
the actual compiled-template restart and independent SDK consumer checks passed **2/2** serially
after the correction. A successful source test or bundling invocation alone was insufficient proof.

### Final frozen local evidence

| Gate | Actual result | Retained evidence |
| --- | --- | --- |
| Fresh complete default Vitest run | **1,191 passed, two opt-in native cases skipped**; 1,193 total cases, 99 passing files plus one native-only skipped file, **945.55 seconds Vitest wall time** | `artifacts/test-results/inngest-unit-final.xml` |
| Final serialized focused gate | **55 passed**, one native case disabled, eight files, **242.23 seconds**; this preceded the last administrative-config assertions, which passed in the later complete run | `artifacts/test-results/inngest-final-focused.xml` |
| Explicit final Inngest native gate | **Two passed**, four ordinary cases filtered by the native selection, **28.62 seconds** | `artifacts/test-results/inngest-final-native.xml` |
| Full existing browser regression | **41/41 passed**, **502.140759 seconds JUnit** | `artifacts/test-results/inngest-e2e.xml` |
| Selected mutations | **Six killed**, six baseline/six restored checks, unchanged original source, **232.656 seconds** | `reviews/mutations-inngest.json` in CRAFTS state |
| Static/contracts | Biome **494 files**, TypeScript and generated owner OpenAPI **1.9.0** passed; application API stays **1.0.0** | Root verification ledger |
| Canonical artifacts | Full console/API/standalone SDK/declarations/backend build passed; actual built-API smoke passed in **8.67 seconds**, with remote server disconnected | Root build/smoke ledger |
| Dependency audit | **Zero vulnerabilities across 495 checked packages** | Root dependency report |
| Independent source/security review | Passed; **58 frozen file hashes** (45 production paths and thirteen test/tool paths) rechecked without mismatch | `reviews/inngest-code-review.json` in CRAFTS state |

The fresh default run includes all **45 added ordinary scenarios**: 42 Inngest/application/runtime
cases and three Windows ACL regressions. Their counts overlap the focused run and are not added
together. The two explicit Inngest native cases are deliberately disabled in the default run and
were executed separately. The final native gate proves both independent two-cell event delivery and
the main-process composition against the existing owner's store, including actual scoped payload
loading and post-start backend disable returning 423 without firing controller failure handling.
It does not certify a separate Inngest REST `COMPLETED` observation or external Redis/PostgreSQL.

Offline owner recovery and access administration select `purpose: "administration"` configuration,
which neither parses unrelated job-runtime JSON nor starts cell engines. Actual offline child-process
recovery with malformed `GODSEYE_INNGEST_CELLS` passed in the fresh full suite. Ordinary runtime
configuration still rejects it; explicit local mode and exclusive process guards remain enforced.
`inngest-config.test.ts` and `owner-runtime.test.ts` bind this local I13/T01 independence case.

The final redacted Gitleaks snapshot covered 58 paths (approximately 556 KB) and produced one raw
match: a known bootstrap placeholder, independently inspected and classified as a false positive.
There were zero actual findings and no suppression. Raw evidence remains
`artifacts/security/inngest-gitleaks-frozen.json`. Semgrep, Syft and cdxgen were unavailable; the
scoped manifest/lock inventory is not a complete SBOM or exhaustive transitive source review.
No line/branch/full mutation percentage, deployed containment, external persistence, off-host recovery
or full E06/V1 qualification is inferred from these passing local gates. No commit, push or
dedicated-server change was performed.

## Autonomous workers and external persistence — final local evidence

The preceding frozen local evidence describes the application-event/Inngest tranche only. The
current E06 completion slice now has scoped source/native proof against its independent-process
topology. The full default regression, selected mutations and canonical build/smoke gates now pass:

| Contract | Required behavior | Evidence status |
| --- | --- | --- |
| `T-E06-W01`/`W03` | Explicit cell child environment/config, no owner/foreign material, strict bounded scoped IPC and active callback authority | Passed; final full gates passed |
| `T-E06-W02`/`W04` | Real execution with owner HTTP absent; PostgreSQL journal concurrency and designated adapter consumption | Passed; final full gates passed |
| `T-E06-W05`/`W06` | Worker death/deadline and lost result preserve protected uncertainty, lifecycle/epoch fencing and bounded physical calls | Passed; final full gates passed |
| `T-E06-C01` | Live catalog add/change/pause/resume/removal reconciles without restart and obsolete authority cannot admit | Passed; final full gates passed |
| `T-E06-P01`/`P03`/`P04` | External dependencies are mandatory, independent and fail closed; startup/shutdown touches only owned resources | Passed; final full gates passed |
| `T-E06-P02` | Real pending workflow and history survive Inngest/PostgreSQL/Redis process restart with exactly one completion | Passed; final full gates passed |

The real-service lab uses existing signed PostgreSQL18.6 tools and signed/extracted Redis8.0.5
patched Ubuntu packages, with distinct authenticated cell services and retained private data/AOF
for restart. A mock, embedded Redis-compatible server, PGlite or configuration-only Compose check
cannot satisfy the external durability criterion. The initial Inngest event stream is in-memory:
source-domain outbox redrive must preserve identity until Foundation receipt even when engine
acceptance precedes a crash.

Native process results must be recorded separately from default-suite skips and from historical
browser checks. They do not prove Docker/gVisor isolation, enforced quotas, private deployed
networking, host-power-loss RPO, off-host recovery, coordinated restore activation or a full V1 soak.
The final counts, commands, timing, selected mutations, source/security review and canonical build
results are recorded below. Historical failed runs remain visible.


### Canonical completion criteria and executable aliases

GAUNTLET's W/C/P IDs are canonical. Earlier D01–D05 names remain in executable cases as aliases:

| Canonical criteria | Executable aliases and concrete files |
| --- | --- |
| W04 | D01: `tests/jobs-consumer-partition.test.ts` |
| W01/W03 | D02: `tests/jobs-runtime-config.test.ts`, `tests/jobs-runtime-ipc.test.ts`, `tests/jobs-runtime-broker.test.ts` |
| W02 | D03: `tests/jobs-autonomous-native.test.ts`, `tests/jobs-autonomous-crash-native.test.ts` |
| W05/W06 | D04: broker/IPC cases plus the native worker-death, protected-effect and read-only reconciliation cases |
| C01 | D05: real live-cron case in `tests/jobs-autonomous-native.test.ts` |
| P01/P02/P03 | `tests/inngest-persistence-native.test.ts`, runtime config cases, native platform case |
| P04 | D03/D04: hard-kill/owned-listener/same-source restart in `tests/jobs-autonomous-crash-native.test.ts` |

Helper failure regressions are `tests/test_jobs_services.py`: per-resource cleanup must continue
after an ownership refusal; failed state writes/replacement cannot truncate restart authority.
Final aggregate gates, scoped source review and all native cases pass.
A previous native cron failure is retained
as a real regression: pinned Inngest emits RFC3339 timestamp IDs, which the prior opaque-ID-only
Foundation validator rejected. Live SDK registration itself is supported by the pinned server;
registration acceptance alone is not proof that the cron reached a Foundation job.


### Current autonomous-runtime evidence checkpoint

The following are completed checks against the frozen local source. They are distinct from the
preceding embedded-engine checkpoint; reruns and focused selections overlap and are not summed.

| Gate | Actual result | Evidence |
| --- | --- | --- |
| Real external PostgreSQL/Redis | Two native cases passed, **43.343 seconds wall**: waiting step survives engine/PG/AOF restart; independent AUTH and unavailable dependency are checked | `artifacts/test-results/e06-persistence-native.xml` |
| Compiled owner HTTP absence/restart | Passed, **87.804 seconds**; application publication/handler reaches the same Foundation journal with owner HTTP stopped | `artifacts/test-results/e06-autonomous-built-initial.xml` |
| Compiled cell worker hard kill | Passed, **55.373 seconds**; protected started effect stays unknown and is not replayed after reopen | Same compiled-native checkpoint |
| Independent platform engine | Final strengthened case passed, **20.063 seconds test time / 22.84 seconds wall**; trusted maintenance uses its own stores and rejects tenant-envelope dispatch | `artifacts/test-results/e06-platform-final.xml` (the preceding 17.208-second run is historical) |
| Compiled supervisor hard kill | Passed, **96.016 seconds**; eleven owned listeners released, unrelated listener retained, same source producer/journal reopened | `artifacts/test-results/e06-supervisor-crash.xml` |
| Compiled read-only protected probe | Passed, **52.524 seconds**; scoped payload is loaded for the authorized probe without replaying the mutation or enabling outbox writes | `artifacts/test-results/e06-native-authority-catalog-final.xml` |
| Actual live cron catalog | Passed, **77.002 seconds**; new cron fires, current pause/change/resume works without worker restart | Same latest native checkpoint |
| PostgreSQL singleton/session loss | Passed, **15.153 seconds**; second supervisor using another local directory is refused and loss of the actual advisory-lock session stops admission | Same latest native checkpoint |
| Latest native selection aggregate | Three native cases plus two ordinary RFC3339 regressions passed, **155.90 seconds wall**; component times above are not wall-time sums | Same latest native checkpoint |
| Persistent operator helper | Actual native stop/restart retained owner-PG and both Redis sentinels; eight Python regressions and eleven independent failure probes passed | `reviews/e06-completion-services.json` and `reviews/e06-completion-services-review.json` in CRAFTS state |
| Static/contracts | Biome **527 files**, TypeScript, control OpenAPI **1.9.0** and application API **1.0.0** consistency passed | Root final-gate ledger |
| Dependencies | **Zero vulnerabilities across 495 packages** | Root Bun audit |
| Frozen source/security | Runtime review passed for **42 paths**; helper/installer reviews complete a **47-unique-production-path** union, with root SHA256 recheck showing zero drift | `reviews/e06-completion-code-review.json`, installer/services reviews and source-freeze manifest in CRAFTS state |
| Scoped secrets scanner | Gitleaks8.30.1: **47 explicitly selected paths, zero raw findings** | `artifacts/security/e06-gitleaks.json` |

There are **nine distinct new native cases** across persistence, compiled autonomous and hard-kill
files. They are opt-in through `GODSEYE_INNGEST_PERSISTENCE_LAB=enabled`; ordinary default-suite
skips are not native passes. A reproducible full selection, run serially after building the jobs
artifacts and installing the three local tools, is:

```powershell
$env:GODSEYE_INNGEST_PERSISTENCE_LAB='enabled'
bun run build:jobs
bunx vitest run tests/inngest-persistence-native.test.ts tests/jobs-autonomous-native.test.ts tests/jobs-autonomous-crash-native.test.ts --maxWorkers=1
Remove-Item Env:GODSEYE_INNGEST_PERSISTENCE_LAB
```

The fixtures create only disposable private native services; the supported operator helper uses
persistent owned directories and stops services without deleting data. Python regressions run with
`python3 -m unittest discover -s tests -p test_jobs_services.py` on Linux/WSL, not inside default
Vitest. Neither command uses an actual owner account or connects to the dedicated server.

The source review resolved distinct defects found during implementation: lease/admission rechecks
after awaited I/O, safe read-only reconciliation authority, completed worker ownership/cleanup,
shared PostgreSQL supervisor exclusion, helper cleanup continuation and atomic state writes. The
actual cron failure revealed RFC3339 event IDs rejected by the old opaque-only validator; canonical
RFC3339 and legacy opaque identities are now bounded and invalid/control-character forms refused.
The passing actual-fire test supersedes the failed earlier cron run; the failure is retained as history.

The final full default-suite, canonical full build/built smoke, both previous embedded native
regressions, selected mutations and strengthened platform observation pass. Exact results follow. The scoped dependency/manifest inventory covers twelve manifests;
Semgrep and Syft were unavailable, so this is not exhaustive SAST or a complete SBOM. Browser journeys
from the previous checkpoint are historical, not newly executed proof of these process changes.

### Final aggregate gates for local E06 completion

| Gate | Final actual result | Retained evidence |
| --- | --- | --- |
| Fresh complete default suite | **1,225 passed, eleven opt-in native cases skipped**, 1,236 total; 104 passing files plus four native-only skipped files, 108 collected files; **950.24 seconds Vitest wall time**, exit0 | `artifacts/test-results/e06-unit-final.xml` |
| New external/autonomous native cases | **Nine distinct cases passed** across the explicit case-level selections listed above; the final strengthened platform case passed in **20.063 seconds test time / 22.84 seconds wall** | GAUNTLET `reviews/e06-completion-tests.json`; `artifacts/test-results/e06-platform-final.xml` |
| Previous embedded native regression | **Two passed**, four unrelated ordinary cases filtered, **30.74 seconds wall** | `artifacts/test-results/e06-legacy-native-final.xml` |
| Selected mutations | **Seven killed**, seven baseline/seven restored passes, unchanged original source, **43.039 seconds**, zero survivors/invalid experiments | `reviews/mutations-autonomous.json` in CRAFTS state |
| Python/operator helper | **Eight Python regressions** plus **eleven independent failure probes** passed; actual persistent native PostgreSQL/Redis stop/restart preserved sentinels and ended with helper-owned services stopped | Helper tests and `reviews/e06-completion-services*.json` in CRAFTS state |
| Static/contracts/dependencies | Biome **527 files**, TypeScript, control OpenAPI **1.9.0** / application API **1.0.0** consistency passed; Bun audit **zero findings across 495 packages** | Root final verification ledger |
| Canonical full artifacts | Console, control API, standalone SDK/declarations, backend and autonomous supervisor/application worker/platform/guardian build passed; actual built-API smoke passed | Root final build/smoke ledger |
| Source/security/trace | Runtime review **42 paths**, **47 unique reviewed production paths** with zero root hash drift; Gitleaks **47 selected paths / zero raw findings**; canonical **11/11** trace bindings rechecked with no missing tests | Frozen review/scan manifests and `reviews/e06-completion-trace.json` |
| Local Git hygiene | `develop` and HEAD unchanged; empty index, previous edits retained, 69 new-source whitespace checks passed; no commit/push/remote mutation | Read-only gitsmith report |

All eleven opt-in native cases skipped by the default run were executed successfully outside it:
nine new cases and two prior embedded regressions. The nine new cases passed across explicit
selections, not a fictitious single fresh all-nine run. Focused/legacy/native/mutation counts overlap
and are never added to the ordinary 1,225 count. The 34 new ordinary scenarios are included there.

The browser suite was **not rerun for this request**, which changes no UI source. The previous
41-journey result is historical evidence only. Coverage percentages, exhaustive mutation scores,
full SAST/SBOM, deployed containment and disaster-recovery qualification were not measured.
The requested local E06 software scope is complete and verified. E00 dedicated-host work,
untrusted-code Docker/gVisor containment, network/IPv6/quota/capacity enforcement, off-host custody
and coordinated E03/E12 recovery/activation retain their mandatory release gates. No server setup,
owner-data migration, account enrollment, commit or push was performed.

## Local Hermes setup checkpoint — 2026-11-13

The E07 setup tranche adds 57 ordinary scenarios across filesystem, catalog, profile lifecycle, installer and CLI boundaries. Its dedicated batch passed; two native opt-ins were skipped there and passed separately against the actual Hermes 0.23.1/CPython 3.14.9 installation. The native profile case resolves all three generated role configurations in disposable mutable probe homes with socket/DNS access denied, only the pinned bootstrap skill and zero CLI/API tools. Immutable original snapshots and the installed runtime manifest remain unchanged. No model call, owner-store access or dedicated-host operation occurs.

Seven selected security/lifecycle mutations were killed with green baseline/restored checks and unchanged source bytes. Regression covers the confirmed missing-revision verification defect: refused promotion and inspection cannot create a broken profile or revision. Installer retry, archive/alias/hardlink refusal, snapshot tampering, scope/role partitioning, exact promotion/rollback, writer exclusion and failure-preserving pointer updates are covered.

Canonical criterion IDs T-AC-701 through T-AC-708 map to the local setup contract, not full T21–T24 epic acceptance. The E01–E06 full regression and browser suites were not rerun for this isolated script/configuration tranche; their earlier counts remain historical. No UI, owner API, store migration or execution engine changed. Actual running agents, mutable run-home materialization, provider calls, task grants, budgets, cancellation, Runs API and deployed containment remain unqualified.


## Local Agent Center continuation — 2026-11-13

The owner API advances to `1.10.0`; the application API remains `1.0.0`. The local
contract in `.codex/crafts/g-o-d-s-e-y-e-cfe8/agent-center-design.md` binds eleven
criteria, T-AC-721 through T-AC-731, to actual test files. Scope includes real
owner project/environment profile admission, one-turn model tasks, shared Foundation
reservations/heavy capacity, bounded history, stop/unknown reconciliation and the
private local provider. This is not whole-E07 or deployed-host acceptance.

The targeted ordinary batch passed 46 cases; an additional real-deadline ignored-abort
case passed separately, for 47 distinct ordinary Agent Center scenarios. The native
cases skipped by the default suite are separately qualified and never counted as
ordinary passes. Two actual PGlite reopen scenarios retain profile/task correlation.
Thirty-eight existing Foundation/infra regressions passed separately; they overlap
the eventual full suite and are not added to its count.

Seven Agent Center browser scenarios pass: four use the actual owner HTTP profile
backend, and three explicitly fixture task-transport responses to exercise launch,
result, cancellation and stale-security-query UI behavior. The latter do not prove
a native task traverses browser, HTTP and Hermes end to end. Two existing console
navigation/mobile-keyboard scenarios also pass. Desktop/mobile/result screenshots
are retained under ignored `artifacts/agents-*.png`.

Four curated copy-only mutation experiments were killed with green baseline and
restored checks and unchanged original source: missing provider identity, missing
physical stop proof, UTF-8 result bound and removed epoch fencing. This selected
score is not a whole-repository mutation or coverage percentage. Two genuine RED
regressions preceded the generic Foundation cancellation/epoch late-result fix;
a fresh delegated source review independently verifies logical cancellation survives
read-only physical reconciliation. A browser regression also verifies failed owner
security refetch cannot retain cached fresh identity or disable protective stop.

Native qualification runs actual pinned Hermes0.23.1, CPython3.14.9, gateway/skill
resolver and installed OpenAI SDK against a loopback model fixture. No provider key
or paid call is used. The separate frozen execution environment contains 74 installed
distributions; exact OSV queries cover 73 third-party PyPI name/version pairs with no
known findings. This is not a complete SBOM, reachability audit or hostile-code sandbox.
The initial native failures and their concrete dependency/provider/socket/skill/framing
fixes remain evidence of failures; they are not relabeled as passing qualification.
The final actual native selections pass separately: text completion in 41.66 seconds,
hostile tool-reply refusal in 47.93 seconds and controlled hanging-request cancellation
in 50.66 seconds. Each retains a stable run identity, actual stopped proof, one physical
fixture request, the reviewed skill and exact model/output/no-tools policy. The hanging
fixture is explicitly released after the stop request; proof requires actual handler
settlement, not the acknowledgement. Two subsequent read-only inspections do not replay.
Artifacts: `agents-native-execution-seventh.xml`, `agents-native-hostile-reply.xml` and
`agents-native-hang-cancel.xml` under ignored `artifacts/test-results`.

A separate actual Python reply-boundary opt-in passes text JSON/SSE and refuses tool/
function calls, oversized and expired replies; its stale-observation merge check proves
that polling cannot rewind the durable physical-attempt counter. It is one test case
with several assertions, not nine independent Vitest tests. No positive/hostile/cancel
native count is added to the ordinary suite total. Final global gates follow below.

Remaining measured limits: provider transport uses a counted authorization stub while
real Foundation admission/fencing is exercised separately through a typed provider;
no single browser-to-native production-key end-to-end journey is claimed. Native real
clock lease expiry, deterministic pre-enqueue cancellation race, binding-helper TTY
and fsync fault injection are not independently measured. General tools, publication,
approval inbox, full chat/SSE/artifacts, coding runners, invoicing reconciliation and
dedicated-server isolation/recovery remain separate implementation/release obligations.


### Final Agent Center aggregate gates

| Gate | Actual result | Evidence |
| --- | --- | --- |
| Complete default regression | **1,329 passed, 14 native opt-ins skipped**, zero failures; 114 passing files plus six skipped files, 120 collected; **2,195.94 seconds Vitest wall time** | `artifacts/test-results/agent-center-unit-final.xml` (JUnit summed test time is separately 1,941.5510423 seconds) |
| Current Agent Center cases | All 47 ordinary scenarios included in the global run, including ignored-abort/deadline retention; seven Agent Center browser scenarios plus two selected existing console journeys pass | `reviews/agent-center-test-results.json` in CRAFTS state |
| Actual new native qualification | Three distinct executions pass (normal response, unsolicited tool reply, controlled hanging cancellation); one final actual Python parser/counter case passes separately in 4.253 seconds | Native XML artifacts above; `agents-native-reply-final.xml` |
| Mutation | Four selected copy-only mutations killed; original sources unchanged | `artifacts/agents-mutation/summary.json` |
| Static/contracts | Biome 570 files, TypeScript and control OpenAPI 1.10.0/application 1.0.0 consistency pass | Root verification ledger |
| Build/runtime | Full console/API/SDK/backend/jobs build and actual built-API smoke pass | Canonical `bun run build` and `bun run smoke:built` |
| Security/source | 92 changed public source/docs/test files scanned with zero Gitleaks findings; 73 exact third-party PyPI OSV queries and 495 Node packages audited with zero known advisories; 53 production hashes unchanged under union of retained setup and current fresh reviews | `reviews/agent-center-security.json`, `agent-center-source-freeze.json`, `agent-center-code-review.json` |
| Trace/docs | All 11 local criterion IDs bind to existing cases; 156 relative file links and the new guide-to-strategy anchor resolve | `agent-center-trace.json`; `artifacts/agent-center-doc-links.json` |

The default native skips are opt-in boundaries, not failures or fresh verification.
The earlier Hermes setup and E06 native results remain historical for their frozen
source; their full native suites were not rerun here. The newly added Python reply
case was collected and executed separately after the global run began. The full
browser suite was not rerun; the nine selected journeys above are the current UI
evidence. Native counts, focused regressions and mutations overlap and are never
added to 1,329 ordinary passes. No exhaustive coverage/mutation percentage is claimed.
Scanner limitations and two harmless state-report/hash false positives from a broader
machine-state scan are retained in the security report; no risk waiver was created.

The requested local Agent Center slice is complete and verified. Full E07 and V1
remain incomplete as specified. No real API key, paid model call, owner-data migration,
dedicated-server change, commit or push was performed.


## Advanced local Hermes chat — 2026-11-13

The `hermes-chat-design.md` contract in CRAFTS state binds eleven local criteria,
T-AC-741 through T-AC-751, to conversations, actual incremental progress, history,
artifacts and exact existing-plan approvals. Control API 1.11.0 and migration 0019
reuse the existing Foundation queue/lease/grant/reservation/approval machinery.
The prior Agent Center checkpoints remain historical for their frozen source.

The targeted batch passes 31 ordinary cases across five files: real PGlite/Foundation
conversation/progress admission, exact plan proposals, private owner HTTP, bounded
SSE and physical store reopen. They cover idempotency/CAS, old-policy history versus
new admission, partial progress, epoch suppression, exact draft bytes/tamper, inert
attachment headers, expired/foreign/stale plan refusal, protective rejection, real
Foundation approval, cursor suffix/reset, capacity/abort/unread lifetime and actual
owner-session expiry. The confirmed read/prune race was corrected by serializing
cursor+suffix observation; the exact 256-event retention boundary is measured, but
no dedicated deterministic mid-transaction fault schedule is claimed.

Three current actual native selections pass: a held multi-frame response emits visible
text before completion, then a second explicit turn carries exact prior context;
a truncated stream cannot become success; an unsolicited tool response is refused.
The first selection has two explicit model requests, one per turn, rather than one
request for an entire conversation. The fixture controls only the model endpoint;
Hermes 0.23.1, Python 3.14.9, the installed OpenAI SDK, actual Runs API, broker and IPC
remain real. Raw prompts are not printed; context is compared with metadata hashes.
The older actual hanging-cancellation and reply-parser/counter cases pass separately
(2/2 in 47.76 seconds), preserving their original deadlines. No paid call is used.
Core and separate execution immutable manifests verify after the new native tests;
this is installation integrity, not hostile-code containment or provider entitlement.

Three new browser journeys pass across explicit selections: actual backend private
conversation creation/reload/unavailable feedback; labeled mobile EventSource partial/
reconnect, inert draft and rejection states; and a lost-send response with advanced
conversation revision that must retain the exact original body/key on verification.
The latter two model/stream/output paths use labeled UI contract fixtures after real
owner enrollment/project/profile setup. No single browser-to-paid-provider/native
end-to-end journey is claimed. Desktop/mobile checks preserve the existing visual
system, keyboard access, inert rendering and no horizontal page overflow.

Four curated copy-only mutation experiments are killed by actual behavioral assertions:
accepting a changed artifact digest, accepting a foreign plan, approving an expired
proposal and disabling cursor reset. Baseline/restored tests pass and original
production hashes remain unchanged. This is selected sensitivity, not an exhaustive
mutation score or line/branch coverage percentage. Missing-facade scaffolding failures
and corrected fixture mistakes are retained as such, not behavioral RED evidence.

The independent source review passes 23 binary criteria over 38 production files, with
no active finding; scope/expiry/approval, partial/final authority, native frame policy,
SSE lifecycle and UI lost-response handling are explicitly reviewed. General tools,
agent-created plans, canonical native paused controls, coding runners, E09 bundles,
paid billing and deployed-host containment/recovery remain outside this local slice.
Final full regression/build/scanner counts are recorded below after actual completion.


### Final advanced chat aggregate gates

| Gate | Actual result | Evidence |
| --- | --- | --- |
| Complete default regression, two disjoint groups | **1,360 passed, 17 native opt-ins skipped**, zero failures; **127 collected files** (119 passing, eight skipped) | `hermes-chat-global-builders.xml` + `hermes-chat-global-rest.xml` under ignored `artifacts/test-results` |
| Builder group | Two passed in one file, one worker, 23.03 seconds Vitest; shared artifact builder serialized | `hermes-chat-global-builders.xml` |
| Remaining default group | 1,358 passed/17 skipped, 126 files, two workers, 1,107.89 seconds Vitest; builder file excluded | `hermes-chat-global-rest.xml` |
| Aggregate integrity | No duplicate test identities across groups; summed Vitest wall durations 1,130.92 seconds | `artifacts/test-results/hermes-chat-global-aggregate.json` |
| Focused behavior | All 31 ordinary chat cases are included in the complete aggregate; three selected browser journeys, three current native selections and two additional legacy native/parser cases pass separately | `reviews/hermes-chat-test-results.json`; `reviews/hermes-chat-legacy-native-results.json` |
| Mutation | Four curated behavioral kills, baseline/restored pass, production unchanged | `artifacts/hermes-chat-mutation/summary.json` |
| Static/API | Biome 593 files, TypeScript, generated control 1.11.0/application 1.0.0 contracts pass | Root final gates |
| Build/runtime | Canonical full console/API/SDK/backend/jobs build and first actual built-API smoke pass | `bun run build`; `bun run smoke:built` |
| Security/review | 123 public source/docs/test paths Gitleaks 0; 495 Node packages audit 0; 73 third-party PyPI exact OSV queries 0; 38 production hashes unchanged under fresh review, 23 binary criteria pass | `reviews/hermes-chat-security.json`, `hermes-chat-code-review.json`, `hermes-chat-source-freeze.json` |
| Docs/trace/visual | Eleven canonical criterion bindings resolve; 162 local file links, reviewed scope/expiry wording, clean unmasked 390px/mobile and 1440px/desktop viewport captures | `hermes-chat-trace.json`; `hermes-chat-docs.json`; `hermes-chat-visual-proof.json` |

The two groups together cover the default Vitest include/exclude set. This is an
aggregate of two disjoint executions, not a fictitious single 1,360-case process.
Native opt-ins, focused cases, browser selections and mutants are not added to the
ordinary aggregate. E06 and earlier Hermes native qualifications remain historical
for their source; the full browser and all legacy native suites were not rerun.
A tall element screenshot initially stitched an offscreen skip-link overlay; final
unmodified viewport captures and computed focus/position metadata confirm it is
not a rendered product defect. No mask or style override is used for final proof.

The requested advanced local chat slice is complete and verified. Full E07/V1,
canonical native paused tools, agent-created plans, coding runners, external connectors,
paid billing and deployed containment/recovery retain their explicit remaining work.
No paid model call, real API key, owner-data migration, dedicated-server change,
commit or push was performed. Scanner and coverage limitations remain in the reports.

## Local typed Hermes tools — 2026-11-14

The frozen `hermes-tools-design.md` contract binds T-AC-761..774 to five fixed
first-party scratch/file/JSON operations. General shell/build/project code remains
blocked under I10 KVM; task contents never execute. A profile ceiling and separate
immutable owner task grant are required. The focused proof adds57 strict contract
cases and9 real PGlite/Foundation admission cases, preserving existing5 Agent Center
contract cases. Exact catalog IDs compose with Foundation without permitting
arbitrary underscore authority; unavailable execution refuses before model work.

Eleven distinct new native cases pass across separate selections: four actual
isolated-executor task/environment/project/scope checks; four actual Foundation+
executor receipt/restart/epoch/final-transaction expiry cases; three complete real
Foundation→pinned Hermes→scripted loopback model→actual isolated helper chains.
Success has3 actual model POSTs and2 durable tool calls plus actual artifact bytes,
digest, physical cleanup and released reservation. The count boundary has4 actual
POSTs and3 tools, refusing the fourth call without final output/artifact. A3000-micro
total reservation stops continuation after1 POST/tool and retains positive durable
conservative spending within the total cap. Only the model endpoint is simulated
in those complete chains; direct authority callbacks are reported separately.
Two selected existing actual native cases also pass after the bridge changes:
one-request no-tools and incremental text followed by exact successful-history reuse.

Three selected browser cases pass: actual owner ceiling persistence with unavailable
task controls; labeled lost-response retry preserving exact nested grant/copied bytes/
key after policy revision and pause; labeled mobile explicit rights/copied inputs,
inert tool output and uncertain cleanup/budget messaging. These response fixtures
follow real owner/project/profile setup and are not browser-to-native-provider proof.
The unmodified390px viewport was inspected without clipping or skip-link overlay.

Five selected isolated source-copy mutation operators are killed with baseline and
restored passes and original source hashes unchanged within each run. They cover
duplicate allowlists, traversal, UTF-8 caps, canonical durable allocation identity,
and the final in-transaction authority fence. The last two use actual native tools;
the final fence regression preserves real database mutations/rollback and injects
clock expiry after the final observation update await. No whole-suite mutation or
line/branch coverage percentage is claimed.

The runtime reports actual production cgroup values and sampled gofer/sentry
membership, production owner-death/EOF cleanup and benign sentinel survival.
Smaller controlled kernel OOM/PID refusal and a separate pinned runsc tmpfs ENOSPC
laboratory supplement those observations; they are not exhaustion of production
512MiB/128-task/4MiB workspace bounds. Hostile links/special files cannot be created
through the catalog and were not physically injected. Fixed no-follow/regular-file
checks, strict paths, copied-data-only execution and fresh review are the stated
complementary boundary. No deployed Docker/host or KVM qualification is implied.

Distinct names, exact artifacts and canonical14-criterion limits are recorded in
`.codex/crafts/g-o-d-s-e-y-e-cfe8/reviews/hermes-tools-test-results.json` and
`hermes-tools-test-matrix.md`. Final root gates passed:1,426 ordinary cases and28
default native skips across132 files, zero failures. The disjoint serialized builder
group passed2 cases in18.86s and the remainder passed1,424 in1,082.09s, totaling
1,100.95s Vitest wall time. The66 focused new ordinary cases are already included.
The1,454 JUnit cases have1,452 display labels because two existing Infinity/NaN
parameterized pairs serialize as JSON null names within their file; there is zero
cross-group overlap. Canonical build and first built-API smoke passed, as did lint
over615 files, types and contracts at control API1.12. Frozen68 production hashes
have zero drift; HTR-001 and HTD-001 review findings are resolved. Exact evidence is
`.codex/crafts/g-o-d-s-e-y-e-cfe8/reviews/hermes-tools-final-gates.json`.
Focused and repeated native/browser/mutation cases are never added to this aggregate.

## Local E07 orchestration — 2026-11-14

The requested local bounded orchestration software is complete and locally verified. The
[operator guide](../docs/development/agent-orchestration.md) and
[story-level table](../docs/plan/v1-development.md#local-e07-orchestration--2026-11-14)
distinguish local completion from external/native-provider qualification.

Focused ordinary families are `orchestration-contracts`, `orchestration-plans`,
`orchestration-runtime`, `orchestration-http`, `orchestration-composition`,
`orchestration-clarification` and `orchestration-proposals`. They exercise strict
DAG/UTF-8 limits, immutable hashes/revisions/epoch, aggregate budgets, recent-passkey
exact approval, service denial, durable child identity, serialized real Foundation
composition, unknown/no-replay, protective cancellation, bounded explicit inert
handoffs, strict pending-only Hermes extraction and new remaining-effectful
clarification continuations without completed-prefix replay.

Final authority checks occur after awaited settlement before committing logical
success; expiry/revocation rolls back publication. Foundation uncertainty marks the
parent unknown atomically before coordinator polling, fencing dependent publication.
A stop transport error retains `CLEANUP_UNCERTAIN` resources without terminating the
whole coordinator. These are regression targets, not claims of paid-provider or
physical interruption qualification. Browser coverage uses desktop/mobile owner
flows with labeled contract-backed model/runner states and inert rendered output.
Final evidence is split by scope rather than reported as a whole-repository run:

| Gate | Final result | Evidence boundary |
| --- | --- | --- |
| New focused ordinary cases | 60 unique passes: 59 across seven files in 130.57 seconds plus one disjoint coding-stop-throws case in 6.88 seconds | `artifacts/test-results/orchestration-frozen-final.json` and `orchestration-coding-stop-final.json`; same frozen production source |
| Existing relevant regression | 656 passes, one legacy opt-in skip across 55 files in 533.21 seconds | `artifacts/test-results/orchestration-regression.xml`; selected relevant scope, not the full repository suite |
| Disjoint ordinary total | 716 related passes | 60 new plus 656 existing; repeated checks and browser cases excluded |
| Desktop/mobile browser | 2/2 passes in 60.418002 seconds (final JUnit) | Responsive owner plan/clarification/recovery flows; labeled provider fixtures |
| Selected mutations | Three selected mutants killed; baseline/restored checks pass | Preliminary redundant adapter-guard survivor retained in the mutation history; no generalized mutation score |
| Independent security/source review | PASS, zero open findings | `.codex/crafts/g-o-d-s-e-y-e-cfe8/reviews/orchestration-security.json`; source and probe history, including the now-passing coding stop-throws regression |
| Static/contracts | TypeScript, Biome 676 files, generated API `1.14.0` check pass | Root final checks |
| Canonical build/smoke | Build and built-API smoke pass | Original 15-second local health bound; remote server disconnected |
| Source freeze | 508 public source/input hashes unchanged after final build | Final source identity, not deployed qualification |
| AEGIS/dependencies | 791 public files, zero new actual credentials; one unchanged synthetic placeholder; Bun audit zero advisories | Semgrep and SBOM tools unavailable; no claim of their coverage |

The two selected focused runs are disjoint by case despite sharing a test file.
Their 60 passes are not added again when reading repeated focused reports. All
required local final gates passed. No paid calls, dedicated-server actions or Git
mutations occurred.

No new paid calls or native-host qualification is implied. Existing locally measured
coding KVM/provider composition and Hermes native tool evidence retain their original
source boundaries. Native vendor pause/resume parity, deployed providers/host and
coordinated recovery, E08 invoice/usage reconciliation, E09 bundles and separately
authorized E05 preview/connectors remain distinct. Neither general Hermes shell nor
automatic deployment/publication is introduced.

## Local E08 usage, observability and incidents — 2026-11-14

The requested local software is complete and locally verified. This
section tracks current-source AC-801–AC-818, not a new whole-repository pass count.
The [operator guide](../docs/development/usage-observability.md) and
[story table](../docs/plan/v1-development.md#local-e08-usage-observability-and-incidents--2026-11-14)
distinguish implemented local behavior from qualification.

Required behavioral evidence includes committed acknowledged intent before POST,
immutable/idempotent outcomes and scope denial; exclusive token categories/raw
vendor totals/cache TTL; frozen prices/expiry/overflow; unknown usage; no Foundation
invoice refund; atomic rolling monetary/rate/concurrency budgets; terminal missing
report releasing only the physical slot; actual physical unknown retaining exposure;
SQL-scoped summaries/keyset pages/windows/invoice attribution/retention; and actual
provider/tool observations distinct from allocated maxima.

Observability checks cover exact source/ancestry/correlation binding, fixed bounded
structured input, no raw prompt/stdout storage, fresh/stale/missing/unknown states,
seven-day log/thirty-day metric pruning with a minimal health head, scoped database
cursor gaps and explicit unknown producer continuity. Operational counts/timelines
must use real journals and explicit identities. Incident checks cover exact
detector-owned clearing coverage, detector failure isolation, lifecycle CAS,
durable outbox claim-before-effect, concurrency/restart, bounded explicit-failure
retry, active physical-slot retention and timeout-unknown/no-blind-retry behavior.

The final frozen-source evidence is bounded to this local implementation:

| Gate | Result and counting boundary |
|---|---|
| New E08 focused | 76/76 cases across 18 files, zero skips, 173.13 seconds; `artifacts/test-results/e08-focused.json` |
| Native composition inside those 76 | Two actual ManagedHermesProvider/Hermes/Foundation cases, four production broker/custom-Node-parent cases and one wrapper running four production coding-broker Python probes; these are included/nested, not additional passes |
| Other related regression | 671 passes, one skip across 56 files; separate from the new E08 cases |
| E07 orchestration regression | 60 passes across seven files, disjoint from the preceding 56-file run |
| Existing coding Python | 29 passes, two explicit opt-in captured-payload skips, separate from the new focused batch |
| Owner browser | 5/5 desktop/mobile cases, zero skips, 85.119 seconds XML time; `artifacts/test-results/e08-e2e.xml`. Includes real source metric value 123, unavailable freshness/time/incident and owner acknowledgement, plus stale-CAS and refetch draft-reset races |
| Selected mutation | Six of six behavioral source-copy mutants killed, baseline/restored runs passed and original sources unchanged; three preliminary harness-interception survivors are retained in the report history |
| Independent review | PASS, zero open findings; four confirmed findings independently closed, including starvation, cross-detector false clearing, expired full-log retention and budget draft/revision mismatch; final lint delta rechecked |
| Static/contracts/build | Biome 733 files, TypeScript, generated API `1.15.0` consistency and build exited zero |
| Built smoke | Original 15-second smoke exited zero; local health reachable and remote server disconnected |
| Security/dependencies | 854 public paths scanned: zero new findings and one unchanged placeholder; dependency audit zero |

Do not add repeated focused reports or nested Python/native subsets. These are
related local gates, not a whole-repository run. The selected mutation result is
not a general mutation score. Whole-scope line/branch coverage remains unmeasured.

Native WSL checks use actual production broker/authority code, loopback upstream and
a custom Node parent. Two actual ManagedHermesProvider/pinned-Hermes/Node-IPC/Foundation composition cases passed with loopback upstream. These mechanisms do not substitute for full current-source Coding/KVM
qualification after source-closure/helper changes; earlier E07 proofs remain
historical. Refresh Hermes with `bun run hermes:runtime:install` before using its new
receipt. No paid vendor billing, real notification messages, live independent
observer, remote metrics or dedicated-host qualification has been performed.
