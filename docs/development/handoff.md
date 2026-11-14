# Cross-machine development handoff

Updated: 2026-11-14. This checkpoint records local development, not a server installation or release.

## Resume here

Latest implementation checkpoint: [E08 usage, budgets, observability and incidents](usage-observability.md),
owner control API `1.15.0`, automatic migrations `0023`/`0024`. Local software is
complete and locally verified with focused, native-composition, browser, mutation and static/release gates. The E07 completion evidence below is historical, not current-source
proof of the new accounting IPC. See the [E08 story table](../plan/v1-development.md#local-e08-usage-observability-and-incidents--2026-11-14).

Refresh the Hermes runtime with `bun run hermes:runtime:install` and verify the new
controller source receipt when migrating an older installation. This checkpoint's
Hermes receipt was refreshed and two actual provider compositions passed. Coding
source closure/helper also changed: independently
requalify current sources rather than reuse old KVM/CLI proof. Actual WSL broker and
authority/loopback mechanisms are measured separately; current full KVM qualification
is not claimed. No private bindings, paid calls, messages or server changes are part
of this checkpoint. Remote metrics, billing administration and real independent
observer/notifier channels remain unconfigured. Unknown physical work/delivery is
never blindly retried; Foundation charges are conservative and never invoice-refunded.

Preceding completed local continuation: [approved agent orchestration](agent-orchestration.md),
owner control API `1.14.0`, automatic migration `0022`. The requested local software
is complete and locally verified. It extends [Agent Center](agent-center.md),
[streaming chat](hermes-chat.md), [trusted tools](hermes-tools.md) and the separate
[locally qualified coding runners](coding-runners.md).

Review immutable single-project/environment plans of at most twelve steps; approve
the exact hash using a recent passkey. The service coordinator delegates through
real Foundation authority and serializes ready children. Strict successful-current
Hermes JSON only proposes pending content. Clarification creates a new pending
remaining-effectful suffix plus inert answered-question provenance; completed prefix
work never replays. Unknown effects block and reconcile read-only. Expiry/revocation
fences admission, active mutations and late logical success; physical cleanup and
observation remain possible. Default providers remain opt-in and fail closed.

The [per-story table](../plan/v1-development.md#local-e07-orchestration--2026-11-14)
records completed local behavior and exact remaining acceptance. Native vendor
paused-tool parity/general Hermes shell, paid entitlement and E08 reconciliation,
E09 operational bundles, deployed provider/host/recovery and E05 preview/connectors
remain distinct. No automatic commit/push/deploy/publication is added. Reinstall
native assets and independently qualify the new PC using the corresponding guides;
private homes and bindings are not repository assets.

Use the private repository's **develop** branch. Main contains presentation/release material and receives application code only on an explicit release decision. Preserve the existing small Conventional Commits; do not squash or reconstruct the published history merely to resume work.

Read these sources before continuing:

1. [V1 development plan](../plan/v1-development.md), including the E06 completion continuation and current qualification boundaries.
2. [V1 requirements](../spec/v1.md), [isolation/data contract](../spec/isolation.md), [networking contract](../spec/networking.md) and [ADR-002](../adr/ADR-002-professional-vm-and-dual-stack.md).
3. [Dedicated-server specification](../spec/dedicated-server.md), [installation plan](../plan/dedicated-server-installation.md) and [completeness register](../reviews/dedicated-server-coverage.md).
4. [Application jobs guide](application-jobs.md), [verification strategy](../../tests/STRATEGY.md) and the guide for the feature being changed.
5. [Local setup](local.md), [owner access](owner-access.md) and [Git workflow](git-workflow.md).

The plan and verification records are more current than some historical README checkpoint paragraphs. Consult those records before estimating progress or declaring an epic complete.

## Decisions retained from the conversation

| Area | Accepted direction |
| --- | --- |
| Product | Private owner-only control panel; own backend platform, TypeScript SDK and deployment management. Target the complete V1, not a reduced MVP or a percentage that waives security/recovery gates. |
| UI/API | React, TanStack, TypeScript, Tailwind, shadcn/ui, Hono and typed contracts; PostgreSQL/Drizzle, Better Auth, Biome, Husky, Vitest and Playwright. |
| Toolchain | Bun 1.4.4 for workspaces, dependencies and scripts; Node.js 24 for the current application/test runtime. Use `bun run test`, not Bun's separate `bun test` runner. |
| Physical machine | Hetzner AX41 in Finland. Owner reported a reset to Ubuntu 26.04 and allowed eventual reinstallation; actual hardware, OS, disks, current data and assigned routes must be inspected before destructive execution. |
| Hypervisor | Proxmox installed once on bare metal. One professional G.O.D.S.E.Y.E VM, one personal games/Discord-bots VM, and an optional disposable sibling work VM for builds/agent tools. No nested Proxmox. |
| Project isolation | Docker/Compose with qualified gVisor systrap application profiles inside the professional VM. Separate project AND environment cells, networks, volumes, material and workflow authority. Ordinary containers do not establish an independent kernel per project. |
| Data | Independent PostgreSQL instance, PGDATA/WAL and scoped roles/material per project/environment. Private files, auth, realtime and SDK are part of the owned application backend. No requirement for unchanged supabase-js compatibility. |
| Network | One public IPv4 target; at most two with a concrete reason. Dual-stack web ingress, routed IPv6 and actual IPv6 egress, IPv4 fallback, shared web proxy, exact game-port registry and private administration. |
| Deployment | Coolify initially, behind a replaceable adapter. GitHub source synchronization, immutable builds, previews, checks, compatible promotion/rollback and finite owner delivery policies. |
| CI | Private Jenkins controller with zero executors; disposable work-VM agents, scheduled tests and source-triggered CI/CD. Prepared files are not qualified Jenkins execution. |
| Jobs | Self-hosted Inngest for durable jobs/cron, scoped per-cell state and external PostgreSQL/Redis. Exactly one scheduling owner per task. |
| Agents | Hermes is central to operational skills, runs and investigation. Remote Codex/Claude Code workers execute scoped tasks on the server; vendor authentication/entitlements remain separate from a browser subscription. |
| Decisions | Laya for evaluated low-cost local classification/decisions, with bounded resources and escalation. LiteLLM is not a required substitute. |
| Operations | Resource metrics and per-project/environment/run/module/skill token/cost attribution; budgets, external alerts, independent audit/recovery custody and operation without the workstation. |
| Recovery | Off-host backups, PostgreSQL physical backup/WAL and held restoration into a new isolated environment; source retained and external effects blocked until safe activation is proven. |

The screenshots supplied on 2026-11-13 are historical conversation evidence. Earlier proposals for four permanent VMs, a regular VM per project, optional-only Hermes or n8n were superseded. The owner explicitly corrected n8n as a transcription error and does not want a visual modular automation platform. The later professional-VM/dual-stack decision governs. Raw screenshots in a temporary Windows directory are not a repository dependency; their durable decisions are recorded here and in the contracts.

## Current software checkpoint

Local E01–E06 feature slices exist: owner access and service identities, evidence-bound infrastructure preparation, independent database/recovery lifecycle, application backend/SDK, application delivery and durable application jobs. This does not mean all corresponding deployed or cross-epic release gates have passed.

The latest E06 local completion includes an owner-HTTP-independent PostgreSQL-journal supervisor, trusted per-cell children, live signed cron catalog reconciliation, external workflow PostgreSQL/Redis and a separate platform engine. The plan records a 1,225-case default-suite pass, eleven native opt-ins, eight Python helper regressions, seven selected mutation kills, independent source review, static checks and build/smoke. These are historical results for the implementation checkpoint, not tests rerun by this documentation handoff. Owner control API is currently 1.14.0; application API remains independently versioned at 1.0.0.

The current product epic remains **E07: Hermes Agent Center, skills, execution grants, remote coding and run recovery**. Confirm its story-level prerequisites in the current plan when implementation is requested. Later epics cover usage/operations, recurring security/marketing skills, Laya/owner UX, personal-service lifecycle and full recovery/release qualification.

Dedicated-server preparation is documented and independently rechecked: 80 canonical F/I/D/N requirements are mapped, DS01–DS18 defined, and P00–P09 all remain pending. The recheck resolved an installation-order problem by separating host/guest/container/receiver subgates, restricted platform installation in P05, recovery qualification in P06 and delivery admission in P07. No dedicated-server changes or executed remote acceptance are claimed.

## Known work and boundaries

- Jenkinsfile/JCasC and the CI guide still contain main-only prepared source assumptions. Before enabling this repository's real Jenkins jobs, qualify trusted **develop** as the initial platform CI source; main currently has presentation rather than executable application source. Application projects use their own exact approved branches, including main where selected.
- Remote GitHub/Jenkins/Coolify/provider admission, Docker/gVisor containment/quotas, real IPv6 paths, host capacity, off-host durability, coordinated recovery/activation and the 72-hour mixed-workload soak still require their named qualification gates.
- Actual server disks/capacity, routes, domains/DNS, games/ports, backup destination/cost/key custody and exact install-version pins remain execution inputs. The installation plan lists how to collect them.
- All work stays local until server installation is requested. A Git push is neither a release-to-main decision nor permission to deploy the dedicated host now.

## Start on the other PC

Clone the private repository, select develop and install the pinned toolchain. For an existing checkout, keep any local edits safe and update develop with a fast-forward pull; do not hard-reset a machine that has its own work.

```sh
git switch develop
git pull --ff-only origin develop
bun install --frozen-lockfile
bun run dev
```

Open `http://localhost:4300`. For a genuinely fresh local instance, run `bun run owner:setup` in a second terminal and complete the real passkey ceremony. The enrollment link is private and must stay outside Git/chat logs.

Git transfers source, specs, plans, lockfile and committed verification records. It does **not** transfer the previous PC's `.local` databases, private identity/process state, keys, provider material, passkeys/sessions, running services, caches or build/test output. A fresh clone therefore starts a new local instance and will not automatically contain old local projects. Keep the old PC's state intact; continuing the same instance requires a separate protected, consistent migration of data and identity state following the operator guides. Do not commit those directories or run owner recovery merely to move code: recovery replaces existing owner access.

Optional native laboratories have explicit Linux/WSL/tool requirements; reinstall their verified tools using the relevant guides rather than copying untracked caches. Default startup does not qualify remote providers or automatically start detached job infrastructure; use the [jobs guide](application-jobs.md) for that explicit topology.

## Suggested resume instruction

> Read docs/development/handoff.md, the current V1 plan and the relevant specs. Continue the remaining local E07 stories after checking the advanced chat guide and its qualification evidence. Preserve the accepted professional-VM/dual-stack topology, independent project/environment authority and all recovery/security gates. Use develop for implementation; do not deploy the server or release to main without a new request.

## Latest local E07 tool continuation — 2026-11-14

Read the [tools runbook](hermes-tools.md) and [ADR-016](../adr/ADR-016-task-scoped-hermes-data-tools.md)
before changing execution. Five trusted data tools have explicit profile ceilings
and immutable per-task/chat-turn subsets; missing grants remain no-tools/one request.
Copied scratch/artifact data is isolated from host/project material. Native Hermes
and model execution stay outside the pinned runsc trusted-helper sandbox. At most
four model POSTs/three calls share one total reservation; durable intentions and
exact unit-invocation/OCI cleanup preserve unknown/no-replay behavior. Standalone
and chat outputs publish only after actual successful nonrevoked/stopped settlement.
Standalone output uses bounded digest-verified tool-journal snapshots and local
`text/plain` Blob downloads; chat inserts immutable chat artifacts with their existing
IDs and attachment endpoint.

On another PC, use explicit tool installation and foreground bootstrap from the
runbook, then opt in with `GODSEYE_HERMES_TOOLS_ENABLED=true` in the API process.
No tracked source transfers runtime state or grants. Bootstrap defaults to eight
hours, refuses a cold manager unless explicitly activated and creates no linger or
persistent system configuration. Default application startup does not enable it.

Real Foundation/pinned-Hermes/helper chain proof uses scripted model transport;
physical production, lab refusal and browser fixtures are distinguished in the
verification strategy. Final regression passed 1,426 cases, with 28 default-native skips across 132 files.
The 66 new ordinary cases are included; 11 new and two selected legacy actual-native
cases passed separately. Three browser journeys, five selected mutants, 615-file
lint/types/control API 1.12 contracts, final canonical build and first-attempt smoke
passed. All 68 frozen production hashes and independent code/security/docs reviews
passed; HTR-001 and HTD-001 are resolved. Public scans covered 713 paths with one
unchanged synthetic placeholder and zero new credential findings; Bun and 73 exact
PyPI OSV queries found zero advisories. Semgrep/SBOM/OS coverage is absent.
Previous checkpoint counts remain historical. E07 remains partial; arbitrary shell/build needs
I10 disposable KVM, which remains unavailable locally. No paid model call,
dedicated-server action or Git publication is part of this continuation.

Final read-only cleanup inventory observed a changed WSL boot and no owned runtimes
or task/probe cgroups in the current boot. The user manager is currently unavailable;
the former holder was already gone, not explicitly released. No old unknown journal
was fabricated as stopped. Follow the tools guide for explicit operator activation
before trying tool tasks on this machine again. The
[final inventory](../../.codex/crafts/g-o-d-s-e-y-e-cfe8/reviews/hermes-tools-final-cleanup-truth.md)
records the physical observations and their limits.

## Latest local coding-runner continuation — 2026-11-14

Read the [coding guide](coding-runners.md) and
[ADR-017](../adr/ADR-017-local-coding-runners.md). Local E07.S05 software adds
immutable repository/commit preparations, Foundation-backed tasks, private
API-only Codex/Claude Code bindings, logical worktree history and inert patch/test
log downloads, under control API `1.13.0`/migration `0021_coding.sql`.

Default execution remains unconfigured. Explicit local setup and binding commands
are in the guide; a write does not enable execution. Never migrate keys through
chat/source control or reuse desktop subscription OAuth. Registered local Git
objects are copied as inert source; configured GitHub identity does not clone it.
The target workspace must independently qualify its private source and local KVM,
resource pool, image/CLI/policy and dated price review before dispatch. The
physically qualified adapter is Windows/Ubuntu WSL2 only; native Linux/Proxmox
remains deployment work. Live worktrees/CLI homes are ephemeral guest RAM; retained
records preserve frozen source/image and patch/log evidence without CLI resume.
The console proposes $0.50 Codex/$0.10 Claude ceilings, preserves manual edits and
requires explicit fresh admission; project/Hermes budgets are unchanged.

Both actual pinned CLI chains passed in Windows/Ubuntu WSL KVM against scripted
models. Three actual Foundation/provider/controller/broker/KVM composition cases passed
with only upstream HTTPS replaced by a trusted fixture and zero paid requests. Existing-suite regression
passed 1,424 cases with 28 default-native skips across 131 files in 1,242.80 seconds,
plus two separately serialized backend-template builder cases in 17.47 seconds.
The new focused suite passed 87/87: the disjoint existing/new aggregate is 1,513
ordinary passes, with 28 legacy default-native skips. Three opt-in actual native
Foundation composition cases passed separately in 123.946 seconds and are excluded
from the ordinary total. Separate mechanisms
passed 31 broker, 10 source and 13 readiness/stop checks. Two coding browser
journeys pass; the earlier strengthened run took 32.9 seconds. Do not add
overlapping focused/mechanism/native subsets.
Four source security findings are independently closed. The final normal receipts
match all 13 runtime sources in native freeze v7. Final unchanged 15-second
built smoke passed at true idle with health reachable, remote server disconnected
and exit 0; cleanup observed zero owned units, broker socket directories and
controllers. Earlier historical checkpoints remain
valid only for their recorded source. No paid calls, server setup or Git
publication occurred; E07 and V1 remain partial.
