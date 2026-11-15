# Dedicated-server project cells

Status: installed and proven on the dedicated server with two disposable cells (evidence: [cells-deploy](../operations/evidence/cells-deploy.md)). Every default stays `unconfigured`; the cell providers exist only when a private binding file selects them. This extends [project databases](project-databases.md) and [PostgreSQL recovery](postgresql-recovery.md); owner decision: project cells run PostgreSQL 18 (PGDG) with pgBackRest 2.60, while the control database stays on PostgreSQL 17 with the distribution pgBackRest 2.55.

## Storage and quota decision

The first design assumed ZFS child datasets with `quota`. The pro VM does not own a ZFS pool: its root is an ext4 virtual disk (`/dev/sda1`, backed by a zvol of the host's `rpool`). Options considered:

| Option | Result |
| --- | --- |
| ZFS inside the guest | Needs a DKMS module on a cloud kernel, its own ARC memory and double copy-on-write on top of the host's ZFS. Rejected. |
| ext4 project quotas on the root disk | The `project` feature cannot be enabled on a mounted root file system (offline `tune2fs`), and a full cell would still share the root device with the platform. Rejected. |
| **Dedicated virtual disk, XFS with `prjquota`** | Chosen. `qm set 100 --scsi1 local-zfs:120,discard=on,ssd=1,iothread=1,backup=0,serial=GODSEYECELLS01` adds a 120 GiB sparse disk (the mirror and the host pool layout are unchanged). It is formatted XFS, mounted at `/srv/godseye/pg` with `prjquota,noatime,nofail`, and every cell directory (`data`, `wal`, optional `repo`) is its own XFS project with a hard block limit. |

Why XFS project quotas: the limit is a hard kernel limit per directory tree (ENOSPC for the cell, never for its neighbours), it survives restarts and remounts (`/etc/projects`, `/etc/projid`), it is readable (`xfs_quota -x -c 'report -p -b'`), it needs no extra kernel module, and a runaway cell can no longer fill the platform's root file system. `backup=0` keeps crash-inconsistent VM snapshots of live PGDATA out of vzdump; cell recoverability is physical pgBackRest backups to the off-host repository. `fstrim.timer` returns freed blocks to the sparse zvol.

## Per-cell PostgreSQL transport

`ServerPostgresTransport` (`packages/core/src/database-server-transport.ts`) is the server `PostgresInstanceTransport`; `ServerPgBackRestTransport` (`recovery-server-transport.ts`) is the matching `PgBackRestTransport`. Both act only through the `CellHostExecutor` interface (`cell-host.ts`): one call per fixed helper verb, no shell, no caller-chosen path or command.

| Aspect | Design |
| --- | --- |
| Instance | `godseye-pg@<allocation>.service` ([template](../../infra/dedicated-server/units/godseye-pg@.service)); creation refuses to adopt existing state |
| Storage | `<mountRoot>/<allocation>/{data,wal}` on the XFS volume, one XFS project each (`pgdata-<id>`, `pgwal-<id>`, optional `pgrepo-<id>`) with `bhard == bsoft`; `initdb -X` places WAL on its own limited directory. Inspection reads limit and mount back from the quota report, never from names |
| Isolation | Cells share the `postgres` UID, so the unit uses a private mount namespace (`TemporaryFileSystem` + `BindPaths`): other cells' data, configuration and sockets are invisible to a cell process. Each cell has its own TLS key, HBA and roles; cell instances join the `godseye` group only so the Unix socket can be group-readable by the control user |
| Network | PostgreSQL listens only on the configured loopback or private-bridge address (`127.0.0.1`, ports 15432-15531 on the pro VM); HBA is `hostssl` + SCRAM per role and database for private CIDRs, explicit rejects, bootstrap role only on the Unix socket |
| TLS | per-cell certificate from a private cell CA (`godseye-pg-issue-cert`); SAN covers the verified server name and the bind address; the public CA certificate is `/etc/godseye/pg/cells-ca.crt` |
| Backups | one stanza per cell (`g_<allocation>`) in the off-host Backblaze B2 bucket under `/cells/<allocation>`, client-side AES-256-CBC with a per-cell passphrase, WAL archiving through pgBackRest 2.60. The stanza is created offline at provisioning (see below) |
| Qualification | `hostQualification` is a live helper probe (XFS with project quotas, template unit installed, `postgres` 18.x, `pgBackRest 2.60`, certificate helper) with a five-minute expiry. Recovery qualification stays `null` until an independent per-scope attestation exists |

### Stanza at provisioning (lesson from the proof)

WAL archiving is enabled from the first start. If the stanza does not exist yet, every segment fails to archive, `pg_wal` grows until its hard quota is reached and PostgreSQL then cannot write `xlogtemp` any more: the cell does not restart by itself. This happened to the first test cell. Provisioning now runs `pgbackrest --no-online stanza-create` right after `initdb`, before the first start. Recovery from a full WAL volume is manual: archive the completed segments with `pgbackrest archive-push` (or enlarge the WAL limit with `xfs_quota`), then start the unit.

## Privilege model: socket-activated root helper

There is no sudo. `godseye-cell-helper.socket` listens on `/run/godseye-cell-helper.sock` (`root:godseye`, `0660`); each connection runs `godseye-cell-helper@.service`, a root process executing the bundle `/usr/local/lib/godseye/cell-helper.mjs` (a root-owned copy of `apps/control-api/src/cell-helper-main.ts`; `/opt/godseye` is writable by the deploy user and is never executed as root). The control API keeps `NoNewPrivileges=true` because it only talks to a socket. The helper unit itself must not set `NoNewPrivileges` (it removes `CAP_SETUID`, which the helper needs to run `initdb` and pgBackRest as `postgres`).

Protocol: one JSON line `{verb, args, stdin}` in, one JSON line `{code, stdout}` out. The closed verb set (`HELPER_VERBS`) is implemented in `packages/core/src/cell-helper.ts`:

`host-probe`, `cells-list`, `file-read`, `file-write`, `storage-create`, `storage-resize`, `storage-inspect`, `storage-empty`, `cell-dirs`, `cert`, `initdb`, `unit`, `timers`, `pg-isready`, `pg-controldata`, `pgbackrest`, `destroy`.

Rules: allocation arguments must be lowercase UUIDs; every path is derived from the root-owned host configuration `/etc/godseye/pg/host.json` (the helper refuses to run when it is writable by others) plus the UUID; file reads/writes are limited to a table of named kinds with fixed owner/mode (the cipher environment file is write-once and not readable; the backup status record is read-only); `pgbackrest` accepts only five commands and a fixed set of option shapes (config/stanza must match the named cell; restore targets must be `<mount>/<uuid>/{data,wal}`), runs as `postgres` and loads the cipher passphrase and storage credentials itself from root-owned files, so no secret crosses the socket or appears in argv; `destroy` refuses a running cell and removes only paths derived from the UUID. `apps/control-api/src/cell-host-process.ts` is the client (`HelperSocketExecutor`).

## Backup schedule and alerts

Host timers (`godseye-pg-backup-{full,diff,check}@<allocation>.timer`): weekly full (Sunday 02:30 UTC), daily differential (Monday to Saturday 03:30 UTC), hourly archive check, with randomized delay and `Persistent=true`; the helper verb `timers` enables them when a cell starts and disables them when it stops. The runner `godseye-pg-backup` records `/var/lib/godseye/pg-backup/<allocation>.json`. `backupScheduleDetector` (`backup-schedule.ts`) reads those records through the helper (`file-read backup-status`) and raises E08 `archive-lag` incidents for a failed/overdue archive check, a missing weekly full or a missing daily differential (tolerance 1.5x the interval). A missing record is raised as unknown, never healthy. The control database stanza `main` uses its own units (`godseye-pgbackrest-*`) and the distribution pgBackRest.

## Jobs, Inngest and per-cell Redis

`godseye-jobs.service` runs `dist/jobs-runtime/server.mjs` as `godseye` after PostgreSQL/Redis/OpenBao with `Restart=on-failure` and systemd back-off (`RestartSteps`/`RestartMaxDelaySec`), hardening and an IP allow-list restricted to loopback and private ranges. Environment entries: `GODSEYE_MODE=local`, `GODSEYE_JOBS_RUNTIME=autonomous`, `GODSEYE_INNGEST_CELLS`, plus the private control/storage/platform bindings and `NODE_EXTRA_CA_CERTS` for the cell CA. `p10-install-jobs.sh` installs the pinned, digest-checked Inngest 1.52.0 Linux binary and a per-cell Redis template (AUTH, AOF `always`, `noeviction`, TLS-only). Cell Redis is not part of the PostgreSQL deployment proof.

The loopback-only workflow-storage rule is relaxed by `workflowEndpoint` (`apps/control-api/src/workflow-endpoint.ts`): a non-loopback endpoint must be an RFC1918/ULA IP literal (no DNS names) and must use verified TLS (PostgreSQL `sslmode=verify-full` with optional absolute `sslrootcert`, Redis `rediss:`); no other connection parameters. Reuse detection keys on host plus port.

## Application store

`openApplicationStore` accepts `tls: { ca, servername? }` (verify-full semantics, plain URL only) and `migrationDatabaseUrl`: a separate migration identity runs DDL and seeds scope, then closes; the runtime identity only needs DML and `SELECT` on the scope row. A non-loopback URL without TLS options is refused.

## Wiring

`apps/control-api/src/cell-providers.ts` builds `ManagedPostgresProvider`, `ManagedPgBackRestProvider` and the backup detector only when `GODSEYE_PG_CELLS_FILE` names a private `0600` JSON binding (`providerId`, `targetId`, `generation`, `secretsDirectory`, and `host` = the content of `host.json`); `server.ts` spreads the result into `InfrastructureEngine` and logs one line when the providers are configured. Without the variable nothing changes. The interim role/repository material store is a private file directory; the OpenBao broker implementations remain the intended production path. The operator harness `apps/control-api/src/cells-proof-cli.ts` (bundled by `scripts/build-cell-helper.mjs`) drives the real transports for disposable cells; `infra/dedicated-server/p10-install-pg-cells.sh`, `p11-cells-escrow-cipher.sh` and `p11-cells-restore-drill.sh` install, escrow and drill.

## Lifecycle orchestrator (not implemented)

Physical suspend/resume of a whole project is not coded. Intended shape, to be built on Foundation plans: one plan per environment with ordered, individually journaled steps. Suspend: stop applications, drain/stop the jobs cell, `ServerPostgresTransport.stop` (disables timers first), then Redis. Resume: reverse order, each step gated by an inspection (`inspect`, Redis `INFO`, jobs health) before the next. Metadata-only suspension in `project-lifecycle.md` remains the current behavior.

## Remaining gaps

- Per-cell CPU/memory ceilings are not applied (`systemctl set-property` from the admitted profile).
- One B2 application key is shared by the control stanza and all cells (`/etc/godseye/pg/b2.env`, root-only, loaded by systemd): a compromised cell process can read it from its own environment and touch every stanza in the bucket. A per-environment key restricted to the `cells/` prefix (or per-cell keys from the broker) is the next hardening step.
- Cipher passphrases are escrowed in OpenBao (`godseye/cells/<allocation>/pgbackrest`) but the live copy is the root-only `archive.env` and the private file store; the broker delivery path is not wired.
- The held-recovery provider path (`replaceRestoredConfiguration` + `startPaused`) still points `restore_command` at the source cell's configuration, which the destination unit's mount namespace hides. Restore drills therefore use `p11-cells-restore-drill.sh` (same helper verb, throwaway server) rather than the provider path. Restore inspection attestation, rotation provider and notifier remain unqualified.
- Redis certificates reuse the PostgreSQL helper's bind-address SAN; a cell bridge address distinct from `host.env` needs a SAN parameter. Redis readiness uses `CONFIG GET`; a read-only ACL user would be tighter.
- The `worker` role has no DML on tables created by the migration role in the proof database; that is policy, not a defect of the transport, but applications must grant it explicitly.
- A full WAL volume is not self-healing (see above); the E08 archive-lag detector is the alert path.

## Owner inputs required

None for the PostgreSQL cells on this server (decisions taken: XFS volume of 120 GiB, loopback bind, ports 15432-15531, B2 prefix `/cells`). Still owner-supplied: the narrower B2 key described above, per-profile quotas for production cells and the first real project.
