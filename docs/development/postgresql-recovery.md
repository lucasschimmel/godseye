# Local PostgreSQL backup and held recovery

Status: local E03.S03 implementation and scoped native recovery evidence, 2026-11-11. Default recovery execution is **unconfigured**; all-service activation is **blocked**. Final local verification passed 596/596 unit/integration cases, 24/24 browser journeys, static checks and build/smoke; independent source reviews and selected mutation checks passed. See [ADR-008](../adr/ADR-008-local-postgresql-held-recovery.md) and [verification history](../../tests/STRATEGY.md).

## Owner workflow

The backup section of `/databases` displays physical full/differential preparations, archive freshness, recovery intervals and held restore runs. An existing verified database allocation is the source. Browser requests contain registered IDs, current revisions and bounded policy only. Paths, SQL, URLs, stanza names, provider configuration and repository material are private server-owned mappings.

1. Select the source project/environment/allocation and prepare a `full` or `diff` backup with current project/environment revisions. Review the returned immutable preparation/hash.
2. Admit that exact preparation using a fresh owner passkey session. A privately supplied provider must independently qualify its exact scope, encryption, independent repository, enforced capacity, private networking and isolated restore capability. Preparation alone does not execute a backup; a 202 response acknowledges durable work.
3. Follow the run and independently inspected backup state. A successful command or pgBackRest `info` archive min/max does not prove continuous recoverability. Evidence binds the repository, source physical/catalog identity, backup/base labels, manifest hash, timestamps, LSN ordering and timeline to finite repository and archive-headroom limits.
4. After new WAL is archived, prepare/admit an archive check for the existing backup. It uses the same Foundation queue, durable intention and authority checks. Verified continuous-WAL evidence refreshes that backup's archive timestamp and recoverable upper bound without changing its manifest/base/lineage or creating another backup.
5. Select a target timestamp inside the freshly verified interval and a new recovery environment name. Restore preparation creates a new server-owned logical environment with a durable recovery hold and a distinct physical allocation ID. The source remains retained.
6. Admit the exact restore preparation. Follow data-validation status separately from activation. A verified restore remains held until the owner runs the confirmed activation step (see "Owner-confirmed activation" below).

All preparations and admissions require owner authentication, recent passkey verification, an `Idempotency-Key` and strict DTO validation. Repeated keys with changed inputs and stale revisions conflict. Preparation changes are immutable: prepare again after relevant scope/revision changes. Retrying an uncertain operation must reconcile the existing intention rather than repeat its physical effect.

## Policy and capacity

| Field | Accepted range |
| --- | --- |
| `fullRetention` | 2–4 completed full generations |
| `differentialRetention` | 1–30 differential backups |
| `repositoryGiB` | 1–16384 GiB |
| `stagingGiB` | 1–4096 GiB |
| `archiveHeadroomGiB` | 1–1024 GiB |
| `maxArchiveAgeSeconds` | 60–86400 seconds |

Retention must preserve at least two completed full generations and their dependent differential/WAL chains. The compiler disables pgBackRest automatic expiration; this tranche exposes no expire, prune, overwrite or source-delete operation. Count settings alone do not prove that retained chains are recoverable.

Weekly full, daily differential and continuous archival describe a **prepared-only** policy. No qualified automatic scheduling consumer executes it. Ordinary existing cells continue running when archives or providers degrade; unsafe new work fails closed with visible stale/archive/headroom reasons.

The shared professional-pool admission ledger counts the retained source separately from new destination data/WAL/temp capacity. Repository plus archive-headroom commitments are deduplicated by repository, while active/unknown runs retain their transient staging reservation. A failed, cancelled or lost-acknowledgment mutation retains uncertain resources until exact inspection resolves them.

Advertised recovery intervals are bounded by the current 30-day Foundation restore-history limit. Resolved effect evidence must outlive the longest advertised window by seven days; unresolved intentions never expire. The existing per-run Foundation effect journal is **not a complete business-effect deduplication journal** and does not authorize safe producer activation.

## What a new physical destination means

A physical PostgreSQL clone retains the source `system_identifier`, role names and database/catalog namespace. These are expected lineage, not evidence of a fresh `initdb`. Destination allocation, ownership, data/WAL paths and network identity must be distinct. Do not bootstrap the restored catalog with allocation-derived fresh-cluster names.

The private provider reserves an exact empty, owned, link-free destination with default tablespaces only. Restore binds the selected backup label, UTC target time and timeline explicitly, remaps WAL and requests pause; no latest-backup, delta, force or automatic-promote default is accepted. Before PostgreSQL starts, replace **all** inherited configuration/includes, auto-configuration, HBA/ident, TLS references, archive/replication settings and external hooks. Source configuration must never execute on the destination.

The held configuration disables TCP listeners and archive push, permits only private Unix-socket SCRAM administration, rejects runtime identities and enables read-only standby recovery. Independently verified evidence must show the exact target was reached, replay is paused, the source remains retained and destination paths/network are independent. A startup-ready message alone cannot establish any of these properties.

## Recovery hold and activation limits

The durable server-owned hold blocks ordinary app/database start/resume, execution/grant admission, service-broker redemption and tool paths. Editing metadata, using a generic Foundation plan or presenting an old service proof cannot remove it. Trusted recovery validation is the narrow exception.

Database validation does not restore files, auth or configuration at the same timestamp. Coverage exposes `databaseAt`, nullable `filesAt`/`authAt`/`configAt`, and missing ancillary snapshots, business-effect history and producer fencing. No complete recovery set is claimed.

### Owner-confirmed activation (owner API `1.21.0`, migration `0026`)

A restored environment becomes the project's active data only through `POST /recovery/environments/:id/activation`. The request carries the exact project and environment revisions, the typed environment name and every required acknowledgement (`FILES_SNAPSHOT_MISSING`, `AUTH_SNAPSHOT_MISSING`, `CONFIG_SNAPSHOT_MISSING`, `NON_REWOUND_BUSINESS_EFFECT_COVERAGE_UNQUALIFIED`); a recent passkey session is required. The gate is derived from stored state and refuses with `ACTIVATION_BLOCKED` while: the restore run is not `restore-verified`; the project is suspended or being deleted; the source is already held; the source has unfinished execution/job/outbox work or unresolved (`intent`/`unknown`) effects; or the provider has no promotion capability (`PROMOTION_UNAVAILABLE`).

The step is durable and ordered: (1) one transaction fences the source (recovery hold, activation epoch advance, running work marked unknown, grants revoked) and records the intent in `recovery_activations`; (2) the provider promotes the exact restored destination; (3) only after an independent `inspectPromotion` proof that matches the scope, allocation and environment, the restored environment takes the source's kind and loses its hold while the source becomes a held `recovery` environment kept as evidence. Any doubt leaves both environments held with state `fenced` or `unknown`; repeating the command resumes without fencing again. The platform never reads an empty or truncated journal as proof that nothing happened: the effect-coverage gap is always acknowledged by the owner.

Not covered: the shipped pgBackRest provider has no promotion capability, so on a real stack activation is reported `blocked` (`PROMOTION_UNAVAILABLE`); the flow is exercised only with a fixture provider. Jobs, backend configuration and domain bindings stay with the fenced source and are not moved, and the restored database is not yet registered as a managed database allocation (no backup/rotation for it until adopted). Files, identities and configuration are not restored.

Before this step existed, activation assessment always returned `activation: "blocked"`. Actual old-source producer/egress fencing, complete non-rewound business-effect reconciliation with stable logical effect IDs, ancillary snapshots and runtime-access adapters are unqualified. A future activation path must obtain fresh exact owner approval and a new non-rewound epoch, reconcile unknown/truncated intervals and prevent replay of restored pending effects. D08 is not completed by this data-recovery implementation.

Read-only reconciliation material has its own exact current Foundation lease/fence/epoch, scope and persisted-intention checks. It does not reuse revoked mutation grants or authorize another backup/restore. If current independent inspection or its private material authority is unavailable, uncertainty remains visible.

## Owner API 1.4.0

All paths below are under `/api/v1`. The generated [OpenAPI](../contracts/control-openapi.json), [recovery schemas](../../packages/contracts/src/recovery.ts) and internal owner client define the precise contract.

| Method/path | Behavior |
| --- | --- |
| `GET /recovery` | Metadata-only overview; execution, blocked activation and prepared-only schedule |
| `POST /recovery/backups/preparations` | Prepare `full`/`diff`; IDs, revisions and bounded policy; 201 |
| `POST /recovery/archives/preparations` | Prepare a check for exact project/source environment/backup and revisions; 201 |
| `POST /recovery/restores/preparations` | Prepare exact backup/UTC target and new name; 201 |
| `POST /recovery/admissions` | Admit `{ preparationId, expectedHash }`; 202 |
| `GET /recovery/environments/:id/activation` | Assess a held restored environment: `blocked` with machine-readable reasons, or `ready`, plus the acknowledgements the owner must give |
| `POST /recovery/environments/:id/activation` | Owner-confirmed activation (fresh passkey, idempotency key); see below |

The backup DTO distinguishes `backup-created`, `archive-healthy`, `restore-verified`, `stale`, `failed` and `unavailable`. Freshness is reevaluated from the clock; unavailable qualification prevents a green readiness claim. Run states include `reserved`, `unknown`, `backup-created`, `archive-checked`, `restore-verified` and `released`. Inspect both run outcome and current backup/provider status. Errors expose safe codes, not private material or raw tool diagnostics.

## Explicit native recovery laboratory

Use Node.js 24 and Bun 1.4.4, plus an existing non-root Ubuntu 26.04 amd64 environment with Python 3, `gpg`, `gpgv`, the Ubuntu archive keyring, `dpkg-deb` and OpenSSL. Windows uses the installed WSL `Ubuntu` distribution; `GODSEYE_PG_WSL_DISTRO` selects another compatible installed distribution. Unsupported prerequisites fail explicitly.

```sh
bun run postgres:install
bun run postgres:recovery:install
bun run test:recovery:lab
```

The installers extract PostgreSQL 18.6 and pgBackRest 2.60.0 under ignored `artifacts/tools/`. PostgreSQL uses signed Ubuntu metadata; pgBackRest uses the pinned official PGDG key and signed repository index, with Ubuntu-signed dependencies. Signed index and package SHA-256/size verification precede extraction. No `apt install`, root service or system configuration change is performed.

`vitest.recovery-lab.config.ts` selects the separate eleven-case actual-tool suite, excluded from default tests. The recorded run passed **11/11 in 49.52 seconds**. The real `ManagedPgBackRestProvider` dispatches two full generations and a differential into an encrypted repository, then restores the explicit older chain to a known transaction boundary after fresh WAL archival. Actual replay/read-only/target evidence, retained source writes, original catalog/system identity, replacement hooks/HBA and wrong-scope/cipher/corruption/missing-WAL/nonempty-target/unreachable-target denials are checked.

Outputs are `artifacts/test-results/recovery-lab.xml` and `artifacts/test-results/recovery-lab-observation.json`; the sanitized qualification record is retained at `.codex/crafts/g-o-d-s-e-y-e-cfe8/reviews/recovery-lab.json`. The observation deliberately records production qualification as `null`. This is local native process/storage evidence for a finite fixture interval. It does not qualify an off-host repository, Docker/VM/firewall isolation, hard quotas, arbitrary historical coverage, production RPO/RTO or all-service activation.

The 49.52-second coordinator recheck follows the initial 40.45-second run; its test duration was 48.245 seconds. The local generated cipher fixture does not qualify private backup-key custody, off-host material recovery or loss-of-controller recovery.

The prepared Jenkins stage runs the same three commands on `godseye-ubuntu2604-amd64-node24-bun144` and collects its XML plus observation JSON, treating missing outputs as failure. Jenkins/agent execution remains unqualified; see [CI preparation](ci.md).
