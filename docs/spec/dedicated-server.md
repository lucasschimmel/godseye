# Dedicated-server infrastructure specification

Status: proposed installation contract, 2026-11-13. No remote inspection, installation, account creation, purchase or DNS mutation has been performed by this documentation task.

Owner: Lucas Schimmel. Target: the owner's Hetzner AX41 in Finland. This contract specializes E00 and the infrastructure/recovery parts of E12; it does not replace the application V1 specification or mark any qualification complete.

Authoritative companions: [installation plan](../plan/dedicated-server-installation.md), [placement decision](../adr/ADR-002-professional-vm-and-dual-stack.md), [isolation/data controls](isolation.md), [network contract](networking.md), [V1 scope](v1.md).

## 1. Facts, assumptions and required inventory

| Item | Current knowledge | Required before installation |
| --- | --- | --- |
| Provider/location/model | Owner reports Hetzner, Finland, AX41 | Robot server identifier, actual location and contract |
| Current OS | Owner reports Ubuntu26.04 after reset | Actual release, boot mode and current data inventory |
| CPU | AX41 product references identify Ryzen5 3600, six cores/twelve SMT threads | CPU model, virtualization flags, actual usable topology |
| Memory | Product references commonly list64GB DDR4 | MemTotal, available memory, health; do not equate marketed GB with usable GiB |
| Disks | AX41 and AX41-NVMe references differ: SATA and NVMe variants exist | Count/model/serial/bytes, SMART/NVMe health, wear, boot partitions and existing RAID |
| Addressing | One primary IPv4 and assigned IPv6 allocation expected | Robot assignment, upstream gateway/link-local scope, MAC/interface, MTU and routes |
| Recovery access | Not verified | Robot access, Rescue and available remote-console procedure independent of the workstation |
| External dependencies | Not selected/enrolled by this task | Domains/DNS provider, private admin devices, off-host backup target, recovery key custody and alert destination |

Collect read-only inventory first. Store sanitized evidence; private keys, recovery phrases, provider login values and access material remain outside Git. No live address, disk device name or destructive command is prescribed before this worksheet is complete.

Historical product descriptions are sizing references, not an observation of this machine. All hardware-dependent budgets below are conditional.

## 2. Required topology

```text
Hetzner AX41 — one bare-metal Proxmox VE installation
  + physical storage mirror, routing, host firewall, private management
  + professional VM
  |   + private G.O.D.S.E.Y.E console/control API and metadata PostgreSQL
  |   + private OpenBao, Coolify, registry/observability as qualified
  |   + HTTPS ingress for public registered application services
  |   + project/environment cells: apps + independent PostgreSQL/data/WAL
  |       + private files/identities + scoped Inngest/Redis/workflow state
  |       + development, production and each preview are distinct cells
  + games/personal VM — games and Discord bots
  + optional disposable work VM — isolated build/test/agent tools
```

There is no nested Proxmox and no ordinary project VM per project. No application, Jenkins executor, Hermes tool process or game server runs directly on the hypervisor. Professional-VM root/kernel/daemon compromise remains a shared failure boundary for professional projects; application sandboxes are not separate kernels.

Proxmox VE9 on its supported Debian13 base is the installation baseline to qualify. Pin the exact supported patch/kernel/repository combination immediately before installation. Replace the current Ubuntu installation through a recorded Rescue/installer procedure; do not attempt an Ubuntu-to-Proxmox package conversion. Select an approved repository/subscription arrangement without assuming a paid entitlement.

Permanent guests use a pinned supported Linux distribution, preferably Debian13 for consistency, subject to actual Docker/gVisor/application compatibility. Ubuntu guests are possible only through a separately recorded compatible profile. Hypervisor packages and guest distributions are independent decisions.

## 3. Storage and capacity

Preferred storage: a two-device ZFS mirror using direct disks when their health, boot support and memory budget qualify. Alternative: Debian software RAID1 with ext4/LVM-thin and separately enforced guest filesystem quotas, recorded before formatting. Never stack ZFS on an unqualified RAID abstraction; do not silently use RAID0. One host does not justify Ceph. A mirror and snapshots do not replace backups.

Create a versioned disk layout with stable serial/by-id mappings, UEFI/BIOS boot procedure, mirrored boot recovery, host root limits, VM storage and bounded snapshot/build caches. Test booting from each mirror member through provider-supported maintenance procedures. Do not simulate destructive disk loss on the only live production copy.

### Conditional planning envelope

| Layer | Memory proposal | CPU proposal | Storage commitment |
| --- | --- | --- | --- |
| Hypervisor/cache/headroom | At least8GiB initially, measured and adjusted for ZFS | Preserve host scheduling capacity | Host OS, images and bounded diagnostics |
| Professional VM |32GiB initial target |6vCPU exposed; initial sustained cap around3 physical-core equivalents | OS, control, every cell, WAL and local staging inside one admitted VM budget |
| Games VM |16GiB initial target |4vCPU exposed; initial sustained cap around2 core equivalents | OS, saves, mods and bounded bot/game logs |
| Disposable work VM | Up to8GiB, only from remaining usable memory |2vCPU exposed; initial sustained cap around0.5 core equivalent | Finite ephemeral disk; at most one heavy task |

CPU numbers are candidate ceilings to benchmark, not proven guarantees or additive dedicated cores. SMT threads are not twelve isolated cores. Preserve approximately0.5 core equivalent for host work, then revise against game latency and contention. A queued worker is preferable to consuming host or game headroom.

The old64GiB example is not a promise of64GiB usable RAM. Reserve host+professional+games first; the optional worker receives at most min(8GiB, measured usable RAM minus those reservations). Reduce/disable it if the measured envelope does not fit. Do not use memory ballooning or swap as permission to overcommit databases.

Admission uses measured usable capacity and commits disk maxima, not only current thin usage. Keep at least20% free usable host-pool capacity including snapshot growth, metadata and temporary builds. Cell quotas subdivide the professional VM allocation and are not counted again as additional physical guest disks.

Illustration only for a healthy roughly477GiB mirror:40GiB host/images +200GiB professional +80GiB games +20GiB worker +20GiB snapshot allowance =360GiB commitments. Accept this only if360GiB is within80% of the measured usable pool after relevant overhead; otherwise reduce it. Do not apply this example to unknown SATA capacity.

Inside32GiB professional memory, reserve control/ingress/monitoring capacity before admitting cells. Start with the existing4GiB production /2GiB development-or-preview aggregate service envelopes, then measure independent PostgreSQL, Inngest and runtime overhead. No project-count promise is made. Hermes model calls should initially be remote; Laya is a separately bounded, evaluated local decision service, not a large generative-model deployment.

## 4. Network and access contract

Public IPv4 target: one. Absolute ceiling: two, with a documented fixed-port/protocol incompatibility proving the need for the second. No automatic IP purchase. Private cells, databases and admin interfaces consume no additional public IPv4.

- The physical host owns the public uplink and NAT44/routing. Public TCP80/443 forwards to the professional ingress; game TCP/UDP forwards use an explicit non-overlapping registry.
- Public web projects share the professional ingress by hostname/SNI. A records point to the shared IPv4; AAAA records point to qualified ingress IPv6, not arbitrary application containers.
- Route selected provider-assigned IPv6 addresses to guests. Prefer separate host-managed guest links and explicit static guest /128 routes when qualified; choose the actual route design from the assigned prefix/gateway/MAC evidence. Do not split one assigned /64 into invented SLAAC /64 networks or copy it onto unrelated bridges.
- Project bridges use unique private IPv4 and generated ULA IPv6 subnets. Neither family permits lateral cells or access to management/games/task/backup networks by default.
- IPv6-first means use working IPv6 where supported, retaining IPv4 egress/client compatibility. Databases, Docker APIs and private dashboards remain private even when IPv6 addresses are globally routable.
- Preserve required ICMPv6 discovery/path-MTU functions. Qualify DNS resolution, return paths, NAT/hairpin behavior, forwarding and filters independently in both families, including after reboot.

| Source | Allowed destinations | Default denial |
| --- | --- | --- |
| Internet | Registered web80/443; exact game protocol ports; chosen VPN endpoint | Proxmox8006, SSH22, control/CI/Bao/Coolify UI, databases/Redis/Inngest admin, registry/admin/metrics |
| Owner private network | Exact administrative endpoints and scope | Arbitrary project-to-project transit |
| Professional cell | Its own DB/files/workflow endpoints and approved egress | Other cells, management, metadata endpoints, personal VM and backup custody |
| Games VM | Explicit game/bot egress, authorized telemetry | Pro control/cells, host management and backup repositories |
| Disposable runner | Exact source/registry/model destinations and returned artifacts | Production data, Docker socket, hypervisor keys and unrestricted LAN |
| Backup identity | Its scoped data/archive and assigned off-host repository | Other cells and independent recovery/deletion authority |

Management access uses WireGuard as the initial self-hosted private-access candidate, plus owner passkeys for G.O.D.S.E.Y.E and MFA for Proxmox/Robot where supported. Admin SSH is key-only through private access after a tested replacement session works. Root bootstrap is temporary; automation uses scoped API/service identities and separate emergency access. No ordinary daily account receives unrestricted cross-platform authority.

During installation, temporary bootstrap access is source-allowlisted and time-bounded, with both-family filtering applied before public management exposure. A VPN transition must not start from an unrestricted public8006/22 policy. Record and remove temporary exceptions after independent private access is verified.

A host-level private-access endpoint must remain usable when the professional VM fails; Rescue/console recovery must also work when the host VPN fails. Define the workstation-independent emergency procedure before closing bootstrap SSH. Public SSH must not remain as an undocumented permanent fallback.

Hetzner Robot filtering is an upstream layer, not the complete stateful guest/container policy. Record the selected Proxmox and Docker firewall backends/versions, input and forwarding chains and reboot persistence. Docker-published ports can bypass an assumed guest input-only policy: verify actual packets rather than relying on UFW or a stopped-container inspection.

## 5. Professional services and isolation

Docker/Compose is the application packaging baseline; gVisor systrap is the candidate application sandbox, requiring no nested KVM. Verify effective runtime on deploy/redeploy, read-only roots, non-root UID, capabilities, PID/CPU/RAM limits, filesystem quotas, mounts and dual-stack policy. Refuse unsupported profiles; no silent native fallback.

PostgreSQL and trusted infrastructure may use separately qualified native runtime profiles. Each project/environment owns its independent PostgreSQL instance, PGDATA/WAL, roles, backup scope and workflow installation state. The controller's metadata database is separate from application identities/data.

Only the trusted deployment broker has limited access to the deployment engine/daemon. Never mount the Docker socket into apps, build contexts or general agent tasks. Coolify is replaceable; documented runtime options are not proof that its rendered deployment enforces this contract.

Jenkins controller has zero executors and remains private. Untrusted repository builds and broad agent tools require the disposable work-VM boundary; if it is unavailable, queue or disable the operation. Keep registry publication, deployment and production material authority separate from checkout/build authority. Hermes and CI share one heavy-task admission budget, not simultaneous unbounded workers.

Infrastructure baseline acceptance does not pretend unfinished G.O.D.S.E.Y.E adapters are complete. Install only qualified components, expose unavailable providers honestly and keep normal mutation dispatch disabled until exact target/version/scope/epoch checks pass. Future Inngest/Hermes/Laya rollouts follow their feature gates.

## 6. Backups, recovery and operations

Inherited objectives remain targets to demonstrate: production DB RPO <=15minutes with healthy off-host WAL archiving; project RTO <=4hours on available replacement capacity; files/config RPO <=24hours. Hardware replacement lead time is separately reported. One AX41 provides no multi-host HA guarantee.

- pgBackRest: weekly full, daily differential, continuous WAL; at least two completed full generations and their dependent archives.
- Files/config: daily snapshots,14 daily copies initially; record timestamps separately from DB archive positions and explicitly assess gaps.
- Preserve owner recovery, OpenBao seal/unseal custody, configuration/IaC, control metadata, app identity/files and game saves. Copies/keys needed after total host loss must exist off-host and be usable without the failed PC/server.
- VM/PBS-style backups are complementary; do not use a running disk snapshot as sole proof of PostgreSQL recovery consistency. Do not place the sole backup on the same mirror, VM or physical host.
- Select an off-host repository with documented encryption/access/retention and independent deletion authority where supported. Compatibility, restore throughput and costs are unresolved until a specific destination is qualified; no purchase is authorized by this document.
- Restore into isolated held destinations. No jobs, agents, webhooks, mail or external side effects resume until explicit activation, lineage/journal coverage and source-producer fencing are verified. Never rewind live data as an image rollback.
- Keep emergency keys outside the system they recover; never publish them or archive plaintext material in Git.

Collect host/guest/cell CPU/RAM/disk/IO/latency, pool health, temperatures where supported, certificate expiry, backup/WAL freshness and queued-task pressure. Start from existing log7day/metrics30day/execution90day/audit180day targets within measured disk budgets. Use an external observer for whole-host loss; an alert process on the failed AX41 is insufficient.

Security updates have maintenance windows, rollback evidence and scheduled reboots. Record a pinned compatibility matrix, sanitized config hashes and exact observations after upgrades. Freeze new admission before disk/headroom exhaustion; existing reads/recovery stay observable where safe.

## 7. Acceptance register

All entries start **not executed**. Evidence must record timestamp, versions, exact target, expected/actual result and sanitized artifacts. Remote access and executed tests are not implied by this specification.

| ID | Observable acceptance | Link to V1 tests |
| --- | --- | --- |
| DS01 | Actual CPU/RAM/disk/health/routes and ownership inventory signed off; data preservation decision recorded | T03/T05/T31 |
| DS02 | Supported pinned Proxmox base, mirror health, reboot/boot recovery and emergency route proven | T05/T31 |
| DS03 | Pro/games/task VM boundaries and capped reservations reject overcommit without exhausting host | T02/T05/T36 |
| DS04 | One-IPv4 NAT/web/game paths and IPv6 routing pass independent positive/negative tests after reboot | T02/T13/T36 |
| DS05 | Admin services inaccessible from Internet through either family; independent private and Rescue access work | T01/T02/T31 |
| DS06 | A/B cells and pro/games/task deny matrix, runtime/mount/user/quota inspection survive redeployment | T02–T06 |
| DS07 | Per-cell DB/identity/workflow ownership and negative cross-cell authorization demonstrated | T06/T08/T20 |
| DS08 | Isolated builds have no prod authority; runner cancellation/absence prevents unsafe reuse | T11/T22/T24/T39 |
| DS09 | Off-host archive + files/auth/config recovery reaches objectives on a new held destination | T07/T08/T30/T31 |
| DS10 | Restore activation and unknown business-effect reconciliation fail closed when evidence is missing | T18/T23/T30/T31 |
| DS11 | Metrics, external outage alert, backup-age/pool-pressure and certificate alarms actually arrive | T25/T40 |
| DS12 | Two representative prod/dev projects, reference game load and bounded heavy task pass a72-hour soak | T05/T36 |
| DS13 | G.O.D.S.E.Y.E provider admission matches actual target/version/ownership; no local fixture qualifies server authority | T09/T34/T37 |
| DS14 | Replacement-host recovery runbook, key custody, compatibility evidence and residual limits are reviewable | T31/T34 |

Host baseline requires DS01–DS06 and DS11. Actual hosting additionally requires DS07–DS09, DS12 and DS13. Full V1 recovery/operations also requires DS10/DS14 and every applicable product release gate; staged acceptance never silently drops these requirements.

## 8. Source notes and unresolved choices

Official sources checked2026-11-13. Documentation supports mechanisms, not this machine's qualification. The direct Proxmox installation chapter/wiki fetch returned403 during research; its vendor requirements, vendor FAQ source and Hetzner official installation tutorial were accessible. Recheck the exact installation instructions before execution.

1. [Hetzner AX41 product reference](https://www.hetzner.com/fr/dedicated-rootserver/ax41/) and [minimum hardware configurations](https://docs.hetzner.com/de/robot/dedicated-server/dedicated-server-hardware/minimum-hardware-configuration/): variants require actual inventory.
2. [Hetzner official Proxmox installation/routing tutorial](https://community.hetzner.com/tutorials/install-and-configure-proxmox_ve/): Debian13 installation path and provider-specific networking.
3. [Proxmox hardware requirements](https://proxmox.com/en/products/proxmox-virtual-environment/requirements) and [vendor FAQ source](https://github.com/proxmox/pve-docs/blob/master/pve-faq.adoc): installation/storage baseline and supported generation mapping.
4. [Hetzner address routing](https://docs.hetzner.com/robot/dedicated-server/ip/additional-ip-adresses/) and [Robot firewall](https://docs.hetzner.com/robot/dedicated-server/firewall/): assigned addressing and separate IPv6 filtering.
5. [Docker packet filtering](https://docs.docker.com/engine/network/packet-filtering-firewalls/): bridge publishing, forwarding and firewall backend behavior.
6. [gVisor platforms](https://gvisor.dev/docs/user_guide/platforms/): systrap platform choice.
7. [Coolify Docker options](https://coolify.io/docs/applications/builds/custom-docker-options): runtime-selection surface requiring effective inspection.

Still unresolved: actual disk variant/health/usable capacity, precise provider routes, domains/private-access devices, off-host destination, game workloads/port requirements, exact pinned versions and measured compatible profiles. Resolve these through the plan before activating dependent services.
