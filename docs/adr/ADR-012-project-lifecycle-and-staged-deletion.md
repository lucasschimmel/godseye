# ADR-012: Project lifecycle, metadata export and staged deletion

Status: accepted (local-first stage; physical stop/purge pending a qualified provider)
Scope: E03.S01 (project suspend/resume/export/quarantine/purge); F03, F41 (local part), D10; T09, T24, T38 (local cases).

## Context

`projects.status` already included `suspended` and the jobs, backend and delivery engines already refuse
a suspended project, but nothing could set it. F03 also requires export and staged deletion, and D10
requires: stop ingress/jobs, revoke grants, verify recovery policy, tombstone and quarantine, then purge at
the configured deadline, with a failed purge visible and auditable. No qualified provider exists locally to
stop or delete physical resources, so a command must never imply that it did.

## Decision

1. **Metadata-only commands beside the Foundation queue.** Like database rotation, lifecycle commands are
   transactional control writes: lifecycle row, project revision bump, idempotency receipt and audit entry
   are the journal. They create no execution plan because they dispatch no external effect.
2. **Phases.** No row means `active`. `suspended`, `quarantined` and `purged` live in `project_lifecycles`;
   `projects.status` is `suspended` for all three so existing gates apply unchanged. Resume restores the
   prior `draft`/`validated` status. `purged` is final and keeps a tombstone row.
3. **Authority (action policy).** Suspend, resume, export and release are explicit owner commands.
   Quarantine and purge require a recent passkey session (`STEP_UP_REQUIRED`). Every command needs
   `Idempotency-Key` and the current project revision; a stale revision is 409.
4. **Export.** A deterministic control-metadata manifest (project, environments, database allocation
   state, backup records, job definitions, backend settings) with a SHA-256 digest. It never contains
   credentials, SQL, paths or application data and says so (`data.included: false`). Application data and
   file export need a qualified provider.
5. **Quarantine preconditions.** Suspended project; an export of exactly the current project revision;
   no job run, outbox effect, operation or role rotation that is running or unresolved; no database
   allocation with unconfirmed physical state. Retention is seven days (isolation retention table).
   Release returns to `suspended` and cancels the deadline.
6. **Purge preconditions.** Quarantined, retention elapsed, typed project slug, and no recorded physical
   resource (database, runtime cell, delivery run/preview, retained backup) that is not released. A refused
   purge commits its own audit entry (`project.purge_refused`) and returns `PURGE_BLOCKED`. A successful
   purge clears the repository binding and records `purgedAt`; control metadata, audit and recovery history
   are retained.
7. **Honest coverage.** The view marks each service `enforced` (platform gate), `pending-provider`
   (physical resource still recorded; this command stopped none) or `none`. Blockers are machine-readable
   codes translated by the console.
8. **Immutability.** Quarantined and purged projects refuse project, environment and repository edits
   (`PROJECT_QUARANTINED`). A merely suspended project can still be edited.

## Consequences

- With no provider able to release allocations, only projects with no recorded physical resource can be
  purged locally. That is intended: residual resources stay visible instead of being silently dropped.
- There is no automatic expiry consumer. Quarantine expiry only makes purge *eligible*; the owner still
  confirms with step-up.
- Not covered: physical database/runtime suspension across all services, application data/file export,
  deployed preview teardown (E05), off-host retention of the tombstone, and an approval object bound to
  the exact quarantine/purge parameters beyond the fresh passkey session and revision check.
