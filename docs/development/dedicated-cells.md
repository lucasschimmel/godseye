# Dedicated-server project cells (repository side)

Status: implemented and tested with fakes only. Nothing here has been installed on, or executed against, the dedicated server. Every default stays `unconfigured`; the cell providers exist only when a private binding file selects them. This extends [project databases](project-databases.md) and [PostgreSQL recovery](postgresql-recovery.md); owner decision: project cells run PostgreSQL 18 (PGDG) with pgBackRest 2.60, while the control database stays on PostgreSQL 17.

## Per-cell PostgreSQL transport

`ServerPostgresTransport` (`packages/core/src/database-server-transport.ts`) is the server `PostgresInstanceTransport`; `ServerPgBackRestTransport` (`recovery-server-transport.ts`) is the matching `PgBackRestTransport`. Both act only through the `CellHostExecutor` interface (`cell-host.ts`): fixed absolute argv, no shell, bounded output.

| Aspect | Design |
| --- | --- |
| Instance | `godseye-pg@<allocation>.service` ([template](../../infra/dedicated-server/units/godseye-pg@.service)); creation refuses to adopt existing state |
| Storage | ZFS child datasets `<parent>/<allocation>/{data,wal,repo}` with a hard `quota`, `godseye:volume` / `godseye:allocation` user properties; `initdb -X` places WAL on its own dataset. Inspection reads quota, mountpoint and ownership back from ZFS |
| Isolation | Cells share the `postgres` UID, so the unit uses a private mount namespace (`TemporaryFileSystem` + `BindPaths`): other cells' data, configuration and sockets are invisible to a cell process |
| Network | PostgreSQL listens only on the configured loopback or private-bridge address; HBA is `hostssl` + SCRAM per role/database for private CIDRs, explicit rejects, bootstrap role only on the Unix socket |
| TLS | per-cell certificate from a private cell CA (`godseye-pg-issue-cert`); SAN covers the verified server name and the bind address |
| Backups | one stanza per cell (`g_<allocation>`), repository dataset per cell, WAL archiving through pgBackRest; cipher passphrase only in a root-owned unit `EnvironmentFile` |
| Qualification | `hostQualification` is a live probe (ZFS pool `ONLINE`, template unit installed, `postgres` 18.x, `pgBackRest 2.60`, certificate helper) with a five-minute expiry. Recovery qualification stays `null` until an independent per-scope attestation exists |

Wiring: `apps/control-api/src/cell-providers.ts` builds `ManagedPostgresProvider`, `ManagedPgBackRestProvider` and the backup detector only when `GODSEYE_PG_CELLS_FILE` names a private 0600 JSON binding; `server.ts` spreads the result into `InfrastructureEngine`. Without it nothing changes. The interim role/repository material store is a private file directory; the OpenBao broker implementations (`BrokerDatabaseMaterialDelivery`, `BrokerRecoveryRepositoryMaterial`) remain the intended production path and need slot-reference wiring.

## Backup schedule and alerts

Host timers (`godseye-pg-backup-{full,diff,check}@<allocation>.timer`): weekly full (Sunday 02:30 UTC), daily differential (Monday to Saturday 03:30 UTC), hourly archive check, with randomized delay and `Persistent=true`. The runner `godseye-pg-backup` records `/var/lib/godseye/pg-backup/<allocation>.json`. `backupScheduleDetector` (`backup-schedule.ts`) reads those records through `InfrastructureOptions.backupSchedule` and raises E08 `archive-lag` incidents for a failed/overdue archive check, a missing weekly full or a missing daily differential (tolerance 1.5x the interval). A missing record is raised as unknown, never healthy. The control database stanza `main` uses the same cadence in the p06 template.

This is host-driven. It does not use the owner-admitted recovery path; physical recovery metadata (manifest/WAL continuity) still comes only from the recovery engine.

## Jobs, Inngest and per-cell Redis

`godseye-jobs.service` runs `dist/jobs-runtime/server.mjs` as `godseye` after PostgreSQL/Redis/OpenBao with `Restart=on-failure` and systemd back-off (`RestartSteps`/`RestartMaxDelaySec`), hardening and an IP allow-list restricted to loopback and private ranges. Environment entries: `GODSEYE_MODE=local`, `GODSEYE_JOBS_RUNTIME=autonomous`, `GODSEYE_INNGEST_CELLS`, plus the private control/storage/platform bindings and `NODE_EXTRA_CA_CERTS` for the cell CA. `p10-install-jobs.sh` installs the pinned, digest-checked Inngest 1.52.0 Linux binary and a per-cell Redis template (AUTH, AOF `always`, `noeviction`, TLS-only).

The loopback-only workflow-storage rule is relaxed by `workflowEndpoint` (`apps/control-api/src/workflow-endpoint.ts`): a non-loopback endpoint must be an RFC1918/ULA IP literal (no DNS names) and must use verified TLS (PostgreSQL `sslmode=verify-full` with optional absolute `sslrootcert`, Redis `rediss:`); no other connection parameters. Reuse detection now keys on host plus port.

## Application store

`openApplicationStore` accepts `tls: { ca, servername? }` (verify-full semantics, plain URL only) and `migrationDatabaseUrl`: a separate migration identity runs DDL and seeds scope, then closes; the runtime identity only needs DML and `SELECT` on the scope row. A non-loopback URL without TLS options is refused.

## Lifecycle orchestrator (not implemented)

Physical suspend/resume of a whole project is not coded. Intended shape, to be built on Foundation plans: one plan per environment with ordered, individually journaled steps. Suspend: stop applications, drain/stop the jobs cell, `ServerPostgresTransport.stop` (disables timers first), then Redis. Resume: reverse order, each step gated by an inspection (`inspect`, Redis `INFO`, jobs health) before the next. Each step is an existing adapter (`database.lifecycle`, jobs, delivery); the new work is only the plan compiler and cross-adapter ordering/uncertainty rules. Metadata-only suspension in `project-lifecycle.md` remains the current behavior.

## Remaining gaps

- Privilege model: `SudoCellHostExecutor` needs a reviewed sudoers drop-in or a root helper; wildcards for `zfs create`/`zfs set` are a real argument-injection surface. Not provided.
- Per-cell CPU/memory ceilings are not applied (`systemctl set-property` from the admitted profile).
- Off-host repository copy, restore inspection attestation, rotation provider and notifier remain unqualified; the repository dataset is on the same host.
- Redis certificates reuse the PostgreSQL helper's bind-address SAN; a cell bridge address distinct from `host.env` needs a SAN parameter.
- Redis readiness uses `CONFIG GET`; a read-only ACL user would be tighter.
- Unit files were reviewed against systemd documentation but never loaded (`systemd-analyze verify` not run); `Type=notify` assumes PGDG/Debian systemd-enabled builds.

## Owner inputs required

ZFS pool name and parent dataset, mount root, total parent quota and per-profile quotas (data and WAL quotas come from the admitted profile; the repository default is 16 GiB per cell and is tightened by backup policy), the cell bridge address and CIDRs, the port range, the first-listener server name, off-host repository target, and the sudoers/helper decision.
