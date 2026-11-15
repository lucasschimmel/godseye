# Local Hermes tools and task permissions

This E07 continuation adds five trusted file/data tools to standalone tasks and
explicit chat turns. It extends [Agent Center](agent-center.md) and
[advanced chat](hermes-chat.md); [ADR-016](../adr/ADR-016-task-scoped-hermes-data-tools.md)
records the amended execution boundary. E07 remains partial.

## Prepare and activate

Install the existing pinned Hermes and frozen Runs environment first, following
[Agent Center setup](agent-center.md#prepare-the-local-runtime). Then explicitly run:

```powershell
bun run runsc:install
bun run hermes:tools:install
bun run hermes:tools:local
```

The installer stages a sealed public Python/helper rootfs; it does not copy a project
or private provider material. Windows uses Ubuntu WSL by default.

**Native Linux (any distribution).** The bootstrap and installers also run directly on a
non-root Linux x64 host with no WSL: commands execute without `wsl.exe`, no distribution
argument is accepted, and the bootstrap never escalates to root. The service user must be
uid 1000 (the gVisor user mapping and `/run/user/1000` are pinned). Instead of the
foreground holder, enable lingering once as an administrator
(`loginctl enable-linger godseye`) and use the optional systemd readiness gates in
`infra/dedicated-server/templates/` (the gateway and tools worker are request-scoped
children of the control API, so the units gate on prerequisites rather than run them).
`--start-user-manager` is WSL-only; on Linux it reports that an administrator action is
required. These templates are unexecuted and nothing here is qualified on the server yet.

The foreground
bootstrap verifies the uid-1000 user manager, delegated cpu/memory/pids controllers
and user bus. Keep that terminal open while using tools. Its default and maximum
lifetime is eight hours; `--lifetime-seconds=3600` selects a shorter interval.
If the manager is inactive, the default command refuses. An operator can explicitly
request activation with `bun run hermes:tools:local --start-user-manager`.
That flag may start/reset the exact `user@1000.service` through root; ordinary task
admission never repairs the manager. No linger, persistent service, system
configuration or distro restart is created. Bootstrap availability is distinct from
actual per-allocation admission checks.

In the PowerShell process launching the API, opt in before `bun run dev`:

```powershell
$env:GODSEYE_HERMES_TOOLS_ENABLED = "true"
$env:GODSEYE_HERMES_WSL_DISTRO = "Ubuntu"
bun run dev
```

The optional distro setting must identify the installation/bootstrap distribution.
Private OpenAI bindings are still separately required for model tasks. Without the
exact enable flag the server supplies no tool executor. Installation, bootstrap or
a profile ceiling alone does not grant any task rights. Runtime failure refuses tool
admission; it never falls back to host execution. Stop owned task runtimes and
observe their settlement before releasing the foreground holder with Enter/Ctrl+C.

## Select rights and copied inputs

In `/agents`, configure a profile's optional `toolPolicy` ceiling. Select the allowed
catalog entries and smaller limits as needed. For each standalone task or chat
turn, explicitly select a `toolGrant` subset and its bounds, with UTF-8 seed contents.
The selection is immutable after admission. A new turn needs its own explicit grant;
history and earlier grants do not carry authority forward. Lost-send verification
retains the original grant together with the original body/idempotency key.

A missing/null profile ceiling preserves legacy profile behavior and hashes. A
missing task grant means no tools and one model request, even with a tool-capable
profile. The server rejects duplicate tools/paths, expansions beyond the ceiling,
service callers and stale or revoked scope. Caller host paths, units, runtime
receipts, provider endpoints and credentials are never owner API inputs.

| Tool | Exact input | Operation |
| --- | --- | --- |
| `godseye_workspace_list` | `path` | Bounded directory listing |
| `godseye_workspace_read` | `path` | Read copied UTF-8 data |
| `godseye_workspace_write` | `path`, `content` | Write bounded UTF-8 data |
| `godseye_workspace_search` | `path`, `text` | Literal text search |
| `godseye_json_validate` | `content` | Parse JSON data without evaluation |

Read/write/seed paths are strict relative paths under `scratch/` or `artifacts/`.
Listing/search may also use `.` or either top-level directory. No traversal, links,
hardlinks or special files are admitted. Inputs are copied into a server-minted
private workspace; a path never mounts the caller's filesystem. Task content is
never imported, evaluated or executed. There is no arbitrary command, argv, native
tool registry, browser, network fetch, project execution or publication connector.

## Bounds, settlement and recovery

The maximum is four actual model POSTs and three tool calls per admitted task.
The task's existing `maxCostMicros` is the total reservation across the finite loop,
not a fresh allowance per step. Conservative attempt cost is durably debited before
each POST; missing token usage stays unknown. There are no hidden retries.

The strict version-1 schemas cap tool timeout at 30 seconds, aggregate read and
write at 64 KiB each, output at 32 KiB, eight files at 16 KiB each, 64 directory
entries and path depth eight. Logical workspace contents are at most 1 MiB and may
be lower under the owner grant. Copied seeds consume write/workspace budgets.
Physical workspace tmpfs is 4 MiB to allow filesystem metadata and staging; this
physical size does not enlarge the logical allowance.

The fixed trusted helper runs under pinned gVisor systrap and an outer verified
systemd user-service cgroup: 512 MiB aggregate RAM, zero swap, 500 millicores and
128 tasks. Root is read-only; the guest is nonroot with no capabilities,
no-new-privileges and no network. Native Hermes and model transport remain outside
this sandbox; only the fixed typed data helper runs inside it. General shell/build
and hostile project-code execution still require a separately qualified coding isolation boundary (KVM, or the weaker server work-VM profile, which is unqualified)
These tools do not relax that requirement.

Foundation persists each call intention, model call/input digest and immutable
allocation identity before dispatch. Changed duplicate calls conflict. A known
receipt can be returned again; unknown physical work is never replayed. Lease,
epoch, profile, task and grant checks fence dispatch and publication. Call history
shows intended/running/succeeded/failed/unknown/cancelled outcomes and cleanup state.
Read-only inspection cannot regrant, renew or relaunch a runtime.

Stop uses the exact owned systemd unit invocation and OCI identity, never a numeric
PID loaded from disk. Cancellation, timeout and controller EOF request actual
cleanup. An accepted stop request is not proof of absence: unknown capacity and
budget remain retained until exact physical stop/absence evidence. Leave uncertainty
visible and reconcile it rather than retrying the same effects.

Actual `artifacts/` snapshots are exposed only after successful, nonrevoked
Foundation settlement with proven runtime stop. For a chat turn, the exporter
inserts bounded snapshots into the existing immutable `agentChatArtifacts` store,
with artifact IDs and digest-verified inert attachment downloads. Standalone tasks
retain bounded, digest-verified snapshots in the tool journal, exposed through
`toolsDetail`; the console creates a local `text/plain` Blob download from those
bytes. Standalone snapshots do not receive chat artifact IDs or its download endpoint.
Partial output, failed/cancelled/unknown calls and late results cannot publish an
artifact. Neither delivery path confers execution or approval authority.

## Measured local evidence

The [production native report](../../.codex/crafts/g-o-d-s-e-y-e-cfe8/reviews/hermes-tools-production-native-evidence.md)
records real pinned runsc/helper execution, actual write/read bytes and stopped
cleanup, sampled service membership, EOF/owner-death cleanup and an unrelated sentinel.
It separates production cgroup-value checks from smaller-limit kernel refusal probes
and a lab tmpfs ENOSPC case. Sampled membership is not continuous enumeration of
every descendant; the lab storage probe is not production 4 MiB exhaustion.

The report records three passing actual Foundation → pinned Hermes → scripted model
→ isolated helper chain cases. The model fixture replaces provider transport only;
this is not a paid-provider claim. Executor and browser fixtures have separate
coverage. The current continuation's regression, restart/lost-ack/cost/adverse cases
and review gates passed; exact scenario mappings remain in the
[verification strategy](../../tests/STRATEGY.md). This does not complete E07.

| Final local gate | Measured result |
| --- | --- |
| Disjoint default regression | 1,426 passed, 28 default-native skips, zero failures across 132 collected files |
| New ordinary cases | 66 passed, already included in the 1,426 total |
| Explicit native qualification | 11 new unique actual-native cases and two selected legacy cases passed |
| Browser / selected mutations | Three browser journeys passed; five selected mutants killed |
| Static contracts | Lint over 615 files, types and control API 1.12 consistency passed |
| Build / smoke | Canonical build passed after regression; built-API smoke passed on its first attempt |
| Source / independent review | All 68 frozen production hashes unchanged; code, security and documentation reviews passed; HTR-001 and HTD-001 resolved |
| Scans | 713 public paths: one unchanged synthetic-placeholder finding, zero new credentials; Bun audit zero advisories; 73 exact third-party PyPI OSV queries zero findings |

The [regression aggregate](../../artifacts/test-results/hermes-tools-global-aggregate.json)
uses 1,454 JUnit cases, with no cross-group overlap. Two existing parameterized
within-file display titles repeat because nonfinite inputs serialize as `null`;
1,452 unique display labels are not the case count. The builder group passed two
cases in 18.86 seconds; the remainder passed 1,424 in 1,082.09 seconds. Native
opt-ins ran separately from the default-native skips. Curated mutations do not imply
a whole-suite mutation score. Semgrep, SBOM/OS coverage, paid-provider billing,
general-code KVM and dedicated-host deployment remain outside this qualification.

## Current availability after verification

The [final physical inventory](../../.codex/crafts/g-o-d-s-e-y-e-cfe8/reviews/hermes-tools-final-cleanup-truth.md)
observed a changed WSL boot, no owned task/probe cgroups and no surviving matching
runtime/helper processes in the current boot. The user manager is currently
unavailable. The former foreground holder was already gone; it was not explicitly
released. A failed service inventory alone was not treated as absence proof, and
old unknown journals were not rewritten as stopped. Earlier successful native runs
do not establish current availability. Explicit operator bootstrap/activation is
required again; ordinary tool admission continues to fail closed.
