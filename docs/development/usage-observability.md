# Local usage, budgets, observability and incidents

E08 implementation checkpoint, 2026-11-14: owner control API `1.15.0`, automatic
store migrations `0023_usage.sql` and `0024_observability.sql`. Local software is
complete and locally verified with focused, browser, native-composition and static/release gates. This guide does not claim complete T26/T40 or deployed qualification.
See the [story-level status](../plan/v1-development.md#local-e08-usage-observability-and-incidents--2026-11-14)
and [verification record](../../tests/STRATEGY.md#local-e08-usage-observability-and-incidents--2026-11-14).

## Read the accounting columns separately

Each physical model request has a trusted-broker intent and an outcome, attributed
from its bound run/project/environment/task/profile/runner/skill. The controller
commits and acknowledges the intent before the broker can POST upstream. Replay
is idempotent; outcome inspection cannot execute a request or renew authority.
Continuation, retry and fallback ancestry records actual requests; accounting does
not enable new retries or fallbacks.

Token categories are exclusive: `input` excludes cache reads/writes and `output`
excludes reasoning. `cacheRead`, `cacheWrite` and `reasoning` remain separate;
`reportedTotals` preserves supplied inclusive vendor input/output totals.
`cacheWriteTtl` distinguishes `5m`, `1h`, `mixed`, `unknown` and `not-applicable`.
Absent evidence is `null`/unknown, including successful or physically stopped
requests whose vendor usage was omitted. Streaming/failure does not invent zeros.

Prices are immutable operator-reviewed USD revisions with review/expiry timestamps,
source and integer micro-USD per million exclusive-category tokens. Intent freezes
the selected `priceId`; later catalog edits cannot rewrite history. Missing/expired
prices, unpriced categories, incompatible cache TTL or unsafe totals produce unknown
estimates. No live vendor-price synchronization is configured.

`estimatedMicros`, `providerReportedMicros`, `invoiceMicros`,
`conservativeChargedMicros` and `reservedMicros` describe different evidence.
Foundation's conservative charge stays monotone: estimates and invoice reconciliation
never refund it. A physically terminal task missing a token report releases its
physical concurrency slot while charging its conservative maximum. Actual physical
uncertainty retains capacity and financial exposure, including across budget windows.

Owner invoice imports identify one project/provider/USD period and immutable line
identities; source is explicitly `operator-import` or `fixture`. Reconciliation
retains matched, unmatched, unknown and discrepancy history. It does not prove a
vendor invoice or access a billing administration account: `adminBilling` remains
`unconfigured`. No paid requests or real invoices are part of this checkpoint.

Project, profile and coding-runner budget scopes reuse atomic Foundation admission.
Each has monetary, rolling-window run-rate and concurrent-run limits. Policy CAS
uses `expectedRevision`; expansions require fresh owner authority. Reductions retain
existing obligations. Accounting/admission failure blocks new budgeted work while
protective stop, cleanup and read-only recovery remain available.

## Query the owner API

The owner console exposes Usage/Budgets and operational observability. These are
control-plane APIs, separate from the application-project SDK. Owner session,
origin/CSRF, idempotency and mutation-specific freshness checks still apply.

```text
GET /api/v1/usage?projectId=<uuid>&environmentId=<uuid>&profileId=<uuid>&runner=codex&runId=<uuid>&since=2026-11-01T00:00:00Z&until=2026-12-01T00:00:00Z&limit=100
GET /api/v1/usage?projectId=<uuid>&limit=100&cursor=<returned-nextCursor>
GET /api/v1/usage/resources
POST /api/v1/usage/prices
PUT /api/v1/usage/budgets
POST /api/v1/usage/invoices
POST /api/v1/usage/invoices/<uuid>/reconcile
```

Preserve the original normalized filters when following `nextCursor`; the short
second example illustrates cursor syntax, not a replacement for those filters.
`runner` accepts `codex` or `claude-code`; `limit` is 1–200, default 100. Start is
inclusive, end exclusive. SQL applies scope before pagination, and summary totals
cover the full selected scope independently of page size. Run exposure uses run
creation time; attempt cost uses intent time. Invoice totals become unknown for
narrower-than-project selection or partial invoice-period overlap. Overflow, legacy
runs and pruned history cannot become reassuring zero totals.

The timestamp/UUID keyset cursor binds filters and a snapshot boundary; it is not an
MVCC-frozen export for simultaneous inserts with identical timestamps. Inspect
`page.historyTruncated`, `page.retainedSince` and collection `truncated` flags.
Catalog/price/invoice/budget caps do not redefine full-scope summary totals.

Typed owner-client methods are `usageOverview(query)`, `usageResources()`,
`putUsagePrice(input, key)`, `putUsageBudget(input, key)`,
`importUsageInvoice(input, key)` and `reconcileUsageInvoice(id, key)`.
Mutation HTTP requests carry `idempotency-key`; reconciliation has an empty JSON body.
The strict contract schemas define the complete payloads.

Usage pruning defaults to a minimum 90-day retention, in bounded batches. Only safe
complete, priced, provider-reported single-attempt terminal evidence is eligible.
Active/unknown effects and reservations, invoice references, multi-attempt histories
and financial/run/reservation/reconciliation journals are retained. This is
conservative evidence pruning, not deletion of all accounting after ninety days.
Resource reporting uses actual provider `deliveryUsage` counters and typed tool-call
observations with units/provenance/completeness; allocation ceilings are not measured use.

## Interpret health and timeline evidence

```text
GET /api/v1/observability/health?projectId=<uuid>&environmentId=<uuid>
GET /api/v1/observability/logs?sourceId=<uuid>&cursor=0&limit=100
GET /api/v1/observability/metrics?sourceId=<uuid>&cursor=0&limit=100
GET /api/v1/observability/timeline?projectId=<uuid>&limit=100
GET /api/v1/overview/operational
POST /api/v1/observability/sources
POST /api/v1/observability/sources/<uuid>/records
```

Observability queries accept `projectId`, `environmentId`, `sourceId`, nonnegative
integer `cursor` and `limit` 1–200. The typed client provides
`observabilityHealth`, `observabilityLogs`, `observabilityMetrics`,
`observabilityTimeline`, `operationalOverview`, `registerTelemetrySource` and
`ingestTelemetry`. Source registration is owner administration; ingestion checks
the exact authenticated source binding and project/environment/resource ancestry.
Correlation IDs must belong to the bound scope. Labels cannot relabel another project.

Only fixed structured event types, bounded codes and allowlisted numeric metrics
are stored. There is no arbitrary stdout, prompt or free-form message ingestion.
Local controller samples measure process CPU, RSS/heap memory and local filesystem
capacity. They do not measure the dedicated server (EX44), VM guests or remote containers;
`remoteHostMetrics` remains `unavailable`.

Health distinguishes fresh, stale, missing, unavailable and unknown, retaining
observed versus desired state and timestamps. Logs retain seven days and metrics
thirty days; a minimal source health head survives without expired event payloads.
Database cursors support replay and scoped retention-gap reporting. Producer-side
sequence continuity is not proven: `sourceContinuity` is always `unknown`.
Filtered-out cursors alone are not evidence loss.

Overview reads real project/environment, job, decision, active-run, incident,
resource-headroom and usage records. Project timelines join actual journal identities
for deployment/job/agent/coding/operation/incident records; explicit identities are
correlation evidence, not inferred causality.

## Incidents and notification delivery

The existing incident lifecycle now supports nullable global/project scope and
accounting, budget, provider, archive and telemetry findings. Deduplication,
recurrence, revision-protected acknowledgement/mute/resolve and mute expiry remain
the existing mechanism. Automatic clearing requires exact detector-owned finding-key
coverage; detector failure or missing/stale evidence cannot clear another finding.

Notifications use a durable bounded outbox: intent/claim precedes delivery, and an
active physical delivery slot survives logical timeout. `acknowledged`, explicit
`failed`, `unknown` and `unconfigured` are distinct. Only explicit failures permit
bounded retries; unknown outcomes are never blindly retried. Restart/concurrent
workers and expired mute/ack state cannot justify duplicate uncertain effects.

The notifier and independent uptime observer are trusted private injected adapters,
unconfigured by default. There is no public arbitrary notification/observer URL,
remote plugin integration or actual message delivery in this checkpoint.
The repository also carries an external uptime observer, `.github/workflows/external-observer.yml`
(see [CI](ci.md#external-uptime-observer-github-actions)). It checks public edge health, certificate
lifetime and closed admin ports from GitHub's runners and relies on GitHub's own failure email. It is
independent of the notification outbox: the outbox adapter is still unconfigured and real message
delivery remains unqualified. A dead
host cannot detect itself: separate external observation and real notification
qualification remain operator work. Server-owned bounded collection, evaluation,
delivery and pruning stop with the server and isolate expected source faults.

## Resume and qualify

Hermes receipts created before E08 predate the new controller evidence source closure.
The receipt was refreshed for this checkpoint and two actual current-source Hermes
provider compositions passed. When resuming an installation with an older receipt,
refresh with `bun run hermes:runtime:install` and verify the current source receipt
before execution. Coding controller/helper source closure also changed; older E07
CLI/KVM proofs do not cover the new accounting IPC. Reinstall/qualify through the
[coding guide](coding-runners.md), retaining private bindings outside the repository.

Actual WSL production broker/authority/loopback/custom-Node-parent checks provide
local mechanism evidence. Two actual ManagedHermesProvider/pinned-Hermes/Node-IPC/Foundation composition cases passed with loopback upstream; complete current-source KVM qualification is
not claimed here. Paid vendor billing, deployed containment/metrics, real external
observer/notifier delivery, dedicated-server installation and complete E08/V1
acceptance remain separate from this implemented local software.
