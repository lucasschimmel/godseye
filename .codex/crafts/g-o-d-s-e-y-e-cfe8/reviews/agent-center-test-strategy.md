# GAUNTLET strategy: local Agent Center

Date: 2026-11-13. Criticity: production. Scope: E07 owner-bound profiles,
Foundation-backed Hermes admission, provider transport and console tracking.
Frameworks are inherited: Vitest/real disposable PGlite, Playwright/temporary
owner state, Python standard library/native WSL runtime. No real owner store,
provider key, paid model request, global install or dedicated server is permitted.

This list is drafted from the request and acceptance contract before reading the
new implementation. Existing Foundation/jobs tests establish reusable mechanics;
new tests must compose actual AgentEngine/InfrastructureEngine wiring instead of
duplicating framework or queue internals. Existing pre-setup counts remain historical.

## Ordered layers and required evidence

| Priority | Criterion | Test layer / scenario |
| --- | --- | --- |
| P0 | T-AC-721 | Real project/env profile create, idempotent replay/conflict, owner-only access, revision-safe configure/pause, immutable role/scope, safe audit. |
| P0 | T-AC-722 | Missing/foreign env, hold/expiry/suspension/quarantine, stale project/env/profile, changed skill and pause after queue admission all refuse physical dispatch. |
| P0 | T-AC-723 | Real Foundation plan/grant/positive budget reservation plus one task on duplicate request; unavailable provider leaves no falsely runnable work; budget denial is atomic. |
| P0 | T-AC-724 | Server-selected profile/runtime mapping; browser cannot choose endpoint/path/key/model override/toolset/provider ID; private fresh mutable home and exact skill snapshot. |
| P0 | T-AC-725 | Real pinned Hermes0.23.1 RunsAPI, deterministic loopback OpenAI fixture, exact version/model, only pinned skill, no tools, no external calls, original snapshot unchanged. |
| P0 | T-AC-726 | Queued/running/terminal states distinct, durable correlation/history/output visible after actual store reopen; bounded result/history/pagination. |
| P0 | T-AC-727 | Queued cancel, running stop acknowledgement versus actual termination, deadline/lease expiry, late physical success and revocation while awaited do not erase uncertainty/release admission. |
| P0 | T-AC-728 | Lost submit response/unknown identity, restart and provider outage reconcile read-only; no second model run, no unbounded pending slots or falsely zero charge. |
| P0 | T-AC-729 | Exact model/input/output/attempt/turn/deadline caps at actual dispatch; no fallback/background retry; conservative positive budget remains on unknown outcomes. |
| P1 | T-AC-730 | Owner desktop/mobile create profile, launch/status/result, pause/configure, cancel/reconcile, outage and clear disabled reasons; no clipping or hidden actions. |
| P1 | T-AC-731 | Strict request and response schemas, API version/OpenAPI/private client, malformed payload/URL/cursor/body refusal, safe errors and no prompt/output in audit. |

Quick wins: profile scope confusion matrix; idempotency/positive Foundation budget
integration; cancellation acknowledgement versus physical terminal observation.
Then failure-window and last-await authorization tests, actual native transport,
browser flows and curated mutation sensitivity.

## Fixture and process discipline

- Use temporary stores with original checksummed migrations. Build two real
  projects and their actual environment IDs; do not mock scope admission.
- Inject only the provider boundary. Fake observations are typed and deliberately
  adversarial (throw, missing identity, delayed settlement, oversized result).
- Await task completion through the actual Foundation consumer. No fake success
  directly written into the production database by happy-path tests.
- Native fixture emulates the vendor model endpoint only. Hermes, prepared skill
  resolver, gateway, request caps and private-home mechanisms remain actual code.
- Native skips are reported separately and cannot count as qualification until
  the opt-in run passes. Root coordinates full shared regression after targeted green.
- Run mutation experiments on disposable source copies, never the shared production
  working tree; record green baseline/restored result and unchanged source hashes.

## Coverage claims and gaps

No exhaustive coverage percentage or whole-repository mutation score is assumed.
All eleven criteria need an existing passing test reference, with actual case-level
results retained. Any missing real transport/model budget/cancel proof remains an
explicit gate; a typed fake alone cannot qualify it. Deployed confinement, private
server ingress, provider entitlement/billing and E09 operational skills stay outside
this local request. Public provider activation remains unavailable when material or
qualified enforcement is missing.
