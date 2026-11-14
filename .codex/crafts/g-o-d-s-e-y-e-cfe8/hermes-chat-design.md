# Advanced local Hermes chat — 2026-11-13

## Scope and assumptions

ASSUMED: continue the existing accepted E07 plan autonomously; no paid model call,
server work or Git publication. Keep inexpensive OpenAI model and current private
bindings. All prior uncommitted work is baseline, not disposable.

ASSUMED: conversations add several explicit owner turns, with a separate one-request,
one-turn Foundation task/reservation for each model response. Server assembles bounded
successful context from the same immutable profile/scope; uncertain turns block new
work. No silent replay or independent scheduler. Context truncation is visible.

ASSUMED: artifacts are immutable bounded UTF-8 text/code/Markdown/JSON/patch drafts,
kept in the private journal with digest and attachment-only download. No arbitrary
filesystem path, URL fetch, executable preview, binary upload or agent file authority.

ASSUMED: approval requests link an EXISTING immutable Foundation execution plan.
The broker derives exact resource/scope/parameters/hash/revision from that plan and
sets a separate one-hour pending proposal deadline,
not model assertions. Owner step-up approve/reject is immutable/idempotent. Approval
uses the real Foundation decision boundary and can resume its already-awaiting run;
it does not create a new broad grant or bypass enqueue/executor policy. General tool
execution, new agent plan creation and upstream broad session/always approvals remain
outside this chat slice. Clearly expose this supported proposal scope in the UI/docs.

## Reuse and architecture

One dependent E07 continuation, sequential stories with explicit research/test satellites.
Reuse AgentEngine tasks, Foundation admission/lease/budget/heavy queue, owner identity,
private Hermes provider, PGlite/PostgreSQL migrations and console design tokens.
Legacy graph is a grep-based scoped map; no independent epic swarm.

Conversations bind one profile/project/environment and revision. Each turn links a
real agent task. Strict new contracts and migration extend the existing engine.
Provider context gains optional `onEvent(event)` with a bounded text delta and stable
provider run identity/sequence. Persist progress under the current actual grant/lease,
rechecking after awaited operations; no output publication after cancellation/epoch drift.
The native broker validates complete SSE frames before forwarding incrementally; no
arbitrary tool/function call is ever delivered. Actual pinned Runs message.delta
feeds IPC progress and durable controller events. Final text remains authoritative.

Owner GET SSE replays journal events from a bounded cursor. Reconnect never launches
work. Backpressure, connection capacity/lifetime and periodic owner reauthentication
are bounded. Expired cursors trigger explicit refetch/reset. A controller restart
retains transcript/progress/artifacts/proposals and uncertain correlation.

Artifact and proposal structured blocks are extracted only from a proven successful
non-revoked response. Invalid/foreign/stale blocks cannot authorize any effect.
Render all model text/code inertly; attachment content type is text/plain+nosniff,
with a safe server-generated filename and private no-store caching.

## Stories and ownership

1. CHAT01 — contracts/store/core conversations, progress and immutable artifact/proposal
   lifecycle; reuse existing task admission and real Foundation approvals.
2. CHAT02 — actual native incremental SSE/IPC and context, with no-tools/cost/attempt
   fences unchanged; qualified delayed loopback fixture.
3. CHAT03 — owner SSE delivery, advanced console transcript/composer/artifacts/inbox,
   reauth/reconnect/stop feedback, responsive accessible layout.
4. CHAT04 — GAUNTLET regression/native/browser/mutation, fresh adversarial review,
   final static/build/scanner gates, spec/plan/operator documentation and memory.

## Local acceptance

| Criterion | Test ID | Observable requirement |
| --- | --- | --- |
| AC-741 | T-AC-741 | Owner admissions bind real current profiles; foreign/stale/held/service mutation refused while authenticated owner history stays readable. |
| AC-742 | T-AC-742 | Explicit sequential turns use Foundation reservations and scope-bound successful context; duplicate/conflicting intentions, busy/unknown and context bounds are enforced. |
| AC-743 | T-AC-743 | Actual pinned Hermes emits visible text before a held completion, with one model request, correct context/skill/model/output policy. |
| AC-744 | T-AC-744 | Durable scoped stream cursor/replay/reset and private transcript survive reconnect/reopen without another model POST. |
| AC-745 | T-AC-745 | SSE lifetime/capacity/backpressure/abort and owner revocation close/release actual streams without cancelling the task. |
| AC-746 | T-AC-746 | Cancellation/lease/epoch/hold suppress late partial/final publication, retain uncertainty and admission until physical stop. |
| AC-747 | T-AC-747 | Immutable text artifacts have exact digest/scope, safe names and inert download; missing/foreign/excess/tampered content fails safely. |
| AC-748 | T-AC-748 | Model proposals only link exact existing same-scope plans, derive immutable parameters/resource/revision/expiry and never self-approve or dispatch. |
| AC-749 | T-AC-749 | Fresh owner approve/reject/replay flows use real Foundation authority; stale/hash/expiry/foreign/revoked proposals cannot approve. |
| AC-750 | T-AC-750 | Desktop/mobile chat streams, reconnects, displays scope/partial/unknown, artifacts and approvals, preserving accessible keyboard/stop paths. |
| AC-751 | T-AC-751 | Strict JSON/stream/download contracts and versioned OpenAPI/client reject malformed content/authority and keep prompts/keys out of audit/errors. |

## Qualification boundaries

Real native tests must exercise a delayed multi-frame local model and read partial
progress before releasing completion. Typed-provider and browser response fixtures
remain explicitly separate. No paid entitlement/invoice or deployed OS isolation,
continuous dedicated-host autonomy, general tool/connector or full V1 claim.
