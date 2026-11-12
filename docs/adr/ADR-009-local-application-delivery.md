# ADR-009: Local application delivery with exact standing authority

- Status: verified local implementation, combined verification, defensive source review, responsive follow-up and scoped mutations; remote qualification open
- Date: 2026-11-12
- Related decisions: [ADR-004](ADR-004-owner-authority-and-foundations.md), [ADR-005](ADR-005-bun-and-local-service-authority.md), [ADR-006](ADR-006-local-inventory-and-cell-provisioning.md), [ADR-008](ADR-008-local-postgresql-held-recovery.md)

## Context

Signed GitHub intake and repository configuration already record local intentions, but they do not establish current source identity, trusted artifacts, a running application or production delivery authority. E05 needs a local implementation of synchronization, build/release history and isolated previews while E00 host/provider qualification remains open.

The existing FoundationEngine owns durable work, scoped authority, capacity, fencing and uncertain effects. Delivery must reuse those boundaries and preserve recovery HOLD. It must also distinguish owner-created standing delivery policy from the legacy `autoDeploy` preference, and distinguish immutable artifact promotion from database recovery.

## Decision

Implement a DeliveryEngine composed into InfrastructureEngine and its single FoundationEngine. A fresh owner creates/revokes an exact revision-bound, expiring standing policy that snapshots repository/installation/ref identity, target environment, supported recipe, required checks and finite artifact/resource/preview limits. Generic owner/service commands and repository code cannot create or widen delegated delivery authority.

A private source provider independently verifies current branch/PR head, repository identity and installation access before build and immediately before promotion. Signed events remain intentions; arrival order and payload timestamps do not prove authoritative source state. Same-repository open PR previews are the default; fork PRs are denied.

Trusted private build/runtime providers return immutable source/recipe/artifact/check/scan/provenance and exact resource evidence. No browser attestation endpoint or repository-authored green result can confer promotion authority. Keep production credentials out of builds. Serialize each target release lane, inspect readiness/smoke/compatibility before traffic switch and retain the previous serving artifact on pre-promotion failure.

Reuse Foundation intentions, leases, fences, epochs, grants, capacity and reconciliation at every external boundary. Policy expiry/revocation, source/provider drift and HOLD invalidate stale work. Unknown effects retain resources and require inspection rather than blind retry. Rollback uses current independently verified CI source authority and an eligible retained older artifact under fresh exact owner authority; it never rewinds data or activates recovered effects.

Create bounded server-owned PR preview environments with independent mappings and empty/synthetic data. TTL/verified closure may stop/unpublish exact owned application resources; they do not authorize persistent data destruction or final purge. Preserve tombstones and recovery/audit evidence after definitive owned-resource absence.

## Consequences

- Local policy/source/artifact/release behavior can be exercised without connecting an external account or pretending remote deployment exists.
- Current-head verification and policy/provider checks add availability dependencies; missing independent evidence must visibly block work.
- Retained artifacts, staged runtimes and uncertain cleanup consume capacity until exact absence/settlement is verified.
- Preview lifecycle needs protective stop/unpublish authority separate from fresh-approved persistent-data purge.
- Native trusted-fixture execution cannot qualify untrusted builds, isolated guests, remote credential custody, networking or production deployment.
- Full E05 and E00/E03/E04/E12 acceptance remain separate from this local checkpoint.

## Alternatives considered

### Treat signed webhook or `autoDeploy` preference as delivery authority

Rejected because neither proves the current source head, active installation access, exact owner policy or allowed target effect.

### Run repository pipeline code on the controller

Rejected because repository-controlled code must not inherit controller or production authority. An actual qualified disposable runner remains a separate provider requirement.

### Add a separate delivery queue or retry unknown external effects

Rejected because it would duplicate Foundation authority/settlement and could repeat uncertain builds, publication or traffic changes.

### Delete persistent preview data automatically on TTL

Rejected because bounded availability cleanup cannot replace the V1 fresh authority, quarantine and recovery requirements for final purge.

## Verification and references

The implemented local owner console at `/pipelines` and strict owner HTTP/client/generated OpenAPI `1.5.0` expose policies, synchronization, exact preparations/admissions, release history and bounded preview cleanup. Type checking and generated-contract consistency passed. The twelve actual managed-provider fixture checks passed in 3.24 seconds inside the final unit suite (earlier focused run: 4.21 seconds), including real artifact bytes and loopback HTTP effects. They are included in the default Vitest count. The combined run passed 851/851 unit/integration cases across 58 files in 569.99 seconds wall time and 28/28 browser journeys in 163.404282 seconds (JUnit), including four delivery journeys. Static checks (320 linted files, types and API `1.5.0` consistency), build/smoke and frozen backend/UI source reviews passed. The narrow responsive-CSS follow-up passed four delivery browser journeys in 58.082768 seconds with refreshed desktop/mobile visual checks; all thirteen selected delivery mutations were killed with green baseline/restored checks and unchanged original sources. Final build/smoke passed after the stylesheet change. The preceding 596-unit/24-browser recovery checkpoint is historical evidence only. No remote provider or full E05 qualification is asserted.

See [application delivery operations](../development/application-delivery.md), [V1 requirements](../spec/v1.md), [development plan](../plan/v1-development.md), [CI preparation](../development/ci.md) and [verification strategy](../../tests/STRATEGY.md).
