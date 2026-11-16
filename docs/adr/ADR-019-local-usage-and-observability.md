# ADR-019: Evidence-bound local usage and operational observability

Status: accepted for local implementation, 2026-11-14; requested local software complete and locally verified.

## Context

E08 needs useful operational views and costs without confusing reservation maxima,
vendor token reports, price estimates and invoices. Existing Foundation authority,
admission and monotone charging remain authoritative. Existing IncidentEngine owns
incident lifecycle. Local execution evidence cannot qualify a remote host, vendor
billing account or notification channel.

## Decision

Journal every physical model intent through acknowledged trusted broker/controller
IPC before upstream POST. Derive attribution from existing run bindings and retain
immutable outcomes, request identity and actual retry/continuation/fallback ancestry.
Normalize exclusive token categories while preserving vendor totals/cache TTL.
Freeze immutable reviewed price revisions at intent; missing evidence remains unknown.

Keep estimates, vendor-reported cost, imported invoices, conservative Foundation
charge and active reservation separate. Invoice reconciliation never refunds a
Foundation charge. Physically stopped work releases concurrency even if financial
reporting is absent; truly unknown physical work keeps its conservative exposure.
Enforce project/profile/runner rolling budgets, rates and concurrency atomically
through the existing Foundation path.

Use scoped SQL queries, bounded keyset pages and independent full-scope summaries.
Expose overflow, legacy evidence and retention loss as incomplete/unknown. Preserve
active/unknown and financial exception histories during minimum ninety-day evidence
retention. Report actual provider/tool observations separately from allocations.

Accept only source-bound structured telemetry, fixed events and bounded metric names.
Measure the local controller process/filesystem; do not label it remote host evidence.
Retain seven-day logs, thirty-day metrics and a minimal health head. Database cursors
describe retained records; producer continuity remains explicitly unknown.

Extend existing incidents with nullable global/project scope and detector-owned exact
key coverage so source failures cannot falsely clear findings. Use a durable bounded
notification outbox with claim-before-effect, physical active slots and no blind
retry of unknown delivery. External uptime observation and notification delivery are
private injectable adapters, unconfigured by default.

Publish owner API `1.15.0`, typed owner-client methods and migrations `0023`/`0024`.
Global telemetry does not enter the application-project SDK. No public adapter URLs,
new execution authority, paid calls or real outbound messages are introduced.

## Consequences

The [operator guide](../development/usage-observability.md) documents unknowns,
retention, exact queries and current-source native requalification. Existing Hermes
and coding source receipts must be refreshed/qualified after the new accounting IPC;
older green native proofs cannot qualify changed controller/helper sources.

Local invoice fixtures and adapter tests verify software behavior. Paid invoices,
provider administration, a separate live observer/notifier, server (EX44)/guest metrics and
deployed containment remain explicit qualification boundaries. Final E08 acceptance
must cite current independent regressions, composition, browser, mutation and static
gates rather than sum overlapping historical test counts.
