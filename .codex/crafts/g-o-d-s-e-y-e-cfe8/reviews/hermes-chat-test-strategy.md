# GAUNTLET strategy: advanced local Hermes chat

Generated: 2026-11-13. Run: godseye-local-hermes-chat. Criticity: production.
Inherited stack: Node24 / TypeScript strict / Hono / React / Drizzle + PGlite.
TEST_FRAMEWORK = Vitest5.1.0 and Playwright1.65.0; actual pinned Hermes/Python
native laboratory remains an additional opt-in layer. No provider keys, paid calls,
server actions or Git mutations. Preserve all existing uncommitted changes.

This independent strategy is drafted from the requested behavior before reading
new implementation. Route/type details and acceptance IDs require the root's
upcoming chat contract; do not harden guessed interfaces into tests.

## Existing evidence and reusable fixtures

- `tests/helpers/agents-fixture.ts`: real InfrastructureEngine, Foundation, temporary
  PGlite and project/environment/budget; only external provider replaced. Controlled
  promises support real last-await races without arbitrary sleeps.
- `tests/agents-persistence.test.ts`: actual store close/reopen and retained provider
  identity; `agents-tasks.test.ts`: uncertainty/cancel/epoch behavior. Extend rather
  than duplicate the existing 47 ordinary Agent Center cases.
- `tests/agents-http.test.ts` + `owner-auth-fixture.ts`: actual authenticated owner,
  strict API headers, idempotency and unavailable provider; suitable for streaming,
  conversation and download routes once their contract is frozen.
- `tests/backend-stream-limits.test.ts` and `backend-stream-fixture.ts`: bounded SSE
  reader, cursor gap, non-reading clients, abort/cancel/lifetime slot release. Reuse
  assertions/patterns, not backend-specific routes. The existing reader discards
  trailing frames when returning, so use one persistent decoder for multi-frame
  ordering assertions rather than repeatedly calling it on coalesced chunks.
- `tests/foundations-helpers.ts`: deterministic FoundationClock, real plans/grants,
  typed adapter and owner session. `infra-approval-capacity.test.ts` already proves
  atomic approval renewal/admission; no need to retest generic queue mechanics.
- `tests/helpers/agents-native-fixture.ts` + `agents-model.py`: loopback model only;
  actual Hermes/runtime caps remain real. Existing positive/hostile/hanging cases
  do not prove incremental text is exposed before upstream completion.
- `tests/e2e/agents.spec.ts`: real owner enrollment/profile binding; current task
  result/cancellation use explicitly labeled response fixtures. New browser tests
  must report actual-backend versus UI-contract evidence separately.
- Prior Agent Center report: 47 ordinary cases, 7 browser cases, measured native
  fixtures and 4 curated mutation kills. Latest global baseline supplied by root:
  1329 passes in about36.6minutes. No new full suite or build run is authorized here.

## Risk-prioritized test plan

| ID | Priority / layer | Target and missing behavior | Effort |
| --- | --- | --- | --- |
| CHAT-STREAM | P0 integration + native | Task/conversation SSE and actual Hermes transport: emit at least two ordered incremental text updates while model completion is deliberately held; reconnect reads durable events and never submits a second model request. A final output split into chunks after completion fails this criterion. | medium |
| CHAT-CURSOR | P0 integration / bounded-input matrix | Stream cursor scoped to exact owner/task/conversation; malformed/foreign/ahead/gap cursors are rejected or explicitly refetched per contract; event IDs strictly increase and resume excludes already consumed events. | medium |
| CHAT-CAPACITY | P0 integration | Bound connections, lifetime, retention and per-frame bytes; non-reader cannot grow queues or consume retained history; abort/cancel/error releases slot; reconnect cannot replay physical work. | medium |
| CHAT-REAUTH | P0 HTTP integration | Owner-only stream, periodic session revalidation, revoked/expired session closes stream without disclosing later content; fail closed after reauth failure; disconnect alone never cancels a durable task. | medium |
| CHAT-CONTEXT | P0 integration + native | First turn, explicit continuation and clarification preserve ordered scoped user/assistant history and provider session correlation; no foreign/profile-revised/unknown turn can continue; total history/input/turn/request caps remain bounded. | medium |
| CHAT-ARTIFACT | P0 integration + HTTP | Artifact bytes, digest, declared size/MIME/name and task scope agree; immutable downloads require owner authentication; no path traversal/absolute path/URL fetch/HTML execution/content-disposition injection; reject oversized or mismatched metadata atomically. | medium |
| CHAT-PROPOSAL | P0 integration | Proposal binds immutable exact command, scope, revision and digest; approval cannot alter it or fabricate an executable target. No effect before valid fresh owner approval; agent actor cannot approve itself. | medium |
| CHAT-DECISION | P0 integration + HTTP | Approval/rejection idempotency and conflict; stale revision/hash, expiry, scope hold/revocation and old session step-up refuse execution; rejection stays terminal; concurrent decisions yield one effect. Real Foundation composition where applicable. | medium |
| CHAT-RECOVERY | P0 persistence / integration | Unknown stream/submission/stop and process reopen preserve correlation, budget/admission and proposal decisions; inspection is read-only; late result cannot undo protective stop; no automatic resubmission. | medium |
| CHAT-PRIVACY | P0 integration + contracts | Audit/errors/overview expose references only, not prompt/output/artifact content/runtime material; durable content visible only through scoped authorized detail; malformed unknown authority fields fail safely. | small |
| CHAT-UI | P1 browser | Desktop/mobile conversation partial text before terminal, safe artifact preview/download, pending exact proposal + recent-owner confirmation/rejection, reconnect/refetch and unavailable/stop states; visible actions remain inside viewport. | medium |
| CHAT-MUTATION | P1 curated isolated experiment | Kill bypasses of owner decision/freshness, cursor scoping, artifact digest, incremental-before-final and no-replay fences. Baseline/restored tests and unchanged shared source hashes required. No global score claim. | medium |

Quick wins: privacy/strict schema matrix; cursor scope/gap contract; immutable
proposal revision/hash and fresh-owner decision matrix. Sequence: frozen contract
and acceptance IDs -> targeted schema/domain tests -> authenticated routes and
reopen/race tests -> actual incremental native fixture -> sparse browser flows ->
isolated curated mutation -> root-coordinated final regression. Estimated work:
one small plus eleven medium feature groups; authoring is bounded by contract and
native fixture complexity rather than a speculative case count.

## Evidence and execution discipline

Write tests from this list/spec first, then inspect the changed implementation.
Use T-AC IDs supplied by root in natural-language test names and generated run tags.
Aim for meaningful red-before-green evidence for uncovered observable behavior;
record pre-fix failure artifacts and exact passing follow-up rather than counting
compile errors as behavioral regressions. Use explicit synchronization at provider
and stream boundaries; every reader/process/temp root has bounded cleanup.

Run only affected files with explicit distinct JUnit paths, preferably one worker
for memory-heavy PGlite; root owns shared build/full suite/browser server scheduling.
Native fixtures use loopback deterministic models only. A parser fixture or typed
provider proves its layer only, never qualifies actual incremental Hermes transport.
Property/fuzz input matrices are appropriate for cursor/name/digest/decision parsers;
use installed APIs and existing fixture idioms, no dependency installation.

Typed results will report coverage {line,branch} as not measured unless collected,
mutation {score,survivors} only for selected experiments, flaky history, layers_run,
case counts/evidence paths, and explicit gaps. Production coverage targets remain
85% line /80% branch and70% touched-business-logic mutation calibration, not invented
measurements. No paid-provider billing, dedicated-host confinement or general tool
execution qualification is implied by these local tests.
