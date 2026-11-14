# E07.S05 core/API/UI proposal

Status: reconnaissance only; production edits require orchestrator contract approval.

## Reuse inventory

- `RepositoryConfiguration` (`packages/contracts/src/http-domain.ts`) already binds GitHub installation/repository/fullName/branch. `configureRepository` increments project revision. Freeze this complete object, its fingerprint, the project/environment revisions and an exact 40-character commit SHA per task; never accept a browser filesystem path or arbitrary clone URL.
- `AgentEngine` demonstrates immutable request intent, Foundation createPlan/enqueue, task/run correlation, reserve/settlement/releaseQueued/uncertainty and stop/inspect semantics. Reuse that lifecycle pattern, not its Hermes-specific profile/provider: existing agent profiles have a fixed model, Hermes skill and roles, and `agent.run` enforces these exactly.
- `FoundationEngine` owns fencing, activation epoch, idempotency, atomic budget hold, scope-bound grants and uncertain effects. `InfrastructureEngine` already composes the domain engines and hooks. A separate `CodingEngine` should register `coding.run`, rather than silently run a new privileged subprocess from AgentEngine.
- `infra-heavy.ts` must classify `coding.run` as heavy, preserving existing queue/slot controls. Unknown runs remain nonterminal and retain their slot/budget semantics.
- `assertProjectMutable` permits suspended projects: preparation may use it, but admission must explicitly require active project, unsuspended/unexpired/unheld environment and current revisions. Foundation repeats the active/epoch/fence checks before physical effects.
- Existing delivery artifacts/previews are deployment authority, not generic agent output. Link existing delivery preview IDs only after a separate admitted Delivery action; never turn agent-provided URL text into verified deployment evidence.
- Existing owner routes, control-client transport, contract/OpenAPI tests, Agent Center and shared `Status`/`EmptyState`/`Failure` should be reused for browser management.

## Recommended bounded public contract

Use `packages/contracts/src/coding.ts`, exported by contracts/index.ts. Exact names to freeze before parallel implementation:

- `CODING_RUNNERS = ["codex", "claude-code"]` (advertisement per runtime; only one actual implementation required).
- `PrepareCodingTask`: projectId/environmentId, expectedProjectRevision/expectedEnvironmentRevision, runner, commitSha, input (UTF-8 bytes bounded), limits (timeoutSeconds, maxCostMicros, maxOutputBytes, maxPatchBytes), testProfile (server-owned enum; never browser argv), previewRequested boolean. Repository is derived from project binding.
- `CodingPreparation`: ID, immutable scope/repository snapshot and hash, commitSha, runner/version policy, input/limits/testProfile/previewRequested, hash, createdAt. Preparation is useful metadata-only while KVM is absent. Source verification is explicitly unverified until independently observed; owner-supplied SHA is not trusted source evidence.
- `AdmitCodingTask`: preparationId + expectedHash. All mutable input, runtime support, immutable source identity and headroom rechecked before reservation; unavailable runtime returns CAPABILITY_UNAVAILABLE before any physical effect.
- `CodingTask`: preparationId/taskId, Foundation runId, scope, state (queued/running/cancel_requested/succeeded/failed/cancelled/unknown/reconciling), correlationId, runner, runnerVersion nullable, submissionIntended, cleanupState (not-started/pending/revoked/stopped/quarantined), reason, created/updated/finished timestamps. No private workspace/session paths.
- `CodingResult`: immutable task ID/hash/repository SHA binding, summary bounded, patch artifact (id/hash/bytes, content owner-only through bounded route), worktree metadata (logical server ID/base/head SHA; never host path), tests array {profile/status/exitCode/log artifact}, preview discriminated {state: not-requested|unavailable|evidence, deliveryPreviewId?}, usage {inputTokens/outputTokens nullable, costMicros nullable, accounting: measured|reserved-conservatively|unknown}. A successful native CLI exit alone cannot imply passing tests or verified preview.
- `CodingOverview`: advertised runner availability and reasons (including I10 KVM unavailable, vendor auth policy, usage limitations), preparations/tasks/results bounded lists. Names/limits should share constants rather than duplicate in client/runtime.

Minimal API under `/v1/agents/coding` (actual base from LOCAL_DEFAULTS): GET overview; POST preparations; GET preparations/:id; POST tasks (admit); GET tasks/:id; POST tasks/:id/cancel; POST tasks/:id/reconcile; GET tasks/:id/artifacts/:artifactId. Every read owner-only; all writes idempotent; bounded retention and JSON bodies. Existing generic plans remain unable to forge reserved coding metadata.

## Private runtime seam (agree with runtime worker first)

`CodingProvider` interface: qualified flag is insufficient by itself; `preflight(snapshot)` returns structured server-owned observed runner/KVM/source/auth/network/resource-policy qualification. `submit(request, {signal, assertActive})`, `inspect(request, signal)`, `stop(request, signal)` use exact task/effect correlation. Observation includes state/stopped/cleanup and typed bounded result, never host paths or native auth details. Source observation must independently bind installation/repository/SHA and prohibit hooks/filters/submodules/credential helpers or execute them exclusively in the guest. Credentials are resolved only by broker from verified scope, never accepted as browser fields or copied from global CLI homes.

I10 is normative: real CLI/test/build/project code runs only in disposable KVM guests created directly by host adapter. No local host/WSL/gVisor fallback. Default provider fails closed with explicit `KVM_UNAVAILABLE`; local utility remains durable preparations, UI, admission validation and evidence parsing. A fake provider is test-only, clearly identified, and cannot be wired to deployed local config.

## Lifecycle and recovery invariants

1. Immutable preparation + hash persisted before admission; exact idempotency replay returns retained identity, differing payload conflicts.
2. Admission creates durable intended task and queues one Foundation command `coding.run` {taskId, preparationId, preparationHash}; reserve validates complete identity and locks workspace/task exclusivity. Budget/queue hold atomic with run admission; blocked/unqualified submission cannot allocate a guest.
3. Before provider submit, journal submissionIntended and stable correlation; recheck active grant/epoch/fence immediately before each physical action. Unknown submit outcome NEVER calls submit again, including after process restart. Reconcile invokes inspect only.
4. Cancellation first revokes logical grants and fences submission, then requests exact guest/provider stop. An ACK or abort signal is not physical stop proof. Terminal state only after independent stopped/cleanup proof; uncertain cleanup -> unknown/quarantined, retained locks, no resubmit or path deletion.
5. Result accepted only after strict schema/bytes/hash/task/repository binding and current admission; patch/test/preview are separate evidence. Revoked output is not published. Retain evidence/worktree disposition for recovery; cleanup must not destroy the sole patch.
6. Foundation uncertainty and queued release update coding rows. Project lifecycle blockers need unresolved coding workspaces if they outlive their Foundation operation; simpler implementation must never mark terminal while uncertain resources exist.

## File ownership recommendation

Core owner: new contracts/coding.ts; new store/coding-schema.ts and migration 0021_coding.sql; new core/coding*.ts modules split by prepare/admission/state/execution/lifecycle; core/infrastructure.ts integration; contracts/foundations.ts union; core/infra-heavy.ts; contracts/index.ts and core/index.ts exports. API/client/OpenAPI same owner or orchestrator integration after contract freeze.

UI can be sequential after contracts stabilize: `components/agents-coding.tsx` rendered in existing Agents page/panel, using bounded repository binding/project/env selectors and exact SHA, visible prepared/unavailable distinction, inspect/cancel/reconcile/results. Avoid adding a new router-generated route unless needed.

Runtime owner: new isolated coding adapter/catalog/native result parsing and fixture qualification files only; do not mutate shared core/contracts until names are frozen. Tests owner receives frozen contract and owns new focused tests/browser fixture; root orchestrates shared integration.

## Verification priorities

Meaningful cases: owner/service denial; arbitrary path/argv/URL/extra fields rejected; stale repo/revisions/epoch fail; no KVM -> no submit and no reservation leak; exact replay vs conflicting key; concurrent duplicate preparation admission; heavy quota; restart after intended submission inspects only; cancellation before submit and after unknown submit; stop ACK without physical proof retains quarantine; oversized/malformed/hash-mismatched artifact denied; result cannot claim test pass/preview based on prose; vendor usage remains explicitly unknown/conservative. Real KVM/native CLI/paid model qualification remains separate evidence, never inferred from contract fakes.
