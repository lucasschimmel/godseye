# Hermes task tools: core reconnaissance

Date: 2026-11-14. Read-only production reconnaissance; no executor or authority claim.
Scope: E07.S03 / F24 / I10-I11, local continuation. Existing uncommitted work is baseline.

## Existing reusable authority

- `agents-runs.ts:launchAgentTask` authenticates the owner, freezes a profile snapshot,
  persists idempotent task intent, rejects busy/unknown profile ownership, then creates
  and enqueues one real Foundation `agent.run` plan. The plan currently permits only
  `agent.model` / `api.openai.com` and reserves the profile's conservative model budget.
- `agents.ts:reserve` verifies immutable task/profile/scope/plan mapping inside the
  Foundation enqueue transaction. `infrastructure.ts` composes this with admission,
  resource and budget reservations; preserve that composition.
- `foundation-queue.ts:enqueue/claim` performs transactional budget reservation,
  immutable-plan checks, approval, epoch and owner/service admission. Claim mints a
  worker/run/environment/epoch/fence-bound expiring grant and durable effect intent.
- `infra-heavy.ts` classifies **every** `agent.run` as heavy. Queued+running admission
  is bounded; unknown/reconciling runs retain occupied capacity. `heavySlotFree`
  leaves a claimed-out run queued. Tools must remain inside this task allocation,
  not create a second independent queue or silently release uncertainty.
- `foundation-grants.ts:validateGrant` checks the current lease, worker, tool,
  destination, epoch, fence, expiry/revocation and budget. `authorizeGrant` charges;
  `Foundation.assertDispatch` rechecks without charging or extending authority.
- `agents-execution.ts:executeAgent` persists submission intent before physical I/O,
  invokes provider `assertActive` immediately before submission and after awaited
  work, retains actual-call ownership beyond timeout, and suppresses revoked output.
  `stopAgentExecution`, cancellation and `onFenced` are protective stop hooks.
- `reconcileAgent` and read-only `validateLease` permit scoped observation under
  holds/epoch change without reviving execution authority. Unknown means inspect/
  stop only; never resubmit an uncertain call. Terminal settlement needs physical
  stopped evidence before budget/heavy-slot release.
- Existing-plan inbox in `agents-chat-outputs.ts` derives command/hash/revision/
  resource from the existing same-scope plan. Fresh owner approval delegates to
  the Foundation boundary transactionally. Preserve this path unchanged in scope:
  tool calls cannot create privileged plans or choose native once/session/always.

## Minimum immutable task permission proposal (not frozen)

Versioned strict schema, all defaults deny. Profile policy is an owner-configured
upper bound; each owner task/turn chooses an explicit subset. Model text never
changes either. Legacy tasks have the empty policy.

- `version: 1`, exact allowlisted catalog IDs, duplicate IDs rejected.
- Workspace identity is a server-minted allocation ID bound to task/project/
  environment/profile revision, never an arbitrary host path or client-selected
  provider ID. One private disposable root per task; no production mounts, shared
  profile home, source checkout execution or administrator material.
- Positive bounded `maxCalls`, `maxReadBytes`, `maxWriteBytes`, `maxWorkspaceBytes`,
  `maxOutputBytes`, `timeoutSeconds`; bounds are explicit in the persisted task
  snapshot and included in its hash. Per-call and aggregate bounds both apply.
- Fixed tools initially: bounded workspace list/read/search/write and structured
  JSON transformation only if runtime proves their actual access boundaries.
  Tool arguments use relative logical paths, with depth/entry/content caps; reject
  absolute/drive/UNC/traversal, symlinks/reparse points, special files and links.
- No generic shell, package scripts, project code, browser/network or arbitrary
  import/eval. I10 shell/build remains unavailable absent verified disposable KVM.
- Optional read-only monitoring must use a named server-side resource selector
  derived from this exact scope, with a separate fixed typed projection. Never
  generic SQL/URL/path/log access. Do not add speculative monitoring endpoints.
- Cancellation, task deadline, profile revision change, owner hold and epoch drift
  revoke new calls. No implicit grants after cancellation or read-only recovery.

## Durable call journal proposal

Add a task-bound tool policy snapshot and separate `agent_tool_calls` journal:
server call ID, task ID, ordinal, model call identity, canonical argument digest,
tool name, task-policy digest, run/grant/epoch/fence, exact immutable argument data,
state (`intended`, `running`, `succeeded`, `failed`, `unknown`, `cancelled`), bounded
result/error projection, result digest/bytes, executor allocation/receipt identity,
timestamps and physical stopped proof. Unique `(taskId, modelCallId)` and ordinal.

Intent and consumed aggregate quota commit **before** executor I/O. An exact repeat
returns the retained result/status; changed arguments under the same identity
conflict. An intended/running/unknown record never re-executes after restart unless
a trusted executor proves no submission occurred. Inspect cannot allocate/start.
Unknown tool activity prevents successful task settlement and allocation cleanup
release. Cleanup failure is quarantined, preserves retained identity/capacity and
requires explicit read-only reconciliation/protective stop.

Use Foundation's current context for every call. Derive scope from the retained
task/context, verify policy hash and allowlist, then assert dispatch immediately
before executor I/O and after every await before recording/publishing success.
Tool admission must not double-charge the already reserved model budget. Finite
resource/call quotas remain separate integer counters under the same write lock.

## Proposed seams and ownership

Core owns contracts, store migration, policy admission/journal, engine methods and
owner JSON API. Runtime owns actual fixed executor/sandbox/protocol integration.
UI consumes exported strict contracts. GAUNTLET owns tests. No production edits
until parent freezes signatures after actual runtime facts and independent review.

Suggested provider seam: `AgentProviderRequest` gains optional immutable task tool
snapshot; `AgentProviderContext` gains `onToolCall(exactCall): Promise<boundedResult>`.
Executor interface uses `execute(request, {signal, assertActive})`, read-only
`inspect(exactRetainedRequest)` and protective `stop(exactRetainedRequest)`; receipt
must include exact call correlation/policy digest/allocation/stopped semantics.
Do not accept executor `qualified: true` or request path assertions as proof alone.

## Risks that must be resolved before freeze

1. Pinned runtime currently forbids every tool and one request/one turn; actual
   Hermes function/result continuation plus finite request accounting needs a
   coordinated protocol change. Do not pretend a parsed final output ran tools.
2. Current `AgentProfile.tools` and overview schema are max-zero. Adding profile
   policy alters profile hash and task snapshot; explicit backward migration is
   required. Chat turn launch must carry task policy rather than infer authority.
3. Existing Foundation plan tools are exactly `[agent.model]`; reserve checks and
   per-call dispatch mapping must agree on bounded additional names/destinations.
4. I10 mandates KVM for arbitrary shell/build. WSL or gVisor alone cannot silently
   satisfy it. Runtime evidence determines the honest locally available catalog.
5. Physical tool shutdown/cleanup must join provider stop before the parent task
   can report stopped; model completion alone cannot release active tool capacity.
6. File-byte accounting needs real private storage and link-safe atomic operations,
   including rename/cleanup races and cross-task roots; lexical path checks alone
   are insufficient. Avoid claiming general hostile-code containment for fixed tools.
