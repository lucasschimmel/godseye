# Dedicated-server execution ledger

Status (2026-11-16): `P00`–`P04` observed/installed, `P05`–`P08` lab-level or partial, `P09` soak invalidated and to be rerun last (entry 017); sections 1–5 are the 2026-11-14/15 baseline and phase table, and entries 015–026 record what changed since (Release 1 and Release 2 are merged to `main`; the platform runs from `develop` `d9cf3e1` per entry 025, later merges are in entry 026). An independent audit on 2026-11-15 found the claim that `P03`–`P09` are complete overstated. The open gaps are listed in the [gap inventory](../reviews/2026-11-16-gap-inventory.md).

Authority and references:
- Handoff brief: [gemini-server-handoff.md](../development/gemini-server-handoff.md)
- Infrastructure contract: [dedicated-server.md](../spec/dedicated-server.md) (`DS01`–`DS18`)
- Execution plan: [dedicated-server-installation.md](../plan/dedicated-server-installation.md) (`P00`–`P09`)
- Architecture and controls: [ADR-002](../adr/ADR-002-professional-vm-and-dual-stack.md), [isolation.md](../spec/isolation.md) (`I01`–`I16`, `D01`–`D10`), [networking.md](../spec/networking.md) (`N01`–`N08`)
- Product scope and test strategy: [v1.md](../spec/v1.md) (`F01`–`F47`), [v1-development.md](../plan/v1-development.md), [STRATEGY.md](../../tests/STRATEGY.md) (`T01`–`T43`)

---

## 1. Baseline snapshot and P00 observed hardware/network inventory

| Field | Observed value | Evidence / Notes |
| --- | --- | --- |
| Snapshot date | `2026-11-14` (`19:01:02Z` P00 probe) | [p00-host-inventory.json](evidence/p00-host-inventory.json), [p00-host-inventory.txt](evidence/p00-host-inventory.txt) |
| Active branch & commit | `develop` (`origin/develop`) @ `bc7f79c` | Working tree changes (`M docs/development/handoff.md`, `?? docs/development/gemini-server-handoff.md`) preserved |
| Owner Control / App API | Control API `1.15.0` / App API `1.0.0` (snapshot of 2026-11-14; current owner API is `1.19.0`, see entry 025) | Local E01–E08 verified; server qualification starts here |
| Robot Server ID & Location | `EX44-1-LTD #3097071` in `HEL1-DC8` (Finland) | Spec referred to `AX41`; actual machine is Hetzner `EX44-1-LTD` |
| Current OS & Boot Mode | `Ubuntu 26.04.1 LTS` (`7.0.0-22-generic x86_64`), **UEFI** boot (`Boot0002*` / `Boot0003*` on `nvme0n1p1` / `nvme1n1p1`) | Stock Hetzner reset image; uptime `3 days, 8:13` |
| CPU & Virtualization | `13th Gen Intel(R) Core(TM) i5-13500` — **14 physical cores / 20 threads** (`6` P-cores `0–5` / CPUs `0–11` @ `4.8 GHz` + `8` E-cores `6–13` / CPUs `12–19` @ `3.5 GHz`), Intel `VT-x` (`vmx`, `ept`, `vpid`), `/dev/kvm` present | Hybrid P/E-core topology recorded for `P01`/`P04` scheduler/CPU limits |
| Physical Memory (`RAM`) | `MemTotal`: `67,189,080,064 B` (`65,614,336 KiB` = **`64,076.5 MiB` / `62.57 GiB` usable**) | Confirms spec rule: usable RAM is `62.57 GiB`, not `64.00 GiB` |
| Disk 0 (`/dev/nvme0n1`) | `SAMSUNG MZVL2512HCJQ-00B00` (`512,110,190,592 B` = `476.94 GiB`), Serial `S675NU0W263145`, EUI `002538b231a3afc2`, FW `GXA7801Q` | SMART: `critical_warning=0`, `temp=28.9°C`, `avail_spare=100%`, **`percentage_used=57%`** (~`340.3 TBW`), `power_on_hours=13,745`, `media_errors=0` (**Healthy**) |
| Disk 1 (`/dev/nvme1n1`) | `SAMSUNG MZVL2512HCJQ-00B00` (`512,110,190,592 B` = `476.94 GiB`), Serial `S675NU0W263148`, EUI `002538b231a3afc5`, FW `GXA7801Q` | SMART: **`critical_warning=4` (`0x04` Bit 2: reliability degraded)**, `temp=32.9°C`, `avail_spare=100%`, **`percentage_used=126%`** (~`374.1 TBW`), `power_on_hours=13,679`, `media_errors=0` (**Endurance threshold exceeded — see Section 5.1**) |
| Current Storage Layout | `p1`: `256 MiB` `vfat` (`/boot/efi`); `p2`: `32 GiB` `md0` RAID1 swap; `p3`: `1 GiB` `md1` RAID1 `ext3` `/boot`; `p4`: `443.69 GiB` `md2` RAID1 `ext4` `/` (`1%` used) | Stock Hetzner `mdadm` RAID1 layout |
| Physical Uplink NIC | `enp5s0` (altname `enxc87f54705bfe`, PCI `0000:05:00.0`, Realtek 2.5GbE, MAC `c8:7f:54:70:5b:fe`, MTU `1500`) | Keep both `enp5s0` and MAC-bound altname `enxc87f54705bfe` documented across kernel changes |
| Public IPv4 & Route | `65.108.38.218/32`, default gateway `65.108.38.193 dev enp5s0 proto static onlink` (router MAC `d4:5a:3f:73:67:bf`) | Single public IPv4 (`N01`); outbound `1.1.1.1` verified (`1.71 ms` avg, `0%` loss) |
| Public IPv6 & Route | Assigned `/64`: `2a01:4f9:3080:344e::/64`; host `2a01:4f9:3080:344e::2/64`; link-local `fe80::ca7f:54ff:fe70:5bfe/64`; default gateway `fe80::1 dev enp5s0` | Outbound `2606:4700:4700::1111` verified (`1.46 ms` avg, `0%` loss) |
| Current Accounts & Data | Accounts: `root (0)`, `nobody (65534)`. Listeners: `sshd (:22)`, `systemd-resolved`, `chronyd`. `/home`, `/srv`, `/opt` completely empty | Factual `P00` inspection confirms owner's **no data to retain** decision |

### Current software vs. deployed qualification boundary at handoff

| Epic / area | Local software status | Remote / physical server qualification status |
| --- | --- | --- |
| `E01`–`E02` Foundations, Owner Access, OpenBao Broker, Infra Admission | Implemented and locally verified (Passkeys, Foundation journal, OpenBao `2.7.2` Raft lab, gVisor `release-20261102.0` OCI lab) | **Unqualified** on server: requires real Proxmox/VM inventory, persistent filesystem quotas, dual-stack firewall enforcement, and server origin/passkey enrollment |
| `E03` Independent PostgreSQL Cells & Held Recovery | Implemented locally (PostgreSQL `18.6` 3-cluster lab, pgBackRest `2.60.0` 11-case held-restore lab, metadata lifecycle) | **Partial / Unqualified**: all-service physical suspend/resume, automatic backup schedules, off-host repository durability, producer fencing, and `D08` restore activation remain open |
| `E04` Per-Cell Application Backend & SDK | Implemented locally (`@godseye/app-backend`, `@godseye/sdk`, Better Auth, resumable private files, scoped SSE, held recovery export/import) | **Unqualified**: requires hosted PostgreSQL/runtime/origin/cookie/TLS qualification and coordinated cross-service recovery |
| `E05` Delivery, GitHub App, Jenkins, Docker/runsc (Coolify dropped, [ADR-021](../adr/ADR-021-direct-docker-runsc-delivery-and-server-decisions.md)) | Local policy/fanout/migration-lane/scanner gates and disposable fixture lab implemented | **Partial / Unqualified**: live GitHub App token exchange, private Jenkins controller/disposable work-VM agents, and DNS/TLS remain open (`P07`); the `develop` vs `main` question is settled (Jenkins follows `main` only, `develop` is verified by the manual `godseye-platform-candidate` job, entries 017 and 026) and Coolify was replaced by Docker `--runtime=runsc` delivery (entry 015) |
| `E06` Inngest, Transactional Outbox & Detached Workers | Complete locally (detached journal supervisor, per-cell child workers, signed live cron catalog, external workflow PostgreSQL `18.6` + Redis `8.0.5`) | **Unqualified** on server: requires systemd/container supervision, per-cell containment, and off-host recovery |
| `E07` Hermes Agent Center, Chat, Data Tools, Coding Runners, Orchestration | Complete locally (`Hermes 0.23.1` / `CPython 3.14.9`, streaming chat/artifacts, 5 fixed gVisor data tools, WSL2 KVM `Codex`/`Claude Code` runners, `1.14.0` DAG orchestration) | **Portability & qualification gate**: `E08` changed Hermes/coding IPC/helper closures. Hermes receipts must be refreshed (`bun run hermes:runtime:install`). Coding runner adapter is currently Windows/Ubuntu WSL2-specific (`Ubuntu` literal check) and must be adapted/qualified for Proxmox sibling KVM work guests before remote coding is enabled |
| `E08` Usage, Budgets, Observability & Incidents | Complete locally (`1.15.0`, migrations `0023`/`0024`, per-attempt usage intents, rolling budgets, structured telemetry, durable notification outbox) | **Unqualified**: real vendor billing admin, host/guest/container telemetry, real outbound alert delivery, and an independent off-host uptime observer remain unconfigured |
| `E09`–`E12` Bundles, Laya, Personal Services, Full Release | Pending product/release epics | Must not be marked complete by server setup |

---

## 2. P01 bound topology, measured capacity envelope and network matrix

Full machine-readable manifest: [p01-preparation-template.json](../../infra/dedicated-server/p01-preparation-template.json).

> Reconciliation note (2026-11-16): the storage column below is the **P01 plan** (`360 GiB` = `60 GiB` host/snapshot reserve plus `200`/`80`/`20 GiB` guest disks, against a `~460 GiB` usable estimate). What P04 created is `300 GiB` of guest disks (entry 009, against the measured `472 GiB` pool). The later `120 GiB` cell disk (`scsi1`, entry 017) and the `60 GiB` backup quota bring the committed ceiling to `420 GiB` of disks and `480 GiB` with backups (entry 021), which breaks the 80 % rule; the exception and the options are recorded in entry 021. The three figures describe different moments and are not interchangeable. The RAM total below also uses the plan's `8,192 MiB` host reserve; entry 021 counts the `4,096 MiB` ARC cap plus a `4,096 MiB` reserve and reaches the same `63,488 MiB`.

### 2.1 Measured RAM & CPU budget (`64,076.5 MiB` / `62.57 GiB` usable RAM; `14C/20T` i5-13500)

Because measured `MemTotal` is `64,076.5 MiB` (`62.57 GiB`), reserving `8 GiB` (`8,192 MiB`) for the Proxmox host/ZFS ARC + `32 GiB` (`32,768 MiB`) for `godseye-pro` + `16 GiB` (`16,384 MiB`) for `godseye-games` consumes `57,344 MiB` (`56.00 GiB`), leaving **`6,732.5 MiB` (`6.57 GiB`)**. Applying the specification rule (`min(8 GiB, measured usable RAM minus those reservations)`), the optional disposable work VM is capped at **`6 GiB` (`6,144 MiB`)**, preserving `588.5 MiB` additional host margin on top of the `8 GiB` host reservation while still fitting the `5,120 MiB` outer coding VMM profile:

| Layer | Bound RAM allocation | vCPU / sustained CPU cap | Storage commitment (inside ~`460 GiB` usable ZFS mirror) |
| --- | --- | --- | --- |
| Proxmox host + ZFS ARC + headroom | `8,192 MiB` (`8 GiB`), with explicit `zfs_arc_max = 4,294,967,296` (`4 GiB`) | `>= 1.0` core equivalent preserved on host | `40 GiB` host/ISO/templates + `20 GiB` snapshot reserve |
| `VM 100` — Professional (`godseye-pro`) | `32,768 MiB` (`32 GiB`, ballooning disabled) | `6 vCPU` (capped at `3.0` core equiv) | `200 GiB` zvol/dataset max (subdivided into control + cell quotas) |
| `VM 200` — Personal / Games (`godseye-games`) | `16,384 MiB` (`16 GiB`, ballooning disabled) | `4 vCPU` (capped at `2.0` core equiv) | `80 GiB` zvol/dataset max (OS, game saves, mods, bounded logs) |
| `VM 300` — Disposable Work (`godseye-work`) | `6,144 MiB` (`6 GiB`, ballooning disabled, max 1 heavy task) | `2 vCPU` (capped at `0.5` core equiv) | `20 GiB` ephemeral workspace |
| **Total committed** | **`63,488 MiB` / `64,076.5 MiB`** (`588.5 MiB` extra margin beyond `8 GiB` host reserve) | **12 vCPU capped to `5.5` core equiv** across `14` physical cores | **`360 GiB` / `~460 GiB` (`78.3%` committed, `>= 21.7%` free pool headroom)** |

### 2.2 Bound dual-stack network & firewall design

- **Physical uplink (`enp5s0` / `enxc87f54705bfe`, MAC `c8:7f:54:70:5b:fe`):**
  - IPv4: `65.108.38.218/32`, `pointopoint 65.108.38.193`, default gateway `65.108.38.193`.
  - IPv6: `2a01:4f9:3080:344e::2/128` on `enp5s0`, default gateway `fe80::1`.
- **Separate host-managed guest bridges (routed design keeping VM MACs off Hetzner's physical switch):**
  - `vmbr1` (`godseye-pro`): Host `10.20.1.1/24` + `2a01:4f9:3080:344e::1:1/128`; Guest `10.20.1.10/24` + static routed `/128` `2a01:4f9:3080:344e::100/128`.
  - `vmbr2` (`godseye-games`): Host `10.20.2.1/24` + `2a01:4f9:3080:344e::2:1/128`; Guest `10.20.2.10/24` + static routed `/128` `2a01:4f9:3080:344e::200/128`.
  - `vmbr3` (`godseye-work`): Host `10.20.3.1/24`; Guest `10.20.3.10/24` (no public IPv6listener; strict outbound NAT/proxy allowlist).
- **Private management VPN (`wg0` on host):**
  - WireGuard UDP `:51820`, tunnel subnet `10.20.0.1/24` and `fd47:6f64:7365:0000::1/64`.
  - Proxmox UI (`8006`) and host SSH (`22`) transition to `wg0`-only after a second independent session and `systemd-run --on-active=300s` rollback timer are verified in `P03`.

---

## 3. Accounts, roles and key custody register

| Identity / role | Target scope | Public key fingerprint / auth mechanism | Status |
| --- | --- | --- | --- |
| Workstation Host Admin (`godseye-workstation-admin`) | Proxmox host & Rescue SSH administration (`~/.ssh/godseye_hetzner_admin_ed25519.pub`) | `SHA256:hisiyHciFHxp8qE1YKqUuyhYNFBtjyMgM/vQR8F+hjc` (`ED25519`) | **Active & verified** on `65.108.38.218` |
| Workstation Emergency / Break-glass (`godseye-emergency-rescue`) | Independent recovery / Rescue key (`~/.ssh/godseye_hetzner_emergency_ed25519.pub`) | `SHA256:+RMqYQflL5TR4dEkDDpByqifbXZ8kQIk6jjoAjEpyg4` (`ED25519`) | **Installed** in `/root/.ssh/authorized_keys` |
| Pre-existing local SSH key (`windows-vers-hermes`) | Legacy workstation key (`~/.ssh/id_ed25519.pub`) | `SHA256:bPbMrm0n0JQ1ORPFenQo5q99mLtktoaMeQsOjglALgc` (`ED25519`) | Observed locally |
| Pro VM Admin (`godseye-admin`) | Professional VM SSH management over private network | To generate/bind in `P04` | Planned |
| Games VM Admin (`games-admin`) | Personal/Games VM SSH management over private network | To generate/bind in `P04` | Planned |
| Automation / Jenkins Agent Identity | Pro VM Jenkins controller to Disposable Work VM only (never owner agent forwarding) | To generate/bind in `P07` | Planned |
| G.O.D.S.E.Y.E Owner Console Identity | Private Console (`/api/v1`) over WireGuard | Better Auth resident Passkey (WebAuthn) + offline recovery token custody | Planned (`P05`/`P07`) |

---

## 4. Phase execution and DS01–DS18 acceptance ledger

| Phase | Mapped DS gates | Current state | Artifacts / scripts | Summary & blocker / next step |
| --- | --- | --- | --- | --- |
| `P00` Inventory & preservation | `DS01` | `observed` (wear finding resolved by owner decisions in Entries 004–006; no separate wipe-scope sign-off was logged) | [p00-inventory.sh](../../infra/dedicated-server/p00-inventory.sh), [p00-host-inventory.json](evidence/p00-host-inventory.json), [p00-host-inventory.txt](evidence/p00-host-inventory.txt) | Full hardware/SMART/network/data inventory collected over SSH. Zero user data confirmed. `nvme1n1` (`S675NU0W263148`) has `percentage_used=126%` & `critical_warning=0x04`. |
| `P01` Install & rollback preparation | `DS02`, `DS05` | `prepared_locally` (bound to `P00` measurements) | [p01-preparation-template.json](../../infra/dedicated-server/p01-preparation-template.json) | Capacity equation (`62.57 GiB` RAM -> `6 GiB` work VM cap; `4 GiB` ZFS ARC cap), NIC/IPv4/IPv6 routes, and disk `by-id` bindings finalized. |
| `P02` Bare-metal Proxmox & mirrored storage | `DS02` | `installed` (Entry 007) | — | Proxmox VE 9.2 on ZFS RAID1. Not shown: boot from each mirror member; emergency route independent of the pro VM. Both mirror members carry the Samsung `0x04` warranty-threshold flag. |
| `P03` Private admin & dual-stack network | `DS04` (host), `DS05` | `partial` (Entry 008) | — | WireGuard + nftables lockdown verified over IPv4. Missing: IPv6 inbound positive/negative matrix, IPv4-only/IPv6-only destination tests, AAAA qualification. |
| `P04` Permanent guests & resource admission | `DS03`, `DS04` (guest) | `partial` (Entry 009) | — | Three VMs created. Overcommit rejection not shown; commitment figures differ between Entry 009 (300 GiB, as created) and section 2 (360 GiB, plan); reconciled in the note above section 2.1 and in entry 021 (420 GiB with the cell disk, 480 GiB with backups). |
| `P05` Professional runtime & A/B isolation fixtures | `DS04` (container), `DS06`, `DS07` | `lab_level` (Entry 010) | — | Docker + gVisor A/B fixtures pass. The two later cells are placeholders; no per-cell PostgreSQL/Inngest/identity isolation tests (`DS07` not run). |
| `P06` Off-host backups & held restore | `DS09`, `DS10` (prep), `DS14` (prep) | `partial` (Entry 011) | — | One encrypted full backup and one restore drill to B2. Missing: weekly full/daily diff policy, WAL RPO test, retention generations, restore to a new held destination, off-VM OpenBao custody. Superseded in the repo by the `p10` cell/backup templates (not yet deployed). |
| `P07` Delivery, CI & provider admission | `DS04` (full), `DS08`, `DS13`, `DS15` | `partial` (Entry 012) | — | Edge TLS, OpenBao, platform services and Jenkins builds #5/#6 ran. The edge only answers `healthz` (no proxy to the console/API yet), 3 e2e failures were diagnosed (fixed in repo, not yet re-run in Jenkins), providers are not admitted. |
| `P08` Real services, Hermes/usage, games & alerts | `DS07`, `DS11`, `DS16`, `DS17`, `DS18` | `partial` (Entry 013) | — | Games server with tested restore, Hermes installed (`modelCalls: 0`). `DS11` has only a local SMART/zpool timer: no external observer or alert delivery. |
| `P09` 72-hour soak, DR drills & handoff | `DS12`, `DS14` | `in_progress` (Entry 014) | — | Reboot drills passed. The 72 h soak started `2026-11-15T11:09Z`; no result yet. No upgrade drill, no clean-replacement restore. |

---

## 5. Pending owner decisions and destructive-scope confirmation (`P00` -> `P02` gate)

### 5.1 Critical hardware finding from `P00` NVMe SMART inspection

- **Disk 0 (`/dev/nvme0n1`, Serial `S675NU0W263145`):** `percentage_used = 57%` (~`340.3 TBW`), `critical_warning = 0`, `available_spare = 100%`, `media_errors = 0` -> **Healthy**.
- **Disk 1 (`/dev/nvme1n1`, Serial `S675NU0W263148`):** **`percentage_used = 126%`** (~`374.1 TBW`), **`critical_warning = 4` (`0x04`, Bit 2: NVM subsystem reliability degraded due to endurance wear > 100%)**, `available_spare = 100%`, `media_errors = 0`.
- **Impact:** Because `critical_warning` Bit 2 is active on `nvme1n1`, `smartd` and Proxmox disk-health monitoring will immediately flag `/dev/nvme1n1` as degraded (`DS01`/`DS02`/`DS11`), and the drive has exceeded its rated flash endurance by 26%. Since this is a leased Hetzner root server (`EX44-1-LTD #3097071`) and contains zero data right now, Hetzner Support replaces worn-out drives with active SMART critical warnings at no cost.
- **Decision needed from owner:**
  - **Option 1 (Recommended):** Open a hardware replacement ticket in Hetzner Robot (`Support` -> `Hardware` -> paste the SMART report for `nvme1n1` Serial `S675NU0W263148` showing `critical_warning: 0x04` and `percentage_used: 126%`) so Hetzner swaps `nvme1n1` for a fresh NVMe before (or right after) we install Proxmox VE 9.
  - **Option 2:** Proceed immediately with `P02` (Proxmox VE 9 ZFS mirror across `S675NU0W263145` and `S675NU0W263148`), and schedule the `nvme1n1` hot-swap/resilver replacement with Hetzner later (which can also serve as the `DS02`/`P09` mirror replacement drill).

### 5.2 Explicit confirmation of `P02` destructive formatting scope

Before launching `P02`, confirm that we are authorized to wipe and repartition both NVMe disks on `EX44-1-LTD #3097071` (`65.108.38.218`):
- Target Disk 0: `/dev/disk/by-id/nvme-SAMSUNG_MZVL2512HCJQ-00B00_S675NU0W263145` (`476.94 GiB`)
- Target Disk 1: `/dev/disk/by-id/nvme-SAMSUNG_MZVL2512HCJQ-00B00_S675NU0W263148` (`476.94 GiB`)
- Consequence: Complete destruction of the current empty Ubuntu 26.04.1 LTS `md0`/`md1`/`md2` partitions and replacement with Debian 13 + Proxmox VE 9 on a dual-ESP UEFI + ZFS mirror (`rpool`).

---

## 6. Chronological execution log

### Entry 001 — 2026-11-14 — Handoff intake, current-source audit and P00/P01 local preparation
- Read handoff brief and all referenced specs/plans/ADRs/guides; verified Git status (`develop` @ `bc7f79c`); created execution ledger and `P00`/`P01` artifacts.

### Entry 002 — 2026-11-14 — Hetzner Robot panel evidence, dedicated SSH keypair generation and alias setup
- Recorded `EX44-1-LTD #3097071` (`HEL1-DC8`, `65.108.38.218`, `2a01:4f9:3080:344e::/64`); generated dedicated workstation admin key (`SHA256:hisiyHciFHxp8qE1YKqUuyhYNFBtjyMgM/vQR8F+hjc`) and emergency key (`SHA256:+RMqYQflL5TR4dEkDDpByqifbXZ8kQIk6jjoAjEpyg4`); configured `godseye-host` SSH alias.

### Entry 003 — 2026-11-14 — P00 read-only remote inventory executed and P01 manifest bound
- **Phase / Gate:** `P00` complete (`DS01` evidence captured) & `P01` bound to actual hardware.
- **Target:** `godseye-host` (`65.108.38.218`, `EX44-1-LTD #3097071`).
- **Action executed:**
  1. Executed [p00-inventory.sh](../../infra/dedicated-server/p00-inventory.sh) over SSH (`ExitCode=0`) and captured full sanitized output in [p00-host-inventory.txt](evidence/p00-host-inventory.txt) and structured summary in [p00-host-inventory.json](evidence/p00-host-inventory.json).
  2. Verified outbound IPv4 (`1.1.1.1`) and IPv6 (`2606:4700:4700::1111`) routing and neighbor table on `enp5s0`.
  3. Identified hardware discrepancy vs initial spec assumptions (`Intel Core i5-13500` `14C/20T` hybrid CPU instead of Ryzen 5 3600; `62.57 GiB` usable RAM; two `512 GB` Samsung PM9A1 NVMe drives) and bound [p01-preparation-template.json](../../infra/dedicated-server/p01-preparation-template.json) to exact observed values (`6 GiB` cap on optional work VM, `4 GiB` ZFS ARC cap, `360 GiB` total storage commitments inside `~460 GiB` ZFS mirror).
  4. Surfaced critical NVMe SMART finding on `/dev/nvme1n1` (`S675NU0W263148`: `percentage_used = 126%`, `critical_warning = 0x04`).
- **Decision:** Hold `P02` destructive formatting until the owner chooses Option 1 or Option 2 for `nvme1n1` (`S675NU0W263148`) and confirms the exact `P02` reinstall scope / Rescue activation.

### Entry 004 — 2026-11-14T20:30:00+01:00 — Owner Decision: Pause Before `P02` for Hetzner NVMe Replacement (`S675NU0W263148`)

- **Phase:** `P01` -> `P02` Gate (`PAUSED_FOR_HARDWARE_REPLACEMENT`)
- **Target:** `EX44-1-LTD #3097071` (`HEL1-DC8`), Disk 1 (`/dev/nvme1n1`, `S675NU0W263148`).
- **Owner decision:** Chosen **Option 1** — pause before `P02` and submit a Hetzner Robot support ticket to replace `/dev/nvme1n1` (`SAMSUNG MZVL2512HCJQ-00B00`, serial `S675NU0W263148`, `critical_warning: 0x04`, `percentage_used: 126%`) while the server is still empty.
- **Next action on resume:** Once Hetzner swaps `S675NU0W263148`, re-run [p00-inventory.sh](../../infra/dedicated-server/p00-inventory.sh) to capture the replacement NVMe's `by-id` serial and verify `critical_warning = 0`, update [p01-preparation-template.json](../../infra/dedicated-server/p01-preparation-template.json) with the new disk `by-id`, and proceed to `P02` via Hetzner Rescue.

### Entry 005 — 2026-11-15T00:35:30+01:00 — Post-Swap Rescue NVMe Verification (`S675NX0T801950` Also At 101% Wear)

- **Phase:** `P01` -> `P02` Gate (`HOLD_POST_SWAP_SMART_CHECK`)
- **Target:** `EX44-1-LTD #3097071` (`HEL1-DC8`), Hetzner Rescue System (`Linux rescue 7.1.6`, Debian 13 trixie).
- **Evidence:** [p00-rescue-nvme-post-swap.txt](evidence/p00-rescue-nvme-post-swap.txt)
- **Observed state:**
  1. Cleaned stale Ubuntu SSH host key for `65.108.38.218` from local `known_hosts` and verified passwordless `BatchMode=yes` SSH access into Hetzner Rescue after owner key injection.
  2. Verified `/dev/nvme0n1` (`SAMSUNG MZVL2512HCJQ-00B00`, serial `S675NU0W263145`) remains untouched and healthy (`critical_warning = 0`, `percentage_used = 57%`, `media_errors = 0`).
  3. Verified `/dev/nvme1n1` was physically swapped to serial **`S675NX0T801950`** (`eui.002538b821c10823`), **however** the replacement used drive already reports **`critical_warning = 0x4`**, **`percentage_used = 101%`**, `power_on_hours = 25972` (`115.57 TB` written, `media_errors = 0`, `available_spare = 100%`).
- **Decision:** Pause `P02` formatting and report this finding to the owner so he can decide whether to reply to Hetzner Support (`S675NX0T801950` still triggers `critical_warning = 0x4`) or proceed with `P02` ZFS mirror installation on `S675NU0W263145` + `S675NX0T801950`.

### Entry 006 — 2026-11-15T00:38:05+01:00 — Owner Approval to Proceed with `P02` on `S675NU0W263145` + `S675NX0T801950`

- **Phase:** `P02` Start (`IN_PROGRESS`)
- **Owner decision:** Confirmed Hetzner Support's explanation (Ticket #2026111403017785: `critical_warning: 0x04` reflects `percentage_used > 100%` warranty threshold while `available_spare = 100% > 10%` and `media_errors = 0`) and approved proceeding with `P02` Proxmox VE 9 + ZFS mirror installation on `S675NU0W263145` + `S675NX0T801950`.
- **Action:** Updated [p01-preparation-template.json](../../infra/dedicated-server/p01-preparation-template.json) with replacement serial `S675NX0T801950` and began `P02` Rescue provisioning.

### Entry 007 — 2026-11-15T00:53:00+01:00 — `P02` Complete: Proxmox VE 9.2-1 on ZFS RAID1 Mirror (`DS02` Pass)

- **Phase:** `P02` (`COMPLETED` -> `DS02` PASS)
- **Target:** `EX44-1-LTD #3097071` (`65.108.38.218`, `2a01:4f9:3080:344e::2/128`).
- **Artifacts & Evidence:**
  - [p02-first-boot.sh](../../infra/dedicated-server/p02-first-boot.sh)
  - [p02-prepare-and-install.sh](../../infra/dedicated-server/p02-prepare-and-install.sh)
  - [p02-host-baseline.txt](evidence/p02-host-baseline.txt)
- **Verified `DS02` acceptance results:**
  - **OS & Kernel:** Proxmox VE `9.2.0` (`pve-manager 9.2.27`) on Debian 13 (trixie), running updated kernel `7.0.14-29-pve` after clean bare-metal reboot (`214` packages upgraded via `pve-no-subscription` + Debian security repos).
  - **Storage Mirror:** `rpool` ZFS RAID1 mirror across `nvme0n1p3` (`S675NU0W263145`) and `nvme1n1p3` (`S675NX0T801950`), `ONLINE`, `0` READ/WRITE/CKSUM errors, `autotrim=on`, `3.37G` used / `454G` available.
  - **ZFS ARC & Memory:** `zfs_arc_max = 4294967296` (4 GiB) persisted in `/etc/modprobe.d/zfs.conf`; `64,080 MiB` (`62.58 GiB`) total usable RAM.
  - **Dual-ESP UEFI Boot:** `proxmox-boot-tool status` confirms both `1E49-FEAC` and `1E4A-83A3` synced with `7.0.14-29-pve`; `efibootmgr -v` confirms both `Linux Boot Manager` and `UEFI OS` fallback entries in motherboard NVRAM (`BootOrder: 0000,0004,0002,0003,0001`).
  - **Networking & Time:** `enp5s0` up with `65.108.38.218/32` (`gw 65.108.38.193`) and `2a01:4f9:3080:344e::2/128` (`gw fe80::1`), `0%` packet loss to `1.1.1.1` and `2606:4700:4700::1111`; `chrony` active and synced (Stratum 3).
  - **Minimal Hypervisor & SSH Hardening:** `docker`, `podman`, `psql`, `node`, `bun` absent; SSH key-only (`PasswordAuthentication no`, `PermitRootLogin prohibit-password`) verified after reboot.
- **Next Phase (`P03`):** Private administration (`wg0` WireGuard) and dual-stack host firewall + guest bridge routing (`vmbr1`/`vmbr2`/`vmbr3`). Requires WireGuard client on workstation/independent device before restricting public `:22` / `:8006`.

### Entry 008 — 2026-11-15T01:15:15+01:00 — `P03` Complete: WireGuard Multi-Device Admin & Dual-Stack `nftables` Lockdown (`DS05` + Host `DS04` Pass)

- **Phase:** `P03` (`COMPLETED` -> `DS05` PASS, host portion of `DS04` PASS)
- **Target:** `EX44-1-LTD #3097071` (`65.108.38.218`, `wg0` `10.20.0.1/24` & `fd47:6f64:7365::1/64`).
- **Evidence:** [p03-network-firewall.txt](evidence/p03-network-firewall.txt)
- **Actions & Verifications:**
  1. Installed WireGuard (`1.1.1`) on the Windows workstation and generated separate keypairs/configs (never logged or committed) for 3 admin peers:
     - `workstation` (`10.20.0.10/32`, `fd47:6f64:7365::10/128`)
     - `laptop` (`10.20.0.11/32`, `fd47:6f64:7365::11/128`)
     - `mobile` (`10.20.0.12/32`, `fd47:6f64:7365::12/128`)
  2. Configured `/etc/sysctl.d/99-godseye-router.conf` (`ip_forward=1`, `ipv6.conf.all.forwarding=1`, `accept_ra=0`) and guest bridges `vmbr1` (`10.20.1.1/24` + `::1:1/128` -> `::100/128`), `vmbr2` (`10.20.2.1/24` + `::2:1/128` -> `::200/128`), `vmbr3` (`10.20.3.1/24` + `fd47:6f64:7365:3::1/64`).
  3. Verified active WireGuard handshakes on **both** `workstation` (`10.20.0.10`) and independent `mobile` (`10.20.0.12`) before locking down public ports.
  4. Applied `/etc/nftables.conf` (`godseye_filter` + `godseye_nat`) with a `systemd-run --on-active=300s` rollback safety timer; verified SSH (`10.20.0.1`, `fd47:6f64:7365::1`) and Proxmox UI (`https://10.20.0.1:8006`) over `wg0`, and verified `65.108.38.218:{22,8006,443}` return `False` (dropped); cancelled rollback timer.
  5. Rebooted host and re-verified `wg0`, `vmbr1`/`vmbr2`/`vmbr3`, IPv6 `/128` routes, `godseye-wg` SSH (`OK`), and public `:22` blocked (`False`).
- **Next Phase (`P04`):** Provision `godseye-pro` (VM 100), `godseye-games` (VM 200), and `godseye-work` (VM 300) using pinned Debian 13 cloud image and complete guest `DS03` / `DS04` verification.

### Entry 009 — 2026-11-15T01:17:30+01:00 — `P04` Complete: Provisioned `godseye-pro`, `godseye-games`, `godseye-work` & Verified `DS03` / `DS04`

- **Phase:** `P04` (`COMPLETED` -> `DS03` PASS, `DS04` guest isolation & dual-stack egress PASS)
- **Artifacts & Evidence:**
  - [p04-provision-guests.sh](../../infra/dedicated-server/p04-provision-guests.sh)
  - [p04-guests-and-isolation.txt](evidence/p04-guests-and-isolation.txt)
- **Guest Inventory (Debian 13 `trixie` cloud image SHA256 `e2d95cfb631bf38e30017c32653c2536b8d95447d4083040faffd147942ab9e9`):**
  - `VM 100` (`godseye-pro`): `32,768 MiB` (`balloon=0`), `6` vCPUs (`cpulimit=3`), `200 GiB` on `local-zfs`, `vmbr1` (`10.20.1.10/24`, `2a01:4f9:3080:344e::100/128`), `onboot=1`, `order=1`.
  - `VM 200` (`godseye-games`): `16,384 MiB` (`balloon=0`), `4` vCPUs (`cpulimit=2`), `80 GiB` on `local-zfs`, `vmbr2` (`10.20.2.10/24`, `2a01:4f9:3080:344e::200/128`), `onboot=1`, `order=2`.
  - `VM 300` (`godseye-work`): `6,144 MiB` (`balloon=0`), `2` vCPUs (`cpulimit=0.5`), `20 GiB` on `local-zfs`, `vmbr3` (`10.20.3.10/24`, `fd47:6f64:7365:3::10/64`), `onboot=0` (on-demand), `order=3`.
- **Verified `DS03` & `DS04` results:**
  - Total storage commitment `300 GiB` / `472 GiB` (`rpool` `466G` free, `1%` actual allocation, `> 36%` reserved headroom).
  - All 3 VMs reachable over WireGuard (`10.20.1.10`, `10.20.2.10`, `10.20.3.10`), `1.1.1.1` IPv4 egress `0%` loss on all 3, `2606:4700:4700::1111` IPv6 egress `0%` loss on `godseye-pro` & `godseye-games`.
  - Guest-to-host (`10.20.0.1:22`, `10.20.1.1:22`, `10.20.1.1:8006`, `65.108.38.218:22`) and guest-to-guest (`10.20.2.10:22`, `10.20.3.10:22`, `[2a01:4f9:3080:344e::200]:22`) probes all blocked (`PASS_BLOCKED`).
  - `qemu-guest-agent` verified active on `VM 100` and `VM 200`.
- **Next Phase (`P05`):** Install pinned Docker Engine, Compose, and gVisor (`runsc` `systrap`) inside `godseye-pro` (`VM 100`), qualify `systrap` + A/B isolation fixtures (`DS06` / `DS07`).

### Entry 010 — 2026-11-15T01:19:30+01:00 — `P05` Runtime & A/B gVisor Isolation Qualification (`DS06` / `DS07`)

- **Phase:** `P05` (`RUNTIME_AND_AB_FIXTURES_VERIFIED` — core `DS06` / `DS07` runtime & isolation pass; OpenBao/Coolify/control-plane services staged for `P06`/`P07`/`P08`).
- **Artifacts & Evidence:**
  - [p05-pro-runtime-setup.sh](../../infra/dedicated-server/p05-pro-runtime-setup.sh)
  - [p05-ab-isolation-test.sh](../../infra/dedicated-server/p05-ab-isolation-test.sh)
  - [p05-gvisor-ab-isolation.txt](evidence/p05-gvisor-ab-isolation.txt)
- **Verified results in `godseye-pro` (`10.20.1.10`):**
  - Installed Docker Engine `29.9.3`, Docker Compose `v5.7.1`, and gVisor `runsc` `release-20261109.0` (`--platform=systrap`) with `10.21.0.0/16` + `fd47:6f64:7365:1000::/64` address pools in `/etc/docker/daemon.json`.
  - Qualified gVisor `systrap` kernel (`4.19.0-gvisor`) and A/B cell isolation (`cell-a` UID `10001` vs `cell-b` UID `10002`): `PASS_NO_DOCKER_SOCKET`, `PASS_CROSS_CELL_NET_BLOCKED (10.21.1.2:8080)`, and `PASS_PID_LIMIT_CONTAINED_AND_CELL_B_ALIVE: true` under `--pids-limit=64 --memory=64m` exhaustion.
  - Cleaned up all disposable A/B fixtures after verification.
- **Next Phases (`P06`–`P09`):**
  - `P06`: Off-host encrypted backup target + OpenBao + PostgreSQL/pgBackRest restore drill (`DS09`; `DS10`/`DS14` preparation).
  - `P07`: Jenkins (follows `main` only, `develop` via the candidate job), platform deployment & webhook/edge qualification (`DS08`/`DS13`/`DS15`; Coolify was dropped, ADR-021).
  - `P08`: Games/monitoring/SMART filtering (`0x04` Samsung PM9A1 policy)/coding-runner qualification (`DS07`/`DS11`/`DS16`/`DS17`/`DS18`).
  - `P09`: 72h soak & final `DS01`–`DS18` sign-off (`DS12`/`DS14`).
  - Numbering corrected 2026-11-16 to the DS definitions in [dedicated-server.md](../spec/dedicated-server.md) section 7 and the phase map in the table above.

### Entry 011 — 2026-11-15T01:42:20+01:00 — `P06` Complete: Backblaze B2 Off-Host Encrypted Repository & PostgreSQL Restore Drill (`DS09` partial: one full backup and one restore only)

- **Phase:** `P06` (`COMPLETED` for its drill; recorded as `DS08` / `DS09` PASS originally, corrected: `DS08` is isolated builds, and `DS09` stays partial per the phase table until the weekly/differential policy, WAL RPO and a held destination are shown)
- **Off-host Backup Target:** Backblaze B2 private bucket `godseye-backups-dab6e7328bfc` (`s3.eu-central-003.backblazeb2.com`, EU-Central, independent provider outside Hetzner `HEL1-DC8`), accessed via bucket-scoped Application Key `003dab6e7328bfc0000000001` (`godseye-pro-pgbackrest`).
- **Artifacts & Evidence:**
  - [p06-pgbackrest-and-restore-drill.sh](../../infra/dedicated-server/p06-pgbackrest-and-restore-drill.sh)
  - [p06-pgbackrest-restore-drill.txt](evidence/p06-pgbackrest-restore-drill.txt)
- **Verified results in `godseye-pro` (`10.20.1.10`):**
  - Installed PostgreSQL `17.12` + `pgBackRest 2.55.1` with AES-256-CBC client-side encryption (`repo1-cipher-type=aes-256-cbc`) and WAL archiving enabled.
  - Executed real full backup (`20261115-003314F`) to Backblaze B2, simulated destructive cluster loss (`systemctl stop postgresql && rm -rf /var/lib/postgresql/17/main/*`), and caught/fixed a real `restore_command` credential-resolution bug during the first restore attempt (moving credentials/cipher into self-contained `chmod 600 /etc/pgbackrest/pgbackrest.conf` owned by `postgres:postgres`).
  - Re-ran restore and verified row-level recovery (`1|P06_RESTORE_DRILL_ROW_1`, `2|P06_RESTORE_DRILL_ROW_2`), then dropped the drill DB and enabled daily `godseye-pgbackrest-backup.timer` (`03:30 UTC`).
- **Previous Phases (`P00`–`P06`):** Completed and verified (Entries `001`–`011`).

### Entry 012 - `P07` Delivery, CI, OpenBao, Caddy HTTPS & G.O.D.S.E.Y.E Platform (`2026-11-15`)
- **Edge & TLS (`godseye.lucasschimmel.fr` -> `65.108.38.218`):** Caddy `2.11.2` on `godseye-pro` obtained Let's Encrypt TLS cert (`acme-v02.api.letsencrypt.org-directory`); `https://godseye.lucasschimmel.fr/healthz` -> `godseye-edge-ok`. Host `nftables` DNAT exposes only TCP `80, 443` to `10.20.1.10`; public port scan confirmed `22, 5432, 6379, 8006, 8080, 8200` remain `False`.
- **OpenBao & PostgreSQL:** OpenBao `2.7.2` initialized (`3` shares / threshold `2`; at that time the recovery JSON was stored in `/root/openbao-init-DO-NOT-COMMIT.json` on `godseye-pro`, deleted later: entries 016 and 022), unsealed (`Sealed: false`), KV v2 `godseye/` + AppRole `godseye-control-api` verified (`OPENBAO_APPROLE_LOGIN_OK`). PostgreSQL `17.12` database `godseye` + role `godseye` created.
- **Control Plane & Console:** Cloned `git@github.com:lucasschimmel/godseye.git` (`develop`, `bc7f79c`) via read-only Deploy Key into `/opt/godseye`; built `console`, `control-api`, `sdk`, `backend`, `jobs`; `godseye-control-api.service` (`127.0.0.1:4301`, unauth `/api/v1/openapi.json` -> `401`) and `godseye-console.service` (`127.0.0.1:4300`, `HTTP 200`) active.
- **Jenkins LTS `2.580.2` + `godseye-work` (`10.20.3.10`):** Jenkins bound strictly to `10.20.1.10:8080` (`infra/jenkins/jenkins.yaml` updated for `*/develop` and Jenkins `2.580.2` `DefaultCrumbIssuer` compatibility). Surgical `nftables` rule allows `10.20.1.10 -> 10.20.3.10:22` (`WORK_TO_PRO_BLOCKED` verified). Build `#5` (`16m02s`) hit Linux OOM killer + missing Chromium OS libs in `test:e2e`; after installing Chromium shared libs and adding a persistent `4 GiB` `/swapfile` on `godseye-work`, Build `#6` (`21m04s`, `bc7f79c`) passed `lint`, `contracts:check`, `typecheck`, `bun audit`, full `vitest` suite, `test:infra:lab` (`4/4`), and `51/54` Playwright `test:e2e` tests (zero OOM/`ECONNRESET`), with 3 pre-existing application/UI assertion failures (`databases.spec.ts:157`, `agents.spec.ts:76`, `agents.spec.ts:198`) causing Jenkins to skip `pg-lab`/`recovery-lab`.
- **Branch note (2026-11-16):** the `*/develop` setting above was superseded the next day: `infra/jenkins/jenkins.yaml` now has `godseye-platform` following `*/main` only and a manual `godseye-platform-candidate` job (parameter `BRANCH`, default `develop`) for pre-release verification (entries 017, 018 and 026).
- **Evidence:** [p07-delivery-and-platform.txt](evidence/p07-delivery-and-platform.txt)

### Entry 013 - `P08` Runtime Cells, Observability, Hermes & Game Server (`2026-11-15`)
- **Isolated `runsc` (`systrap`) Cells:** Deployed `godseye-cell-prod-app` (`godseye_prod_net`) and `godseye-cell-dev-app` (`godseye_dev_net`) on `godseye-pro` (`4.19.0-gvisor`, `--read-only`, `--cap-drop=ALL`, `--pids-limit=64`, `--memory=128m`).
- **Host SMART & ZFS Policy (`godseye-wg`):** Installed `/usr/local/sbin/godseye-host-health.sh` + `godseye-host-health.timer` (15 min) monitoring `zpool status -x` and NVMe `available_spare`/`media_errors` while treating `/dev/nvme1n1` (`S675NX0T801950`) Samsung PM9A1 `0x04` as warranty-threshold-only (`Hetzner Ticket #2026111403017785`, `overall_ok: true`).
- **Hermes & Coding Runner:** Installed and verified Hermes `0.23.1` (`python 3.14.9`, `network: denied`, `modelCalls: 0`) under isolated user `godseye`. `apps/control-api/src/coding-startup.ts` safely degrades to `unavailableConfiguration` (`qualified: false`) until Linux/Proxmox KVM coding-runner adapter is qualified.
- **Game Server (`godseye-games`, `10.20.2.10`):** Deployed Docker `26.1.5` + `godseye-luanti` (`10.20.2.10:30000/udp`) with quiesced backup script `/usr/local/sbin/godseye-games-backup.sh` + daily `04:00 UTC` timer; verified destructive restore drill (`BACKUP_OK`, `sha256sum OK`, `RESTORE_DRILL_OK:godseye-luanti:Up 3 seconds`).
- **Evidence:** [p08-runtime-observability-games.txt](evidence/p08-runtime-observability-games.txt)

### Entry 014 - `P09` Post-Reboot Drills & Handover (`2026-11-15`)
- **`VM 200` (`godseye-games`) Reboot:** `qm reboot 200` recovered `godseye-luanti` (`10.20.2.10:30000/udp`) and `godseye-games-backup.timer` (`active`).
- **`VM 100` (`godseye-pro`) Reboot:** `qm reboot 100` recovered all 8 systemd services (`postgresql`, `openbao`, `redis-server`, `caddy`, `jenkins`, `godseye-control-api`, `godseye-console`, `docker`), both `runsc` cells, `CONSOLE_HTTP=200`, `JENKINS_HTTP=200`, and `https://godseye.lucasschimmel.fr/healthz` -> `godseye-edge-ok`; OpenBao unsealed post-reboot (`Sealed: false`).
- **Open Items for Final Sign-Off:** (1) 72h continuous soak window (`DS12`) started `2026-11-15T11:09Z`; (2) 3 pre-existing Playwright UI test assertions (`databases.spec.ts:157`, `agents.spec.ts:76`, `agents.spec.ts:198`) blocking `pg-lab`/`recovery-lab` in `Jenkinsfile` (infrastructure OOM/`ECONNRESET` resolved); (3) Linux/Proxmox KVM coding-runner adapter requires an application-layer PR (`apps/control-api/src/coding-provider.ts` currently enforces Windows/WSL2 `distro: z.literal("Ubuntu")`, safely degraded via `coding-startup.ts`).
- **Evidence:** [p09-reboot-and-acceptance.txt](evidence/p09-reboot-and-acceptance.txt)

### Entry 005a — 2026-11-14T21:43:04Z — Handoff resume and read-only state recheck

> Numbering note: this entry predates Entry 005 (`2026-11-15T00:35`) chronologically; it was originally also titled "Entry 005" and is renumbered here to remove the duplicate. Its "hold `P02`" decision was superseded by Entries 004–006.

- **Phase / Gate:** `P00` resume; `P02` remains paused for hardware replacement.
- **Repository:** Re-read the handoff and referenced architecture, installation, operations and current-source E07/E08 documents. Verified `develop` @ `bc7f79c51c7ceb4c566194bc68f18c04cd7bdd2c`; all pre-existing modified/untracked work remains preserved.
- **Access:** Direct key-based SSH to the observed host passed without reading or logging private material. The local `godseye-host` alias currently fails because the first line of the workstation SSH config has a UTF-8 BOM; direct explicit connection parameters were used instead. No local SSH configuration was changed.
- **Observed:** Host kernel remains `7.0.0-22-generic`; disks remain `S675NU0W263145` and `S675NU0W263148`; all three existing RAID1 arrays still contain both expected members. No replacement disk was observed and no remote configuration changed.
- **Evidence:** [p00-resume-preflight.json](evidence/p00-resume-preflight.json).
- **Decision / next permitted action:** Continue holding `P02`. After Hetzner completes the NVMe replacement, rerun the full read-only inventory, verify the new disk health/serial and rebind the exact destructive target before requesting the final reinstall-scope confirmation.

### Entry 015 — 2026-11-15 — Independent audit and repository-side remediation (`feat/server-integration`, not deployed)

- **Audit:** five read-only audits (E01/E02, E03/E04/E06, E05, E07, live server vs `DS01`–`DS18`) found the local-only epics had never run on the server and several `P0x` "complete" claims were lab-level. Live SSH verification was skipped: the workstation SSH config starts with a UTF-8 BOM and `ssh` cannot parse it (owner file, not changed).
- **Owner decisions:** project cells use PostgreSQL 18 + pgBackRest 2.60 (control DB stays PG17); delivery runs on Docker `--runtime=runsc` without Coolify; the coding runner uses `godseye-work` as disposable boundary with a gVisor/container sandbox (weaker than KVM, stays unavailable until qualified); the console/API are reachable only over WireGuard.
- **Repository changes (not applied to the server):** validated `GODSEYE_MODE=server` with a single https owner origin; webhook-only public Caddy template; per-cell PostgreSQL/pgBackRest/Redis units and backup schedule templates; GitHub App/Jenkins/Docker-runsc delivery adapters; Linux work-VM coding profile; three e2e assertion fixes.
- **Verification:** `biome check` (769 files, 0 errors), `tsc --noEmit` and contract check pass; unit suite 1779 passed / 1 failed / 33 skipped. The one failure, `tests/e08-native.test.ts` T-AC-801, is not yet compared against baseline `e428f15`. e2e run on this PC: 53/54 (first test timed out on a cold start; passes alone).
- **Open security finding (superseded, see entry 016 and 022):** the OpenBao init material was stored on the VM it protects (`/root/openbao-init-DO-NOT-COMMIT.json`) and the unseal procedure was undocumented. The VM copy has since been deleted and the procedure is in [openbao-custody.md](openbao-custody.md).
- **Edge reconciliation (repository only):** console hostname fixed to `console.godseye.lucasschimmel.fr` (private WireGuard A record); host-systemd Caddy replaced by the container template `p10-install-edge-caddy.sh` (two listeners, per-host HTTP-01 app certificates, `p10-wildcard-apps-caddy.sh` removed); `p07-caddy-https.sh` is a superseded stub. Open: console TLS issuer (internal CA vs DNS-01).
- **Owner decisions (2026-11-15, later):** console host fixed as `console.godseye.lucasschimmel.fr` (DNS A record to a private WireGuard-reachable address, certificate via DNS-01 with the OVH API, credentials to be created by the owner and stored in OpenBao, never in chat); the ZFS mirror (`rpool`, `DS02`) is kept. Live check: `rpool` is 472 GiB with 12.7 GiB allocated. A later hybrid layout (small mirrored system area + striped data area) cannot be reached in place because `rpool` spans both full disks; it needs a planned storage rebuild from backups.
- **Edge DNS-01 implementation (repository only, not executed):** `p10-build-edge-caddy-image.sh` builds the edge image (xcaddy, `caddy-dns/ovh` v1.1.0, digest-pinned builder/base, image-ID-pinned output); `p10-install-edge-caddy.sh` now defaults the console to `tls { dns ovh { endpoint ovh-eu ... } }`, accepts that image ID and starts the edge through `godseye-edge.service` (after OpenBao); `p10-store-edge-credentials.sh` (owner, silent prompts) and `p10-render-edge-env.sh` (AppRole to `/run/godseye/edge.env`, exit 75 when sealed) handle credentials. Open: the owner creates the OVH application/consumer key and runs the store script; builder/base digests are chosen at build time.
- **Next permitted action:** deploy only after OpenBao share custody is completed by the owner (at that time the init file was still on the VM and on the owner's desktop; the VM copy was deleted later, see entry 016), the OVH DNS-01 credentials exist and the ZFS quota/sudoers helper design is reviewed.

### Entry 016 — 2026-11-15 — Edge container, server mode and owner passkey deployed on `godseye-pro`

- **Phase / gate:** `P07` re-qualification (`DS04` edge, owner access). Source: PR #1 merged into `develop` (`5c7a086`); the server ran branch `feat/server-integration` while testing.
- **Private console address:** `10.20.1.11/24` added to `eth0` (persistent netplan drop-in `60-godseye-edge.yaml`). Owner DNS record `console.godseye.lucasschimmel.fr` A `10.20.1.11` created at OVH; the wildcard `*.godseye` still resolves to the public IPv4. Reachable only over WireGuard (`wg0` forwards to `vmbr1`).
- **Edge:** Caddy `2.11.9` + `caddy-dns/ovh v1.1.0` built locally from digest-pinned builder/base images and run as container `godseye-edge` (`--cap-drop ALL --cap-add NET_BIND_SERVICE`, read-only, non-root). Two failed attempts were rolled back automatically with the host Caddy restored each time: (1) the unit depended on a guest `wg-quick@wg0` that does not exist (WireGuard terminates on the host); (2) `exec caddy: operation not permitted` because the binary carries a file capability and `--cap-drop ALL` removed it from the bounding set. Both fixes are in the repository. Host `caddy.service` is disabled.
- **Certificates:** `godseye.lucasschimmel.fr` (tls-alpn-01) and `console.godseye.lucasschimmel.fr` (DNS-01 with the OVH API; owner-created token limited to `GET`/`POST`/`DELETE` on the zone) both obtained. `https://godseye.lucasschimmel.fr/healthz` → `godseye-edge-ok`; the public listener returns an empty `200` for unknown hosts (no console content; to be changed to `404`).
- **Credentials:** OVH values were typed by the owner into a silent prompt and stored in OpenBao KV `godseye/edge/ovh`; the edge reads them with AppRole `godseye-edge` (read-only policy) into a tmpfs env file. The values never passed through the agent session.
- **Server mode:** `p07-deploy-platform.sh` rebuilt `/opt/godseye` and the environment (previous file kept as a root-only backup); control API logs `server mode ... owner origin https://console.godseye.lucasschimmel.fr (private network only)`; `/api/v1/health` → `{"status":"ok","mode":"server","serverConnected":true}`; `owner/local-command` is blocked at the edge. The owner enrolled a passkey on the real origin.
- **Not done / residual (corrected 2026-11-16):** the OpenBao init file on the VM (`/root/openbao-init-DO-NOT-COMMIT.json`) was deleted afterwards; the owner confirmed the VM copy is gone and that only the owner's desktop holds parts of the init material (entry 022 item 9: "the init file is gone and nothing auto-unseals"; [openbao-custody.md](openbao-custody.md)). This was recorded from the owner's statement and was not re-checked on the VM by this documentation task. Still open: shares not yet distributed to a second location, root-token revocation not independently evidenced (custody document says revoked, no log entry), unseal rehearsal after a reboot not done; Jenkins has not yet run the merged code; the control API's OpenBao provider token (`provider-auth`) is not configured; IPv6 matrix, external alerting, per-cell services and delivery remain unexercised on the server.

### Entry 017 — 2026-11-15 — Parallel hardening wave, CI on `main`, platform redeployed from `develop` (`183199f`)

- **Soak (`DS12`):** the 72 h window that started `2026-11-15T11:09Z` is **invalidated** by the day's changes (edge swap, server mode, restarts, new firewall guard, VM disk). Nothing waits on it: it is rerun last, on the final configuration, after the release.
- **CI:** Jenkins follows `main` only; the manual `godseye-platform-candidate` job verifies `develop`. Candidate #1/#3 found real defects (a Windows-path assertion and a Python 3.13 fixture), candidate #2 was killed by memory pressure on `godseye-work` while another agent ran sandbox tests on the same VM. Unit suite on the Linux agent: 1860 passed, 34 skipped after the fixes.
- **Cells (`DS07`, `DS09`; evidence [cells-deploy.md](evidence/cells-deploy.md)):** the VM root is ext4, so quotas use a dedicated 120 GiB virtual disk (`scsi1`, `backup=0`) with XFS project quotas; PostgreSQL 18.7 and pgBackRest 2.60.0 run beside PG17; a socket-activated root helper (17 fixed verbs) replaces sudo; disposable cells A/B proved hard quotas (A full, B writable), cross-cell denial, role separation and restart persistence; one stanza per cell to the off-host B2 bucket (distinct cipher passphrases escrowed in OpenBao), full backups and archive checks passed, an offline restore matched 5003 rows. **Open:** B2 restore drill and teardown of the two cells wait for the Backblaze daily cap reset; one shared B2 key covers the control stanza and all cells.
- **Host (`DS02`, `DS04`, `DS05`, `DS09`, `DS14`; evidence [host-hardening.md](evidence/host-hardening.md), runbooks [host-operations.md](host-operations.md), [break-glass.md](break-glass.md)):** nightly vzdump of VMs 100/200/300 and host config into a 60 GiB-capped dataset; restores to scratch VMIDs on an isolated bridge worked (VM 200 in 8 s, VM 100 in 22 s); unattended security updates with staggered reboot windows; scrub run (0 errors); external scan shows only 80/443 open on IPv4, 63 in-VM egress/MTU/isolation checks passed; a drop-only guard table with a five-minute rollback; temporary second WireGuard peer reached the host and was revoked. **Not proven:** off-host copy (needs a dedicated Backblaze key), host reboot with the new guard, Hetzner rescue on the installed system, `laptop`/`mobile` WireGuard peers, full host rebuild, in-guest firewalls.
- **Coding runner (`DS08`, `DS17`; was labelled `DS13`; evidence [work-vm-coding.md](evidence/work-vm-coding.md)):** `runsc 20261109.0` on `godseye-work`, per-task sandbox with no network and hard caps; 18 gates passed for both CLIs against the scripted fixture; control-API SSH identity lives in OpenBao/tmpfs with a pinned host key and a forced command. The runner stays `available:false`: the work VM still reaches the Internet (it is also the CI agent) and the signed owner acceptance is missing.
- **Hermes:** runtime `0.23.1` and tools `typed-files-v4` reinstalled for the deployed source under uid 994 (`modelCalls: 0`).
- **Observer (`DS11`):** a GitHub Actions workflow checks `healthz`, certificate expiry and closed ports every thirty minutes from outside the server; GitHub only schedules it from `main`, so it starts with the first release. Delivery of E08 notifications remains unconfigured.
- **Platform:** `/opt/godseye` redeployed from `develop` (`183199f`) with all unmanaged environment settings preserved; control API 1.16.0 (custom domains, migration `0025`), PG cell providers configured, health `mode: server`.
- **Owner inputs still open:** dedicated Backblaze key for host copies (and optionally a `cells/`-scoped one), offline copy of the restic password, tunnel tests from laptop and phone, TOTP for the Proxmox account, GitHub App for delivery, decision on a dedicated coding VM.

### Entry 018 — 2026-11-16 — Pull requests #13 to #20 and the first release

- **#13** isolates the browser journeys (one application at a time); **#14** moves the Ubuntu-only PostgreSQL laboratories out of the platform pipeline (the platform Jenkinsfile no longer runs them); **#15** adds `host/h10-replace-wg-peer.sh` (replace a WireGuard peer key without moving a private key; the `laptop` peer was replaced and shows a fresh handshake); **#16** removes each e2e project's data directory when it finishes (CI disk hygiene); **#17** is Release 1 (`develop` `2773c79` into `main`, merged 2026-11-16 09:35 UTC); **#18** reports server mode and real connections on the console overview; **#19** (server-aware shell and owner entry) and **#20** (read-only server observations endpoint and Serveur section) merged during this wave.
- **Effect on the server:** after #17 Jenkins builds `main`: `godseye-platform` #9 (SCM change) and #10 (nightly timer) failed only because `main` had no `Jenkinsfile` yet, and #11 (manual, 20 min) is the first green platform build on `main`. The control API still runs the `develop` bundle of entry 017; it was **not** redeployed in this wave (no console change needed it); redeploy with `p07-deploy-platform.sh` at the end of the console work.

### Entry 019 — 2026-11-16 — Hardening wave: B2 drill, edge 404, guest firewalls, egress allowlist, pinned images, cell snapshots

- **Evidence:** [server-hardening-2026-11-16.md](evidence/server-hardening-2026-11-16.md). Scripts: `p10-install-edge-caddy.sh` (rollback copy added), `guest/g01-guest-firewall.sh`, `guest/g02-disable-llmnr.sh`, `guest/g03-work-egress.sh`, `p12-install-snapshots.sh`, `p12-openbao-owner-setup.sh`, `p12-cell-ceilings.sh`, `p12-jenkins-drills.sh`, tests `tests/guest-hardening-scripts.test.ts`.
- **B2 restore drill (DS07/DS09): PASS.** Restore of the per-cell PG18 stanza from Backblaze, WAL replay and a row-level match (5003 rows, md5 `c91f152e...`); disposable cells A and B torn down including their stanzas and escrow copies; disk accounting recorded. One 5 MB leftover stanza of the first test cell needs a Backblaze console deletion.
- **Edge (DS04): DONE.** Unknown hosts answer 404 on the public listener, the on-demand TLS `ask` guard is deployed, console and public `healthz` verified, a stray test container removed. The control API was not redeployed.
- **Firewalls and egress (DS04/DS08; was labelled DS13): DONE** on all three guests, each with an armed auto-rollback and a second-session proof; LLMNR is off everywhere. The work VM now reaches only an allowlist of GitHub, package registries, Debian, Playwright and a few lab hosts; the first full candidate build behind it exposed one missing host (`storage.googleapis.com`, Chrome for Testing), now allowed. Result of the verifying candidate run: see entry 020.
- **Images:** Luanti and the `alpine:3.21` fixtures pinned by digest (container recreated after a fresh backup; same image ID).
- **Cell data safety:** daily config/auth snapshot of the cell host (root disk, so vzdump and restic carry it). OpenBao raft snapshot job installed but disabled until the owner creates its AppRole; read-only renderer AppRole prepared (owner script).
- **Jobs units:** Inngest 1.52.0 (digest verified) and the `godseye-jobs`/`godseye-redis@` unit templates installed, not enabled. A real project cell via the control API was not provisioned: it needs an owner passkey session and the first real project; the per-cell CPU/RAM ceilings are now scripted (`p12-cell-ceilings.sh`, proven on a transient unit) but the control API does not call them.
- **Unexpected state changes:** `godseye-edge` recreated (about 5 s), `godseye-luanti` recreated (about 10 s), `dnsmasq-base`, `nftables` installed on games/work, `/etc/resolv.conf` on the work VM is now a static file pointing at 127.0.0.1, `/etc/godseye/guest-fw.nft` and units `godseye-guest-fw`, `godseye-egress-fw`, `godseye-egress-dns` added, shredded `/var/lib/godseye/cells-proof`.

### Entry 020 — 2026-11-16 — Jenkins drills, candidate build behind the allowlist, observer, guest reboots

- **Candidate build behind the egress allowlist:** `godseye-platform-candidate` #9 (`develop`, 20 min) **SUCCESS**: unit suite 1896 passed / 34 skipped, `test:infra:lab` 4/4, all 11 e2e projects passed. #8 failed only on the Chrome for Testing download (host added, see entry 019). The Jenkins agent was online throughout.
- **Jenkins drills (`p12-jenkins-drills.sh`, throwaway `gdy-drill-*` jobs, deleted afterwards; the platform jobs were never touched):** agent offline: the build waited for an executor and ran to SUCCESS once the agent returned (**PASS**); cancellation: a running 600 s build stopped as `ABORTED`, no busy executor and no leftover process on the agent (**PASS**); retention: `numToKeep=3` kept builds 4, 5, 6 of six (**PASS**; the platform jobs keep 30); missed schedule: Jenkins stopped for 200 s across three one-minute ticks, none were replayed, the schedule resumed at the next tick with one duplicate firing on the first tick (**PASS**, noted behavior). Source-triggered and timer-triggered runs of `godseye-platform` exist (#9 "Started by an SCM change", #10 "Started by timer", 2026-11-15/16) but both failed before `main` had a `Jenkinsfile`; a green source-triggered run is still pending and needs the next commit on `main` (not done here: no merge to `main`). The nightly timer will show its first useful result on 2026-11-17 04:40 UTC.
- **External observer:** `external-observer.yml` extended (unknown host 404, console name stays private and unreachable from outside, console certificate expiry from Certificate Transparency as a best-effort warning); B2 backup age and host-health staleness are not observable from outside without a heartbeat (owner item 8 in entry 022). **`gh run list` shows no scheduled run since the workflow reached `main`; a manual dispatch failed instantly: "recent account payments have failed or your spending limit needs to be increased".** GitHub Actions is blocked by billing, so the observer is inactive until the owner fixes it (entry 022, item 1). The new steps reach `main` only with the next release.
- **Reboots:** `godseye-games` rebooted (`systemctl reboot`) and `godseye-work` rebooted; after each, the guest firewall, LLMNR state, egress table and resolver, game container and Jenkins agent came back (`p12-post-reboot-check.sh`: `POST_REBOOT_CHECK_PASS`, 21 checks). **Not done and held:** reboot of `godseye-pro` and of the host with the guard, because OpenBao would come up sealed and only the owner can unseal it (edge, console and control API stay down until then). Procedure and owner item 9 in entry 022; risk to WireGuard is limited to a few minutes (peers reconnect after the host is back), recovery per [break-glass.md](break-glass.md).

### Entry 021 — 2026-11-16 — Capacity figures and recommended proposal (no resize performed)

Measured on the host (`qm config`, `zfs list`, `free -m`, `zfs_arc_max`):

| Resource | Committed maximum | Pool / host | Share | 80 % rule |
| --- | --- | --- | --- | --- |
| Virtual disks | 200 (VM 100 root) + 120 (VM 100 `scsi1`) + 80 (VM 200) + 20 (VM 300) = **420 GiB** | `rpool` 472 GiB | 89.0 % | 377.6 GiB |
| Disks plus backup quota | 420 + 60 (`rpool/backup`) = **480 GiB** | 472 GiB | **101.7 %** | exceeded by 102.4 GiB |
| Guest RAM | 32,768 + 16,384 + 6,144 = **55,296 MiB** | 64,076 MiB | 86.3 % | 51,261 MiB |
| Guest RAM plus ZFS ARC cap (4,096) plus host reserve (4,096) | **63,488 MiB** | 64,076 MiB | 99.1 % | exceeded by 12,227 MiB |

Reality today: `rpool` has 28.0 GiB allocated (5.9 %): VM 100 root 6.2 GiB, `scsi1` 0.08 GiB, VM 200 1.1 GiB, VM 300 4.4 GiB, backups 12.5 GiB of the 60 GiB quota, host root 3.4 GiB; the host uses about 25 GiB of RAM with every guest running (39 GiB available). All zvols are sparse (no refreservation), so the over-commit is a ceiling that is not near any filesystem. What bounds it: the cell disk is fully governed by XFS project quotas (sum of admitted cell quotas must stay below 120 GiB), `rpool/backup` is hard-capped at 60 GiB, and the host health file already alarms at pool 70 % and 85 %.

**Recommendation (owner decision; nothing was changed):**

1. Now, record a thin-provisioning exception, valid while real allocation stays below 50 % of `rpool` (about 236 GiB): the rule is satisfied on allocated space, not on committed space. Conditions: alert at 70 % (exists), refuse new cell admission when `rpool` is above 60 %, keep the backup quota at or below 60 GiB (it may shrink to 40 GiB: 12.5 GiB are used with 2 daily plus 1 weekly archives per VM), and re-evaluate when any guest root passes 100 GiB. Guest-only RAM at 86.3 % is acceptable for the current three guests because the largest tenant (the game) is capped by its container at 1 GiB; set `MemoryMax` ceilings on cells with `p12-cell-ceilings.sh`.
2. A dedicated coding VM does not fit either rule as built. To add one (8 GiB RAM, 40 GiB disk) and honor 80 % of RAM, resize guest memory to pro 24 GiB, games 8 GiB, work 6 GiB, coding 8 GiB (46 GiB = 47,104 MiB, plus ARC 4,096 = 51,200 MiB = 79.9 %); pro currently peaks well below 24 GiB. The extra disk (460 + 40 = 500 GiB committed) only fits through a planned storage rebuild (hybrid layout from entry 015) or a larger pool, so keep the coding runner on `godseye-work` until that is decided.
3. Do not shrink zvols or the ZFS layout in place; both need a backed-up, scheduled rebuild with a restore drill first.

### Entry 022 — 2026-11-16 — Owner actions still blocking the freeze (click by click)

1. **GitHub Actions billing (new finding, blocks the external observer and every hosted workflow):** github.com, profile photo, Settings, Billing and plans, Payment information: update the failing payment method; then Spending limits (Actions): raise from 0 or set a monthly limit. Re-run `external-observer` with `gh workflow run external-observer.yml --ref main`; a green run proves it.
2. **Backblaze dedicated host-copy key:** secure.backblaze.com, Buckets: App Keys, Add a New Application Key. Name `godseye-host-restic`; allow access to bucket `godseye-backups-dab6e7328bfc` only; file name prefix `host/`; Read and Write. Copy the key id and application key once, then `ssh -t godseye-wg bash h08-offhost-credentials.sh` (silent prompts). Escrow the restic passphrase (`ssh godseye-wg cat /etc/godseye/restic-password`) into the password manager, not into chat. Optional second key `godseye-cells` limited to prefix `cells/` for the cell stanzas.
3. **Backblaze console cleanup:** Buckets, Browse Files, folder `cells/414cc5e5-83d1-48a3-8896-2ed69ae8b165`, delete all versions (about 5 MB, first test cell).
4. **OpenBao (needs the shares, not an agent):** from the workstation unseal state as in [openbao-custody.md](openbao-custody.md); generate a short-lived root token with two shares (`bao operator generate-root`); run `ssh -t godseye-pro sudo ./p12-openbao-owner-setup.sh <templates dir>` and paste the token at the silent prompt; revoke the token; then run `p12-install-snapshots.sh` on the VM to enable the raft snapshot timer. This also gives the bindings renderer its own read-only role. Rehearse an unseal after a reboot (required before the host reboot drill below).
5. **Proxmox TOTP:** `https://10.20.0.1:8006`, Datacenter, Permissions, Two Factor, Add, TOTP for `lucas@pve` (and `root@pam` if used); scan with an authenticator app; store the recovery keys with the other escrow items. A scoped monitoring API token has no design in the repository: decide whether one is wanted (`pveum user token add`, role `PVEAuditor`, privilege separation on) and say so.
6. **GitHub App for delivery:** Settings, Developer settings, GitHub Apps, New GitHub App. Webhook URL `https://godseye.lucasschimmel.fr/hooks/github`, content type `application/json`, a webhook secret you generate and store in OpenBao yourself; repository permissions Contents (read), Metadata (read), Pull requests (read), Commit statuses (read and write); subscribe to Push and Pull request; install on `lucasschimmel/godseye` only; generate a private key and keep it out of chat and the repository. Check the exact permission list against [application-delivery.md](../development/application-delivery.md) before installing.
7. **Registry credentials:** create `/etc/zot/htpasswd` on `godseye-pro` out of band (`htpasswd -bBn <user> <password>`, bcrypt, 0640 root:zot) before `p10-install-registry.sh`.
8. **Alert channel and heartbeat:** choose a channel (email address, Telegram or Slack webhook) and a dead-man's-switch service (for example healthchecks.io); host-health staleness and backup age can only be observed from outside through a heartbeat the host pushes. Create the account and the check yourself and give the ping URL to be stored in OpenBao.
9. **Host reboot drill with the guard (held, needs you present):** a reboot of `godseye-pro` or of the host seals OpenBao (the init file is gone and nothing auto-unseals), so the edge, console and control API stay down until two shares are supplied. Schedule a window, have the shares at hand, run `qm reboot` for the guests first and the host last, unseal, then `p12-post-reboot-check.sh` (guard table, WireGuard handshakes, edge, console, guest firewalls).
10. **IPv6/AAAA, domain decisions and the dedicated coding VM:** unchanged from entries 015 and 017; see the capacity proposal above.

Update 2026-11-16 (entry 023): items 2 (interim, shared key) and 3 are done; only the passphrase copy and the bucket lifecycle rule remain from them.

### Entry 023 — 2026-11-16 — Backblaze cleanup, host off-host copy on a shared key, retention

- **Evidence:** [server-offhost-observe-2026-11-16.md](evidence/server-offhost-observe-2026-11-16.md). Scripts: `p13-b2-prefix-tool.mjs`, `p13-b2-retention-check.sh`, `host/h11-offhost-shared-key.sh`, `host/h13-offhost-restore-drill.sh`.
- **Entry 022 item 3 (orphan stanza): DONE.** `cells/414cc5e5-...` removed at object level (its passphrase no longer existed, so `stanza-delete` could not open it). The cleanup also found that the bucket keeps every version: the torn-down disposable cells A and B had only been hidden, so about 21 MB of their encrypted data was still stored. All three `cells/` prefixes are now fully deleted; the control stanza `main` passes `pgbackrest check`.
- **Entry 022 item 2 (gap P06b), interim: DONE on a shared key.** The host restic repository lives under `host/` in the same bucket, using the key the pgBackRest stanzas already use. First copies ran through the existing units (host config 12:22Z, three vzdump archives 6.43 GiB 12:28Z, sample integrity check passed) and a **restore drill from Backblaze passed** (host config with 47 PVE entries; VM 200 archive identical to the local one). Host health went from `degraded` to `ok`.
- **Accepted risk R-P06b (no dedicated key):** one Backblaze key can read, overwrite and delete the control stanza, the cell stanzas and the host repository. Confidentiality is unaffected (pgBackRest and restic encrypt client-side with separate passphrases), but a compromise of the pro VM (which holds the key) or the host could destroy the off-host copies. Mitigations: the key is root-only on both machines; the VM cannot reach the host; local vzdump archives and ZFS snapshots stay independent. **Later hardening:** (1) create keys scoped by prefix (`host/` read/write; `pgbackrest/` and `cells/` for the stanzas) and rerun `h08-offhost-credentials.sh`; (2) enable bucket Object Lock with a default retention on `host/`, or use a key without delete rights plus lifecycle-based pruning; (3) rotate the shared key afterwards.
- **Retention:** control stanza `repo1-retention-full=2` (was 4; template updated); per-cell stanzas follow the project policy default of 2 full backups; `p13-b2-retention-check.sh` passes. Host restic: 14 daily, 8 weekly and 6 monthly host-config snapshots, last 2 vzdump sets.
- **Owner steps remaining:** (a) copy the restic passphrase offline with one PowerShell command on the desktop (the file gets owner-only permissions and nothing is displayed): `$f="$HOME\godseye-restic-password.txt"; scp godseye-wg:/etc/godseye/restic-password $f; icacls $f /inheritance:r /grant:r "${env:USERNAME}:(R)"`; then move it into the password manager and an offline copy. Without it the host copies cannot be decrypted after a host loss. (b) Backblaze console, Buckets, the bucket, Lifecycle Settings, "Keep only the last version of the file": the key cannot read or set lifecycle, and until then pruned restic packs and expired pgBackRest files stay stored as hidden versions.

### Entry 024 — 2026-11-16 — Truthful console server panel: host status published into the VM

- The host pushes `host-health.json` (it embeds the off-host state) to `godseye-pro` after every 15-minute health run through a restricted receiver (`hoststatus` account, forced command, pinned host key, JSON validation, atomic write, group-readable by `godseye`). The VM holds no credential into the host. OpenBao was already trusted with full verification (the certificate carries `127.0.0.1` and `10.20.1.10` SANs and `NODE_EXTRA_CA_CERTS` is set): `sealed=false` read from the service environment; `openbao-custody.md` corrected. The four observation settings are now managed by `p07-deploy-platform.sh`.
- Not verified: the rendered Serveur panel (needs an owner session); the data it reads was checked as the service user.

### Entry 025 — 2026-11-16 — Platform redeployed from `develop` (`d9cf3e1`) and release candidate list

- `p07-deploy-platform.sh` with `GODSEYE_DEPLOY_REF=develop`: control API 1.19.0 and the console from `develop` run on `godseye-pro`; health `mode: server`, console reachable through the edge. The script was fixed to restart the services (it left the old process running) and to end on the public health endpoint (the OpenAPI document needs a session).
- **Changes on `develop` since `main` (all merged; release PR not opened):** #18 server mode and real connections on the overview; #19 server-aware shell and owner entry; #20 read-only server observations endpoint and Serveur section; #21 audit journal anchor and export; #22 mode-aware copy sweep; #23 passkey naming and reasons on disabled owner controls; #24 real dedicated-server wording on the infrastructure page; #25 route error and pending boundaries; #26 cross-project domain overview and list; #27 backup cadence panel with host B2 state (API 1.19.0); #28 current release, deploy health and build links on CI/CD; #29 server hardening scripts and the gap inventory; plus the PR of this entry (off-host scripts, status push, deploy fix).
- **Ready:** all of it is code-complete and deployed. **Before the release PR:** run `godseye-platform-candidate` on the final `develop` head (the last green candidate, #9, predates #21 to #29 and this change); look at the Serveur, Backups, Domains and Delivery pages with the owner's session; fix GitHub Actions billing (entry 022 item 1) so the external observer can start with the release.

### Entry 026 — 2026-11-16 — Release 2 on `main`, platform builds panel and read-only Jenkins identity

- **PRs:** #30 (off-host copy on a shared key, host status push, B2 cleanup tooling, deploy restart fix; entries 023-025) and #31 are on `develop`. **#31** fixes the template inventory test: `tests/server-templates.test.ts` now accepts OpenBao `.hcl` policies next to the server templates (test only). **#33** adds the read-only list of the platform's own Jenkins builds to the delivery page (`GET /infrastructure/jenkins`, optional binding `GODSEYE_PLATFORM_JENKINS_BINDING`, last 8 builds of `godseye-platform` and `godseye-platform-candidate`, 4 s deadline, `not_connected` without the binding). **#34** adds the matching read-only Jenkins identity (`infra/jenkins/jenkins.yaml`: user `JENKINS_READER_ID` with `Overall/Read` and `Job/Read` only) and the installer `infra/dedicated-server/p14-platform-jenkins-reader.sh` (password written to root-only files, never printed).
- **Release 2:** **#32** merged `develop` into `main` on 2026-11-16 at 16:23 +0100 (merge commit `7b44474`). Jenkins reported the manual candidate build **#11** (`develop`) and the `main` build **#12** (`godseye-platform`) green. These two results were reported to this documentation task; they were not re-read from Jenkins here, and the build logs are not stored in the repository.
- **CI rule in force:** Jenkins follows `main` only; `develop` is verified through `godseye-platform-candidate` before every release PR (entry 017). The `*/develop` text in entry 012 is historical.
- **Applied on the server (2026-11-16, evening):** `p14-platform-jenkins-reader.sh` ran on `godseye-pro` (Jenkins restarted by `p07-update-jenkins-jobs.sh`, jobs present). The reader identity returned `200` on the job API and `403` on `/script` and `/manage/`, so it can read builds but not administer. `develop` `d0ac7c7` (includes #30-#34) was then deployed with `p07-deploy-platform.sh`; the control API restarted, `GET /api/v1/health` answered `{"status":"ok","mode":"server","serverConnected":true}`, and the built bundle contains the `/infrastructure/jenkins` route. The server runs `develop`, not the `main` bundle (the Release 2 merge commit `7b44474` and `develop` have the same content apart from the later #33-#34).
- **Not verified:** that the builds panel actually lists builds #10 to #12 (the endpoint needs an owner session, so the data path was not exercised end to end); the rendered Serveur, Backups, Domains, Delivery and builds panels with an owner session; the first scheduled external-observer run (GitHub Actions billing, entry 022 item 1); the first green nightly `godseye-platform` timer run (expected 2026-11-17 04:40 UTC) and a green source-triggered run; the soak, which is still to be rerun last.
- **Documentation:** this entry accompanies the spec and plan synchronisation (ADR-021, F47 custom domains, owner API `1.19.0`, I10a in the plan, `EX44` instead of `AX41`, corrected DS numbering and the OpenBao custody wording in entries 015, 016 and 022).

### Entry 027 — 2026-11-16 — Owner decisions: capacity exception, Releases 3 and 4, OpenBao identity script

- **Capacity (DS03, owner approved option A of entry 021):** a thin-provisioning exception is recorded. The 80 % rule applies to allocated space, not committed space, while real allocation stays below 50 % of `rpool` (about 236 GiB; 28 GiB allocated on 2026-11-16). Conditions: the alarms at 70 % and 85 % of the pool stay; new cell admission is refused above 60 % of the pool; the backup quota stays at or below 60 GiB; per-cell `MemoryMax` ceilings are applied with `p12-cell-ceilings.sh` when cells are admitted; the exception is re-evaluated when any guest root passes 100 GiB or allocation passes 236 GiB. No dedicated coding VM: the coding runner stays on `godseye-work`. Nothing was resized.
- **Releases:** Release 3 (PR #44, `main` `675f616`, `godseye-platform` build 13 and candidate build 13 SUCCESS) and Release 4 (PR #51, `main` `d3d0d00`, candidate build 15 SUCCESS on `develop` `1c04f2a`). The Release 4 `main` build was triggered by hand and its result is not recorded here. Candidate build 14 was a duplicate trigger of the same revision. The server runs `develop` `1c04f2a` (owner API `1.22.0`).
- **External observer:** scheduled and manual runs succeeded on 2026-11-16 (20:06 and 12:19 UTC) with the repository public; the billing block of entries 020 and 022 no longer applies while the repository stays public.
- **OpenBao controller identity (not yet run):** `p13-openbao-controller-identity.sh` creates the limited controller token (policy `godseye-broker-v1` only, periodic 720 h, weekly renewal timer), installs it as `bao.auth` through the repository CLI, and revokes the admin token afterwards. The CLI must run with a minimal environment: the full `control-api.env` makes `access:policy` fail (server-only keys are rejected in local configuration mode); with the minimal environment it printed the policy on `godseye-pro`.

### Entry 028 — 2026-11-17 — OpenBao admin token recovery (plan B prepared)

- **Finding:** the initial root token kept in the owner's init material was refused by OpenBao (`p13-openbao-owner-session.sh` stopped before changing anything), so no admin token exists. OpenBao 2.7 serves `generate-root` only through the authenticated `/sys/generate-root-token` endpoint (verified: the CLI answers 403 without a token) and keeps the legacy unauthenticated `/sys/generate-root/*` endpoints disabled by default (`disable_unauthed_generate_root_endpoints`, listener `tcp`, default `true`; OpenBao 2.7 listener documentation).
- **Plan B:** `p13-openbao-recover-admin.sh` re-enables that endpoint on the loopback listener only (the `10.20.1.10` listener keeps the default), restarts and unseals OpenBao with two shares typed silently, generates a one-time-password protected root token with the same shares, restores `/etc/openbao/openbao.hcl`, then runs the owner session, which revokes the token. The running process keeps the legacy loopback endpoint enabled until its next restart (the file is restored); the reboot drill closes that and must record it. Not yet run.

### Entry 029 — 2026-11-17 — OpenBao session done: controller identity, root-token hygiene, unseal rehearsal, snapshots

- **Shares and tokens (owner's desktop material, values never printed):** all three root tokens kept on the desktop (`root-token.txt`, its copy and `openbao-init.json`) were refused by OpenBao with HTTP 403, i.e. the initial root token was already revoked (the custody wording of entries 015 and 016 is confirmed). The three unseal shares were proven on 2026-11-17 by unsealing a throwaway copy of the vault data on loopback ports 18200/18201 (pair 1+2 unsealed it; the copy and its unit were deleted, production never changed).
- **Plan B ran** (`p13-openbao-recover-admin.sh`, non-interactive, shares sent over SSH, safety copies of the data in `/root/openbao-backups/data-20261117T064300Z` and `...T065223Z`, root-only 0700, 520 KiB each). The first run restarted and unsealed OpenBao, then hit HTTP 500 ("local node not active but active cluster node not found") on the first legacy `generate-root` call made right after unsealing; the calls now retry. Fixes made along the way: a pipeline-subshell variable bug, a weekly renewal timer that could not work (the minimal policy forbids `auth/token/renew-self`: 403; the timer was removed), and the token backend max lease TTL (32 days) that capped the controller token's real TTL at 31 days (now raised to 8760 h, and the script refuses a token whose real TTL is under 300 days).
- **Result:** AppRoles `godseye-bindings-render` and `godseye-snapshot` created (secret ids rotated, renderer restarted); controller token installed as `<identityDir>/bao.auth` (policies `godseye-broker-v1` only, orphan, periodic 8760 h, real TTL 365 days, installed 2026-11-17 06:52 UTC) and the previous controller token revoked; daily raft snapshot timer enabled (`godseye-bao-snapshot.timer`, first real snapshot `openbao-raft-20261117T065233Z.snap`, 58,905 bytes, checksum file present); one stray root token left by a diagnostic generation was found and revoked; the session root token was revoked and OpenBao refused it afterwards (`ADMIN_TOKEN_REVOKED_AND_VERIFIED`).
- **Unseal rehearsal:** OpenBao was restarted and unsealed with two shares twice (2-3 s of outage each); the legacy unauthenticated `generate-root` endpoint answers 405 again (its option is not in `openbao.hcl`); `godseye-control-api`, `godseye-edge` and `godseye-bindings-render` were active and `GET /api/v1/health` answered `{"status":"ok","mode":"server","serverConnected":true}`. This rehearsal was a service restart, not a reboot of the VM or the host. `p12-post-reboot-check.sh` was run on the VM itself and reported failures for every host-side check because it is meant to run from the host; ignore that output.
- **Open:** the controller token expires about 2027-11-17: re-run `p13-openbao-controller-identity.sh identity` before then (it replaces `bao.auth` and revokes the old token). The Access page showing `ready` instead of `no_authority` needs an owner session and was not seen here. Share redistribution (single desktop copy) is still deferred by the owner. The Jenkins and external-observer notes of entry 027 are unchanged.

### Entry 030 — 2026-11-17 — GitHub App created and installed on Melvyn; webhook path fixed

- **App (created by the assistant through GitHub's manifest flow, confirmed in the owner's signed-in browser pane):** `godseye-delivery-lucasschimmel`, App ID `5796301`, Client ID `Iv23lin3RTYaSVjlukEX`, private to the owner's account, read-only permissions `contents`, `pull_requests` and `metadata`, events `push` and `pull_request`, webhook `https://godseye.lucasschimmel.fr/hooks/github`. The CLI cannot create a GitHub App; the manifest flow needs one confirmation click.
- **Installation:** installation `182839062` on the personal account, repository selection `selected`, only `lucasschimmel/Melvyn` (repository id `1403647799`, private). Verified by authenticating as the App (JWT signed with its key) and reading `GET /app/installations`.
- **Secrets (never printed):** the private key and the webhook secret were sent by SSH to `godseye-pro` and stored as root-managed private files, not in OpenBao: `/etc/godseye/github-app.pem` and `/etc/godseye/github-app.json` (`{issuer: <client id>, privateKeyPath}`, both `godseye:godseye` 0600) plus `GODSEYE_GITHUB_APP_BINDING` and `GODSEYE_GITHUB_WEBHOOK_KEY` in `control-api.env` (preserved by `p07-deploy-platform.sh`; backup `control-api.env.bak-pre-github-app`). The local copies on the owner's PC were deleted; the key can be regenerated in the App settings. Moving them into OpenBao is deferred and needs an admin token.
- **Bug found and fixed (PR #63):** every webhook delivery (ping and installation) returned 403 because the control API rejected the public site host (`godseye.lucasschimmel.fr`) with `INVALID_HOST` before checking the signature. Only `POST /hooks/github` is now exempt from the host allowlist (it is authenticated by its HMAC signature). After deploying `develop` `6cc482a`, GitHub's redelivery of the installation event was answered `OK`, so the chain public site, edge, control API and signature check works end to end. The earlier unsigned test from outside (403) was the same host check.
- **Not done:** no push or pull request event of a real project was received yet (no project exists); the project form still needs the repository and installation ids above; no source sync or delivery was run.
