# Projects and independent PostgreSQL cells

Status: verified local E03 implementation, owner control API `1.3.0`; production execution and recovery qualification remain separate. See [ADR-007](../adr/ADR-007-independent-postgresql-cells.md), the [isolation contract](../spec/isolation.md) and [verification evidence](../../tests/STRATEGY.md).

## Project and environment metadata

Project registration creates separate development and production environment records. The owner can update a project's name/description and each environment's requested name/resource policy. Updates require the current project revision; environment updates also require the current environment revision. Mutating requests require an `Idempotency-Key`. A conflicting replay or stale revision returns 409.

Named persistent previews are registered explicitly, with finite CPU/memory/disk requests and an expiry in the next thirty days. At most eight preview records are accepted per project. Standard development/production environments cannot expire. Invalid or elapsed preview expiry blocks new provisioning and resume; suspension of a retained allocation remains available to preserve a safe stopped state. Registration, policy edits and expiry are metadata: they do not prove physical creation, resizing, suspension or cleanup. There is no automatic expiry consumer that purges services or data.

## Independent cell boundary

Each project/environment is assigned its own PostgreSQL 18 instance, separate PGDATA and WAL allocations, and independent random service material. Its application and workflow databases are inside that instance. Two databases or schemas on a shared project instance cannot satisfy cross-cell isolation. Server-owned allocation IDs determine database/role/volume identities; browsers cannot supply SQL, host paths, endpoints, provider IDs or arbitrary settings. PostgreSQL supports placing WAL separately during initialization with `initdb -X`; distinct directories alone do not prove filesystem quotas. [PostgreSQL 18 initdb](https://www.postgresql.org/docs/18/app-initdb.html)

The strict preparation profile bounds CPU, memory, data/WAL capacity, temporary space and connections. PostgreSQL settings constrain selected server operations; actual CPU/memory and persistent data/WAL quotas require independently verified host enforcement. In particular, WAL sizing settings are not a hard disk quota. [PostgreSQL 18 resource settings](https://www.postgresql.org/docs/18/runtime-config-resource.html)

`temp_file_limit` is a per-backend disk allowance. Admission reserves an additional `ceil(maxConnections × temporaryMiB / 1024)` GiB against data capacity, and the policy disables query/maintenance parallel workers. This prevents a per-backend limit from being mistaken for a whole-cell allowance; the qualified provider must still enforce the physical quota.

| Identity | Intended authority |
| --- | --- |
| Private bootstrap administrator | Initialize and inspect the new cluster through private transport; never delivered to applications |
| `migration` | Own application schemas and perform separately authorized DDL |
| `api`, `worker` | Application DML, without schema ownership or DDL authority |
| `auth` | Authentication schema, separate from application tables |
| `reader` | Explicitly exposed analysis objects, without broad application/auth access |
| `backup` | Dedicated backup identity; its existence does not qualify backup/PITR |
| `workflowMigration`, `workflow` | Separate workflow schema owner and runtime identity in the workflow database |

Runtime identities have no superuser, role/database creation, replication, RLS bypass, owner membership or broad file/program authority. Bootstrap revokes PUBLIC access and sets owner-specific defaults for future objects. Inspection checks existing object, column and future-object default ACLs; a valid login alone cannot establish least privilege. Default privileges apply to the creating role, so each migration owner needs its own policy. Full application release migrations remain future work. [PostgreSQL 18 default privileges](https://www.postgresql.org/docs/18/sql-alterdefaultprivileges.html)

TCP requires SCRAM and TLS 1.2 or later, with CA-chain and hostname validation equivalent to `verify-full`. A TLS connection without server identity verification is insufficient. Private HBA rules bind database, user and both address families, followed by explicit reject rules; PostgreSQL uses the first matching HBA record. Private Unix sockets are reserved for bootstrap administration. There are no public database ports. [PostgreSQL 18 TLS](https://www.postgresql.org/docs/18/libpq-ssl.html), [HBA matching](https://www.postgresql.org/docs/18/auth-pg-hba-conf.html)

## Prepare, admit and verify

The default local server has no qualified database execution provider. It can save project/environment metadata and immutable preparations. The database overview reports `execution: unconfigured`; backup, restore and rotation report `unqualified`. Running the native laboratory does not enable a provider.

1. Read the project/environment revisions and request a preparation with the strict profile. The response contains an opaque preparation/allocation ID and hash, with no connection material. Preparation has no physical effect.
2. Review that exact preparation, then admit `provision`, `suspend` or `resume` using its ID/hash and a fresh owner passkey session. Admission requires independently qualified private provider authority, current revisions/inventory, capacity and exact target/generation binding. A generic Foundation plan cannot bypass this path.
3. Admission reserves capacity and persists work in the existing FoundationEngine. A 202 response acknowledges durable admission; it does not establish readiness. The same queue, grant, lease, epoch, fence and effect journal govern dispatch and reconciliation.
4. Follow observed allocation state separately from requested state. `reserved`, `unknown` and `quarantined` are not successful provision/suspend/resume. Verified state requires independent physical/catalog inspection, including cluster system identity, effective policy and exact owned volumes. Lost receipts and stale authority retain uncertainty/reservations until reconciliation; no automatic deletion or adoption by name occurs.

After project/environment or inventory observations change, prepare again with current revisions. For a retained cell, renewal requires the exact existing resource profile and reuses its allocation identity; it updates admission authority without replacing or renaming physical data. Operation generations remain monotonic even when queued work is cancelled, while verified physical scope is retained separately for subsequent inspection and lifecycle work.

Private material is generated independently for every role/cell and delivered through private broker-compatible callbacks. Owner HTTP DTOs, preparations, audit entries and logs contain metadata/references only. The owner API has no SQL console, provider-registration, deletion, export or restore operation.

| Method and path (under `/api/v1`) | Request or result |
| --- | --- |
| `PUT /projects/:id` | `expectedRevision`, `name`, `description` |
| `POST /projects/:id/environments` | `expectedProjectRevision`, preview name/kind/expiry and finite resources |
| `PUT /projects/:id/environments/:environmentId` | Project/environment revisions and requested name/expiry/resources |
| `GET /databases` | Execution/recovery qualification, preparations and allocation metadata |
| `POST /databases/preparations` | Project/environment IDs and revisions, strict profile; 201 preparation |
| `POST /databases/admissions` | `preparationId`, `expectedHash`, `intent`; 202 allocation |

All routes require owner authentication. Database prepare/admit also require fresh passkey authority. All mutations require idempotency keys. Generated [OpenAPI](../contracts/control-openapi.json) and the internal control client are the precise contract; neither is the future application SDK.

The French owner UI exposes project metadata/environment forms on the project detail page and database preparation/state at `/databases`. It shows requested versus verified state, preparation hashes and current revisions, passkey freshness, unavailable execution and unqualified recovery. Older preparations cannot authorize actions after a newer preparation for that allocation or a revision change.

## Explicit native PostgreSQL laboratory

Use the pinned Node 24/Bun 1.4.4 workspace. This separate lab requires an existing non-root Ubuntu amd64 environment, Python 3, `gpgv`, the Ubuntu archive keyring, `dpkg-deb` and OpenSSL. Windows uses the existing WSL `Ubuntu` distribution by default; set `GODSEYE_PG_WSL_DISTRO` to select another compatible installed distribution. Unsupported prerequisites fail explicitly.

```sh
bun run postgres:install
bun run test:database:lab
```

The installer downloads Ubuntu PostgreSQL 18.6 packages into `artifacts/tools/postgres/18.6`. It verifies `InRelease` signatures using the Ubuntu archive keyring, verifies the signed Packages index SHA-256/size and each package's SHA-256/size, then extracts locally. It runs no `apt install`, service registration or system configuration edit. The provenance file records source URLs, package versions and hashes; installer pins require review if the archived package version becomes unavailable.

The lab initializes three independent disposable clusters: project A development/production and project B development. It executes the production policy/bootstrap/catalog inspection and tests cross-cell denials, TLS identity/trust failure, no-TLS denial, private bootstrap transport, DML/DDL boundaries, auth/reader/workflow separation, connection ceilings and restart persistence. Its dedicated configuration is `vitest.pg-lab.config.ts`; JUnit is written to `artifacts/test-results/pg-lab.xml`.

The latest Windows/WSL Ubuntu 26.04 run passed ten checks in 15.08 seconds using PostgreSQL `18.6-0ubuntu0.26.04.1`, including negative existing/default/column ACL drift checks. Its sanitized report is `artifacts/test-results/pg-lab-report.json`, retained in `.codex/crafts/g-o-d-s-e-y-e-cfe8/reviews/database-lab.json`; `database-lab-initial.json` preserves the initial seven-check checkpoint. Native processes share the WSL host and UID. This proves selected PostgreSQL mechanisms and independent cluster state; it does not prove Docker/VM containment, host firewall or hard CPU/memory/data/WAL quotas. Coverage and mutation percentages were not measured by this lab.

An intermittent WSL post-restart connection failure is preserved in `artifacts/test-results/pg-lab-flakiness.json` and the retained `reviews/database-lab-flakiness.json`. The fixture now bounds expected TLS/API-role connection readiness to five seconds and executes `SELECT 1` before checking persisted data. It retries connection establishment only; it never retries DDL, DML, bootstrap or provider writes and never weakens authentication.

## Backup, rotation and incident views (E03.S04, local)

Owner API `1.7.0` adds read-mostly protection views to `/databases`; they stay readable when the provider is degraded.

| Path (under `/api/v1`) | Result |
| --- | --- |
| `GET /databases/backups` | Per-environment `healthy`, `lagging`, `headroom-low` or `unknown`, last base backup, archive age/lag against policy, recovery window and archive headroom. `unconfigured` without a provider; a throwing or degraded provider yields `unknown`, never `healthy`. |
| `GET /databases/rotations`, `POST /databases/rotations`, `POST /databases/rotations/:id/reconcile` | Role-by-role rotation state. A rotation persists its intent first, allows one unresolved rotation per allocation and role, replays an idempotency key without repeating the effect, reconciles a lost commit acknowledgement by inspecting a durable marker, and records only public SHA-256 verifier fingerprints. Secret values never appear in responses, audit or logs. Without a rotation provider the route answers 503 and the view reports `unconfigured`. |
| `GET /incidents`, `POST /incidents/evaluations`, `POST /incidents/:id/{acknowledge,mute,resolve}` | Deduplicated `archive-lag`, `headroom` and `rotation-failure` incidents with owner acknowledgement, bounded mutes and resolution. Notification delivery is `unconfigured`, `pending`, `notified` or `failed`; a failed delivery stays visible and is never reported as an alert sent. |

The `/databases` console page shows the three panels. The native tests use an in-process PostgreSQL
stand-in for the cell cluster; real-cell rotation, off-host archive probes and an actual notification
channel remain unqualified.

## Remaining operational gates

Physical E00 admission, real private deployment transport, persistent quotas and both-family firewall enforcement remain required. The subsequent [physical backup and held-recovery continuation](postgresql-recovery.md) adds a separate eleven-case actual pgBackRest/PITR lab and API `1.4.0`; default execution is still unconfigured and all-service activation remains blocked. Protected off-host recovery, production RPO/RTO, old-credential revocation/rotation and full release migration workflows remain unqualified. A backup role, restart-persistent data or a successful policy test cannot substitute for restore/archive/transition evidence.

This checkpoint covers project/environment metadata, bounded previews and the local database lifecycle. The [project lifecycle guide](project-lifecycle.md) adds metadata-only suspension, export and staged deletion; physical suspension of every service, application data export, deployed preview teardown and provider-driven release of allocations are still not complete E03.S01 acceptance.
