# ADR-008: Physical PostgreSQL backup and new held recovery environments

- Status: local implementation; verified local data-recovery implementation; independent source reviews and local verification passed; production execution and activation unqualified
- Date: 2026-11-11
- Related decisions: [ADR-004](ADR-004-owner-authority-and-foundations.md), [ADR-005](ADR-005-bun-and-local-service-authority.md), [ADR-007](ADR-007-independent-postgresql-cells.md)

## Context

E03.S03 needs physical full/differential backups, continuous-WAL evidence and restore into a new isolated destination while local development precedes E00 host qualification. A successful backup process, logical dump or repository filename range cannot prove a recoverable interval. Restored application queues may contain effects already completed after the selected database time; physical consistency alone cannot authorize their replay.

Independent PostgreSQL cells and the existing FoundationEngine already own allocation, authority, capacity, leases, grants, effects and uncertainty. Recovery must compose those boundaries instead of introducing another queue or accepting browser-controlled paths and provider arguments. Physical cloning retains the source system identifier and catalog, so it must not use ordinary fresh-cluster bootstrap semantics.

## Decision

Use pgBackRest for exact per-cell encrypted physical full/differential backups and continuous archive checks. Persist private source/repository/chain/manifest/LSN/timeline evidence and expose metadata-only owner preparations/status through control API `1.4.0`. Exact fresh owner approval, current independently qualified private provider proofs and atomic capacity reservations precede mutation. Default local execution remains unconfigured.

Reuse the same Foundation queue, durable intention and reconciliation paths for backup, archive check and restore. Archive checks refresh the selected existing backup's verified interval after fresh WAL without replacing its immutable identity. Keep per-repository retained capacity separate from active staging, and retain uncertain reservations after cancellation or lost acknowledgement. Read-only inspection uses separate exact current authority rather than a revoked mutation grant.

Restore only into a new server-owned logical recovery environment and distinct physical allocation, with disjoint data/WAL, ownership and network. Retain the source unchanged. Bind exact backup/time/timeline and pause at the target. Preserve source catalog lineage and replace all inherited configuration, HBA/TLS and shell hooks before startup. Reject nonempty targets, ambiguous/foreign scope and overwrite/adoption paths.

Persist a recovery hold that ordinary app/database lifecycle, Foundation/grant, broker and tool entry points cannot bypass. Data verification and activation are separate. Activation remains blocked because actual producer fencing, complete non-rewound business-effect history and file/auth/config/runtime recovery are unqualified. The existing per-run Foundation journal is not a complete business-effect deduplication journal.

Require at least two completed full generations with their dependent differential/WAL chains. Disable automatic expiration and expose no destructive repository operation. Bound advertised intervals by the current 30-day Foundation history, with seven additional days for resolved effect evidence and no expiry for unresolved intentions. Weekly full/daily differential/continuous archive scheduling remains prepared-only until a qualified scheduling consumer exists.

## Consequences

- A local owner can review bounded recovery preparations and truthful freshness/coverage without treating them as executed infrastructure. A verified data restore remains held.
- Physical clone identity is explicit: new allocation and network do not imply new PostgreSQL system/catalog identity. Configuration replacement becomes a mandatory private transport responsibility.
- Retaining source, target, two full chains, WAL, staging and headroom increases capacity requirements. Uncertainty can retain those reservations until independent reconciliation.
- Native actual-tool tests can demonstrate a finite recovery interval and denials, but cannot qualify off-host durability, shared-kernel containment, hard quotas or production recovery objectives.
- Complete D08 activation and D09 recovery sets require later real producer/business-effect and ancillary-service adapters. No purge or source deletion is enabled by this decision.

## Alternatives considered

### Logical dump or live-volume snapshot as the primary recovery proof

Rejected because neither establishes the required physical backup/WAL chain and target-time recovery evidence. Logical export remains a separate portability feature.

### Restore over the source or automatically activate the clone

Rejected because it destroys source evidence or can replay completed external effects. A new held destination preserves source state and makes unresolved activation prerequisites visible.

### A separate recovery queue or name-based target adoption

Rejected because it duplicates Foundation authority/settlement and admits resources without exact durable ownership evidence.

## Verification and references

The explicit local native laboratory passed 11/11 cases in 49.52 seconds with signed PostgreSQL 18.6 and pgBackRest 2.60.0 packages, production managed-provider dispatch, two full generations, a dependent differential, fresh WAL and actual paused PITR/negative cases. Production qualification remains `null`. Independent backend/UI reviews and selected mutation checks passed. Final local verification passed 596/596 unit/integration cases across 45 files in 408.36 seconds and 24/24 browser journeys in 140.767398 seconds (JUnit), plus static checks and final build/smoke; the historical 421-unit/21-browser/47-selected-mutation checkpoint belongs to ADR-007.

See the [operator guide](../development/postgresql-recovery.md), [verification history](../../tests/STRATEGY.md), [D07-D10 contract](../spec/isolation.md) and retained `.codex/crafts/g-o-d-s-e-y-e-cfe8/reviews/recovery-lab.json`. Mechanism references: [pgBackRest user guide](https://pgbackrest.org/user-guide.html), [command reference](https://pgbackrest.org/command.html), [PostgreSQL 18 continuous archiving](https://www.postgresql.org/docs/18/continuous-archiving.html).
