# Dedicated-server execution ledger

Status: `P00` read-only inventory **executed and recorded** (`2026-11-14T19:01:02Z`); `P01` installation/rollback preparation **bound to observed hardware/network**; awaiting owner decision on `nvme1n1` SMART endurance warning (`126%` wear / `critical_warning: 0x04`) and final confirmation of destructive `P02` reinstall scope.

Authority and references:
- Handoff brief: [gemini-server-handoff.md](../development/gemini-server-handoff.md)
- Infrastructure contract: [dedicated-server.md](../spec/dedicated-server.md) (`DS01`–`DS18`)
- Execution plan: [dedicated-server-installation.md](../plan/dedicated-server-installation.md) (`P00`–`P09`)
- Architecture and controls: [ADR-002](../adr/ADR-002-professional-vm-and-dual-stack.md), [isolation.md](../spec/isolation.md) (`I01`–`I16`, `D01`–`D10`), [networking.md](../spec/networking.md) (`N01`–`N08`)
- Product scope and test strategy: [v1.md](../spec/v1.md) (`F01`–`F46`), [v1-development.md](../plan/v1-development.md), [STRATEGY.md](../../tests/STRATEGY.md) (`T01`–`T43`)

---

## 1. Baseline snapshot and P00 observed hardware/network inventory

| Field | Observed value | Evidence / Notes |
| --- | --- | --- |
| Snapshot date | `2026-11-14` (`19:01:02Z` P00 probe) | [p00-host-inventory.json](evidence/p00-host-inventory.json), [p00-host-inventory.txt](evidence/p00-host-inventory.txt) |
| Active branch & commit | `develop` (`origin/develop`) @ `bc7f79c` | Working tree changes (`M docs/development/handoff.md`, `?? docs/development/gemini-server-handoff.md`) preserved |
| Owner Control / App API | Control API `1.15.0` / App API `1.0.0` | Local E01–E08 verified; server qualification starts here |
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
| `E05` Delivery, GitHub App, Jenkins, Coolify | Local policy/fanout/migration-lane/scanner gates and disposable fixture lab implemented | **Partial / Unqualified**: live GitHub App token exchange, private Jenkins controller/disposable work-VM agents, `Jenkinsfile`/`jenkins.yaml` `develop` vs `main` fix, Coolify gVisor enforcement, and DNS/TLS remain open (`P07`) |
| `E06` Inngest, Transactional Outbox & Detached Workers | Complete locally (detached journal supervisor, per-cell child workers, signed live cron catalog, external workflow PostgreSQL `18.6` + Redis `8.0.5`) | **Unqualified** on server: requires systemd/container supervision, per-cell containment, and off-host recovery |
| `E07` Hermes Agent Center, Chat, Data Tools, Coding Runners, Orchestration | Complete locally (`Hermes 0.23.1` / `CPython 3.14.9`, streaming chat/artifacts, 5 fixed gVisor data tools, WSL2 KVM `Codex`/`Claude Code` runners, `1.14.0` DAG orchestration) | **Portability & qualification gate**: `E08` changed Hermes/coding IPC/helper closures. Hermes receipts must be refreshed (`bun run hermes:runtime:install`). Coding runner adapter is currently Windows/Ubuntu WSL2-specific (`Ubuntu` literal check) and must be adapted/qualified for Proxmox sibling KVM work guests before remote coding is enabled |
| `E08` Usage, Budgets, Observability & Incidents | Complete locally (`1.15.0`, migrations `0023`/`0024`, per-attempt usage intents, rolling budgets, structured telemetry, durable notification outbox) | **Unqualified**: real vendor billing admin, host/guest/container telemetry, real outbound alert delivery, and an independent off-host uptime observer remain unconfigured |
| `E09`–`E12` Bundles, Laya, Personal Services, Full Release | Pending product/release epics | Must not be marked complete by server setup |

---

## 2. P01 bound topology, measured capacity envelope and network matrix

Full machine-readable manifest: [p01-preparation-template.json](../../infra/dedicated-server/p01-preparation-template.json).

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
| `P00` Inventory & preservation | `DS01` | `observed` (awaiting owner sign-off on `nvme1n1` `126%` wear finding) | [p00-inventory.sh](../../infra/dedicated-server/p00-inventory.sh), [p00-host-inventory.json](evidence/p00-host-inventory.json), [p00-host-inventory.txt](evidence/p00-host-inventory.txt) | Full hardware/SMART/network/data inventory collected over SSH. Zero user data confirmed. `nvme1n1` (`S675NU0W263148`) has `percentage_used=126%` & `critical_warning=0x04`. |
| `P01` Install & rollback preparation | `DS02`, `DS05` | `prepared_locally` (bound to `P00` measurements) | [p01-preparation-template.json](../../infra/dedicated-server/p01-preparation-template.json) | Capacity equation (`62.57 GiB` RAM -> `6 GiB` work VM cap; `4 GiB` ZFS ARC cap), NIC/IPv4/IPv6 routes, and disk `by-id` bindings finalized. |
| `P02` Bare-metal Proxmox & mirrored storage | `DS02` | `awaiting_owner_confirmation` | — | Ready to execute via Hetzner Rescue once owner confirms `nvme1n1` handling (replace now via Hetzner Support vs install now) and approves wiping `S675NU0W263145` + `S675NU0W263148`. |
| `P03` Private admin & dual-stack network | `DS04` (host), `DS05` | `not_started` | — | Depends on `P02`. |
| `P04` Permanent guests & resource admission | `DS03`, `DS04` (guest) | `not_started` | — | Depends on `P03`. |
| `P05` Professional runtime & A/B isolation fixtures | `DS04` (container), `DS06`, `DS07` | `not_started` | — | Depends on `P04`. |
| `P06` Off-host backups & held restore | `DS09`, `DS10` (prep), `DS14` (prep) | `not_started` | — | Depends on `P05` + off-host destination selection. |
| `P07` Delivery, CI & provider admission | `DS04` (full), `DS08`, `DS13`, `DS15` | `not_started` | — | Depends on `P05`/`P06`. |
| `P08` Real services, Hermes/usage, games & alerts | `DS07`, `DS11`, `DS16`, `DS17`, `DS18` | `not_started` | — | Depends on `P07`. |
| `P09` 72-hour soak, DR drills & handoff | `DS12`, `DS14` | `not_started` | — | Depends on `P08`. |

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
  - `P06`: Off-host encrypted backup target + OpenBao + PostgreSQL/pgBackRest restore drill (`DS08`/`DS09`).
  - `P07`: Jenkins (`develop` branch fix), Coolify/G.O.D.S.E.Y.E platform deployment & webhook/edge qualification (`DS12`/`DS13`/`DS15`/`DS18`).
  - `P08`: Games/monitoring/SMART filtering (`0x04` Samsung PM9A1 policy)/coding-runner qualification (`DS10`/`DS11`/`DS14`/`DS16`).
  - `P09`: 72h soak & final `DS01`–`DS18` sign-off (`DS17`).

### Entry 011 — 2026-11-15T01:42:20+01:00 — `P06` Complete: Backblaze B2 Off-Host Encrypted Repository & PostgreSQL Restore Drill (`DS08` / `DS09` Pass)

- **Phase:** `P06` (`COMPLETED` -> `DS08` / `DS09` PASS)
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
- **OpenBao & PostgreSQL:** OpenBao `2.7.2` initialized (`3` shares / threshold `2`, recovery JSON stored only in `/root/openbao-init-DO-NOT-COMMIT.json` on `godseye-pro`), unsealed (`Sealed: false`), KV v2 `godseye/` + AppRole `godseye-control-api` verified (`OPENBAO_APPROLE_LOGIN_OK`). PostgreSQL `17.12` database `godseye` + role `godseye` created.
- **Control Plane & Console:** Cloned `git@github.com:lucasschimmel/godseye.git` (`develop`, `bc7f79c`) via read-only Deploy Key into `/opt/godseye`; built `console`, `control-api`, `sdk`, `backend`, `jobs`; `godseye-control-api.service` (`127.0.0.1:4301`, unauth `/api/v1/openapi.json` -> `401`) and `godseye-console.service` (`127.0.0.1:4300`, `HTTP 200`) active.
- **Jenkins LTS `2.580.2` + `godseye-work` (`10.20.3.10`):** Jenkins bound strictly to `10.20.1.10:8080` (`infra/jenkins/jenkins.yaml` updated for `*/develop` and Jenkins `2.580.2` `DefaultCrumbIssuer` compatibility). Surgical `nftables` rule allows `10.20.1.10 -> 10.20.3.10:22` (`WORK_TO_PRO_BLOCKED` verified). Build `#5` (`16m02s`) hit Linux OOM killer + missing Chromium OS libs in `test:e2e`; after installing Chromium shared libs and adding a persistent `4 GiB` `/swapfile` on `godseye-work`, Build `#6` (`21m04s`, `bc7f79c`) passed `lint`, `contracts:check`, `typecheck`, `bun audit`, full `vitest` suite, `test:infra:lab` (`4/4`), and `51/54` Playwright `test:e2e` tests (zero OOM/`ECONNRESET`), with 3 pre-existing application/UI assertion failures (`databases.spec.ts:157`, `agents.spec.ts:76`, `agents.spec.ts:198`) causing Jenkins to skip `pg-lab`/`recovery-lab`.
- **Evidence:** [p07-delivery-and-platform.txt](file:///d:/Developer/Projects/G.O.D.S.E.Y.E/docs/operations/evidence/p07-delivery-and-platform.txt)

### Entry 013 - `P08` Runtime Cells, Observability, Hermes & Game Server (`2026-11-15`)
- **Isolated `runsc` (`systrap`) Cells:** Deployed `godseye-cell-prod-app` (`godseye_prod_net`) and `godseye-cell-dev-app` (`godseye_dev_net`) on `godseye-pro` (`4.19.0-gvisor`, `--read-only`, `--cap-drop=ALL`, `--pids-limit=64`, `--memory=128m`).
- **Host SMART & ZFS Policy (`godseye-wg`):** Installed `/usr/local/sbin/godseye-host-health.sh` + `godseye-host-health.timer` (15 min) monitoring `zpool status -x` and NVMe `available_spare`/`media_errors` while treating `/dev/nvme1n1` (`S675NX0T801950`) Samsung PM9A1 `0x04` as warranty-threshold-only (`Hetzner Ticket #2026111403017785`, `overall_ok: true`).
- **Hermes & Coding Runner:** Installed and verified Hermes `0.23.1` (`python 3.14.9`, `network: denied`, `modelCalls: 0`) under isolated user `godseye`. `apps/control-api/src/coding-startup.ts` safely degrades to `unavailableConfiguration` (`qualified: false`) until Linux/Proxmox KVM coding-runner adapter is qualified.
- **Game Server (`godseye-games`, `10.20.2.10`):** Deployed Docker `26.1.5` + `godseye-luanti` (`10.20.2.10:30000/udp`) with quiesced backup script `/usr/local/sbin/godseye-games-backup.sh` + daily `04:00 UTC` timer; verified destructive restore drill (`BACKUP_OK`, `sha256sum OK`, `RESTORE_DRILL_OK:godseye-luanti:Up 3 seconds`).
- **Evidence:** [p08-runtime-observability-games.txt](file:///d:/Developer/Projects/G.O.D.S.E.Y.E/docs/operations/evidence/p08-runtime-observability-games.txt)

### Entry 014 - `P09` Post-Reboot Drills & Handover (`2026-11-15`)
- **`VM 200` (`godseye-games`) Reboot:** `qm reboot 200` recovered `godseye-luanti` (`10.20.2.10:30000/udp`) and `godseye-games-backup.timer` (`active`).
- **`VM 100` (`godseye-pro`) Reboot:** `qm reboot 100` recovered all 8 systemd services (`postgresql`, `openbao`, `redis-server`, `caddy`, `jenkins`, `godseye-control-api`, `godseye-console`, `docker`), both `runsc` cells, `CONSOLE_HTTP=200`, `JENKINS_HTTP=200`, and `https://godseye.lucasschimmel.fr/healthz` -> `godseye-edge-ok`; OpenBao unsealed post-reboot (`Sealed: false`).
- **Open Items for Final Sign-Off:** (1) 72h continuous soak window (`DS16`) started `2026-11-15T11:09Z`; (2) 3 pre-existing Playwright UI test assertions (`databases.spec.ts:157`, `agents.spec.ts:76`, `agents.spec.ts:198`) blocking `pg-lab`/`recovery-lab` in `Jenkinsfile` (infrastructure OOM/`ECONNRESET` resolved); (3) Linux/Proxmox KVM coding-runner adapter requires an application-layer PR (`apps/control-api/src/coding-provider.ts` currently enforces Windows/WSL2 `distro: z.literal("Ubuntu")`, safely degraded via `coding-startup.ts`).
- **Evidence:** [p09-reboot-and-acceptance.txt](file:///d:/Developer/Projects/G.O.D.S.E.Y.E/docs/operations/evidence/p09-reboot-and-acceptance.txt)

### Entry 005 — 2026-11-14T21:43:04Z — Handoff resume and read-only state recheck

- **Phase / Gate:** `P00` resume; `P02` remains paused for hardware replacement.
- **Repository:** Re-read the handoff and referenced architecture, installation, operations and current-source E07/E08 documents. Verified `develop` @ `bc7f79c51c7ceb4c566194bc68f18c04cd7bdd2c`; all pre-existing modified/untracked work remains preserved.
- **Access:** Direct key-based SSH to the observed host passed without reading or logging private material. The local `godseye-host` alias currently fails because the first line of the workstation SSH config has a UTF-8 BOM; direct explicit connection parameters were used instead. No local SSH configuration was changed.
- **Observed:** Host kernel remains `7.0.0-22-generic`; disks remain `S675NU0W263145` and `S675NU0W263148`; all three existing RAID1 arrays still contain both expected members. No replacement disk was observed and no remote configuration changed.
- **Evidence:** [p00-resume-preflight.json](evidence/p00-resume-preflight.json).
- **Decision / next permitted action:** Continue holding `P02`. After Hetzner completes the NVMe replacement, rerun the full read-only inventory, verify the new disk health/serial and rebind the exact destructive target before requesting the final reinstall-scope confirmation.
