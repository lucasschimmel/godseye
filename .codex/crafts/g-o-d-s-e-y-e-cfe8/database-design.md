# Local project lifecycle and independent PostgreSQL cells

Scope: E03.S01/S02 and the corresponding local E03.S04 owner views. E03.S03 physical backup/PITR/activation remains separate. No dedicated-server access, global installation or weakening of ADR002/006.

## Invariants

- One project/environment maps to an independent PostgreSQL instance with separate PGDATA and WAL, application and workflow databases, exact immutable profile and opaque server-owned allocation identity. A schema or database on a shared project server cannot substitute for this boundary.
- Reuse the existing project registry, control lock/idempotency/audit, Foundation plans/consumer/effects/grants/epochs/fencing, infrastructure capacity and broker reference/private-delivery primitives. Compose execution adapters/hooks into one FoundationEngine, never start a second queue or report registration as provisioning.
- Local native PostgreSQL laboratory is explicit and disposable, independently identifies its weaker host/process boundary and never qualifies Docker/VM quotas/firewall. Default runtime execution stays unavailable until a private independently qualified provider is supplied. The owner can still register/edit projects/environments and prepare immutable database plans locally.
- Add real project metadata/environment management (development, production, named persistent previews with finite expiry/limits), revision-safe updates and visible requested versus verified lifecycle. Suspend/resume physical resources only via qualified durable operations; a metadata toggle is not successful suspension. Deny unsupported deletion/export/restore rather than fake completion.
- Database preparations fix engine/version, finite connection/storage/WAL/temp budgets, role/schema/grant policy, SCRAM/HBA/TLS requirements, allocation bindings and artifact/configuration hashes. No browser SQL, host paths, endpoints, provider IDs, arbitrary settings or material values. Owner responses contain metadata and references only.
- Roles: private bootstrap admin; separate migration owner, API, worker, auth, sanitized analysis reader, backup and workflow identities. Runtime roles have no ownership/SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS or broad file/program grants. PUBLIC database/schema/function defaults are revoked; app/auth/workflow grants differ. Migration lock and separate authority are required; full release migrations remain E05.
- TCP requires server-identity verification (verify-full) and TLS >=1.2 with restrictive database/user/CIDR HBA, SCRAM and explicit reject fallback for IPv4/IPv6. Unix sockets are private local administrative paths only. No public database ports.
- Durable provision/suspend/resume/reconcile bind exact cell/allocation/profile/target/generation, current project/environment revisions and activation epoch. Persist intentions before effects, independently inspect actual effective settings/role grants/system identity, preserve unknown states and reservations after lost acknowledgments/fencing. Never adopt a cluster from names or labels alone, never erase existing data automatically.
- Material is independently random per role/cell, privately staged/delivered through broker-compatible boundaries, never in control DB/manifests/audit/HTTP/build logs. Do not add an owner HTTP SQL console. Rotation/backup readiness must stay unqualified until actual upstream transition/archive evidence exists.
- Native PostgreSQL tests must execute production policy/bootstrap/inspection logic against independent real instances and test negative same/cross-project and production/development access, wrong/no TLS, DML versus DDL/auth/reader restrictions, finite limits and recovery from restart. A PGlite or mock-only pass is insufficient evidence for PostgreSQL isolation. If native runtime cannot be obtained without system changes, preserve an explicit qualification gap rather than fabricate results.

## Local acceptance contract

| ID | Behavior | Test ID |
| --- | --- | --- |
| AC-27 | Revision/idempotency-safe project metadata and scoped environment registration/update, finite preview policy and accurate lifecycle states | T-AC-27 |
| AC-28 | Strict immutable independent PostgreSQL cell profile; server-owned mappings, distinct PGDATA/WAL and scoped roles, bounded resources | T-AC-28 |
| AC-29 | Durable Foundation-based database lifecycle with exact fresh owner authority, atomic cell/capacity reservations and generic endpoint bypass refusal | T-AC-29 |
| AC-30 | Effective PostgreSQL bootstrap/inspection, PUBLIC/default-grant restrictions and per-service connection/schema authority | T-AC-30 |
| AC-31 | Private reference-only service material; TLS/SCRAM/HBA and cross-cell authorization restrictions | T-AC-31 |
| AC-32 | Idempotent restart/reconciliation, stale authority/unknown effects quarantine and no cross-cell adoption/deletion | T-AC-32 |
| AC-33 | Authenticated French project/environment/database UI, real HTTP/client/OpenAPI contract and honest unavailable/recovery states | T-AC-33 |
| AC-34 | Explicit actual PostgreSQL independent-instance lab with negative privilege/transport/cross-cell checks; no production containment claim | T-AC-34 |

Implementation is sequential, with disjoint mandatory test/security/documentation/git satellites. Existing baseline:325 unit/integration,18 browser,31 curated mutations. New checks cover behavior and negative authority, not shallow schema snapshots. Current Context7 unavailable; use PostgreSQL18 official documentation and installed library types with explicit source records. Final production review is fresh-context and evidence-backed. E00 remains the remote execution gate.

## Primary mechanism references consulted 2026-11-11

- PostgreSQL18 HBA first matching record wins, with no fallback: https://www.postgresql.org/docs/18/auth-pg-hba-conf.html
- PostgreSQL18 TLS server identity is not verified by default; verify-full is required here: https://www.postgresql.org/docs/18/libpq-ssl.html
- Per-owner default privileges apply to future objects, requiring explicit policy for each creating owner: https://www.postgresql.org/docs/18/sql-alterdefaultprivileges.html
- PostgreSQL resource settings are not filesystem storage quotas: https://www.postgresql.org/docs/18/runtime-config-resource.html
- Separate data/WAL initialization: https://www.postgresql.org/docs/18/app-initdb.html
