# V1 boundary contracts

These JSON Schemas describe proposed first-party boundaries. They are not a running API, generated SDK or proof of authorization. E01 finalizes referenced configuration/plan records and OpenAPI; no endpoint may accept an untyped arbitrary record in the meantime. T34 is the schema/provider/API acceptance family.

| Schema | Meaning |
| --- | --- |
| [project.schema.json](project.schema.json) | Versioned platform project and cell/service manifest; application gVisor/PostgreSQL/Inngest profiles are constants; cells belong to the professional VM |
| [action.schema.json](action.schema.json) | Typed owner/worker action envelope, target/revision and idempotency; commands refer to authorized stored plans/configurations |
| [operation.schema.json](operation.schema.json) | Durable asynchronous progress, unknown/cancellation/reconciliation state, cleanup and safe retry guidance |

## Validation and authorization sequence

Authenticate the caller; derive allowed actor/project/environment scope; validate schema/size/version; load target and referenced records within that scope; verify object revision, resource ancestry, policy/grant and exact approval binding; reserve quotas; persist intent; dispatch using provider mappings. Reference UUIDs are never authorization or arbitrary provider IDs. Invalid cross-scope references return 403 or a non-enumerating 404 consistently. T06/T14/T20/T22/T34 verify those checks.

In addition to schema validation, enforce unique environment/service IDs, one production/development identity per declared cell, artifact registry provenance, admitted resource maximums and the configured profile. The schema's numeric minimums do not grant capacity. Only private owner/system actions can use null project/environment for global resources; service identities cannot widen their scope by submitting nulls.

The authenticated actor, lease/fencing token, immutable parameter hash, approval result, provider mapping and request receipt time are generated or verified server-side. They are not trusted browser fields. A matching idempotency key and identical canonical request returns the existing operation; a different request returns 409. An expired provider-side key does not remove the platform's deduplication record.

## Stored records behind references

All records below include `id: UUID`, `schemaVersion: 1`, `revision: nonnegative integer`, server-owned `projectId/environmentId` where scoped, `createdAt: UTC timestamp`, and `contentDigest: SHA-256`. Immutable versions are used for approved work. No record contains an arbitrary shell command, credential value or host path supplied by public clients.

| Record | Required typed fields and semantic checks |
| --- | --- |
| Service configuration | Service ID; typed public non-sensitive settings; credential references; public origin/domain IDs; resource/health policy IDs. References must belong to the same cell and the service must be allowed to resolve them. |
| Database operation plan | Intent `migrate/rotate/backup/restore/export`; cell database ID; migration artifact/version for migrate, identity ID for rotate, destination policy ID for backup/export, source recovery-set ID and UTC recovery time for restore; restore always targets a newly reserved isolated cell. |
| Job definition | Registered function/artifact ID; cell engine mapping; event schema; UTC cron/timezone definition when scheduled; retry/concurrency/timeout policy IDs; result-retention policy. No raw platform installation key. |
| Agent input | Assigned task text/artifact refs, repository/source IDs and output policy; never a replacement for tool permission checks. |
| Task grant | Server-issued actor/cell/resource/tool set, allowed destinations, model/budget allocation, lease/fencing identity, expiry and revocation state. Only trusted broker mints it. |
| Skill version | Catalog skill ID, content digest, source/provenance, compatible tools/runtime, scoped configuration requirements, review/promotion status and parent version. |
| Approval | Owner identity, operation/action kind, canonical parameter digest, target revision, expiry and immutable approve/reject record; cannot be resolved by its proposing agent. |
| Domain/storage/settings configuration | A discriminated record type; domain ownership/route policy, file quota/access policy, or settings allowlist. A configuration created for one command kind cannot be used for another. |
| Recovery set | Cell ID, database backup/archive range, file/config snapshots/timestamps, integrity metadata, tool versions, encryption-key references, effect-journal checkpoint, prior/new activation epoch, paused producer inventory and independent data/activation verification states. |

These record tables are the semantic contract to encode as DTOs/schemas in E01; production parsers remain blocked until the exact discriminated schemas and generated clients are tested. Never replace them with a permissive JSON blob simply to complete the UI. T34 verifies types/dispatch and T07/T22/T37 verify security/recovery semantics.

An optional `approvalId` in the generic shape means some action types do not need an approval. The [V1 action policy](../spec/v1.md) determines required approval/step-up per action and actor; missing required approval is a denial, never an implicit grant. Target/reference schemas cannot override that rule. Restore plans also implement the paused/fenced/reconciled activation contract in [isolation.md](../spec/isolation.md).

## Proposed transport

| Route | Shape and behavior |
| --- | --- |
| `GET /v1/projects` and `GET /v1/projects/{id}` | Scoped inventory/manifest plus observed status; pagination and freshness |
| `POST /v1/actions` | Action schema; 202 with operation schema after authorized admission |
| `GET /v1/operations/{id}` | Scoped operation schema, safe error and artifact reference |
| `GET /v1/operations/{id}/events` | Authorized SSE records with event cursor and operation revision; reconnect/refetch on gaps |
| `GET /v1/capabilities` | Installed provider versions, supported actions, degradation and last probe time |

These private management routes do not serve as public project APIs. SDK application contracts cover separate auth/session, files, typed application endpoints and event publishing, with project-specific origins/identity. E01 fixes those DTOs before E04 exposes SDK functionality. Error/status/size/lifecycle rules are defined in [V1](../spec/v1.md).

## Compatibility

Unknown schema versions and unsupported commands fail with 422 or explicit capability-unavailable 503. First-party v1 clients reject incompatible responses visibly. Backward-compatible additions use optional fields in a new tested contract revision; breaking changes get a new major version. Provider IDs never enter the project SDK. All meaningful provider substitutions require T34 plus the corresponding isolation/recovery scenarios, not just JSON shape compatibility.
