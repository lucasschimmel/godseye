# E07 local Agent Center — owner-bound profiles and durable Hermes tasks

Date: 2026-11-13. Continue the prior pinned Hermes installation. Owner explicitly
requests project/environment binding, task launch and tracking, in local mode only.
OpenAI is retained; owner delegated an inexpensive model selection. Default:
`gpt-6-luna`, checked against official model/pricing documentation on this date.
No paid qualification call, provider key in chat, server install or Git publication.

## Contract and assumptions

- Authenticated owner HTTP only. Bind profiles to real existing project/environment
  identities and revisions in the existing control journal. Reject foreign/missing,
  held, expired, suspended or quarantined targets before preparation and dispatch.
- Retain the three roles and exact first-party versioned bootstrap skill. A binding
  is not executable until its trusted local runtime mapping and policy are verified.
  Keep setup snapshots immutable and materialize separate private mutable homes.
- First qualified execution is bounded conversation/drafting only. No shell, file,
  browser, network tool, MCP, subagent, publication or learned-skill authority. Later
  S03/S04/S05/E09 features retain their existing requirements.
- Reuse Foundation plans, durable queue, scoped grants, lease/epoch fences, budget
  reservations, audit and cancellation. Do not implement a second independent task
  scheduler. Persist provider submission intent and exact correlation before I/O;
  HTTP acceptance is not completion. Never blindly replay unknown outcomes.
- Each profile has one active/uncertain task; preserve admission until physical
  termination is confirmed. Bounded global in-flight slots are retained on timeout.
  Keep task input/output private; audit stores references, never prompt/output.
- Provider is server-owned. Browser cannot choose endpoints, paths, provider IDs,
  keys or toolsets. Runtime configuration is local and private. Unconfigured model
  authority produces a useful unavailable state, not a fake successful task.
- OpenAI runs have explicit hard output/turn/request/deadline limits and positive
  conservative Foundation reservation. Unknown usage remains unknown; reserve/charge
  conservatively rather than reporting a fabricated zero cost. No premium fallback.
- Integrate the pinned actual Hermes Runs API, inspect/poll its status and preserve
  its run/session identity. Own bounded durable progress/result records so vendor
  in-memory SSE retention is not the owner's only history. Use authenticated bounded
  polling/refetch for the initial console; external publication approvals are absent.
- Cancellation revokes local admission and requests actual provider stop. An accepted
  stop is not proof of termination. Unknown persists through restart until read-only
  reconciliation proves a final outcome; retry is a separate explicit owner action.
- The local worker continues independently of a browser connection. Dedicated-host
  PC-disconnected operation and hostile-code OS containment remain unqualified.

## Sequential stories and ownership

1. E07.CENTER01: strict versioned contracts, checksummed migration, bound profile
   lifecycle and durable task admission/reconciliation on Foundation.
2. E07.CENTER02: qualified private local provider, separate runtime homes and pinned
   Runs API transport; no-tools/no-paid-call native laboratory.
3. E07.CENTER03: owner Agent Center UI, profile/task forms, tracking, bounded result,
   cancellation/reconciliation and clear unavailable states.
4. E07.CENTER04: regression/native/browser tests, mutation, fresh source/security
   review and updated spec/plan/operator handoff reflecting measured scope.

One dependent epic, no parallel epic implementation swarm. Backend is one owned
implementation; runtime research/provider and GAUNTLET tests are explicit satellites;
UI work follows the backend contract. Preserve all pre-existing uncommitted setup
work. Legacy graph remains grep-based; query existing Foundation/jobs/identity/UI
patterns and record the scoped delta rather than pretending a full fresh graph.

## Acceptance

| Criterion | Test ID | Required observable behavior |
| --- | --- | --- |
| AC-721 | T-AC-721 | Only authenticated owner creates/configures/pause profiles; exact real scope and revisions, audit/idempotency and safe catalog binding. |
| AC-722 | T-AC-722 | Missing/foreign/held/expired/suspended/quarantined scopes and stale profile/skill policies cannot prepare or dispatch tasks. |
| AC-723 | T-AC-723 | Launch persists exact intention/correlation, positive reservation and grant; duplicate input is one task, conflicting idempotency fails. |
| AC-724 | T-AC-724 | Trusted provider alone selects exact scope/model/skills, materializes private separate homes and exposes no tool or credential authority to browser. |
| AC-725 | T-AC-725 | Actual pinned Hermes Runs API completes a deterministic no-tools task via local model fixture, no external paid call; original snapshot unchanged. |
| AC-726 | T-AC-726 | Bounded progress/result/history survives controller restart; source acceptance, running, failed, succeeded and unknown remain distinct. |
| AC-727 | T-AC-727 | Cancel/timeout/fence retain unknown and budget/admission until stop proven; late success cannot override cancellation or scope revocation. |
| AC-728 | T-AC-728 | Unknown submission/running outcomes reconcile read-only with retained provider identity; no automatic second model run or premature slot release. |
| AC-729 | T-AC-729 | Model/output/turn/attempt/deadline/budget caps are enforced at real transport boundary; no unbounded fallback/background calls. |
| AC-730 | T-AC-730 | Agent Center works on desktop/mobile with owner login, real environment selection, role/model/limits, start/status/result and unavailable/retry feedback. |
| AC-731 | T-AC-731 | All response schemas/OpenAPI/private client match version; malformed provider payloads, URLs, prompts, cursors and excess bodies fail safely. |

## Sources and memory

Read constitution, stack/context pack, existing Hermes setup research, graph/map,
Foundation/jobs production code and crafts-godseye playbook. Key lesson: even config
imports mutate Hermes home; do not point the actual runtime at immutable snapshots.
Recheck scope/lease after awaited authorization and at last physical dispatch.
Retain actual-call slots after deadlines. Existing full tests take about16minutes;
targeted tests precede full integration regression and final build/browser checks.
No Context7 available: current official docs/installed types and pinned source govern.
Routine implementation choices are authorized by the user's instruction to continue;
no additional approval gate is introduced for local reversible work.
