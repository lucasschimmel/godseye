# E07.S05 coding runners — GAUNTLET strategy

Generated: 2026-11-14. Run: `godseye-local-coding-runners`. Status: canonical design and coding contracts frozen; test implementation in progress. Criticity: production. Stack: strict TypeScript, Node 24, Vitest 5.1.0, Playwright 1.65.0, real local PGlite/Foundation fixtures. Framework versions come from the existing CRAFTS bus and package manifest; no new framework/dependency is required.

## Scope and evidence boundary

F43/E07.S05 requires an assigned repository/worktree, at least one **qualified** Codex or Claude Code runner, typed patch/test/preview evidence, scoped authority, retained artifacts and safe reconciliation. I10 mandates disposable KVM for arbitrary repository code, builds and agent shell commands. Existing gVisor fixed-data tools are not evidence that coding is qualified. A safely disabled integration can pass unavailable-path tests while S05 execution qualification remains incomplete.

The behavioral scenario list preceded implementation inspection. Canonical T-AC-781 through T-AC-794 now bind the local CR scenario groups through the complete crosswalk below. `packages/contracts/src/coding.ts` and the coding design define the frozen shared API; tests carry canonical IDs. CR labels remain only strategy scenario references.

No tests may run a paid model call, reuse real vendor authentication, mutate the current checkout or its Git metadata, read protected filenames or `.env` files, install globally or change host configuration. All fixture data is synthetic. Actual guest qualification, if available, is a separately admitted finite native suite with explicit prerequisites; its absence must fail closed in product admission and be reported honestly in evidence.

## Existing seams to reuse

- `tests/helpers/agents-fixture.ts`: real infrastructure/store/Foundation budget admission and task lifecycle, deterministic clock, reusable `controlled<T>()` race barrier. Its `AgentProviderFixture` replaces only the external provider boundary and is not native qualification.
- `tests/agents-tools-admission.test.ts`: unavailable execution rejects before task rows, model submission and reserved budget; stale owner, held environment and ceiling narrowing scenarios. Preserve these regressions; do not repurpose scratch grants as coding authority.
- `packages/core/src/agents-provider.ts`: immutable server-owned request context, stable correlation identity, `assertActive()` before submission, read-only `inspect()`, protective exact-task `stop()`, and physical `stopped` proof. Coding adapters must preserve these semantics or define an equally strong dedicated boundary.
- `tests/agents-persistence.test.ts`, `tests/agents-chat-persistence.test.ts`, `tests/agents-tools-journal-native.test.ts`: patterns for persistent reopen/uncertainty and journal authority. Read only the needed scenarios after the intended-behavior list is frozen.
- `tests/helpers/run-hermes-tools-mutations.mjs`: source-copy mutation pattern, behavioral assertion failure requirement, baseline/restored passes, original source hash verification. Its three contract mutations are historical sensitivity checks, not coverage of coding authority.

The current checkout has no existing coding runner/worktree tests. Existing agent tests cover useful shared admission/lifecycle behavior but leave repository selection, physical coding containment and runner output validation untested. Coverage has not been measured in this strategy tranche.

## Contract decisions needed before test authoring

1. Owner input selects a declared repository/reference/worktree policy; the backend derives physical locations and immutable source identity. Specify exact allowed path and reference grammar, supported link handling, identity digest inputs and stale revision behavior.
2. Distinguish pure runner availability from trusted KVM qualification. A caller or runner output must never self-certify containment. Define which preflight observations prove guest identity, absence of protected mounts, finite resources and scope-limited egress/authentication.
3. Define strict output schemas and maximum UTF-8 byte/file counts for patch, test evidence and preview. Separate runner assertions from independently observed evidence. Unknown usage must remain unknown; missing vendor metering cannot become zero or exact provider billing.
4. Define retained execution ID, grant generation/expiry, stop/cleanup proof and quarantine semantics. State which artifacts survive cancellation and which receipts permit safe reconciliation. Specify that inspect/restart/reconciliation cannot replay execution automatically.
5. Define owner API/UI capability states and unavailable reasons. A preview URL is evidence only after validated scope/readiness/expiry; it must not authorize arbitrary runner-controlled URLs or automatic publication.

## Acceptance-to-test plan

Canonical traceability (design `coding-runners-design.md`; closes CR-PLAN-02):

| Canonical ID | Strategy groups | Required layer |
| --- | --- | --- |
| T-AC-781 | CR-01, CR-03 | Strict contracts and owner-only real core/API |
| T-AC-782 | CR-03, CR-09 | Frozen binding/revisions, HOLD, epoch and dispatch races |
| T-AC-783 | CR-02, CR-03, CR-12 | Real Foundation admission, idempotency, budget/capacity |
| T-AC-784 | CR-04, CR-05 | Actual synthetic Git/worktree byte isolation |
| T-AC-785 | CR-06, CR-07 | Actual pinned Codex noninteractive protocol mechanism |
| T-AC-786 | CR-06, CR-07 | Actual pinned Claude Code noninteractive protocol mechanism |
| T-AC-787 | CR-02, CR-04, CR-05, CR-12 | Fail-closed admission plus actual disposable KVM containment |
| T-AC-788 | CR-10 | Durable intent, read-only reconciliation and no replay |
| T-AC-789 | CR-09, CR-10, CR-11 | Revocation, late-publication fencing, stop proof/quarantine |
| T-AC-790 | CR-07, CR-08, CR-11 | Bound bytes/digests/identity and final transaction fencing |
| T-AC-791 | CR-06, CR-07, CR-12 | Finite attempts/resources, explicit opaque usage, no paid calls |
| T-AC-792 | CR-07, CR-08 | Actual test exit/status and explicit unavailable preview |
| T-AC-793 | CR-13 | Typed HTTP/client and focused owner browser journey |
| T-AC-794 | CR-13 and shared existing suites | Existing behavior, migration/OpenAPI, static/build/review |

Early feasibility and final qualification are distinct gates (closes CR-PLAN-03). Before substantial adapter execution, run a reversible workspace-pinned KVM feasibility probe and fail closed on missing access/assets. KVM_CREATE_VM has now been observed; runtime is attempting a pinned actual guest. This proves feasibility only. Actual guest enforcement/protocol/repository qualification still follows the implementation and independent assertion suite. KVM is not assumed permanently unavailable; no host/TCG/gVisor fallback is admitted while qualification is pending.

All entries are high priority except the explicitly marked supplementary browser cases. One scenario may assert several outputs when they jointly establish one behavior.

| Local ID / spec mapping | Layer and target | Behavioral scenario and evidence | Effort |
| --- | --- | --- | --- |
| CR-01 / F43, T11, T21 | Contract; frozen request/selection schemas | Reject unknown keys, unsupported runner/auth mode, caller physical cwd/argv/environment injection, malformed immutable refs, widened repository identity and extra production authority. Valid minimal inputs round-trip without adding authority. | Small |
| CR-02 / I10, T22 | Real core admission + API | Missing runner, unavailable KVM, unsupported vendor auth, stale qualification or wrong execution profile returns explicit unavailable state before any task/grant/worktree creation, budget reservation or provider/model request. A configured data-tool executor does not satisfy coding admission. | Small |
| CR-03 / F43, T22 | Real core/Foundation/store | Service actor, foreign project/environment/repository, stale owner step-up, outdated repository/profile revision, recovery HOLD and expired/replayed selection are denied. Snapshot exact task scope so later repository or profile edits cannot widen admitted authority. | Medium |
| CR-04 / F43, T11, I10 | Native repository harness; real filesystem and runner adapter | Materialize two fresh synthetic repositories A/B and task allocations from trusted fixture records. Produce a patch in A's assigned worktree. Hash/enumerate controlled A source, B source and a sibling canary before/after; only the assigned worktree and allowed retained artifact directory change. Verify observed source commit/digest and worktree identity, distinct task homes/index/object writes, no current-repo path passed to runner. This is mechanism evidence until it runs inside qualified KVM. | Large |
| CR-05 / I10, T22 | Adversarial real-path harness + qualified native guest | Reject traversal, absolute paths, Windows drive/UNC, mixed separators, symlink/junction/reparse escape, worktree `.git` indirection to foreign metadata, path prefix collisions and TOCTOU replacement. A request may never cause edits/deletion outside owned task allocation. Use only synthetic harmless canaries and filenames. | Large |
| CR-06 / F43, T21, T22 | Actual runner adapter with local deterministic subprocess/transport fixture | Supported pinned invocation loads exact task context and explicit auth/usage limitations; repository instructions cannot inject host argv, inherit user home/global config, widen broker grants or contact production administration. Capture sanitized child context/attempts, never real process environment values. No paid endpoint exists in the fixture. | Medium |
| CR-07 / F43, T11 | Contract/property/fuzz; strict result parser and evidence ingester | Parse bounded valid patch/test/preview results; reject unknown keys, duplicate IDs/paths, invalid UTF-8 lengths, negative/nonfinite usage, contradictory test counts/outcomes, oversized/truncated output, mismatched task/source/executor identities, bad byte hashes and terminal success without required evidence. Repo-authored green prose/process exit alone cannot establish tested/qualified success. | Medium |
| CR-08 / F43, T11, T33 | Actual bytes + preview transport fixture | Rehash retained patch bytes; patch applies only to admitted synthetic source and never to the current checkout. Test failures stay visible. Preview remains separately unavailable when no qualified preview adapter exists. A supported preview has scoped readiness/expiry evidence; reject private/management/foreign destinations and misleading runner-authored URLs. | Medium |
| CR-09 / T24, I10 | Core + native cancellation race | Pause immediately before physical submit, revoke/cancel/expire scope, then release. No new process starts. For running work, revoke grants before cleanup and withhold `cancelled` until physical stop proof. Stop timeout, malformed receipt, wrong guest ID and residual allocation remain unknown/quarantined with reservations retained as required. | Medium |
| CR-10 / T24, F43 | Core + persistent reopen + controlled late observation | Persist exact execution/correlation identity; after lost submission ACK, timeout, worker restart, lease expiry or duplicate ticks, read-only inspection/reconciliation never submits again. Late success after fence change cannot commit trusted artifacts, restore grants or overwrite terminal authority. Explicit owner resolution is separately tested; retries cannot mint a new effect identity to hide uncertainty. | Medium |
| CR-11 / T22, T24 | Actual scope and artifact journal/API | Other project/service identities cannot read patch/test/preview artifacts or stop a foreign guest; exact owner may inspect retained evidence. Stale/replayed artifact references and forged runner task IDs are refused. Artifact failure never disappears behind task success; failed cleanup remains visible. | Medium |
| CR-12 / T24, T26 | Real shared reservation + local model transport | Enforce finite CPU/memory/pids/time/output/disk and shared model budget admission. Unknown vendor usage is explicit; no exact billing claim from a flat subscription/opaque CLI. Capture zero outbound paid-model calls during all default tests. Native resource tests require actual observed enforcement, not submitted configuration. | Large |
| CR-13 / T33 | HTTP typed client; browser supplementary | Owner sees unavailable reason, selected immutable repository/worktree scope, strict patch/test/preview results, retained unknown/cancel/cleanup state and auth/usage limits. One desktop/mobile keyboard journey is sufficient after API freeze; service/unauthenticated mutation denial stays in integration tests. Browser fixtures do not qualify execution. | Medium |

Execution order: the early pinned KVM feasibility gate precedes implementation execution. Core authoring then starts with CR-01/02/03, followed by strict evidence CR-07 and source-only harness CR-04/05/06, lifecycle CR-09/10/11/12, HTTP/UI CR-08/13 after API freeze, and final separately gated KVM/native qualification. Quick wins are strict schemas, unavailable-KVM admission with zero reservations, and replay-free restart reconciliation. The large items are actual containment proofs and bounded resource enforcement, not extra browser tests.

## Isolation harness constraints

The fixture root is a newly created task-specific temporary directory whose resolved absolute path is recorded. Create synthetic A and B repositories only there through a dedicated trusted fixture builder; if fixture Git mutations are needed, coordinate with GITSMITH and do not run them in this checkout. Prefer immutable prepared synthetic repository fixtures when available. Tests must verify every cleanup target is owned by that recorded root before recursive removal; links and `.git` files must not redirect cleanup elsewhere.

Host-side unit tests may exercise trusted staging, parsing and fail-closed preflight. They must not execute arbitrary repository scripts or a real coding CLI outside disposable KVM. The qualified-native suite executes only synthetic harmless fixtures in newly created guest disks, with no protected host mount or production credentials. A host mock that says `qualified: true` proves control-plane behavior only. An actual KVM absence is an explicit qualification gap, not an invitation to fall back to WSL/native/gVisor execution.

## Property/fuzz cases

Use seeded bounded tables/generators unless an existing property library is already available. Invariants: accepted paths remain descendants under platform canonicalization; hashes bind exact UTF-8 bytes and task/source identity; narrowing never grants more authority; expired/revoked generations cannot submit or settle; arbitrary runner text cannot become an operation/credential/preview URL; parser rejection leaves no committed artifacts. Bound parser and input sizes so fuzzing itself cannot exhaust CI. Avoid tests that simply repeat schema implementation internals.

## Limited mutation gate

Mutate source copies and run selected behavioral tests only; never edit live shared sources. Require a passing unchanged baseline and restored copy; each killed mutant must fail an intended assertion, not compilation/import/setup. Freeze source hashes and label the result `curated source-copy sensitivity`, not repository-wide/touched-line mutation coverage.

Select 5–7 meaningful branches after implementation exists: bypass KVM preflight; accept a path escaping task root; omit exact repository/source binding; bypass active-generation check immediately before submit; accept terminal success without physical stop/evidence; turn reconciliation into submit/replay; remove artifact byte/hash or output cap check. Each selected mutant must be killed. Survivors become explicit work items with location, reason and missing test. A production target of 70% mutation score applies to measured scope; a small curated sample does not establish that score.

## Completion report shape

Return `{coverage:{line,branch,scope},mutation:{kind,score,survivors},flaky:[],layers_run:[],gaps:[]}` with unmeasured fields `null`, never invented percentages. Report synthetic repository/adapter tests separately from actual KVM/CLI qualification. Preserve observed failed prerequisites, unavailable vendor auth/usage, no paid call evidence and the exact native command/result artifacts. Record flakiness only from history; one run cannot establish stability. Execution results belong in the separate test evidence report. Initial dependency audit observed zero findings per root; no dependency changes are required by this strategy.

Implemented mutation scope: orchestration froze three independent behavioral operators after implementation: final publication fence, artifact digest validation, and VMM memory overhead accounting. All three were killed in source copies with passing baseline/restored runs; original core hashes remain unchanged. The earlier 5–7 candidate list was planning breadth, not a measured result or a claim of full mutation coverage. Actual native adversarial cases independently exercise source bytes, mutable index, test-tree mutation, background quiescence and PID fail-closed boundaries.
