# Hermes tools core contract proposal

2026-11-14; awaiting parent freeze. This file proposes signatures, not production behavior.

## Model admission compatibility

Extend `AgentLimits.maxRequests` / `maxTurns` to integers 1..4. Profile refinement:
without `toolPolicy`, both remain exactly 1; with tool policy, `maxRequests >= 2`
and `maxTurns === maxRequests`. Existing maxOutputTokens remains a per-request cap;
existing maxCostMicros remains the entire task reservation, not multiplied.

Only an explicit owner create/configure with recent step-up can add/change a
non-null tool policy or increase tools/model limits. Normal legacy configuration
with no tool policy keeps its existing behavior. Configure omission preserves the
current policy; explicit null removes it (removal is protective and needs no step-up).
Profile storage gains nullable tool_policy. Existing profile hashes omit that key
when null; old task/profile snapshots remain valid. Tool-enabled snapshots include
the complete policy in the hash. Unknown keys and duplicate catalog IDs fail.

`AgentProfile.toolPolicy?: AgentToolPolicy` and `.tools` display configured catalog
IDs. Overview tools are the qualified local catalog; each task still needs explicit
owner selection. General shell/build is unavailable: I10 KVM is not locally proven.

## Exact proposed schemas

`AgentToolName` enum:
`godseye_workspace_list`, `godseye_workspace_read`, `godseye_workspace_write`,
`godseye_workspace_search`, `godseye_json_validate`.

Strict `AgentToolPolicy`:

```ts
{
  version: 1;
  tools: AgentToolName[]; // 1..5 unique exact IDs
  maxCalls: number; // 1..3
  timeoutSeconds: number; // 1..30 and <= profile.limits.timeoutSeconds
  maxReadBytes: number; // 1..65536 aggregate
  maxWriteBytes: number; // 1..65536 aggregate including seed files
  maxWorkspaceBytes: number; // 1..1048576 live UTF-8 bytes
  maxOutputBytes: number; // 1..32768 aggregate tool result bytes
  resources: { memoryMiB: 512; pids: 128; cpuMilliCores: 500 };
}
```

Use a fixed initial resource profile rather than claiming untested arbitrary
configurations; runtime must prove it before qualification. The values remain
explicit in immutable task policy. Whole-service cgroup caps and network-none
runsc containment apply; bounded workspace tmpfs has its own physical hard cap.
Runtime's final proven memory minimum may change these constants before freeze.

Strict `AgentTaskToolSelection` on both LaunchAgentTask and SendAgentChatTurn:

```ts
{
  policy: AgentToolPolicy; // every field <= exact profile ceiling; tools subset
  maxModelRequests: number; // 2..profile.limits.maxRequests
  workspace: {
    kind: "scratch";
    files: { path: string; content: string }[]; // 0..8, each<=16KiB, total<=64KiB
  };
}
```

Field name `toolGrant?: AgentTaskToolSelection`; omission always means NO tools,
even on tool-enabled profiles. Task storage gains nullable immutable tool_grant,
server-computed policy hash and server-minted workspace identity (task UUID).
Owner-supplied seed content is copied, never a source/host path. Seed bytes consume
write/workspace caps. No task-level tool/model selection can enlarge the profile.
Task view may include toolGrant and retained call summaries for owner audit.

Tool arguments are a strict discriminated union (no shell/URL/provider parameters):

```ts
list: { path: string } // logical relative directory, '.' means workspace root
read: { path: string } // logical relative UTF-8 file
write: { path: string; content: string } // bounded UTF-8; no links/special files
search: { path: string; text: string } // literal case-sensitive search, no regex
json_validate: { content: string } // bounded JSON syntax/normalization only
```

Logical paths <=160 ASCII characters, relative `/` separators, <=8 segments; deny
drive/UNC/absolute/backslash/NUL/dot-dot/empty segments. Only list/search permit
the exact `.` root. Runtime performs no-follow descriptor-relative traversal,
regular-file checks, bounded directory enumeration and atomic replacement.
Never accept symlinks, hard-linked files, devices, sockets or executable behavior.
Write content <=16KiB; JSON/search input <=16KiB; directories <=64 entries and
recursive search depth<=8; returned results obey smaller remaining byte caps.

## Shared TypeScript runtime signatures

```ts
interface AgentToolCall {
  id: string; // exact model call ID, 1..128 safe ASCII
  name: AgentToolName;
  arguments: unknown; // core strict-parses by name before intent
}
interface AgentToolAllocationRequest {
  taskId: string;
  projectId: string;
  environmentId: string;
  profileHash: string;
  policyHash: string;
  correlationId: string; // === taskId
  deadline: string;
  grant: AgentTaskToolSelection;
}
interface AgentToolReceipt {
  unitInvocationId: string;
  ociId: string;
  profileHash: string;
}
interface AgentToolAllocationObservation {
  state: "available" | "stopped" | "unknown";
  receipt: AgentToolReceipt | null;
  stopped: boolean;
}
interface AgentToolExecutionRequest {
  allocation: AgentToolAllocationRequest;
  callId: string; // server UUID, persisted before dispatch
  name: AgentToolName;
  arguments: Record<string, string>; // validated catalog argument union
  inputHash: string;
  sequence: number;
}
interface AgentToolObservation {
  state: "succeeded" | "failed" | "unknown";
  result: string;
  artifacts: {path: string; contentUtf8: string; sha256: string; bytes: number}[];
  receipt: AgentToolReceipt;
}
interface AgentToolExecutorContext {
  signal: AbortSignal;
  assertActive(): Promise<void>;
}
interface AgentToolExecutor {
  readonly qualified: boolean;
  supports(grant: AgentTaskToolSelection): boolean;
  prepare(request: AgentToolAllocationRequest, context: AgentToolExecutorContext):
    Promise<AgentToolAllocationObservation>;
  execute(request: AgentToolExecutionRequest, context: AgentToolExecutorContext):
    Promise<AgentToolObservation>;
  inspect(request: AgentToolAllocationRequest, signal: AbortSignal):
    Promise<AgentToolAllocationObservation>;
  stop(request: AgentToolAllocationRequest, signal: AbortSignal):
    Promise<AgentToolAllocationObservation>;
}
```

`AgentOptions.toolExecutor?: AgentToolExecutor` supplies the controller-owned
executor. `AgentProviderRequest.toolGrant?` carries the immutable selection plus
policy hash; no authority-bearing host paths, receipts or grant secrets.
`AgentProviderContext.onToolCall?(call: AgentToolCall): Promise<string>` invokes
the controller journal and executor; absence denies. Actual pinned Hermes
_execute_tool_calls replaces all native dispatch with this callback. Concurrent
and sequential native helpers plus registered-tool handlers remain denied.

## Foundation and journal lifecycle

Plan tools become `[agent.model, ...taskExactCatalog]`, destinations include the
fixed server-owned `local.hermes-tools` only for tool tasks. Reserve verifies exact
set/hash against frozen task, including model limit and subset checks. Each tool
assertDispatch uses exact tool + destination, zero model cost; model budget is
reserved once and aggregate conservative spending enforced before every real POST.

Journal tables: `agent_tool_allocations` one row/task with immutable allocation
request/hash, preparation intent, latest exact receipt, state/stopped/cleanup;
`agent_tool_calls` unique(taskId,modelCallId), unique(taskId,sequence), immutable
argument/policy/input hash and authority correlation, intended/running/succeeded/
failed/unknown/cancelled state, bounded result/artifacts and digest, quota counters.
Persist allocation and call intent before preparation/dispatch. Changed duplicate
IDs conflict; exact replay returns retained result/status. Unknown/intended rows
never execute again after restart. Inspect/stop use retained correlation only.

Preparation and execute call assertActive after preparation and immediately before
I/O. Core rechecks lease, grant, task policy hash, profile revision, current scope,
cancel and epoch after every await before publishing result. Exhausted call/byte/
runtime budgets stop new work. Model request exhaustion cannot launch a fallback
or hidden retry; valid final response requires the admitted finite loop to finish.

Physical stop requires whole task unit cgroup empty plus exact OCI stopped/absent
and cleanup proof. Model completion alone cannot settle parent while tool runtime
remains active. Failed cleanup => unknown/quarantined + retained heavy reservation.
Reconciliation observes/stops only and cannot renew task tool authority.

Only files beneath `artifacts/` produced by actual successful execution can export,
<=8 files, each <=existing 16KiB artifact bound, aggregate under tool output caps.
Core verifies UTF-8/path/bytes/digest and stores immutable content in the existing
chat artifact store before disposable cleanup. Publish only after successful,
non-revoked parent task settlement. Existing attachment-only download is reused.
General privileged actions continue solely through existing exact-plan inbox;
there is no new plan creation, broad native session approval or connector access.
