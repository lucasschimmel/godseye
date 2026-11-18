# Gap inventory — 2026-11-18 (specs and plans versus code and the live server)

This inventory supersedes [2026-11-17-gap-inventory.md](2026-11-17-gap-inventory.md) for status. The per-requirement tables there (F01-F47, I/D/N controls, DS01-DS18, T01-T43) remain the baseline; this file records what changed, what was **measured live on the server today**, and the consolidated list of remaining gaps.

Method: read-only inspection over WireGuard SSH of the host (`pve`) and the three guests on 2026-11-18 around 06:30 UTC, one unauthenticated probe of the public edge, and a diff of `develop` against the code audited yesterday (`57d2c75` → `6d89827`). No file on the server was modified. Tests were not run. Secrets, OpenBao contents and credential stores were not read.

Status words are those of the 2026-11-17 inventory: DONE-SERVER, DONE-LOCAL, PARTIAL, MISSING. Needs: C code, S server work by the assistant, O owner-only, D owner decision.

## 1. What the server actually runs (measured 2026-11-18)

### Host `pve` (Proxmox, kernel 7.0.14-29-pve, up 3.3 days)

| Area | Observed | Against spec |
|---|---|---|
| Storage | `rpool` ONLINE, 7 % used (34.5 G of 506 G), fragmentation 4 %, last scrub 2026-11-15, 0 errors. ARC 4.22 GiB of a 4.29 GiB maximum, hit ratio 96.8 %. | Matches mirror/ZFS target (DS02). |
| Drive wear | `nvme0n1` percentage used **58 %**; `nvme1n1` percentage used **101 %** with critical warning `0x4` (accepted as the Samsung warranty flag). Spare 100 %, 0 media errors on both. | Both mirror members are heavily worn and the second is past its rated endurance. The health policy accepts it; no replacement plan or spare-drive decision is recorded. New to this inventory. |
| Guests | VM 100 `godseye-pro` (32 GiB RAM, 200 G disk), 200 `godseye-games` (16 GiB, 80 G), 300 `godseye-work` (6 GiB, 20 G). All running, guest agent reports no reboot pending. | Matches the pro / games / disposable-work topology. |
| Firewall | `inet godseye_filter`, `ip godseye_nat`, `inet godseye_guard`; input and forward policies drop; health reports SSH closed on the public side. Host listens on 22, 8006, 3128 (spiceproxy) and local mail only. | Public closure was taken from the health file, not re-probed from outside. |
| WireGuard | Peer .10 (this PC) handshake 32 s ago; peer .11 2 h 13 min; peer .12 **no handshake since boot**. | DS05 mobile-peer gap unchanged. |
| Backups | vzdump of 100, 200, 300 all 4.2-4.3 h old (about 4.0 GB, 0.7 GB, 2.3 GB zstd). Host-config archive 5 h old. Off-host copy state `ok` but its mode is **`config` only**; the `vms` off-host timer has never run (next Sunday 2026-11-22). Backup dataset 31.8 % of its 60 G quota. | Off-host VM copy unproven (DS09). |
| Updates | Unattended upgrades on, last run 06:14, 0 security pending, 14 PVE packages pending (qemu-server, pve-manager, pve-qemu-kvm and others). Running kernel 7.0.14 while the newest installed package is 7.0.2 (version string oddity to explain). | Non-security host updates are manual by design. |
| Time | NTP synchronised, offset 45 µs. | OK. |
| Health file | `status: ok`, no alerts. | OK. |

### Guest `godseye-pro` (VM 100)

| Area | Observed |
|---|---|
| Running services | `godseye-control-api`, `godseye-console`, two `godseye-edge-forward` sockets, `jenkins`, `openbao`, `postgresql@17-main` (control metadata), `redis-server`, `docker`, `containerd`. No failed unit. |
| Installed but disabled | `godseye-jobs`, `godseye-pg@`, `godseye-redis@`, the per-cell `pg-backup` full/diff/check timers, `godseye-bindings-render`. Enabled: edge, guest firewall, cell-helper socket, bao-snapshot, cell-snapshot, pgbackrest-backup timers. |
| Containers | Three only. `godseye-edge` (runc, read-only root, all capabilities dropped, 4 binds). `godseye-cell-dev-app` and `godseye-cell-prod-app`: **`alpine:3.21`, runtime `runsc`**, read-only root, 128 MiB, 64 pids, all capabilities dropped, no binds, on separate `godseye_dev_net` / `godseye_prod_net`, up 2 days. |
| Images present | Caddy (edge build) and `alpine:3.21` only. No application image, no registry, no Trivy. |
| Disk and memory | Root 6 % of 197 G; 2.1 GiB of 31 GiB RAM used. |

The two cell containers are placeholders with no application, no per-cell PostgreSQL or Redis running and no job supervisor.

### Guests `godseye-games` (200) and `godseye-work` (300)

- Games: a service listens on UDP `10.20.2.10:30000` (the pinned Luanti server); 1.6 G of 79 G used. No other game, bot or adapter.
- Work: `runsc`, Java and the DNS egress unit are present; **no Docker and no Trivy**. No persistent Jenkins agent service is running (the agent is presumably started on demand over SSH; not verified).

### Public edge

`https://godseye.lucasschimmel.fr/healthz` returns 200 `godseye-edge-ok`; `/` returns 404. No AAAA record could be confirmed from this PC.

### Not measured today (do not read these as passing)

OpenBao seal state and token lease (the OpenBao health endpoint could not be queried because a local security hook blocks commands containing that path, and it was not circumvented; the 2026-11-17 evidence stands); control API version; Jenkins build history and nightly result; which commit the console and control API currently run (so whether the console redesign and the boards app are deployed); public port exposure from outside the machine; IPv6 reachability; contents of the cell containers.

## 2. Changes since the 2026-11-17 inventory

| Change | Source | Effect on the inventory |
|---|---|---|
| Delivery readiness now checks non-root user, no privileged mode, no added capabilities, no-new-privileges, environment network, private PID/IPC, no swap, no binds, devices or published ports | `5df8821`, PR #67 | **B7 closed in code.** Two cell containers observed live match the policy fields (runsc, read-only, capabilities dropped, limits). Not exercised through a platform deploy. I05 moves toward DONE-LOCAL. |
| Stale documentation reconciled after ledger entries 027-030 | `765282b`, PR #66 | Touches the execution doc, OpenBao custody, owner guide, V1 plan and spec headers and five script headers. Likely closes items 1, 5-8 and 10 of section 7 below; not re-read line by line. |
| Owner console redesign: new navigation (Aujourd'hui, Projets, Hermes, Plateforme: Serveur/Livraison/Données/Jobs, Suivi: Coûts/Journal, Réglages), design system, command palette, passkey step-up sheet with single retry, project tabs and environment switch | `bdcd3b6`, PR #68 | F40: Settings and a Journal page now exist and old routes redirect. Still no Skills, security findings, research/marketing, Personal or unified approvals page. F01: step-up flow is in the console; adding a passkey from the console is still CLI-only. Owner API unchanged. New test file `console-redesign.test.ts`. |
| Excalidraw boards app (`apps/boards`): accounts (Better Auth), boards, owner/editor/viewer sharing, optimistic-concurrency autosave, PGlite or external PostgreSQL | `c2f63ac`, PR #69 | **Outside the V1 spec and plan.** Local only; deployment needs database and volume support. Its document calls that gap "B3", which collides with B3 below: rename one. Decide whether boards belong in the plan, a separate product, or the personal VM. New test file `boards-service.test.ts`. |

Nothing else in `packages/`, `apps/control-api/` or `infra/` changed in code besides the hardening check and script header text.

## 3. Blocking findings (carried forward, status today)

| # | Finding | Status |
|---|---|---|
| B1 | `DockerInfrastructureProvider` never wired into the control API; no quota manager or firewall-evidence implementation. | **Open.** The two live cells exist but were created by hand or lab scripts, not by the platform. |
| B2 | No create-project command that provisions network, sandbox, database, identity, files and jobs; lifecycle verbs are metadata-only. | **Open.** Live state agrees: per-cell PostgreSQL, Redis and jobs units are disabled. |
| B3 | Delivered container receives only `PORT`: no data volume, database credentials or outbound access; only static and node HTTP kinds. | **Open.** Live cells are bare alpine. |
| B4 | Restore activation always `PROMOTION_UNAVAILABLE` on the shipped pgBackRest provider. | **Open.** |
| B5 | No rotation provider or cell-transition adapter; GitHub App key and webhook secret are root files, not in OpenBao. | **Open.** |
| B6 | No component runs application migrations; build template hardcodes `migration: none`. | **Open.** |
| B7 | Hardening check incomplete. | **Closed in code** (see section 2). |
| B8 | Per-cell CPU/RAM ceilings scripted but never called. | **Open.** The two cell containers show memory and pids limits, so some enforcement exists on the delivery path; CPU is not shown. |

## 4. Remaining gaps by theme

### A. Platform core (code, before any project can live)
B1, B2, B3, B4, B5, B6, B8; F03 export and purge are metadata only (F41, D10); per-cell Redis/Inngest never enabled (F04, F20, I07); no preview data or credentials (F10); cell egress control is DNS-only, with no named grants (I15); no application-volume quota manager (I06).

### B. Features with no code
F26 recurring security checks, F28 market and marketing skills, F29 Laya, F36 games and bots (only the pinned Luanti VM works), F38 import/migration/export, N03 game-port allocation, N05 AAAA gating, F23 skills catalog, F34 approvals inbox, F35 scheduled off-host audit copy, F27 telemetry tools for Hermes, F32 guest and container metrics, F31 vendor billing reconciliation.

### C. Built locally, never run on the server
Registry, Trivy and app-build agent installers (the work VM has no Docker or Trivy, the pro VM has no registry or scanner image); Hermes gateway and tools units; per-cell backup timers; jobs unit; GitHub App event intake for a real push (F45); delivery smoke on the server (F09, F46); hosted auth, files, SDK, outbox (F16-F21); Hermes first model call (`modelCalls: 0` as of yesterday's audit, not re-measured); notification channel arrival (no channel configured).

### D. Server and recovery qualification (DS items)
- **DS02/05:** boot from each mirror member, Rescue on the installed system, remote console, host reboot with the guard table, Proxmox TOTP, mobile peer handshake (still none), emergency key custody.
- **DS09/14:** off-host copy covers host configuration only (VM copies never ran); WAL RPO not measured; restic passphrase escrow; B2 lifecycle rule; single shared B2 key (accepted risk R-P06b); host rebuild and replacement-host drill.
- **DS10:** restore activation fails closed (B4).
- **DS11:** external alert channel, arrival test and heartbeat.
- **DS12:** 72 h soak, last, on a frozen configuration.
- **DS13/15 (updated later on 2026-11-18, ledger entries 031-032):** Jenkins evidence is now kept outside Jenkins (31 builds archived, daily timer, configuration fingerprint with the instance's `numExecutors=0`); the first nightly (2026-11-17, #15) is green with 2268 tests, the second (2026-11-18, #16) failed on a new `picomatch` advisory, fixed by PR #70 (waiver) and awaiting a release to `main`. The private registry (Zot, `10.20.1.10:5000`) is installed with generated credentials (anonymous 401, authenticated 200). **Still open:** Docker and Trivy on the work VM, the agent label `godseye-app-build`, the firewall openings (host forward, pro guest, work egress; prepared in the repository, not applied), digest-pinned base images (resolved: see entry 032), the Jenkins credential `godseye-github-app-read` that the `godseye-app-build` job uses to read a private repository (nothing provisions it), the control API's Docker access (owner decision: delivery binding **not** activated), and the first source-triggered run (the platform job polls `main`; no webhook-to-Jenkins path exists without a project).
- **F44 / T42 (console):** the delivery page now shows commit, build agents and queue next to the builds, and CI failures raise incidents; not seen with an owner session.
- **DS16:** autonomy with the PC off, including pro and host reboot with sealed OpenBao.
- **DS17/18:** first model call, runner acceptance, Laya, budget refusal; lifecycle, rotation, export, purge and audit copy (E09-E12).

### E. Hardware and operations (new or sharpened today)
- NVMe mirror wear: 58 % and 101 % used. Decide on a spare or replacement drive and a trigger threshold.
- 14 pending non-security PVE package updates and an unexplained kernel version string.
- Open owner decisions: AAAA publication, game port 30000 exposure, workload definition for DS01, whether boards enter the plan.

## 5. Dedicated-server acceptance, one line each

DS01 done (workload definition missing). DS02 partial. DS03 partial. DS04 partial. DS05 partial. DS06 partial. DS07 partial. DS08 partial. DS09 partial. DS10 not done. DS11 partial. DS12 not done. DS13 partial. DS14 partial. DS15 done, not evidenced. DS16 not done. DS17 partial. DS18 not done. Reasons are unchanged from the 2026-11-17 table except where section 1 adds measurements above.

Plan phases: P00 done; P01-P08 partial; P09 not done.

## 6. Test families

Unchanged: no repository test for T27, T28, T29, T32, T35, T36; server-only or manual proof for T02, T03, T31, T40, T42; lab-level for the rest. Two new unit files (boards service, console redesign) do not map to a T family.

## 7. Documents still contradicting the code or the ledger

Not touched by PR #66 and therefore still to fix: `docs/spec/isolation.md` line 3 ("no server provisioned"); `docs/spec/dedicated-server.md` section 5 (CI follows `develop`) and section 3 (20 % free rule versus the accepted exception, AX41 assumptions); ledger phase table wording and entry 010 crediting DS04/DS06/DS07 from a manual lab; `host-hardening.md` sections 6, 8, 9; "complete locally" for E07 and E08 overstating (no skills catalog, no F26-F28, process-level metrics only); ledger entry 026 builds panel never viewed with an owner session.
Likely fixed by PR #66, to confirm: V1 spec/plan API version, owner guide token and GitHub App wording, OpenBao custody status, "NOT executed" script headers.
New: the boards document should not reuse the label B3; the spec, plan and ledger do not mention boards.

## 7b. Critical path (updated)

1. The platform still cannot create a project (B1, B2); everything project-dependent waits on it.
2. A deployed application cannot use data, persistence or outbound calls (B3); static and stateless HTTP only.
3. Restore, rotation and migrations are unwired (B4-B6).
4. Owner and server steps before the freeze: registry password and delivery installers, alert channel and heartbeat, restic escrow, B2 lifecycle rule, Proxmox TOTP and Robot rescue key, mobile WireGuard test, reboot drill, off-host VM copy, AAAA / game-port / workload decisions, NVMe wear decision.
5. Paused backlog: E09-E12, skills catalog, approvals inbox, passkey-add flow, audit off-host copy, guest and container metrics, cell egress, boards deployment.
