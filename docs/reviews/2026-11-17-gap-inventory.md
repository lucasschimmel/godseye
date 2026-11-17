# Gap inventory — 2026-11-17 (rebuilt from the specs and plans)

Four independent read-only audits re-derived every requirement from `docs/spec/v1.md`, `isolation.md`, `networking.md`, `dedicated-server.md`, `docs/plan/v1-development.md` and `docs/plan/dedicated-server-installation.md`, and checked it against the code at `develop` (`57d2c75`) and against the execution ledger (entries 001-030) and `docs/operations/evidence/*`. Documents were used only for server status; where a document and the code disagree, the code wins. Tests were not run for this inventory. Nothing was re-measured live on the server. This file supersedes [2026-11-16-full-gap-inventory.md](2026-11-16-full-gap-inventory.md) for status; the limits L1-L10 and owner decisions recorded there still apply unless stated below.

Status: **DONE-SERVER** (code and recorded on the real server), **DONE-LOCAL** (code and tests, never run on the server), **PARTIAL**, **MISSING**. Needs: **C** code, **S** server work by the assistant, **O** owner-only action, **D** owner decision.

## 1. What changed since the 2026-11-16 inventory

- Closed: controller OpenBao identity, root-token hygiene, unseal rehearsal (as a service restart), raft snapshots (entry 029); GitHub App created and installed on `Melvyn`, signed webhook accepted through the public edge (entry 030); capacity exception accepted (entry 027); observer runs succeed on the public repository.
- New findings from this audit (not recorded before): items B1-B8 below. They change the critical path.

## 2. Blocking findings (new)

| # | Finding | Evidence | Consequence | Needs |
|---|---|---|---|---|
| B1 | `DockerInfrastructureProvider` is never instantiated outside tests; the control API passes no `options.provider` to `InfrastructureEngine`. `PersistentQuotaManager` and the firewall-evidence interface have no concrete implementation. | `packages/core/src/infra-docker-provider.ts:117`, `packages/core/src/infrastructure.ts:61`, `apps/control-api/src/server.ts` | The platform cannot provision a cell sandbox. F06, I01, I05, I12 are local-only. The server A/B isolation proof (entry 010) was a manual Docker lab, not the platform. | C + S |
| B2 | There is no create-project command that reserves and provisions network, sandbox, database, identity, files and jobs. Suspend, resume, quarantine and purge are metadata-only. `project.provision` returns CAPABILITY_UNAVAILABLE. | `packages/core/src/project-lifecycle.ts:50-52`, `project-management.ts:120` | No project can be brought to life from the console. F03 partial. | C + S |
| B3 | The delivered container receives only `PORT`: no data volume, no database credentials, no route to its cell database, internal network with no outbound access, read-only root. Delivery kinds are `static` and `node` behind an HTTP route. | `apps/control-api/src/delivery/docker-runtime.ts:129-190`, `packages/contracts/src/delivery.ts` | A delivered application cannot use its own cell database, cannot persist files and cannot call external APIs. A worker (no HTTP), a SQLite file or a Discord bot (Melvyn) is not deployable. | C |
| B4 | Restore activation always returns `PROMOTION_UNAVAILABLE` on the shipped pgBackRest provider (no `promote`, no `inspectPromotion`). Production restore cannot complete through the platform. | `packages/core/src/recovery-provider.ts:110`, `recovery-activation.ts:178`, `apps/control-api/src/cell-providers.ts:134` | F15, D08, T07/T30/T31 cannot pass. Known as L2; the cause is now precise. | C |
| B5 | Rotation provider and a broker cell-transition adapter are not configured; credential material for cells is a root-managed file store; GitHub App key and webhook secret are root files, not in OpenBao. | `cell-providers.ts` (no `rotationProvider`), `access-runtime.ts:41`, entry 030 | F13 and I08 are local-only. | C + S |
| B6 | No component runs an application's migrations with the migration role; the build template hardcodes `migration: { class: "none" }`; there is no resumable migration journal (D04). | `infra/jenkins/app-build/build-app.sh:52`, `delivery-migration.ts` | F14 partial: only a lane lock and approval of a declared class. | C |
| B7 | The wired delivery hardening check verifies only runtime, read-only, cap-drop, memory and pids; the full policy inspection (systrap, user, seccomp, no binds or devices) is unwired. | `docker-runtime.ts:218-228` | I05 weaker on the real path than the spec requires. | C |
| B8 | Per-cell CPU and RAM ceilings are scripted (`p12-cell-ceilings.sh`) but no code path calls them. | ledger entry 019 | I06 and D06 are not enforced by the platform. | C + S |

## 3. V1 requirements F01-F47

| ID | Requirement (short) | Status | Remaining | Needs |
|---|---|---|---|---|
| F01 | Owner passkey, enrollment, revocation, recovery | DONE-SERVER | Revocation and offline recovery not drilled; console flow to add a passkey is missing (ticket is CLI-only) | C + O |
| F02 | Overview | DONE-LOCAL | Page never viewed with an owner session; host/guest pressure comes from a 15-minute pushed file | O, S |
| F03 | Project lifecycle | PARTIAL | B2 above; export is metadata only | C + S |
| F04 | Separate dev/prod/preview cells | PARTIAL | B1, B3; per-cell Redis and Inngest never enabled | C + S |
| F05 | Inventory of real capacity, placement | PARTIAL | Only the controller VM is observed; no per-guest, placement or desired-vs-observed comparison | C + S |
| F06 | Policy rejects dangerous options, limits | DONE-LOCAL | B1, B7, B8; no application-volume quota manager | C |
| F07 | Domains and dual-stack TLS | PARTIAL | No AAAA/IPv6 verification; edge does not serve the routed IPv6; never run live | C + S + O + D |
| F08 | Repo, isolated build, scan, provenance | DONE-LOCAL | No registry, no delivery binding, no app-build agent on the server; provenance is a platform hash, not a signed attestation | S + O |
| F09 | Deploy with readiness and smoke | DONE-LOCAL | Smoke is a single HTTP 200; never run on the server | S |
| F10 | PR preview with test data | PARTIAL | No preview database, data or credentials; `syntheticDataOnly` is a label; TTL is a policy field, no 48 h default | C + S |
| F11 | Image rollback | DONE-LOCAL | Registry not deployed | S |
| F12 | Per-cell PostgreSQL | DONE-SERVER (lab) | Proven by a harness on disposable cells, not by a real project | S |
| F13 | Separate credentials, rotation | PARTIAL | B5 | C + S + O |
| F14 | Migrations | PARTIAL | B6 | C |
| F15 | Backup freshness, restore, activation | PARTIAL | B4; file/auth/config recovery is acknowledgement only | C + S + O |
| F16 | Per-project auth | DONE-LOCAL | Hosted runtime, origin, cookie and TLS never run | S |
| F17 | Files with quotas | DONE-LOCAL | Same | S |
| F18 | SSE/WebSocket events | DONE-LOCAL | SSE only (allowed by spec); no console consumer | S (+C optional) |
| F19 | SDK and template | DONE-LOCAL | No server evidence | S |
| F20 | Per-cell Inngest jobs | DONE-LOCAL | Units installed but disabled; nothing ran | S + O |
| F21 | Outbox and reconciliation | DONE-LOCAL | Not run on the server | S |
| F22 | Agent Center | DONE-LOCAL | Hermes on the server has `modelCalls: 0`; one fixed model and one skill bindable; PC-off continuation untested | S + O |
| F23 | Skills catalog | PARTIAL | Pinned loading exists; no catalog API or console page, no compatibility view, no learned-skill review/promotion; contract hard-codes one skill | C + D |
| F24 | Scoped tools, grants | DONE-LOCAL | Tools are file-only (no log, metric, scanner or HTTP tools); sandbox not qualified on the server | S |
| F25 | Unknown runs reconciled | DONE-LOCAL | Not exercised against the real runtime | S |
| F26 | Recurring security checks | MISSING | Scanner pipeline, findings store with diff, remediation proposals, UI | C + D |
| F27 | Log/metric investigation | PARTIAL | Telemetry exists; no Hermes tool, skill or grant exposes it; no redaction path | C |
| F28 | Market/marketing skills | MISSING | Monitor, source store, deltas, skills, publication policy, page | C + D |
| F29 | Laya | MISSING | Runtime, labelled FR/EN dataset, frozen policy, escalation, sampled review | D + O + C |
| F30 | Usage ledger | DONE-LOCAL | No real model usage exercised | S |
| F31 | Budgets, reconciliation | PARTIAL | `adminBilling` hard-coded `unconfigured`; no vendor difference computed | C + O |
| F32 | Logs and metrics | PARTIAL | Metrics are control-API process level (nine metrics); no guest/container collectors, no log shipping | C + S |
| F33 | Incident notifications | DONE-LOCAL | Webhook channel only; no channel configured; no real delivery observed (Discord adapter in progress) | C + O |
| F34 | Approvals | PARTIAL | Binding and invalidation done by plan hash; no aggregate inbox, no `/approvals` route | C |
| F35 | Audit with off-host copy | PARTIAL | Export and anchor are pulled by hand; no scheduled off-host push | C + D |
| F36 | Games and bots | MISSING | Only schema stubs; no adapter, API, port inventory or Personal page (the pinned Luanti VM and its backups do work) | C + S + D |
| F37 | Rebuild on replacement capacity | PARTIAL | B4; no clean-replacement drill; controller, passkey and OpenBao restore never exercised together | S + O + C |
| F38 | Import, migration, export | MISSING (metadata export only) | No import, no data export, no Supabase migration, no cutover | C + D |
| F39 | Adapters with capabilities | DONE-LOCAL | No real-provider contract run beyond Docker/runsc (opt-in) | S |
| F40 | Owner UX | PARTIAL | 12 nav items present; missing Skills, Security (findings), Research/Marketing, Personal, Settings, unified Approvals; a11y populated states partial | C |
| F41 | Retention and purge | PARTIAL | Purge is metadata only: no PGDATA, file or backup destruction, no tombstone | C + O |
| F42 | Headroom and queues | PARTIAL | No soak; no representative load; over the 80 % rule by recorded exception | S |
| F43 | Remote coding | PARTIAL | Server runner `available:false`: egress-allowlist gate to re-run, acceptance unsigned, binding is a placeholder, preview unavailable; code still pins the WSL path for the local profile | S + O + D |
| F44 | Jenkins | DONE-SERVER (mostly) | No green source-triggered run and no first nightly result recorded; agent is a shared VM | S |
| F45 | GitHub App intake | DONE-LOCAL (server partial) | App and webhook path proven; no real push or project event received | S + O |
| F46 | Standing delivery policy | DONE-LOCAL | Never run on the server | S |
| F47 | Custom domains | DONE-LOCAL | Ask guard and 404 live; no real hostname issued | S + O |

## 4. Isolation, data and network controls

| ID | Status | Remaining | Needs |
|---|---|---|---|
| I01 | PARTIAL | B1; manual proof only | C + S |
| I02 | PARTIAL | Cross-cell proof is IPv4 lab fixtures; guard persistence across a host or pro reboot not shown | S + O |
| I03 | PARTIAL | Scan clean on both families; game port 30000/udp not published (decision open); no registered application route yet | D + S |
| I04 | DONE-SERVER | none | none |
| I05 | PARTIAL | B7 | C + S |
| I06 | PARTIAL | B8; no application-volume quota manager | C + S |
| I07 | PARTIAL | Postgres done; Inngest and Redis never ran | S |
| I08 | PARTIAL | B5 | C + S + O |
| I09 | DONE-LOCAL | No hosted application backend | S |
| I10 / I10a | PARTIAL | Server runner unavailable | S + O + D |
| I11 | DONE-LOCAL | No real profile on the server | S |
| I12 | DONE-LOCAL | Compile/inspect path never ran through the control plane (B1) | C + S |
| I13 | DONE-LOCAL (server partial) | Reboot drill of pro and host held; share redistribution deferred | O + S |
| I14 | DONE-LOCAL | No per-cell labelled telemetry from a real cell | S |
| I15 | PARTIAL | No cell-level egress proxy or named grants; DNS to upstream resolvers unrestricted; pro and games VMs have no egress control | C + S |
| I16 | PARTIAL | One shared B2 key can delete every stanza and host copy (R-P06b, accepted) | O + D |
| D01-D03 | DONE-SERVER (lab) | Same as F12 | S |
| D04 | DONE-LOCAL | B6 | C |
| D05 | DONE-LOCAL | B5 | C + S |
| D06 | PARTIAL | B8; no WAL-growth or pool-limit incident | C + S |
| D07 | PARTIAL | RPO 15 min not measured; cell timers disabled after the drill; shared key | O + S |
| D08 | PARTIAL | B4 | C + S |
| D09 | PARTIAL | No named recovery set with separate file/database timestamps | C + S |
| D10 | PARTIAL | Purge metadata-only | C |
| N01 | DONE-SERVER | none | none |
| N02 | PARTIAL | Only healthz and the webhook are public; no real application route | S + O |
| N03 | MISSING | No game-port DNAT, allocation or collision code | C + S + D |
| N04 | DONE-SERVER (reboot caveat) | Host reboot with the guard not done | S |
| N05 | MISSING | No AAAA gating, no broken-IPv6 state; no AAAA published (decision open) | C + O + D |
| N06, N08 | DONE-SERVER | Docker published-port and reboot persistence tested partially | S |
| N07 | DONE-SERVER (lab) | Real per-cell networks via the control plane not shown | S |

## 5. Dedicated-server acceptance DS01-DS18

| DS | Status | Remaining | Needs |
|---|---|---|---|
| 01 Inventory | DONE | Workload definition (game profile, p95/p99) never recorded | D |
| 02 Proxmox, mirror, boot, recovery route | PARTIAL | Boot from each mirror member, Rescue on the installed system, remote console, host reboot with guard, TOTP | O + S |
| 03 VM caps and overcommit | PARTIAL | Admission refusal above the 60 % pool never shown; exception accepted contradicts the spec text; control API does not call the ceilings script | S + C |
| 04 Network, IPv4/IPv6 | PARTIAL | Replay, oversize, invalid-signature rejection and neighbouring-route denial on the public host; AAAA decision; Docker-bypass probes; cells IPv6 egress | S + D |
| 05 Admin closed | PARTIAL | Mobile peer no handshake since last boot; Rescue not exercised; passkey and TOTP not owner-verified; emergency key custody | O |
| 06 A/B isolation | PARTIAL | No real cell inspected after a platform redeploy | S + O |
| 07 Per-cell DB, identity, workflow | PARTIAL | No real cell; Inngest/Redis disabled; no application-level cross-cell authorization test | O + C + S |
| 08 Isolated builds | PARTIAL | `numExecutors: 0` set in config, not read back from the running controller; no explicit no-production-authority negative test; runner not accepted | S + D |
| 09 Off-host recovery | PARTIAL | WAL RPO not measured; control stanza schedule not tested; no replacement-host restore; restic passphrase not escrowed; B2 lifecycle rule not applied; shared key | O + S |
| 10 Restore activation fails closed | NOT DONE | B4, producer fencing, fail-closed tests | C + S |
| 11 Metrics, external alert, alarms | PARTIAL | No alert channel, no alert-arrival test, no heartbeat; observer lacks IPv6 | O + S + C |
| 12 72 h soak | NOT DONE | Last, on a frozen configuration | S |
| 13 Provider admission | PARTIAL | App installed; registry, Trivy, app-build agent, delivery binding, Hermes binding script, real project and coding bindings missing | O + S + C |
| 14 Replacement-host runbook, custody | PARTIAL | Host rebuild and upgrade drills; passphrase escrow; share redistribution (deferred) | O + S |
| 15 Jenkins | DONE, not evidenced | Reports of builds 11-15 not stored; first nightly and first source-triggered run unrecorded; JUnit and configuration hash not archived | S |
| 16 Autonomy with the PC off | NOT DONE | Jobs unit, PC-off test, pro and host reboot with sealed OpenBao | O + S |
| 17 Hermes, runner, Laya, accounting | PARTIAL | First model call, runner acceptance, Laya, budget-refusal test | O + D + C |
| 18 Lifecycle, rotation, export, purge, audit copy | NOT DONE | E09-E12 code | C + D |

Plan phases: P00 done; P01-P08 partial against the DS items above; P09 not done (soak invalidated, no replacement drill, no handoff package).

## 6. Test families T01-T43

- **No test anywhere in the repository:** T27 (recurring security and log skills), T28 (market deltas), T29 (Laya), T32 (games and bots), T35 (Supabase migration and cutover), T36 (72 h soak harness).
- **Server-only or manual, no repeatable test in the repo:** T02 (allow/deny matrix is `h05` scripts and a scan), T03 (A/B isolation), T31 (clean-replacement drill, not done), T40 (observer workflow file only), T42 (Jenkins drills are scripts).
- **Fixture or lab level only:** T01, T04-T26, T33, T34, T37 (the off-host audit copy half has no test), T39 (no credential scan in the Jenkins pipeline), T41-T43.
- Test files carry their own `T-AC-nnn` identifiers, not T01-T43; the traceability to the T families is by behaviour and must be rebuilt for E12.

## 7. Documents that contradict the code or the ledger (to fix)

1. `docs/spec/v1.md` line 13 and the plan header: API `1.19.0`; code and OpenAPI are `1.22.0`.
2. `docs/spec/isolation.md` line 3: "no server provisioned or qualified".
3. `docs/spec/dedicated-server.md` §5: platform CI "follows develop"; the as-built rule is `main` only plus the manual candidate job. §3 "commit disk maxima, keep 20 % free" versus the accepted exception (entry 027). Top tables still carry AX41 assumptions.
4. Ledger phase table: E008-E011 say "Complete" or "PASS" while the table says partial; entry 010 credits DS04/DS06/DS07 although the proof is a manual lab (B1). Ledger header status predates entries 027-030.
5. Ledger entry 027 (720 h token, weekly renewal) is superseded by entry 029 (periodic 8760 h, no timer, manual renewal before about 2027-11-17). Owner guide section 2 still lists `bao.auth` absent, the rehearsal undone and the old token wording.
6. Entry 022 item 6 (GitHub App on `godseye`, statuses read/write) versus entry 030 (installed on `Melvyn` only, contents, pull requests and metadata read-only). The guide checklist still lists the App as pending.
7. GitHub billing block (entries 020, 022, guide checklist 3 and section 5) is stale since entry 027; the guide still marks capacity BLOCKING.
8. `docs/operations/openbao-custody.md` status dated 2026-11-15; does not mention snapshots, AppRoles or the rehearsal.
9. `host-hardening.md` sections 6, 8, 9 (capacity numbers, in-guest firewalls, host health) are superseded.
10. Script headers saying "NOT executed" on scripts the ledger says ran (`p10-build-edge-caddy-image.sh`, `p10-install-edge-caddy.sh`, `p10-render-edge-env.sh`, `p10-store-edge-credentials.sh`, `p10-install-jobs.sh`); `p07-caddy-https.sh` is a stub.
11. "Complete locally" for E07 and E08 overstates: skills catalog and F26-F28 are absent (E07), and metrics are process-level only (E08).
12. Ledger entry 026 reports the builds panel as done; the panel was never viewed with an owner session.

## 8. Items that exist but never ran on the server

`p10-install-registry.sh` (needs the registry password), `p10-install-app-build-agent.sh`, `p10-install-trivy.sh`, `h08-offhost-credentials.sh` (replaced by the interim `h11`); the jobs and Redis units (installed, disabled); the Hermes gateway and tools unit templates; `p12-cell-ceilings.sh` (transient unit only); `p11-cells-teardown.sh` (disposable cells only).

## 9. Reading of the critical path

1. **The platform cannot yet create a project** (B1, B2). This is the largest gap and sits before every project-dependent step (DS06, DS07, DS12, DS16, F04, F10, F20).
2. **A deployed application has no data, no persistence and no outbound access** (B3). Static or stateless HTTP apps are the only fit. A Discord bot with SQLite (Melvyn) needs a worker kind, a persistent volume and a bounded egress allowlist.
3. **Restore, rotation and migrations are unwired** (B4-B6), so the recovery and data stories (F13-F15, F37, D04, D08) cannot be demonstrated even with a project.
4. **Owner and server steps that still block the freeze:** registry password and the three delivery installers; Discord channel and healthchecks heartbeat (the adapter is in progress); restic passphrase escrow; B2 lifecycle rule; Proxmox TOTP and Robot rescue key; mobile WireGuard test; reboot drill; AAAA, game-port and workload decisions.
5. **Paused code backlog** (until the owner chooses): E09-E12 (F26-F29, F36, F38, F41), skills catalog, approvals inbox, passkey-add flow, audit off-host copy, guest and container metrics, WebSocket consumer, AAAA gate, game-port allocation, cell egress.
