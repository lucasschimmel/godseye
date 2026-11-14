# Hermes task tools: actual local runtime and pinned dispatch

Date: 2026-11-14. SCOUT --docs satellite; production read-only. Coverage partial:
metadata and pinned source inspection completed; no transient resource-cap exercise
or new sandbox execution yet. No paid calls, installation, key read or server change.
Existing dossier reused; report is the requested context-bus research artifact.

## Verdict

General shell/build/project-code execution remains gated by I10 disposable KVM.
The local KVM device exists but uid1000 lacks read/write and qemu is absent. Do not
call WSL/gVisor a KVM substitute. A useful initial catalog can instead execute only
trusted first-party typed file/list/read/write/search/JSON handlers in a disposable
pinned gVisor sandbox. Actual whole-runtime hard caps appear feasible through the
already-running delegated systemd user manager; they still require live proof.

## Observed metadata

- Docker CLI29.7.2/API1.55, context desktop-linux. Docker Desktop Linux Engine pipe
  absent; daemon unavailable now, not merely inherited historical evidence.
- Ubuntu WSL2 was stopped at inventory; bounded `wsl --exec` diagnostics started
  it normally. Kernel6.6.87.2-microsoft-standard-WSL2; uid1000; systemd259.
- `unshare --user --map-root-user --mount --net --fork true` succeeds.
- User systemd DBus responds; manager control group is
  `/user.slice/user-1000.slice/user@1000.service`. Its actual cgroupfs directory is
  writable and both controllers/subtree report `cpu memory pids`.
- Root `/sys/fs/cgroup` and `user-1000.slice` are unwritable. This does not rule
  out a transient user service under the writable delegated manager subtree.
- `/dev/kvm` exists but is unreadable/unwritable to this identity; no
  `qemu-system-x86_64` executable is present.

These observations are capability leads, not effective task qualification.

## Reuse and required proof

`tests/runsc-lab.py` already validates local archive checksums, extracts only
regular pinned public binaries, starts runsc release-20261102.0 with systrap and
network none, constructs nonroot/drop-all-capabilities/noNewPrivileges/read-only
root, and proves IPv4/IPv6 host-loopback refusal plus bounded tmpfs. Alpine3.24.4
pin contains busybox and musl. Reuse the safe extraction/configuration patterns.
Do not reuse its `--ignore-cgroups=true` as evidence of limits: it explicitly
reports cgroupLimitsQualified=false and persistentDataQuotaQualified=false.
Do not copy its numeric process-group kill cleanup into retained runtime authority.

`packages/core/src/infra-docker-inspection.ts` verifies actual profile/limits after
creation rather than trusting submitted values. Reuse that principle; Docker
adapters themselves are cell-scoped and not a disposable-tool executor.

Candidate: launch an exact correlation-derived transient `systemd-run --user`
service (not scope attached to an uncontrolled caller) with MemoryMax,
MemorySwapMax=0, CPUQuota, TasksMax, RuntimeMaxSec, KillMode=control-group.
The service must inspect its own effective `memory.max`, `memory.swap.max`,
`cpu.max`, `pids.max` before any handler runs and fail closed on mismatch. Outer
cgroup must contain runsc sentry, gofer, workers and descendants. A finite writable
tmpfs must contain all workspace scratch/output; no host repository mount and no
persistent unrestricted writable root. Bounded stdin carries exact staged files;
bounded stdout returns exact approved text artifacts. Qualify memory/process/CPU
and storage refusal using harmless bounded negative controls, not exhaustion.

Default named catalog recommendation: `godseye_workspace_list`,
`godseye_workspace_read`, `godseye_workspace_write`,
`godseye_workspace_search`, `godseye_json_validate`. Strict schema, UTF-8 byte
caps, path-component allowlist, no symlink/hardlink/device, no absolute/traversal
paths, deny sensitive basenames, bounded file count/depth, literal search only.
Write applies only to the private scratch workspace and emits an artifact; it
does not modify the source repository. JSON parse/format must bound depth and
input size. No arbitrary argv, shell, eval, plugins, network or project code.

## Exact Hermes0.23.1 seam

Pin `3b421578588243f920886e6fe79a6faa87ea026e`; local source:
`/home/osiri/.local/share/godseye-hermes/d0a962b3d5bd0126493ed930a557ad95b0f28d51ba8a7e05b5faa69eea6b2b93/tools/0.23.1/source`.

- `run_agent.py:1315`: `_execute_tool_calls(assistant_message,messages,
  effective_task_id,api_call_count=0)` controls a whole batch.
- `run_agent.py:1367`: `_invoke_tool` forwards to
  `agent/agent_runtime_helpers.py:2470 invoke_tool(...)`.
- `agent/tool_executor.py:1352` concurrent calls invoke `_invoke_tool`, but
  `:1683` sequential inline dispatch uses `INLINE_TOOL_EXECUTORS` directly.
  Therefore `_invoke_tool` or registry replacement alone is not a universal gate.
- `model_tools.py:897 handle_function_call(function_name,function_args,task_id,
  tool_call_id,session_id,turn_id,api_request_id,user_task,enabled_tools,...)`
  includes aliases, bridge tools, connectors and middleware before dispatch.
- `tools/registry.py:832 register(name,toolset,schema,handler,...)` accepts trusted
  functions, but opening ordinary native toolsets introduces unrelated machinery.
- `gateway/platforms/api_server_runs.py:1142` provides actual stream_delta_callback
  and tool_progress_callback when constructing the real agent.

Recommended narrow seam is the existing `BoundedAgent` subclass in
`scripts/hermes_agent_boot.py`, overriding the entire `_execute_tool_calls` with
strict exact first-party tool-name validation and serial broker calls, while
retaining hard-deny sequential/concurrent/registered native dispatch. Populate
only exact trusted schemas after verified construction; reject name repair and
native unknown names. Produce normal upstream tool-result messages with exact
call IDs and safe projected events. This is a first-party adapter, not a claimed
native executor callback API.

Current `hermes_gateway_broker.py:outgoing_body` rejects tools and tool roles;
reply validation rejects tool calls; broker admits one model request. Tool turns
require an explicit bounded multi-step protocol with cumulative reservation,
strict schema equivalence, bounded argument stream, assistant/tool linkage and
final success. Exposing tools without these changes cannot work correctly.

## Retained authority contract recommendation

Controller supplies immutable task/project/environment/profile/revision identity,
catalog hash, initial staged-file digest, quotas/deadline/max calls, generation and
execution correlation. Never accept host paths, unit names, OCI IDs or limits from
model arguments. Before each tool dispatch: durable intent with unique tool call
ID/input digest; await existing live authority callback; check deadline/cancel/
recovery hold; only then admit the exact executor call. Same call ID with different
input refuses; unknown committed/mutating outcome is never retried automatically.

Inspect is read-only and never creates/restarts/renews the unit or sandbox.
Stop first revokes task dispatch, then stops the exact retained workspace-bound
unit/OCI identity; numeric saved PID is never authority. Read unit invocation ID,
cgroup emptiness and native OCI stopped state before reporting stopped. Late
starts need repeated protective stop. Missing identity, cleanup failure or changed
unit invocation retains unknown/quarantine/reservation; recovery-held tasks cannot
mint a new generation or replay work.

## Official sources consulted

1. [Pinned Hermes tools runtime](https://raw.githubusercontent.com/NousResearch/hermes-agent/3b421578588243f920886e6fe79a6faa87ea026e/website/docs/developer-guide/tools-runtime.md)
   (2026-11-14; NousResearch): registry + agent-level exceptions, not a universal
   external executor callback. Local pin inspected to resolve exact behavior.
2. [gVisor systemd cgroup driver](https://gvisor.dev/docs/user_guide/systemd/)
   (2026-11-14; Google): OCI resources map to systemd controls; older host/runtime
   support can omit resource fields, so actual enforcement must be inspected.
3. [gVisor rootless](https://gvisor.dev/docs/user_guide/rootless/)
   (2026-11-14; Google): user namespace paths differ; rootless mode may ignore
   cgroup errors and some modes lack netns. Never infer enforcement from a flag.
4. [Docker resource constraints](https://github.com/docker/docs/blob/main/content/manuals/engine/containers/resource_constraints.md)
   (2026-11-14; Docker): CPU/memory controls require actual kernel support.
5. [Docker rootless limitations](https://docs.docker.com/engine/security/rootless/tips/)
   (2026-11-14; Docker): process rlimits are not aggregate container hard caps.

## Authorized disposable probe follow-up

Parent explicitly authorized transient user-service capability probes. One real
service `godseye-capability-probe.service` completed successfully with measured
`memory.max=268435456`, `memory.swap.max=0`, `cpu.max=50000 100000`,
`pids.max=64`, and a present invocation identity. The process read its actual own
cgroup, not its submitted systemd properties. Clean service exit reported5MiB peak.

Subsequent actual runsc-under-caps probing could not start: the user manager
became failed, `Result=resources`; the bounded journal reports `Failed to spawn
executor: Device or resource busy` and `Failed to spawn 'start' task`. The user
bus and delegated cgroup disappeared. Thirty bounded metadata retries did not
restore availability. No root/system-service/distro reset was performed. Thus
the first observed exact caps are real, but stable local executor availability
and aggregate runsc membership/lifecycle are NOT qualified.

Probe source is `artifacts/hermes-tools-probe.py`, which reads effective controls
then invokes the existing pinned runsc lab and samples child cgroup membership.
It has not reached that execution. The runtime must fail closed while the user
manager is unavailable; rlimits/native unsandboxed execution are not substitutes.
Use an explicitly supplied sanitized `XDG_RUNTIME_DIR` and
`DBUS_SESSION_BUS_ADDRESS` rather than inheriting account environment. Owner
user-manager `Linger=no` and transient WSL session lifecycle are operational
availability concerns to resolve without weakening task containment.

Await frozen parent contract before production edits.

The parent subsequently authorized ONE conditional activation of the exact failed
`user@1000.service` after confirming no owned active task units. Reset-failed and
start succeeded without persistent configuration changes. An actual pinned runsc
lab then completed inside a transient service with exact effective512MiB memory,
zero swap,500mCPU and128 host tasks. Real RO root/nonroot/gVisor marker/cross-root
denial/IPv4+IPv6 denial/tmpfs exhaustion controls all passed. Measured service
memory peak201986048 bytes, pids peak39, CPU12.016s over24.713s;235 periods were
CPU throttled. Sampled runsc child shared the same outer service cgroup. This
qualifies feasibility of wrapping runsc in aggregate caps, not the unimplemented
production tool protocol or all-child lifecycle proof.

After all foreground WSL holders expired, the next cold WSL entry again had no
user bus. No second root activation was attempted. A persistent owned WSL outer
process must span operator bootstrap and local app runtime; production task
dispatch must never trigger root repair. Cold-restart unavailable state remains
visible/fail-closed. Stronger all-child sampling and EOF/exact-unit stop probes
are prepared in `artifacts/hermes-tools-probe.py` and
`artifacts/hermes-tools-lifecycle-probe.py`, awaiting live user-manager availability.

## Final disposable capability evidence

The parent authorized one additional bounded bootstrap with a foreground holder
started first. The manager was active when checked; its start operation was
idempotent. An owned foreground WSL holder now remains until explicit release,
stdin closure or30-minute maximum. No linger/distro reset/system configuration.

Repeated capped runsc execution passed in27.444s. All sampled processes including
unshare, runsc, anonymous `exe`, gvisor_sentry and runsc-fd-parkin shared the exact
outer service cgroup. Peak202575872 bytes/39 tasks;268 CPU-throttled periods. Actual
nonroot/RO-root/cross-root/network-none IPv4+IPv6/tmpfs ENOSPC controls passed.
The anonymous exe was not independently labeled gofer, so this does not claim a
separate explicit gofer-name proof; membership sampling covered it and every
observed process. Existing lab deliberately still reports its own cgroup
qualification false; the new outer-service evidence is separately recorded.

Benign controlled memory refusal: exact64MiB/swap0 service attempted128MiB and
only its own service was OOM-killed, Result=oom-kill. Benign process refusal:
pids.max8 admitted parent+7 children then refused next spawn; pids.events max1.
EOF and invocation-bound exact-unit stop each started a benign two-process
service and proved controller exit plus empty/deleted complete cgroup afterward.

Machine-readable evidence:
`reviews/hermes-tools-native-capability-probes.json`. These are real feasibility
controls, not a claim that the not-yet-implemented production tool executor has
passed its own prepare/execute/inspect/stop, Python rootfs, or artifact tests.
