# Per-cell PostgreSQL 18 deployment: sanitized evidence

Date: 2026-11-15 (UTC). Target: `godseye-pro` (VM 100). Design and protocol: [dedicated cells](../../development/dedicated-cells.md). No secret appears here; identifiers of the two disposable cells are random UUIDs. This file is not the main ledger; the coordinator folds it in.

## 1. Design check against reality

| Assumption in the templates | Reality | Decision |
| --- | --- | --- |
| ZFS child datasets with `quota` | The VM root is a 200 GiB ext4 virtual disk (`/dev/sda1`, backed by a zvol of the host `rpool`); the VM has no ZFS | Add a dedicated virtual disk and use XFS project quotas |
| `sudo` for privileged commands | `godseye-control-api.service` runs with `NoNewPrivileges=true`, so sudo cannot work from it | Socket-activated root helper with a closed verb set |
| Local repository dataset on the same host | Off-host Backblaze B2 repository already exists for the control stanza | Cells use it under `/cells/<allocation>` with a distinct cipher passphrase each |

Host change (rollback: `qm set 100 --delete scsi1`, then destroy the unused volume; copy of the previous VM config in `/root` on the host): `scsi1: local-zfs:vm-100-disk-1, 120G sparse, discard=on, ssd=1, iothread=1, backup=0, serial=GODSEYECELLS01`. Host pool `rpool` had 457 GiB free before; the mirror is unchanged. `backup=0` excludes live PGDATA from vzdump (the host-backup owner should know); cell recoverability is the per-cell pgBackRest stanza.

## 2. Software

- PGDG key fingerprint verified against `B97B 0AFC AA1A 47F0 44F2 44A0 7FCC 7D46 ACCC 4CF8`; repository pinned to priority 100.
- `postgresql-18` 18.7 (PGDG `18.7-1.pgdg13+2`) installed with no default cluster; `libpq5` upgraded to the PGDG 18.7 library (required by `postgresql-client-18`, no restart triggered).
- pgBackRest `2.60.0-1.pgdg13+1` unpacked to `/opt/pgbackrest-2.60.0`; the distribution `pgbackrest` stays 2.55.1 for the control stanza.
- PostgreSQL 17 control cluster: `MainPID 816` before and after every step (checked by the installer and again at the end); `pg_lsclusters` shows only `17 main`.
- Root helper bundle `/usr/local/lib/godseye/cell-helper.mjs` sha256 prefix `2a70de9ea114fac6`.

## 3. Privilege helper

`godseye-cell-helper.socket` (`/run/godseye-cell-helper.sock`, `root:godseye`, `0660`) activates `godseye-cell-helper@.service` per connection. Seventeen fixed verbs, UUID-validated allocations, helper-derived paths, no sudo. Unit-test coverage: `tests/cell-helper.test.ts` (rejects unknown verbs, traversal, NUL bytes, reading the cipher file, writing the status record, foreign configuration paths, unknown pgBackRest options and restore targets outside the cell storage root; refuses to destroy a running cell). Defects found and fixed while deploying: `NoNewPrivileges` in the helper unit removed `CAP_SETUID`; `@privileged` seccomp denial killed PostgreSQL on `chown` of its socket group; cell instances needed the `godseye` supplementary group for `unix_socket_group`; the runtime directory had to exist before the offline stanza creation.

## 4. Disposable cells A and B (real transports, real helper)

Provisioned with `ManagedPostgresProvider` (create, start, role/policy bootstrap) through the operator harness. Each cell: own unit, own TLS certificate, own HBA, eight roles, data quota 2 GiB, WAL quota 1 GiB, loopback ports 15432/15433.

| Proof | Result |
| --- | --- |
| Inspection | Both cells `running`, `quotaEnforced`, `independentInstance`, `privateNetwork`, `policyVerified` all true (limit read from the XFS project report) |
| Quota | Filling cell A past the data limit (unlogged table, 15 batches of about 128 MB): `53100 could not extend file ... No space left on device` at 2,145,800,192 of 2,147,483,648 bytes. During and after, cell B accepted DDL and writes and cell A still answered `SELECT 1`; `TRUNCATE` released the space (40 MB used) |
| Cross-cell denial | A's credentials against B with B's database, with A's database, and B's migration role against A: all denied (HBA binds role, database and TLS) |
| Role separation | `api` and `worker`: `CREATE TABLE` denied (`42501`) and `ALTER TABLE` denied; `api` has DML on the migration-owned table, `worker` has none (policy); `migration` can run DDL |
| Restart persistence | Cell A stopped (`inactive`) and started through the transport; row written before the restart read back; unit stays enabled |
| WAL volume finding | Before the stanza existed, WAL archiving failed, `pg_wal` filled its 1 GiB limit and cell A could not restart (`xlogtemp: No space left`), while cell B was unaffected. Fixed: the stanza is now created offline at provisioning (verified on the second pair of cells) |

XFS report after the proof (`xfs_quota -x -c 'report -p -b -h'`): each cell shows `pgdata` hard 2G and `pgwal` hard 1G.

## 5. Backups to the off-host repository

- One stanza per cell (`g_<allocation>`), `repo1-path=/cells/<allocation>`, AES-256-CBC with an independent 256-bit passphrase per cell. Passphrases are also escrowed in OpenBao at `godseye/cells/<allocation>/pgbackrest` (KV v2 version 1, written through the control AppRole; values never printed).
- `check` (archive) passed for both cells; full backups: cell A `20261115-181715F` (415 s, 5.4 MB in the repository, WAL `...05` to `...06`), cell B `20261115-182411F` (401 s, 5.2 MB). The duration is the wait for the backup-start checkpoint; `start-fast=y` is now part of the generated configuration (existing test cells were created before that change).
- `info` reports `status: ok`, `cipher: aes-256-cbc`, WAL range `...01` to `...08` for A.
- Timers installed per cell by the helper verb `timers`: weekly full (Sunday 02:30 UTC), daily differential (Monday to Saturday 03:30 UTC), hourly archive check (minute 17), randomized delay, `Persistent=true`. They were listed and fired once on enablement; they are disabled again on the disposable cells (see 7).

## 6. Restore drills

1. Off-host repository, held-style (new quota-bound allocation, throwaway server on a private socket, archiving off): the restore from B2 and the WAL replay worked twice (`restored log file ... from archive`, server consistent and accepting connections). The first attempt exposed that a restore server must run with at least the source's `max_connections` (fixed). The row comparison of that run failed only because the harness queried the wrong schema (application roles own a schema of their own); fixed in `p11-cells-restore-drill.sh`. The re-run was blocked, see 7.
2. Offline local repository (`p11-cells-restore-drill-local.sh`, same restore mechanics, new allocation with 2 GiB/1 GiB limits, source cell briefly stopped): restore 8 s; throwaway server; `SELECT count(*), md5(all rows)` on the restored copy equals the source: 5003 rows `c91f152e6583c2af9fba7383beeb8ff4` (5000 seeded before the backup plus 3 written after). **PASS**, row-level. The drill allocation and its quota were removed automatically.

## 7. Open issue: Backblaze daily transaction cap

After the proof runs the B2 account returned `AccessDenied: download bandwidth or transaction (Class B) cap exceeded` for every read. The cap resets at midnight UTC or can be raised in the Backblaze "Caps & Alerts" page. Consequences: the control stanza `main` shares the account (its next archive push or check may fail until the reset; its idle WAL backlog is small and the daily backup runs at 03:30 UTC, after the reset; at the last check `pg_stat_archiver` had zero failures); the full B2 row-level drill and the off-host teardown could not be repeated. The disposable cells are therefore kept, labelled `DISPOSABLE=1`, `HELD=1` in `cell.env` (the E08 detector skips held cells) and with their timers disabled. After the reset, finish with (as root on `godseye-pro`, scripts in `infra/dedicated-server`):

```
p11-cells-restore-drill.sh ed074ea0-c4bc-48af-b0ea-738feba5cb26 g_ed074ea0c4bc48afb0ea738feba5cb26_app drill_records 5003 c91f152e6583c2af9fba7383beeb8ff4
p11-cells-teardown.sh ed074ea0-c4bc-48af-b0ea-738feba5cb26
p11-cells-teardown.sh 9162404e-3401-4a67-a8d8-8a325ff9a28a
```

An earlier, destroyed test cell (`414cc5e5-83d1-48a3-8896-2ed69ae8b165`, first design iteration) left its small stanza (about 5 MB) under the `cells/` prefix of the bucket; it can be deleted from the Backblaze console or with `pgbackrest stanza-delete` once the cap is lifted. `stanza-delete` through the teardown script removes the stanzas of the two kept cells.

## 8. Control API wiring

- Backup of the service environment: `/etc/godseye/control-api.env.bak-pre-cells-20261115T184422Z` (root-readable only). Previous server bundle kept as `/opt/godseye/dist/control-api/server.mjs.bak-pre-cells`.
- The deployed platform is `feat/server-integration@51c6937`; `origin/develop` is 34+ commits ahead, including a control-database migration for custom domains, which must not be applied by this task. The running bundle was therefore rebuilt from `51c6937` plus only the cell patch (`git diff origin/develop..HEAD -- apps packages scripts package.json`, applied cleanly) with `scripts/build-api.mjs`; no migration, dependency or other behavior changed. sha256 prefix of the new bundle `50c6dcc88b5e85a6` (previous `3c196f09e303a269`). The next regular deployment of `develop` supersedes it.
- `GODSEYE_PG_CELLS_FILE=/etc/godseye/pg-cells.json` (`0600`, owner `godseye`) added; one restart of `godseye-control-api` (MainPID 18886 to 48846). `/api/v1/health` answered `{"status":"ok","mode":"server","serverConnected":true}` before and after; the journal shows `Private PostgreSQL cell providers are configured`; no errors followed. Edge, console, Jenkins, OpenBao and PostgreSQL 17 stayed active and were not restarted.
- Rollback: restore the environment backup and `server.mjs.bak-pre-cells`, `systemctl restart godseye-control-api`.

## 9. Not proven

- Held-recovery provider path (`replaceRestoredConfiguration`/`startPaused`) against the live host: the destination unit cannot read the source configuration (documented gap).
- Control-plane-driven provisioning of a real project cell (needs a project, preparation and admission; the harness used the same provider and transport classes directly).
- Per-cell CPU/memory ceilings, per-cell B2 keys, OpenBao broker delivery of role and repository material, cell Redis, notifier.
