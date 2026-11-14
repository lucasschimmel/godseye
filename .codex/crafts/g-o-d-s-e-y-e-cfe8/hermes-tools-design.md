# Local Hermes tools and task-scoped isolated execution

Date: 2026-11-14. Owner explicitly requests implementation by parallel focused agents,
with the parent orchestrating, reviewing and validating. Remain local; preserve all
uncommitted previous work. No paid model call, server operation or Git publication.

## Scope and normative boundaries

ASSUMED: implement useful FIXED first-party file/data tools now. The catalog is
`godseye_workspace_list`, `godseye_workspace_read`, `godseye_workspace_write`,
`godseye_workspace_search` (literal search), and `godseye_json_validate`.
Only task-private copied UTF-8 scratch/artifact data is reachable. No arbitrary
command/argv/project code, browser, URL fetch, native tool registry or external side effect.
General shell/build remains subject to normative I10 disposable KVM guests; local
KVM is not qualified. Do not weaken that rule or silently use native/rlimit fallback.

ASSUMED: gVisor systrap can host these trusted typed operations, under a separate
verified outer user-service cgroup. Docker daemon is currently absent. Initial
actual probe measured512MiB aggregate memory, swap0, CPU500millicores,128PIDs/tasks,
ROroot/nonroot/network-none/tmpfs controls. This is not full deployed containment.
All-child membership, negative bounds, stop/EOF and actual Hermes chain qualification
remain required; absent proof must fail closed. No persistent/system configuration,
root model actions, global package installation or distro restart is authorized.
An explicitly started local operator WSL lifetime holder/user-manager bootstrap may
support development; ordinary model/tool requests never repair the manager as root.

## Contract freeze

Adopt `hermes-tools-core-contract-proposal.md` for the exact catalog, strict schemas
and shared TypeScript signatures, with these clarifications:

- Nullable optional profile `toolPolicy` is an owner-configured ceiling. Preserve
  legacy profile hashes/views when absent; default remains no tools/one request.
  Expand model ceilings to1..4 only under the new explicit policy refinement.
- Each owner task/chat turn additionally selects immutable `toolGrant` subset,
  model-step/call/byte/time caps and copied seed contents. Omission means no tools.
  No caller host path, service unit, provider endpoint, native receipt or credential.
- Fixed initial resources are512MiB memory, zero swap,128tasks,500millicores; physical
  workspace tmpfs is bounded to4MiB to include filesystem metadata/atomic staging.
  Logical UTF-8 file bytes obey the smaller owner maxWorkspaceBytes (<=1MiB), and
  aggregate write/read/result caps remain those in the proposal. No quota claim is
  inferred solely from a submitted OCI or systemd field.
- Root listing/search may use `.`; read/write/seed paths live under `scratch/` or
  `artifacts/`. Strict relative paths, no links/special files/hardlinks/traversal;
  fixed helper never imports/evaluates task contents and runs Python isolated/no-site.
- Model requests and calls are finite (<=4requests/<=3tool calls). Existing task
  maxCostMicros is the TOTAL reservation. Debit conservative aggregate attempt cost
  durably before each real model POST; missing usage is not free/zero. No hidden retry.
- Foundation exact tool/destination grants are reused, with durable per-call intention,
  model call ID+input digest and immutable allocation identity before physical dispatch.
  Changed duplicates conflict; known results may replay as receipts, unknown work never
  repeats. Recheck current lease/epoch/profile/task/grant after every relevant await.
- Workspace allocations and actual runtime handles survive uncertainty as retained
  capacity. Owned unit+invocation/container identity, never a stale PID, governs stop.
  Cancellation/parent death requests actual cleanup; keep reservations/unknown state
  until exact physical stop/absence evidence. No blind native relaunch on recovery.
- Export bounded actual `artifacts/` file snapshots through existing immutable owner
  artifact machinery only after proven successful nonrevoked Foundation settlement.
  General existing-plan approvals remain unchanged; tools cannot approve or widen policy.

## Execution architecture and ownership

One dependent E07 continuation; three explicit satellites with frozen interfaces,
not unrelated epics or shared-file swarm. Parent writes only plan/state/review/docs
and runs verification. It delegates production and tests as requested by the owner.

1. TOOL01 core worker owns contracts/store/core/JSON API and shared executor/provider
   types. It publishes types first. Once core is stable it owns console UI (or hands
   that disjoint UI area to a later worker). It does not edit runtime Python/TS adapter.
2. TOOL02 runtime worker owns private native tool executor/installation/bootstrap,
   pinned Hermes broker/dispatch multi-step integration and disposable qualification.
   No model key enters sandbox. It coordinates argument/call/receipt types with core.
3. TOOL03 GAUNTLET owns independent plan critique and tests/native/browser/mutations;
   it edits no production. Native fixtures replace only model transport or deliberately
   injected failure edges; actual execution/containment proofs must remain physical.
4. TOOL04 parent coordinates gates, fresh source/security review after a worker frees
   a slot, documented limitations and spec/plan/handoff/memory. Shared edits are frozen
   before full disjoint ordinary regression, canonical build and built API smoke.

## Acceptance

| Criterion | Test ID | Required observable behavior |
| --- | --- | --- |
| AC-761 | T-AC-761 | Owner profile ceiling + explicit per-task subset/limits; absent grants, services, duplicates, expansions and stale scope cannot admit tools. |
| AC-762 | T-AC-762 | Server-minted task workspace contains only copied inputs; tasks/projects/environments cannot read each other, host state or ambient credentials. |
| AC-763 | T-AC-763 | Actual pinned Hermes model tool-call traverses real Foundation journal and actual isolated helper, then receives result and finishes bounded continuation. |
| AC-764 | T-AC-764 | Actual ROroot/nonroot/no caps/no network IPv4+IPv6, all-descendant cgroup membership, CPU/RAM/swap/PID/tmpfs bounds and negative controls qualify supported runtime. |
| AC-765 | T-AC-765 | Strict args/paths/no-follow/regular-file checks plus file/entry/depth/read/write/result caps reject traversal/links/oversize inputs without effects. |
| AC-766 | T-AC-766 | Lease/epoch/profile/grant expiry/cancel cannot publish late result/artifact or acquire expanded tool authority. |
| AC-767 | T-AC-767 | Persist intent and exact call/input/allocation correlation before effects; duplicate receipts safe; unknown/restart never replays physical work. |
| AC-768 | T-AC-768 | Cancellation/EOF/timeout stop exact owned runtime, preserve unrelated sentinel, retain budget/capacity until actual stopped proof or explicit unknown. |
| AC-769 | T-AC-769 | Aggregate model/call/resource/time/byte cost bounds apply to actual finite loop; no fallback, hidden retry or undercounted unknown usage. |
| AC-770 | T-AC-770 | Actual artifact bytes/digest export only after successful nonrevoked settlement; inert owner download and cross-scope/tamper checks remain intact. |
| AC-771 | T-AC-771 | Desktop/mobile owner can configure ceiling, select explicit task rights/inputs, observe tool calls/results/denials/cleanup and unavailable runtime. |
| AC-772 | T-AC-772 | Migration/legacy no-tools profiles/hashes, old tasks/chat, approvals and private runtime bindings retain behavior. |
| AC-773 | T-AC-773 | Read-only inspect/reconcile cannot mutate/regrant/restart; forged unit/receipt/scope is denied; audit/errors expose references rather than private arguments/material. |
| AC-774 | T-AC-774 | Strict versioned contracts/OpenAPI/private owner consumers reject malformed authority; final tests/build/scans/fresh review match measured scope. |

## Qualification and evidence

Research/tests source maps are progressively loaded from the existing bus; current
runtime source pin governs rather than advertised static flags. Native operator
bootstrap and model fixtures remain separate from runtime admission evidence.
Report typed-provider/browser fixtures and actual physical/native chain separately.
No whole-suite mutation/coverage percentage, general-code KVM support, deployed host
or paid provider entitlement claim is implied by these local acceptance criteria.
