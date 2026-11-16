# Production typed executor: local physical evidence

2026-11-14. This supersedes the feasibility-only status in
`hermes-tools-native-capability-probes.json`; that historical probe record is
preserved. No paid provider request, dedicated server, KVM, Docker daemon, global
package or persistent host configuration was involved.

## Actual production worker

`artifacts/hermes-tools-worker-probe.py` exercised production
`hermes_tools_runtime.py`, sealed standalone Python3.14.9 plus fixed regular
public glibc files, pinned runsc release-20261102.0 including its required sidecar
executables, and the actual `hermes_tools_worker.py` under a verified outer
systemd user service. Preparation then two typed calls plus cleanup completed in
approximately4.14s after explicit installation. It wrote `artifacts/report.txt`,
read the same actual UTF-8 bytes, returned27-byte content plus SHA256
`65ba732f158e58e94578a94889b125be3e5a6c6f621db3feae7c6d47850afb0b`,
and reported per-call read/write/live-workspace counts. Exact unit invocation,
OCI ID and profile receipt stayed stable. Cleanup reported stopped=true.

The sealed rootfs installer independently checks selected Python files against
the existing immutable Python manifest and hashes the complete staged public
payload. It excludes site-packages, tests, links and sensitive basenames. It does
not copy a project, model/provider identity or general host directory into the
sandbox. Model and native Hermes processes remain outside it; only strict typed
scratch/data operations execute within it.

## Physical ownership and sampled membership

`artifacts/hermes-tools-owner-death-probe.py` prepared the actual production
worker. It sampled the running service's cgroup membership and recognized the
gofer by its fixed argv role, and the sentry by its boot role; every sampled
process had that same outer cgroup. This is **sampled membership evidence**, not
an assertion that polling enumerated every descendant at every instant. Linux
cgroup inheritance, inaccessible guest cgroup controls and the fixed trusted
wrapper provide the implementation boundary; inspection and negative controls
provide complementary evidence.

The probe terminated only its owned live controller process handle. Native stdin
EOF propagated to the sandbox; the complete target cgroup became empty within
the bounded6-second observation window. A separately owned benign sentinel
service stayed active. Exact retained-scope reconciliation then removed the OCI
metadata and returned stopped=true. No numeric PID loaded from disk authorized
any kill. This run completed in approximately3.42s.

Separate benign two-process services proved both EOF and exact
invocation-bound unit stop emptied their complete service cgroups. These generic
service lifecycle controls supplement, rather than replace, the production-worker
owner-death proof.

## Resource and isolation observations

Production service pre-exec refuses unless actual own cgroup files equal512MiB
memory, zero swap, CPU50000/100000, and128 host tasks; this check precedes runsc
and any task input. The production worker refuses unless uid1000 and the actual
gVisor marker are present. Its writable workspace is a4MiB tmpfs, with smaller
independently enforced logical/write/read/result budgets. Fixed OCI configuration
uses read-only root, empty capabilities, noNewPrivileges, fresh user/mount/network
namespaces and runsc network none. Arbitrary shell/project code remains forbidden.

A real pinned runsc lab within the same verified outer512MiB/128-task/500mCPU
profile observed approximately193MiB peak/39 tasks and268 throttled CPU periods;
it passed nonroot, RO-root refusal, cross-root refusal and host IPv4/IPv6 refusal
with positive host-listener controls. Its1MiB lab tmpfs refused a2MiB copy with
ENOSPC. That is actual **lab** storage-bound evidence, not a claimed4MiB production
workspace exhaustion case. The production helper independently enforces its
smaller logical byte/file caps.

Controlled kernel refusal probes used smaller disposable service limits to avoid
host pressure:64MiB/swap0 killed its own128MiB allocation, Result=oom-kill;
pids.max8 admitted parent+7 children and refused the next spawn, pids.events max1.
These prove the kernel controllers physically enforce those smaller probe values;
they are **not** claims of exhausting the production512MiB/128-task bounds.
Actual production pre-exec values and measured bounded runtime footprint are
recorded separately. No uncontrolled exhaustion was attempted.

## Remaining qualification boundaries

- Independent GAUNTLET reports3/3 passing native-chain cases after the canonical
  JSONB identity fix, including actual Foundation journal → pinned Hermes →
  scripted model → actual typed executor → successful final result/artifact.
  Its independently recorded tests/gate evidence governs the precise scenarios;
  this report does not reclassify model fixtures as paid provider qualification.
- Review, adverse typed arguments, journal/restart/cancel/cost conditions and
  browser behavior require their own passing acceptance evidence.
- Hostile physical links/special files are not constructible through this catalog;
  path-schema tests alone do not claim an injected physical-link fixture proof.
- General arbitrary shell/build/project-code execution remains gated by I10 KVM.
- A cold WSL user manager can be unavailable. Runtime admission fails closed;
  explicit foreground operator bootstrap supports it without persistent linger or
  model-triggered root repair. Current operator holder24838 must be released after
  tests and owned task runtimes have stopped.

## Final local cleanup recipe

Close each managed Hermes/tool executor and wait for its native owner close; verify
there are no active task/probe units belonging to this test run. Do not stop an
unrelated unit merely because it shares a prefix. The private journal retains
unknown/stopped=false until exact invocation/cgroup/OCI cleanup proves otherwise.
Only after all required tests finish, send Enter to foreground holder24838 and
observe its exit. No distro reset, linger change or general service shutdown.

## Production source map

- `scripts/hermes_tools_install.py`: explicit sealed public runtime staging.
- `scripts/hermes_tools_policy.py`: exact catalog, schemas and native bounds.
- `scripts/hermes_tools_worker.py`: isolated trusted file/JSON operations.
- `scripts/hermes_tools_service.py`: own-cgroup hardcap verification before exec.
- `scripts/hermes_tools_runtime.py`: durable exact-unit/OCI owner, EOF guard and
  read-only inspect/protective stop; no root repair or saved-PID authority.
- `scripts/hermes_tools_bridge.py`, `hermes_gateway_tools_reply.py`: bounded private
  controller callbacks and standard model tool-call SSE validation.
- `scripts/hermes_gateway{,_state,_broker}.py`, `hermes_agent_boot.py`: exact task
  identity, finite model attempt/cost fence and entire-batch dispatch override.
- `apps/control-api/src/hermes-tool-executor.ts`: strict shared envelope schemas,
  canonical immutable allocation comparison across JSONB round trips, pipe owner.
- `apps/control-api/src/hermes-provider.ts`: exact native prepare/call acknowledgments
  into the real core authority and durable per-call journal.
- `scripts/hermes-tools-{install,bootstrap}.mjs`: explicit operator setup and
  foreground8-hour-max WSL holder; optional exact user-manager activation flag.
