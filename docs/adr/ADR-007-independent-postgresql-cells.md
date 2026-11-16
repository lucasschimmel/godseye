# ADR-007: Independent PostgreSQL cells and durable database lifecycle

- Status: verified local implementation, source review and bounded unit/build/browser/laboratory evidence
- Date: 2026-11-11
- Related decisions: [ADR-002](ADR-002-professional-vm-and-dual-stack.md), [ADR-004](ADR-004-owner-authority-and-foundations.md), [ADR-005](ADR-005-bun-and-local-service-authority.md), [ADR-006](ADR-006-local-inventory-and-cell-provisioning.md)

## Context

The local-first continuation needs useful project/environment management and real database isolation evidence before access to the physical host. Existing project registration and PGlite control storage do not demonstrate independent project PostgreSQL processes, grants or transport policy. Inventory declarations, metadata updates and prepared manifests also cannot establish that physical resources exist or have stopped.

The accepted topology retains one professional VM and a shared trusted administrator/kernel boundary. The database boundary must nevertheless separate each project/environment's PostgreSQL instance, data/WAL, identities and workflow state. Physical backup/PITR and activation remain distinct work.

## Decision

Allocate one PostgreSQL 18 instance per project/environment, with separate PGDATA/WAL and application/workflow databases. Derive opaque names and bindings from server-owned allocation identity. Use strict immutable profiles with finite resource requests, connection ceilings, configuration hashes and exact project/environment/provider/target revisions. PostgreSQL initialization supports separate WAL paths; host quota enforcement requires independent evidence. [PostgreSQL 18 initdb](https://www.postgresql.org/docs/18/app-initdb.html), [resource settings](https://www.postgresql.org/docs/18/runtime-config-resource.html)

Account for per-backend temporary disk with `ceil(maxConnections × temporaryMiB / 1024)` GiB additional data reservation and disable parallel workers. Existing object, column and default ACL inspection must reject privilege drift. PostgreSQL settings and successful policy inspection do not replace physical enforcement.

Separate private bootstrap, migration, API, worker, auth, analysis-reader, backup and workflow identities. Revoke PUBLIC defaults and apply explicit owner-specific future-object privileges. Runtime roles do not own schemas or obtain role creation, replication, RLS-bypass or broad file/program authority. Only authorized migration owners can perform DDL. [PostgreSQL 18 default privileges](https://www.postgresql.org/docs/18/sql-alterdefaultprivileges.html)

Require private TCP with SCRAM, TLS 1.2 or later, CA-chain and hostname validation, exact database/user/CIDR HBA rules and reject fallbacks for both address families. Bootstrap administration uses private transport; service material stays inside private broker-compatible delivery boundaries. Owner responses expose metadata and references only. [PostgreSQL 18 HBA matching](https://www.postgresql.org/docs/18/auth-pg-hba-conf.html), [TLS server identity](https://www.postgresql.org/docs/18/libpq-ssl.html)

Separate preparation from admission and observed outcome. Reuse the existing FoundationEngine, capacity reservations, effect journal, approvals, grants, leases, epochs and fencing for provision/suspend/resume/reconcile. Bind admission to exact preparation/hash and current fresh owner/provider authority. Persist intent before effects and independently inspect physical/catalog identity before verified state. Uncertain effects retain reservations; foreign or drifted resources remain quarantined. Never adopt a cluster by name or delete existing data automatically.

Allow revision/idempotency-protected project metadata and environment policy edits, plus bounded named persistent previews. Report metadata requests separately from actual resources. Keep default database execution unconfigured until a privately supplied provider independently qualifies instance separation, quotas, network and TLS identity.

Renew preparation authority after metadata/observation changes while preserving a retained allocation's exact profile and physical identity. Keep monotonic operation generations separate from last verified physical scope, including cancellation before dispatch. Preview expiry blocks new provision/resume but permits protective suspension; it does not imply automatic service/data cleanup.

Run a separate explicit native PostgreSQL laboratory using the production policy/bootstrap/inspection logic. Obtain pinned Ubuntu packages through archive-keyring-verified signed metadata and package hashes, extracting into the project cache without a system installation. Record the native shared-host/shared-UID boundary honestly.

## Consequences

Local operators can register/edit projects and previews and prepare exact database policies without pretending that an instance was provisioned. Admission can fail visibly while preparation remains useful. A 202 admission response is durable work acknowledgement, not proof of database readiness or suspension.

Independent clusters consume more memory and storage than schemas on a shared instance, but preserve the accepted cross-cell administrative and recovery scope. Application and workflow identities have separate databases inside their own cell; migration authority is never delivered to runtime services.

The native lab can prove PostgreSQL authentication, effective grants, cluster separation and restart persistence. It cannot qualify Docker/VM containment, host firewall, persistent hard quotas, physical backup/PITR or credential rotation. These remain release gates, and the laboratory never becomes a production provider.

## Alternatives considered

- Schemas/databases on a shared cross-project server weaken the required independent-instance boundary and couple administrative/recovery state.
- PGlite or mock-only tests cannot exercise real PostgreSQL multiprocess, HBA/TLS and connection-limit behavior.
- A second database queue would duplicate Foundation authority/effect recovery and create competing settlement paths.
- Treating metadata, labels or owner-supplied qualification as evidence would bypass actual provider verification.

## Verification

The latest explicit Windows/WSL Ubuntu 26.04 laboratory passed ten checks in 15.08 seconds across three independent PostgreSQL 18.6 clusters. It records cross-project and development/production denials, TLS trust/hostname and no-TLS failures, runtime privilege restrictions, auth/reader/workflow separation, actual role connection limits, restart persistence and existing/default/column ACL drift denial. The current report is retained in `.codex/crafts/g-o-d-s-e-y-e-cfe8/reviews/database-lab.json`, with signed source/package provenance; `database-lab-initial.json` preserves the seven-check checkpoint and `database-lab-flakiness.json` the observed WSL restart transport failure. A bounded expected-authentication readiness probe addresses fixture readiness without retrying writes.

Final E03 verification passed 421/421 unit/integration cases across 37 files in 676.45 seconds with `bun run test --maxWorkers=1`; lint (238 files), type checking and generated API `1.3.0` consistency passed separately. Final build/smoke and 21/21 browser journeys passed (112.584583 seconds JUnit). All 47 selected mutants were killed after strengthening the public 409 assertion for the initially surviving M40, with baseline/restored checks passing and original source unchanged. Fresh backend review passed after six confirmed findings were fixed and reverified; two UI findings and the final repository-feedback issue were fixed and independently rechecked. No full coverage or mutation percentage is inferred. Full E03.S01 all-service suspension/export/purge and E03.S03 physical backup/PITR/activation remain open. See the [operator guide](../development/project-databases.md) and [verification strategy](../../tests/STRATEGY.md) for commands and preserved failure/retest evidence.
