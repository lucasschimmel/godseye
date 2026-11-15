# Proxmox host operations: backups, updates, health, firewall

Scope: the Proxmox host `godseye-wg` and the VM-level concerns of `VM 100/200/300` (DS02 to DS05, DS09, DS11, DS14).
Everything is installed by idempotent scripts in [`infra/dedicated-server/host/`](../../infra/dedicated-server/host/);
each script saves what it replaces under `/var/lib/godseye/rollback/<script>-<timestamp>/` on the host.
Results and dates: [host-hardening.md](evidence/host-hardening.md). Emergency access: [break-glass.md](break-glass.md).

Run a script from the workstation: copy `infra/dedicated-server/host/` to the target (the host cannot always fetch GitHub), then `bash <script>` as root.
Guests are reached through the same WireGuard SSH config.

| Script | Purpose |
| --- | --- |
| `h01-host-backup.sh` | Backup dataset, `local-backup` storage, nightly vzdump job, host-config backup, off-host timers |
| `h02-restore-drill.sh [100\|200\|300]` | Restore the newest archive to a scratch VMID on an isolated bridge, boot-check, destroy |
| `h03-update-policy.sh host\|pro\|games\|work` | Unattended security updates, reboot windows, bounded journald, update status helper |
| `h04-host-health.sh [--scrub-now]` | 15-minute health snapshot to the status file, logrotate, scrub-schedule check |
| `h05-external-scan.ps1` / `h05-guest-network-tests.sh` | Public IPv4/IPv6 closed-port scan; guest egress, MTU and isolation matrix |
| `h06-firewall-hardening.sh apply\|commit\|ssh-harden\|rollback` | Guard nftables table with auto-rollback; SSH daemon limits |
| `h07-break-glass-drill.sh` | Second-peer path and peer revocation proof |
| `h08-offhost-credentials.sh` | **Owner:** store the Backblaze key for off-host backups |
| `h09-offhost-selftest.sh` | Off-host pipeline proof against a local repository |

## 1. Backups (DS09)

Schedule (UTC), chosen so nothing overlaps pgBackRest (03:30) and the games backup (04:00):

| Time | What | Where | Retention |
| --- | --- | --- | --- |
| 01:30 daily | Host configuration archive (`/etc/pve`, network, nftables, WireGuard, SSH host keys, units, package list, ZFS properties, VM configs) | `rpool/backup/host-config` (root-only) | 14 newest |
| 02:00 daily | vzdump of VM 100, 200, 300, snapshot mode with guest-agent filesystem freeze, zstd (2 threads, 256 MiB/s cap) | `local-backup` = `rpool/backup/vzdump` | last 2 plus 1 weekly |
| 05:15 daily | Newest host-config archive to the encrypted restic repository | Backblaze B2 `host/` prefix | 14 daily, 8 weekly, 6 monthly |
| Sunday 05:30 | Newest vzdump archive per VM to restic, plus a 2% data integrity check | Backblaze B2 `host/` prefix | last 2 sets |

`rpool/backup` has a 60 GiB quota so backups can never push the pool past the 36% reserve planned in DS03.
Archives contain WireGuard/SSH/pmxcfs private keys on purpose (they are needed to rebuild): they never leave the host unencrypted
and must never be copied into a repository.

Off-host leg: needs the owner key (`h08-offhost-credentials.sh`) and the escrowed restic passphrase. Until then
`/var/lib/godseye/status/offhost-backup.json` says `not_configured` and the health file carries a warning.

Restore procedures

- One VM to a new VMID (never over the original): `h02-restore-drill.sh <vmid>` shows the exact commands (`qmrestore <archive> <new vmid> --storage local-zfs --unique 1`). For a real recovery restore under the original VMID only after stopping and removing the broken VM.
- From off-host: `export $(cat /etc/godseye/offhost-backup.env)`, `export RESTIC_PASSWORD_FILE=<file with the escrowed passphrase>`, `restic snapshots`, `restic restore <id> --target <dir>`.
- Replacement host: install Proxmox from rescue ([p02-prepare-and-install.sh](../../infra/dedicated-server/p02-prepare-and-install.sh)), restore `/etc/wireguard`, `/etc/nftables.conf`, `/etc/network` and `/etc/ssh` from the host-config archive, restore `/etc/pve/qemu-server` and `storage.cfg`, then restore each VM archive. Host rebuild from backup has not been drilled end to end (open DS14 item).

## 2. Update policy (DS02, DS11)

| Target | Unattended | Blacklisted from unattended | Reboot |
| --- | --- | --- | --- |
| Host | Debian-Security only, daily | Proxmox, ZFS, kernel, boot loader, WireGuard, nftables packages (applied by hand, see below) | Manual, attended window below |
| pro VM | Debian and Debian-Security, daily | PostgreSQL, Redis, Caddy, Docker/containerd, runsc, OpenBao, Jenkins, pgBackRest | **Manual only**: OpenBao must be unsealed by the owner after boot |
| games VM | Debian and Debian-Security, daily | Docker, containerd | Automatic Monday 05:30 UTC only if `reboot-required` is set and load is below 1.0 |
| work VM | Debian and Debian-Security, daily | Docker, containerd, Jenkins | Automatic Tuesday 05:30 UTC only if `reboot-required` is set and load is below 1.0 |

Windows (UTC): games Monday 05:30, work Tuesday 05:30, host and pro Sunday 09:00 to 11:00 attended (first Sunday of a month, or sooner for a critical
CVE). A host reboot restarts every VM, so it always counts as the pro window; announce it, make sure the OpenBao shares are at hand, and
reboot nothing else in the same week. No script reboots the host or pro VM.

Manual monthly host update (attended): `apt-get update`, review `apt-get -s dist-upgrade`, run it, then (kernel/ZFS/PVE changes) reboot in the window, run `h04` output check and `h05-guest-network-tests.sh` for each guest, confirm `https://godseye.lucasschimmel.fr/healthz`.

Repository trust: every enabled APT source has a `Signed-By` keyring (Debian archive keyring, Proxmox archive keyring); `h03` refuses `trusted=yes`/insecure options and sets
`Acquire::AllowInsecureRepositories "false"`. The Proxmox enterprise repositories stay disabled (no subscription). The package set is not hash-pinned: updates follow the signed Debian/Proxmox archives.

Time: chrony on the host and all guests (NTP synchronized, checked in the health file). Logs: journald is capped (500 MiB host, 300 MiB guests, one month, 1 GiB free space kept); `godseye-host-health.jsonl` rotates weekly, eight copies. Status files hold no secrets by construction (no environment, no keys; SMART serials only).

## 3. Host health status file (DS11)

`/var/lib/godseye/status/host-health.json` (mode 0644, rewritten atomically every 15 minutes by `godseye-host-health.timer`). The external observer should fetch it over WireGuard SSH:
`ssh godseye-wg cat /var/lib/godseye/status/host-health.json`, treat `status` (`ok`, `degraded`, `critical`) and `alerts[]` as the contract, and alarm on a stale `ts` (older than 45 minutes).

Fields: `pool` (health, capacity), `scrub` (last completed, age, errors), `arc` (size, maximum, hit ratio), `drives[]` (SMART policy; Samsung `0x04` is accepted only as the documented warranty flag), `backups` (age of the newest vzdump per VM and host-config archive, backup dataset use, off-host state), `time`, `network` (firewall tables and default-drop policies present, WireGuard handshakes), `guests` (VM state plus each guest's update status through the QEMU guest agent), `host_updates`.
Critical: unhealthy pool, pool over 85%, failed SMART policy, any backup older than 36 h, firewall policy missing, VM 100/200 not running, scrub errors. Warning: pool over 70%, no scrub for 45 days, backup dataset over 80% of quota, off-host backup not configured, reboot pending over 14 days, clock drift over 1 s, no WireGuard handshake in 7 days.
Scrub: Debian's `/etc/cron.d/zfsutils-linux` scrubs `rpool` on the second Sunday of each month; `h04 --scrub-now` starts one on demand.

## 4. Network matrix (N01 to N08)

Effective policy, enforced in `/etc/nftables.conf` (`godseye_filter`, `godseye_nat`) plus the drop-only `godseye_guard` table:

- Host input: only UDP/51820 from the Internet and everything from `wg0`; public ICMP and ICMPv6 limited to diagnostic/PMTUD types, echo rate-limited (10 per second); router adverts and redirects dropped; `rpcbind` disabled.
- Forward: Internet to pro only TCP 80/443 on the shared IPv4 (DNAT); no inbound IPv6 to guests except ICMPv6 errors and rate-limited echo; guests may only source their own subnet/`/128` (anti-spoofing); ULA never leaves the uplink; the single guest-to-guest exception is pro to work TCP/22.
- Expected scan result from outside (`h05-external-scan.ps1`): `65.108.38.218` has only 80 and 443 open; `2a01:4f9:3080:344e::{2,100,200}` have nothing open; `22, 5432, 6379, 8006, 8080, 8200` closed everywhere.
- Publishing an AAAA record or any new port needs a recorded justification (N01, N05); add the port in `/etc/nftables.conf`, rerun `h05-external-scan.ps1` and the guest tests, and update the expected list in the script.
- After any firewall change: `h06-firewall-hardening.sh`-style procedure: schedule a rollback timer first, keep the current SSH session, test from a second session, then cancel the timer.
