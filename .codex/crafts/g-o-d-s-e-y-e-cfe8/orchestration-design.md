# E07 local orchestration continuation — 2026-11-14

Mode: CRAFTS feature, auto execution under explicit user instruction. Local only; no Git mutations or paid model requests. One dependent feature, no parallel epic swarm. Focused satellites operate disjoint ownership after contract freeze.

Reuse: existing AgentEngine/CodingEngine, Foundation budgets/reservations/grants/effects, write() serialization, owner passkey middleware, durable chat/artifacts. Graph is a scoped grep/import approximation.

ASSUMED: finite acyclic plans within one project/environment; conservative serialized dispatch initially, dependencies explicit; no model-controlled shell/controller or dynamic authority expansion. Approval is exact immutable content with recent passkey, bounded lifetime and aggregate conservative maximum. Native Hermes broad session/always approval stays denied; platform-owned clarification/approval supplies the product flow. Operational E09 skill bundles and E00 remote qualification excluded.

AC / test mapping:
- AC-701 / T-AC-701: strict bounded DAG and typed Hermes/coding/clarification steps; reject duplicates/cycles/unknown refs/unsafe fields/UTF8 overflow.
- AC-702 / T-AC-702: owner prepares immutable scoped plan freezing profile/hash and coding preparation/hash, target revisions, epoch, limits, dependencies; no execution during proposal.
- AC-703 / T-AC-703: fresh owner exact-hash approval or rejection, expiry/staleness/final transaction fence, service cannot self-approve. Decisions audited/idempotent.
- AC-704 / T-AC-704: durable background coordinator runs only ready approved steps via real Foundation admission, finite aggregate budget, existing heavy capacity; no owner impersonation.
- AC-705 / T-AC-705: durable child identity before admission, idempotent recovery across restart/concurrent ticks/lost admission response, no resubmission of unknown effects.
- AC-706 / T-AC-706: approved exact delegation checked at transactional admission and actual grant dispatch; cancellation/epoch/revision/profile/preparation/expiry invalidates authority; dependent steps cannot run late.
- AC-707 / T-AC-707: unknown/failure blocks dependents, explicit read-only reconciliation, stop propagates to children and physical uncertainty retained.
- AC-708 / T-AC-708: bounded owner clarification pauses plan, response retained and separately approved as changed content; no silent injection into already approved task inputs.
- AC-709 / T-AC-709: successful current Hermes output can propose a new typed plan only; malformed/untrusted/stale output has no run authority; owner review required.
- AC-710 / T-AC-710: owner HTTP/typed client/OpenAPI plus local scheduler startup/shutdown; anonymous/service/CSRF denied.
- AC-711 / T-AC-711: console composes plan, previews exact steps/budget/dependencies/scope/source, approves/rejects, answers clarification, watches/cancels/reconciles; stale data and passkey restrictions, responsive and inert text.
- AC-712 / T-AC-712: regression/build/docs accurately distinguish local E07 software completion from real provider/remote/operational E09 qualification.

Checkpoints: contracts/store/core -> focused regression -> HTTP/UI -> integration+review -> docs/scans/build/smoke. Evidence counts separate; no new native KVM mechanism changes anticipated.

Plan critique resolutions:
- Clarification creates a NEW pending continuation containing only unexecuted suffix; original evidence retains completed child identities, original becomes superseded after response. Do not replay executed prefix or reuse completed coding preparations. Owner response is inert bounded context; any changed execution content needs new exact approval.
- Approval/deadline semantics must be explicit in final contract: deadline bounds new admission and mutation; read-only observed settlement/cleanup is allowed after expiry, cancellation revokes logical publication. Never synthesize new owner session or renew deadline during recovery.
- Proposal extraction applies to successful current Hermes tasks (including non-chat tasks), is bounded/deduplicated and pending-only; no approval, Foundation enqueue or grants are produced by model output.
