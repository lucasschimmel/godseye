# Local PostgreSQL backup and new-environment recovery

Scope: local E03.S03 and corresponding E03.S04 status. Continue the single FoundationEngine and existing project/database/broker boundaries. No dedicated server, global installation or host firewall change. Baseline a38b63fe:421 unit/integration,21 browser,10 actual PostgreSQL cases and47 curated mutation experiments.

## Contract

- Use real pgBackRest physical full/differential backups and continuous WAL archival. A logical dump, successful process exit, repository directory, or archive maximum filename alone is not evidence of a recoverable interval. Track backup-created, archive-healthy, restore-verified, stale, failed and unavailable separately, with provider-owned timestamp/LSN/timeline/manifest evidence and finite repository/archive/capacity bounds.
- Per-cell repository namespaces and private service authority. Browser inputs contain registered IDs, bounded retention/type/target metadata and revisions only: no SQL, filesystem paths, URLs, provider IDs, stanza names, raw configuration/CLI arguments or material. Private transports derive exact owned source/target/repository mappings. Encrypt repository material through private reference-based delivery; no material in argv, owner HTTP, audit or control DB.
- Pure preparations are available without qualification. Mutating execution requires current independently qualified private provider binding, source allocation identity/physical scope, exact fresh owner approval, target/manifest hashes and atomic Foundation reservations. Default production backup/restore execution remains unavailable until the relevant actual transport is qualified.
- Restore into a NEW server-owned logical environment and NEW physical allocation, with independent PGDATA/WAL/private network reservations, while retaining the source unchanged. Reject same-target restore, foreign project/source/repository/backup mismatches, nonempty target adoption, --delta/force overwrite, ambiguous mappings and unverified target reachability. Preserve uncertain effects/reservations; no global prune or source deletion.
- Physical PostgreSQL recovery retains the SOURCE system_identifier, role names and database/catalog namespace. This is expected lineage, not a newly initialized cluster. Distinguish catalog lineage from destination allocation identity, paths, network, timeline and ownership. Never run ordinary fresh bootstrap or assume a new allocation-derived catalog namespace. Remap WAL/tablespaces/configuration to private destination mappings and forbid replay of source archive_command or external shell hooks.
- A restored environment has a durable server-owned RECOVERY HOLD. PostgreSQL may run in paused/read-only recovery solely for trusted validation, but application credentials, API traffic, jobs, outbox, agents, effect egress and normal app/database resume paths cannot activate it. Owner metadata edits, direct generic Foundation enqueue, service proofs and prior snapshots cannot clear the hold. Safe explicit activation is separate from data restoration.
- An activation attempt needs a fresh exact owner action, compatible verified data/config recovery set, actual old-source producer/egress fencing, a new non-rewound activation epoch and complete effect-journal reconciliation. Preserve stable logical effect IDs and lineage across the new environment; unknown/missing/truncated journal intervals block activation. No replay of restored pending effects. Real Inngest/Hermes/file/auth/session/config adapters are not yet qualified, so actual all-service activation stays unavailable by default; implement and test deterministic policy/contract checks without claiming production activation.
- Reuse existing Foundation leases, grants, epoch fencing, effect receipts, idempotency journal, audit and database/app pool accounting. Recovery capacity includes retained source plus target, staging/temp/WAL/repository/headroom obligations. A failed or cancelled restore remains isolated and visible; absence or a lost acknowledgment cannot release its reservation.
- Recovery sets name database/archive state plus file/auth/config snapshots with separate timestamps. Missing/unqualified ancillary snapshots remain explicit and block full activation; do not invent file/auth backup capability in this PostgreSQL stage. Existing cells continue running when archives/providers degrade; new unsafe backups/restores/admissions fail closed and incidents identify stale archive/headroom.
- Weekly full/daily differential and continuous archive retention policy may be prepared and displayed; do not claim automatic schedules execute before the qualified scheduling consumer exists. Retention must keep at least TWO completed full generations and their dependent differential/WAL chains. The non-rewound effect journal must retain evidence for at least the longest advertised restore window plus seven days, and unresolved intentions never expire. Reject policies exceeding the actually supported journal-retention window; no destructive expire/purge endpoint in this tranche without a separately validated policy and owner authority.

## Local acceptance

| ID | Behavior | Test ID |
| --- | --- | --- |
| AC-35 | Exact per-cell backup/repository policy, finite budgets, strict versioned owner input, truthful freshness and degradation | T-AC-35 |
| AC-36 | Concrete pgBackRest policy/provider executes physical full/differential/WAL operations and independently verifies backup/recovery metadata | T-AC-36 |
| AC-37 | Restore creates a distinct held environment/allocation, preserves source and expected physical-clone catalog lineage, never overwrites or bootstraps source | T-AC-37 |
| AC-38 | Shared Foundation authority/reservations and generic entry points enforce exact fresh approval, capacity/headroom, scope and idempotency | T-AC-38 |
| AC-39 | Recovery set timestamps and missing database/file/auth/config coverage remain explicit; no false complete recovery | T-AC-39 |
| AC-40 | Durable recovery hold and activation policy block normal resume/grants/producers, stale epochs and missing/unknown/truncated non-rewound effects | T-AC-40 |
| AC-41 | Restart/lost-ACK/cancel/qualification drift reconcile exact owned resources without repeated effects or premature release | T-AC-41 |
| AC-42 | French owner backup/restore UI and strict HTTP/client/OpenAPI manage real preparations/status with no material or false readiness | T-AC-42 |
| AC-43 | Explicit signed-tool actual PostgreSQL+pgBackRest lab verifies full/differential backups, archived PITR into a new paused destination, source preservation and negative corruption/missing-WAL/wrong-scope cases | T-AC-43 |

One sequential production implementer; disjoint mandatory GAUNTLET/security/SCRIBE/gitsmith satellites. Native Linux/WSL laboratory is local process/storage evidence and does not qualify an off-host repository, Docker/VM/firewall, hard quotas, all-service activation or RPO/RTO under real load. Context7 unavailable; primary pgBackRest/PostgreSQL18 documentation and installed types are the fallback.

## Mechanism references, consulted 2026-11-11

- https://pgbackrest.org/user-guide.html
- https://pgbackrest.org/command.html
- https://pgbackrest.org/release.html (verify installed tool includes relevant current fixes; signed Ubuntu artifact extraction, no global installation)
- https://www.postgresql.org/docs/18/continuous-archiving.html
- https://www.postgresql.org/docs/18/runtime-config-wal.html

Explicit recovery target/action and exact backup set/repository are required; never inherit a tool's latest-backup selection or automatic promote default. Preserve a demonstrably paused target and validate actual pg_is_in_recovery/replay state.
