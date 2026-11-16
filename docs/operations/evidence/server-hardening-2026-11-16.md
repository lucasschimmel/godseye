# Server hardening wave, 2026-11-16: sanitized evidence

Date: 2026-11-16 (UTC), run from the owner's workstation over WireGuard. No secret, share or root token was used or printed. Ledger entries 018 to 021 in [dedicated-server-execution.md](../dedicated-server-execution.md) summarize this file. Scripts: [`infra/dedicated-server/guest/`](../../../infra/dedicated-server/guest/) and `p10-*`, `p12-*` in [`infra/dedicated-server/`](../../../infra/dedicated-server/).

## 1. B2 restore drill for per-cell PG18 stanzas, then teardown (DONE)

- The Backblaze cap had reset (first read after midnight UTC succeeded).
- `p11-cells-restore-drill.sh ed074ea0-... g_ed074ea0c4bc48afb0ea738feba5cb26_app drill_records 5003 c91f152e6583c2af9fba7383beeb8ff4` restored backup `20261115-181715F` from the off-host repository into a new quota-bound allocation (about four minutes through B2), replayed WAL, and reported `restored: 5003 c91f152e6583c2af9fba7383beeb8ff4; in_recovery=f` and `RESULT PASS: row-level verification matches the source`. The drill allocation removed itself.
- `p11-cells-teardown.sh` for both disposable cells A (`ed074ea0-...`) and B (`9162404e-...`): timers and units stopped, stanza and backups deleted from B2 (`stanza-delete`), OpenBao escrow copy removed, storage quota and configuration destroyed through the root helper. The harness secrets and receipts under `/var/lib/godseye/cells-proof` were shredded.
- Accounting after: `/srv/godseye/pg` (the `scsi1` XFS volume) holds no project quota entries, `df` 2.4 GiB used of 120 GiB (XFS metadata); `/etc/godseye/pg` contains only the host files; PostgreSQL 17 `main` online; no failed units (three stale `failed` units of the old cells were reset); `rpool` 28.0 GiB allocated of 472 GiB, `rpool/backup` 12.5 GiB of its 60 GiB quota.
- Not done: the small stanza of the very first test cell `414cc5e5-83d1-48a3-8896-2ed69ae8b165` (about 5 MB) remains under the `cells/` prefix of the bucket; its configuration no longer exists on the server, so it needs the Backblaze console (delete the folder `cells/414cc5e5-...`).
- Finding: the first teardown of cell B ended after the stanza-delete step when run in a pipe with a long-lived SSH session; rerunning it completed (the script is idempotent).

## 2. Edge: 404 for unknown hosts and the on-demand TLS guard (DONE)

`p10-install-edge-caddy.sh` (now writes a rollback copy of the Caddyfile and start script under `/var/lib/godseye/rollback/p10-install-edge-caddy-<timestamp>/` and restores them if `caddy validate` fails) was run with the existing locally built image ID and `GODSEYE_WG_BIND=10.20.1.11`; the container `godseye-edge` was recreated (about five seconds of interruption).

| Check | Result |
| --- | --- |
| `https://godseye.lucasschimmel.fr/healthz` from the workstation | `godseye-edge-ok` (200) |
| `https://console.godseye.lucasschimmel.fr/healthz` over WireGuard | 200, `/` 200, `/api/v1/health` 200 |
| Unknown `Host` over HTTP on the public listener | **404** (was an empty 200) |
| Unknown host over HTTPS | TLS handshake refused (no certificate, on-demand `ask` denies it) |
| Known host over HTTP | 308 redirect to HTTPS |

A stray container `hungry_satoshi` (`caddy file-server --listen :443 --root /tmp`, left from the earlier failed edge attempt, no published port) was stopped; it auto-removed.

## 3. In-guest firewalls, LLMNR, work-VM egress (DONE; guest reboots passed, pro and host reboot held: see section 8)

### Inbound firewall (`guest/g01-guest-firewall.sh`)

One table `inet godseye_guest`, input policy drop, no `flush ruleset` (Docker's iptables-nft tables are untouched), rollback timer armed before loading, persistence by `godseye-guest-fw.service` (ordered before `network-pre.target`). Applied in this order with a new SSH session as the proof before `commit`: games, pro, work.

| Guest | Allowed inbound |
| --- | --- |
| all | loopback, established/related, ICMP/ICMPv6 essentials (echo rate limited), SSH from `10.20.0.0/24` (WireGuard peers), the subnet gateway and `fd47:6f64:7365::/64` |
| pro | TCP 8080 (Jenkins UI) from WireGuard peers; TCP 4300/4301 from the edge bridge `172.30.0.0/24` |
| games | UDP 30000 (published container port; forwarded traffic never touches this chain) |
| work | SSH also from `10.20.1.10` (Jenkins controller) |

Proof after commit: new SSH sessions to all three, `console` 200, public `healthz` 200, Jenkins UI 200 from the workstation, OpenBao `8200` on the guest address now filtered (timeout; loopback unchanged), Jenkins node `godseye-work` online, `pro -> work:22` reachable, Luanti container up. `nftables.service` stays disabled (the distribution `/etc/nftables.conf` starts with `flush ruleset`).

### LLMNR (`guest/g02-disable-llmnr.sh`)

Drop-in `/etc/systemd/resolved.conf.d/10-godseye-no-llmnr.conf` (`LLMNR=no`, `MulticastDNS=no`) on pro, games and work: port 5355 no longer listens, name resolution still works.

### Work-VM egress allowlist (`guest/g03-work-egress.sh`, domains in `guest/work-egress-domains.txt`)

Local dnsmasq (`godseye-egress-dns.service`, `127.0.0.1:53`) copies the addresses of allowlisted names into the nftables set `allowed4`; the output chain (policy drop, reject with admin-prohibited) allows DNS to the Hetzner resolvers only for the dnsmasq user, NTP, ICMP, established flows and TCP 22/80/443 to `allowed4`. IPv6 egress is dropped, AAAA answers are filtered. `verify` output before commit:

```
ALLOWED_OK  github.com, registry.npmjs.org, pypi.org, deb.debian.org  (200)
BLOCKED_OK  example.com, 1.1.1.1, www.google.com, neverssl.com, direct DNS to 8.8.8.8 (tcp),
            resolver reachable only through dnsmasq, pro:8080
WORK_EGRESS_VERIFY_PASS
```

Finding from the first full candidate build behind the allowlist (build 8, unit suite 1896 passed, `test:infra:lab` 4/4): `playwright install chromium` failed because `cdn.playwright.dev` answers 307 to `storage.googleapis.com` (Chrome for Testing). The host was added (it covers every public bucket; accepted exposure, recorded in the list) and `refresh` applied; a restart of the resolver causes a one-lookup blip, so refresh only between builds. Rollback of the whole change: `/usr/local/lib/godseye/g03-work-egress.sh rollback` on the work VM (restores the open egress and the systemd-resolved stub).
Known limit: DNS to the two upstream resolvers is unrestricted, so DNS tunnelling is not prevented.

## 4. Images pinned

- Luanti: `p08-games-luanti.sh` now requires `lscr.io/linuxserver/luanti@sha256:49f780ef...` (the digest `:latest` resolved to). A fresh game backup (`BACKUP_OK`) was taken, the container recreated; the image ID `0fdc6c4963d5` is unchanged and the world and port are intact.
- `alpine:3.21` (cell and isolation fixtures) pinned to `sha256:bc214871...` in `p05-ab-isolation-test.sh`, `p05-pro-runtime-setup.sh`, `p08-deploy-cells.sh`. The running fixture containers were not recreated (same image).
- The edge image is referenced by local image ID and built from digest-pinned builder/base images (unchanged).

## 5. Cell data safety (3b)

- `p12-install-snapshots.sh` (run): `godseye-cell-snapshot.timer` daily 01:40 UTC (before the 02:00 vzdump) tars `/etc/godseye`, `/etc/pgbackrest`, the cell units, `/usr/local/lib/godseye` and `/var/lib/godseye/state` to `/var/backups/godseye-snapshots` (root, 0700; 7 kept; `sha256` next to each). First run: 135,586 bytes, listing verified. They sit on `scsi0`, which vzdump covers (and so the off-host restic copy). PGDATA stays protected by the per-cell pgBackRest stanza.
- OpenBao raft snapshot job (`godseye-bao-snapshot`) is installed but its timer is disabled: it needs the snapshot-only AppRole, which only the owner can create (section 8).
- Read-only renderer AppRole: the code supports it (the renderer reads `/etc/godseye/openbao-role-id` and `openbao-secret-id`, today the control API's role); `p12-openbao-owner-setup.sh` plus policies in `templates/` create `godseye-bindings-render` (read `godseye/data/bindings/*` only). Blocked on the owner (admin token).

## 6. Per-cell ceilings and jobs units (4)

- `p10-install-jobs.sh` run: Inngest 1.52.0 verified against the pinned and the GitHub-published digest and installed to `/opt/godseye/artifacts/tools/inngest-1.52.0`, `godseye-jobs.service` and `godseye-redis@.service` installed (not enabled: they need the owner bindings and a real cell).
- `p12-cell-ceilings.sh` (new): persistent `CPUQuota`, `MemoryMax`, `MemoryHigh` (90 %), `MemorySwapMax=0`, `TasksMax` on a cell's PostgreSQL and Redis units. Proven on a transient unit (`150 %`, `512M` produced `CPUQuotaPerSecUSec=1.5s`, `MemoryMax=536870912`, `MemoryHigh=482344960`, `TasksMax=128`), not on a real cell.
- A real project cell through the control API was **not** provisioned: every provisioning route needs an owner passkey session, and per-profile quotas plus the first real project are owner inputs (`docs/development/dedicated-cells.md`). Control-API wiring of the ceilings is a code change (not done).

## 7. External observer

See ledger entry 020. The workflow now also checks that unknown hosts answer 404, that the console name resolves to a private address and does not answer from the Internet, and the console certificate expiry from Certificate Transparency (best effort). Finding: **no scheduled run has ever executed**; a `workflow_dispatch` run on `main` failed instantly with "recent account payments have failed or your spending limit needs to be increased", so GitHub Actions is blocked by billing on the owner's account.

## 8. Jenkins, reboots, capacity

Candidate #9 (SUCCESS, 20 min) behind the egress allowlist, the four Jenkins drills and the guest reboots (`godseye-games`, `godseye-work`; `p12-post-reboot-check.sh` passed 21 of 21) are summarized in ledger entry 020; `godseye-pro` and host reboots are held (OpenBao would stay sealed). Capacity figures and the recommendation are in ledger entry 021, owner steps in entry 022.
