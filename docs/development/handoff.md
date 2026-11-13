# Cross-machine development handoff

Updated: 2026-11-13. This checkpoint records the owner's decisions and screenshot context before moving to another PC. It documents local development, not a server installation or release.

## Resume here

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

The latest E06 local completion includes an owner-HTTP-independent PostgreSQL-journal supervisor, trusted per-cell children, live signed cron catalog reconciliation, external workflow PostgreSQL/Redis and a separate platform engine. The plan records a 1,225-case default-suite pass, eleven native opt-ins, eight Python helper regressions, seven selected mutation kills, independent source review, static checks and build/smoke. These are historical results for the implementation checkpoint, not tests rerun by this documentation handoff. Owner control API is currently 1.9.0; application API remains independently versioned at 1.0.0.

The next planned product epic is **E07: Hermes Agent Center, skills, execution grants, remote coding and run recovery**. Confirm its story-level prerequisites in the current plan when implementation is requested. Later epics cover usage/operations, recurring security/marketing skills, Laya/owner UX, personal-service lifecycle and full recovery/release qualification.

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

> Read docs/development/handoff.md, the current V1 plan and the relevant specs. Continue locally with E07 after checking its prerequisites. Preserve the accepted professional-VM/dual-stack topology, independent project/environment authority and all recovery/security gates. Use develop for implementation; do not deploy the server or release to main without a new request.
