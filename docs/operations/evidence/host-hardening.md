# Host hardening evidence (2026-11-15)

Sanitized record of the host and VM-level hardening run on `godseye-wg` (Proxmox VE 9.2, `pve`, kernel `7.0.14-29-pve`) and VMs 100/200/300.
Scripts: [`infra/dedicated-server/host/`](../../../infra/dedicated-server/host/). Operating procedures: [host-operations.md](../host-operations.md),
[break-glass.md](../break-glass.md). No key, token, passphrase or credential value appears here. This file is deliberately separate from the main execution ledger; the coordinator folds it in.

Proven means executed on the live host with the output described. Not proven is listed explicitly in section 8.

## 1. Backups (DS09)

| Check | Result |
| --- | --- |
| Local target | ZFS dataset `rpool/backup`, quota 60 GiB, lz4; PVE storage `local-backup` (`/rpool/backup/vzdump`) |
| Job | `godseye-vms` in `/cluster/backup`: VMs 100,200,300, 02:00 UTC, snapshot mode (guest-agent `fs-freeze`/`fs-thaw` seen in the log), zstd, retention `keep-last=2,keep-weekly=1`; `vzdump.conf`: `zstd: 2`, `bwlimit: 262144` |
| First run (manual, same parameters) | VM 100 `3.40 GB` in 13 min 26 s (200 GiB disk, sparse), VM 200 `715 MB` in 5 min 23 s, VM 300 `1.9 GB` in 1 min 22 s; "Backup job finished successfully"; guest stall during the freeze was not measured |
| Host configuration archive | `godseye-host-config-backup` daily 01:30 UTC, 45 `/etc/pve` entries, nftables, WireGuard (including the server key, so the archive is root-only and stays off the repository), SSH host keys, units, package list, ZFS properties; sha256 file; 14 generations |
| Off-host leg (restic to B2) | Pipeline **proven against a local restic repository** with the production scripts (`h09-offhost-selftest.sh`): config mode and vms mode succeed, `restic check --read-data-subset=2%` passes, the restored host-config snapshot matches its sha256, a wrong passphrase cannot open the repository. **Not yet connected to B2**: it needs an owner-created key (section 9). Status file `offhost-backup.json` says `not_configured` and `host-health.json` carries a warning until then |
| Timers | `godseye-host-config-backup.timer` 01:30, `godseye-offhost-backup-config.timer` 05:15, `godseye-offhost-backup-vms.timer` Sunday 05:30 (all UTC) |

### Restore proof (isolated, then destroyed)

`h02-restore-drill.sh` restored the newest archive of a VM to a new VMID on a throw-away bridge `vmbr99` (no uplink, no address, no route), with a new MAC, memory reduced to 2 GiB, `onboot 0`:

| Source | Scratch VMID | Restore time | Boot check | Cleanup |
| --- | --- | --- | --- | --- |
| VM 200 `godseye-games` | 9200 | 8 s | guest agent answered; Debian kernel `6.12.117`; root fs 79G; `/var/backups/godseye-games` present | VM destroyed, `vmbr99` removed, `qm list` shows only 100/200/300 |
| VM 100 `godseye-pro` | 9100 | 22 s | guest agent answered; root fs 197G (8.9G used) | same; no ZFS datasets for the 9000-range VMIDs remain |

Production VMs, bridges and firewall were not modified; the scratch VM never had network connectivity (`bridge link show master vmbr99` empty apart from its tap, no routes).

## 2. Update policy (DS02, DS11)

| Item | Result |
| --- | --- |
| Host | `unattended-upgrades` installed; origin restricted to `trixie-security`; blacklist for Proxmox/ZFS/kernel/boot/WireGuard/nftables; `Automatic-Reboot "false"`; dry run reports "Allowed origins ... trixie-security" and "No packages found" |
| Guests | Already had unattended-upgrades (Debian + Debian-Security). Added `51godseye-policy`: no auto-reboot, kernel cleanup, service blacklist (pro: PostgreSQL, Redis, Caddy, Docker, containerd, runsc, OpenBao, Jenkins, pgBackRest; games/work: Docker, containerd, Jenkins on work) |
| Reboot windows | pro and host: manual only, Sunday 09:00 to 11:00 UTC attended. games: Monday 05:30 UTC, work: Tuesday 05:30 UTC, each only if `reboot-required` is set and load below 1.0 (`godseye-reboot-window.timer`, verified present). Never the same day |
| Repositories | Every enabled source has a `Signed-By` keyring; no `trusted=yes`; `AllowInsecureRepositories false`; Proxmox enterprise repos disabled; keyring fingerprints recorded by the script run |
| Time | chrony on host and 3 guests: NTP synchronized, host stratum 3, offset about 0.15 ms |
| Logs | journald `SystemMaxUse` 500M host / 300M guests, 1 month, 1G free kept; `godseye-host-health.jsonl` rotated weekly x8 |
| Actually applied? | The policy is in effect (`unattended-upgrade --dry-run -d` on all four targets prints the intended origins and blacklist; `apt-config dump` shows the settings; timers listed). No security package was pending on any target, so no real unattended installation could be observed yet; `godseye-update-status` will record `unattended_last_install` after the first one. `godseye-work` already has a newer kernel installed than the one running (reboot pending since 00:16 UTC): it is rebooted by the Tuesday window if idle |

## 3. Firewall and IPv6 matrix (N01 to N08, DS04, DS05)

Finding before changes: the main table already enforced the intended exposure (only 80/443 to the shared IPv4, nothing for IPv6). Gaps found and fixed by the additive table `godseye_guard` (rolled out with a 300 s auto-rollback timer, new SSH session verified, then committed):

| Gap | Fix |
| --- | --- |
| All ICMPv4/ICMPv6 types accepted from the Internet on the host and forwarded to guests, no rate limit | Only diagnostic and PMTUD types, echo limited to 10/s; RA/redirect dropped; link-local ICMPv6 never forwarded |
| No source validation on guest bridges | `vmbrN` may only emit its own IPv4 subnet and its own routed IPv6 /128 (work has no public IPv6). Test from `godseye-work` with forged sources `10.20.1.77` and `2a01:4f9:3080:344e::dead`: both dropped (counters `2` packets each); legitimate IPv4 egress unaffected |
| `rpcbind` listened on `0.0.0.0:111` | Disabled and masked (no NFS use) |
| SSH daemon forwarded X11/agent, 6 tries, 120 s grace | `50-godseye.conf`: no X11/agent forwarding, 3 tries, 20 s grace, keepalive, key-only; new session verified |
| `accept_ra` observed as 1 although the sysctl file said 0 (route is static via `fe80::1`, forwarding on, so the kernel ignored RAs) | Set to 0 at runtime and persisted (`98-godseye-no-ra.conf` and the guard unit) |

Persistence: `godseye-nft-guard.service` (After/PartOf `nftables.service`) reloads the table; restart of the unit verified. A full host reboot was **not** performed (it restarts all VMs, attended window only).

### External scan (outside the host and WireGuard; IPv4 and IPv6 from the workstation's ISP)

`h05-external-scan.ps1`, TCP connect scan of 22, 25, 53, 80, 111, 443, 3128, 4300, 4301, 5355, 5432, 6379, 8006, 8080, 8200, 8201, 30000:

| Target | Before guard | After guard (and persisted) |
| --- | --- | --- |
| `65.108.38.218` | 80 and 443 open, all others closed/filtered, ICMP echo answered | identical; `https://godseye.lucasschimmel.fr/healthz` returns `godseye-edge-ok` |
| `2a01:4f9:3080:344e::2` (host) | everything closed, ICMPv6 echo answered | identical |
| `2a01:4f9:3080:344e::100` (pro) | everything closed, echo answered, `https://[::100]/` no connection | identical |
| `2a01:4f9:3080:344e::200` (games) | everything closed, echo answered | identical |

Required closed ports 22, 5432, 6379, 8006, 8080, 8200: closed on all four addresses. 0 failures in both runs. UDP is not scanned (a closed UDP port cannot be distinguished from filtered); the only accepted UDP input rule is 51820 on the uplink, and no other UDP listener is reachable (the firewall input policy is drop).

### Guest matrix (`h05-guest-network-tests.sh`, run inside each VM, before and after)

| Guest | Checks passed | Failed |
| --- | --- | --- |
| pro (`10.20.1.10`, `::100`) | 22 | 0 |
| games (`10.20.2.10`, `::200`) | 22 | 0 |
| work (`10.20.3.10`, ULA only) | 19 | 0 |

Covered: IPv4 and IPv6 ICMP, IPv4-only destination (`ipv4.google.com`), IPv6-only destination (`ipv6.google.com`), dual-stack destination over each family, source address is the routed /128 (pro, games), IPv6 egress **blocked** for work (ULA only, as designed), 1500-byte DF packets over IPv4 and IPv6, TCP to the host bridge address, host public IPv4, host WireGuard addresses on 22/111/3128/8006 (all blocked), guest to guest on IPv4 and IPv6 (blocked except the intended pro to work TCP/22, which passes).
Default family (N06): from pro and games the default path for a dual-stack site uses the routed IPv6 source; from work it uses IPv4 (`65.108.38.218`).

### MTU and ICMPv6

From outside: DF IPv4 packets of 1500 bytes reach the host (1472 payload), 1501 gets the local "needs fragmentation" answer, so the path MTU is 1500; IPv6 echo of 1500-byte packets (1452 payload) is answered by the host and by pro. Over WireGuard (MTU 1420): IPv4 1392 payload passes, 1393 does not; IPv6 echo of 1360 and 1450 payload bytes to `fd47:6f64:7365::1` is answered (fragmentation at the source after PMTUD). ICMPv6 destination-unreachable/packet-too-big/time-exceeded/parameter-problem remain accepted inbound and forwarded.

## 4. Emergency access (DS05, DS14)

`h07-break-glass-drill.sh` on the host: a temporary peer key was generated in tmpfs, added to `wg0` at runtime (`wg0.conf` untouched), a client interface was moved into a network namespace:
tunnel ping to `10.20.0.1` passed, handshake recorded, host SSH banner `SSH-2.0` and the Proxmox port `8006` reachable through the tunnel, pro VM SSH banner reachable; the peer was then removed: it disappears from `wg show`, the tunnel no longer passes ping or TCP/22. The 3 real peers (also persisted in `wg0.conf`) were unchanged; the temporary key was shredded. 8 of 8 checks passed.
Authorized keys on the host match the register: workstation admin `SHA256:hisiyHciFHxp8qE1YKqUuyhYNFBtjyMgM/vQR8F+hjc`, emergency `SHA256:+RMqYQflL5TR4dEkDDpByqifbXZ8kQIk6jjoAjEpyg4`, plus the Proxmox-generated `root@pve` RSA key.
Peers `laptop` and `mobile` show no handshake since the last host boot. Rescue and remote console are documented, not exercised. Details and rotation steps: [break-glass.md](../break-glass.md).

## 5. Host health (DS11)

The existing 15-minute timer was kept; `godseye-host-health.sh` is now a symlink to `godseye-host-health`, which writes `/var/lib/godseye/status/host-health.json` (0644, atomic). First run: `status: degraded`, `overall_ok: true`, one warning (off-host backup not configured). Contents verified: pool `ONLINE` 4%, ARC 2.4 GiB of a 4 GiB maximum (hit ratio 98%), both NVMe drives within policy (Samsung `0x04` accepted as the documented warranty flag), vzdump ages 0.1 to 0.2 h, host-config age 0.4 h, backup dataset 10% of quota, time synchronized, firewall tables and default-drop policies present, 3 WireGuard peers listed, guest update status for VM 100/200/300 collected through the QEMU guest agent (work: reboot required).
Scrub: the pool had never been scrubbed. Debian's cron scrubs on the second Sunday monthly (verified present, cron enabled); a first scrub was started and completed: `scrub repaired 0B in 00:00:12 with 0 errors on Sun Nov 15 18:02:49 2026`. The health file warns after 45 days without a completed scrub.

## 6. Capacity

`rpool` 472 G, 22 GiB allocated (4%); 300 GiB provisioned to VMs (thin) plus the 60 GiB backup quota = 360 GiB of 472 GiB, 24% free headroom, above the DS03 reserve.

## 7. Repository and commits

Branch `ops/host-hardening`. Scripts are idempotent and were deployed unmodified from the repository files (CRLF stripped on staging).

## 8. Not proven

- Off-host copy to Backblaze B2 (needs the key); restic passphrase escrow.
- First real unattended installation on any target; behavior of the guarded reboot timers when a reboot is actually due (games Monday, work Tuesday).
- A host reboot with the guard and sysctl persistence in place; Hetzner Rescue and remote console on the installed system; the real `laptop` and `mobile` peers.
- Bare-metal rebuild of the host from the archives (DS14).
- In-guest firewalls: the VMs have none (pro publishes ports on the private network, reachable from any WireGuard peer by design); not changed because another agent owns the pro services.
- LLMNR (`5355`) is listening in all guests (blocked from outside by the host firewall); not changed.

## 9. Owner inputs needed

1. Backblaze application key for host backups: name `godseye-host-restic`, bucket `godseye-backups-dab6e7328bfc` only, prefix `host/`, read and write. Then run `bash infra/dedicated-server/host/h08-offhost-credentials.sh` on the host (silent prompts).
2. Escrow the restic passphrase from `/etc/godseye/restic-password` offline (password manager and a printed copy). Without it the off-host copies are unreadable after a host loss.
3. Run the quarterly device drill from `laptop` and `mobile`, keep the emergency SSH private key offline and on the phone, enable TOTP for `lucas@pve`, and confirm the Hetzner Robot rescue key and remote-console request.
