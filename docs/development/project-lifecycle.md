# Project lifecycle, export and staged deletion

Status: verified local E03.S01 continuation, owner control API `1.8.0`. See [ADR-012](../adr/ADR-012-project-lifecycle-and-staged-deletion.md), the [isolation contract](../spec/isolation.md) (D10, retention table) and [verification evidence](../../tests/STRATEGY.md).

These commands change control metadata only. They never stop a database, runtime cell, preview or
backup. The lifecycle view says which services the platform already gates and which still need a
qualified provider.

## States

| Phase | Meaning | Edits | Next |
| --- | --- | --- | --- |
| `active` | No lifecycle row | Allowed | suspend |
| `suspended` | Jobs, backend and delivery admission refuse the project | Allowed | resume, export, quarantine |
| `quarantined` | Tombstoned for seven days | Refused (`PROJECT_QUARANTINED`) | release, purge |
| `purged` | Final; control metadata, audit and recovery history kept | Refused | none |

## Commands

| Method and path (under `/api/v1`) | Authority | Notes |
| --- | --- | --- |
| `GET /projects/:id/lifecycle` | Owner | Phase, services, residual resources, exports, blockers |
| `POST /projects/:id/lifecycle/suspend` | Owner | `expectedRevision`, `reason` |
| `POST /projects/:id/lifecycle/resume` | Owner | Restores the prior draft/validated status |
| `POST /projects/:id/exports` | Owner | 201; manifest and SHA-256 digest of the current revision |
| `GET /projects/:id/exports/:exportId` | Owner | Full manifest |
| `POST /projects/:id/lifecycle/quarantine` | Owner + recent passkey | Needs an export of the current revision; `exportId`, `reason` |
| `POST /projects/:id/lifecycle/release` | Owner | Back to `suspended` |
| `POST /projects/:id/lifecycle/purge` | Owner + recent passkey | `confirmSlug`; only after retention and with no recorded physical resource |

All mutations require an `Idempotency-Key`; the current project `revision` guards against stale
commands (409). The generated [OpenAPI](../contracts/control-openapi.json) and the internal control
client (`projectLifecycle`, `suspendProject`, `createProjectExport`, ...) are the precise contract.

## Blockers

Quarantine is refused (`LIFECYCLE_BLOCKED` or `EXPORT_REQUIRED`) while a job run, outbox effect,
operation or role rotation is running or unresolved, or a database allocation has an unconfirmed
physical state. Purge is refused (`PURGE_BLOCKED`) before the retention deadline or while any database,
runtime cell, delivery run/preview or retained backup is not recorded as released. Each refused purge
leaves a `project.purge_refused` audit entry.

## Console

The project detail page shows a French "Cycle de vie et suppression" panel: phase, per-service
coverage, residual resources, blockers, exports and the actions above. Quarantine and purge stay
disabled without a recent passkey confirmation; purge also needs the project identifier typed exactly.

## Remaining gates

Physical suspension of every service, application data/file export, deployed preview teardown and TTL
consumer (E05), provider-driven release of allocations so a provisioned project can ever reach purge, and
off-host retention of the tombstone remain open. See [project databases](project-databases.md) and
[held recovery](postgresql-recovery.md) for the database side.
