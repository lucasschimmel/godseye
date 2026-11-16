# Control foundations

Status: local E01 implementation, 2026-11-11. The broker has no implicitly registered execution adapter. A connected page, plan or identifier does not establish provider qualification.

## Admission and authority

The contract package defines strict action, resource, plan and outcome schemas. A registered reference has a server-known kind and project/environment ancestry. Plan admission verifies the selected target and command references in that scope, the expected revision and a qualified adapter from the trusted constructor registry. Caller-controlled UUIDs do not prove ownership, and the browser cannot register an execution adapter or submit worker lease authority.

Plans are immutable snapshots with a canonical hash, cost ceiling, permitted tools and destinations. Required owner approval binds that exact plan/hash and a recent server-verified owner session. Approval expires after five minutes and is checked again at dispatch. Services cannot approve their own work. Provider payloads and real resource mappings still belong to the owning runtime/data/delivery integrations.

Project/configuration writes and execution admissions use durable idempotency records. Identical replay returns the recorded resource; changed parameters return 409. Optimistic revision checks prevent stale updates. Owner reconciliation is itself an idempotent command; replay does not call the provider a second time.

In the infrastructure composition, reapproving a nonterminal run in `awaiting_approval` invokes the
trusted heavy-task admission hook in the same approval transaction. A full queue returns
`HEAVY_QUEUE_FULL` (429) and rolls back the new approval, request receipt, audit and run changes.
After capacity is freed the same safe retry may succeed; successful replay does not consume another
slot. This requeue check does not repeat physical resource reservations and does not re-admit runs
that are already queued, running or terminal.

## Durable execution

`FoundationEngine` persists the run, stable effect identity, reservation and authority before dispatch. `runFoundationWorker` owns an awaited consumer loop; isolated tests drive deterministic ticks against the same implementation. Leases, heartbeats, monotonic fencing and environment activation epochs reject old workers and grants.

Task grants bind a worker/task, environment, epoch/fence, permitted tools/destinations and cumulative cost. Cancellation/expiry revokes authority and records cleanup or uncertainty visibly. A known in-flight effect is not made replayable merely because its process or lease ended.

Provider exceptions, expired work, missing/blank evidence and malformed outcomes remain `unknown` when the external result cannot be established. Reconciliation looks up the surviving effect identity; it never blindly resubmits the original external action. A definitive result requires usable provider evidence. Actual adapters must prove their lookup/idempotency/containment behavior during qualification.

Budget admission reserves atomically against the account. Settlement records known actual cost, retains uncertain reservations and preserves an overrun incident even after a definitive receipt resolves the reservation. Concurrent requests cannot independently spend the same headroom. These are control-ledger amounts, not a claim of complete LLM/provider usage metering.

## Retention, migrations and audit

Resolved request receipts survive at least seven days after terminal outcome; unresolved intents do not expire. Effect evidence survives the configured restore window plus seven days, with a thirty-day default restore window. These controls preserve non-rewound evidence for later recovery integrations; they do not implement project PITR by themselves.

Ordered SQL migrations are applied under a database lock and transaction. Stored checksums reject edits to already applied migrations; legacy local data can be initialized into this history without being recreated. The PostgreSQL driver is prepared, but local PGlite tests do not establish real PostgreSQL multi-process guarantees.

Audit export produces canonical paginated records, a continuation cursor and an anchor. Verification checks chain integrity, gaps and truncation against an independently retained trusted anchor. Exporting a chain and an anchor from the same compromised host does not make that host trustworthy. Actual protected off-host transport/storage and recovery remain qualification work.

## HTTP contracts and client

The current first-party control API uses version `1.9.0` in `x-godseye-api-version`. Its shared request/response schemas generate [OpenAPI 3.1](../contracts/control-openapi.json) and validate responses consumed by the console/private control client. The owner-only routes cover `/foundation/resources`, `/foundation/budgets`, `/foundation/plans`, `/foundation/runs` and audit export/anchors. Worker claim, finish, heartbeat and activation-epoch methods are not browser APIs.

The internal `@godseye/control-client` is for the owner control plane. It is not the hosted-application/project SDK promised by F19/E04. Better Auth's pinned WebAuthn wire protocol is a separately referenced vendor boundary; it is not replaced by an arbitrary first-party JSON command.

Generate the committed OpenAPI artifact with `bun run contracts:generate`. `bun run contracts:check` verifies it against the runtime schemas and runs within `bun run check`; generation alone does not qualify an external provider.

Schema-invalid payloads return 422, JSON syntax errors return 400, replay/revision conflicts return 409 and unavailable/unqualified capabilities return 503. Required mutation keys and supported response versions are checked explicitly. The local default registry contains no real provider, so a valid typed command still cannot provision a server or deploy a site.

## Evidence boundary

Real PGlite cases exercise concurrent admission, scoped references, approval freshness, actual consumer ticks, restart, fencing, grants, budget uncertainty, retention and independently anchored export verification. Auth HTTP/browser cases separately exercise the owner admission path. Current source is described by [ADR-004](../adr/ADR-004-owner-authority-and-foundations.md); the [verification strategy](../../tests/STRATEGY.md) records the passing combined local run and its limits.

E00 host/network/sandbox qualification, real PostgreSQL concurrency, protected off-host destinations, Jenkins/agent execution, project recovery and actual provider compatibility remain outside this local implementation claim.

The E02.S02 [service-access broker](service-access.md) reuses these execution controls. It validates task authority on each material redemption and after provider I/O, then checks authority again at the synchronous private handoff. A grant ID, a project-wide Actor or a KV version cannot establish sufficient service/rotation authority. Native OpenBao's local ACL/CAS/seal/recovery cases are separate evidence from unqualified real database and deployment transitions.

## Windows private-state startup

Local Windows startup still replaces the private root's DACL with the current operator's protected
rule and rejects shared roots, links, hard links and paths outside the controlled directory. Reopening
a populated PostgreSQL/PGlite tree first batches read-only inspection of descendant permissions.
Only an exact canonical inherited operator-only FullControl rule avoids a redundant reset; changed
or unrecognized entries still take the individually checked repair path. Each descendant is checked
again before that decision. Inspection failure refuses startup rather than skipping protection.

This reduces repeated process launches while preserving the existing guards. The fixed CLI test
deadline has not been increased. Diagnostic measurements and the associated native regressions are
recorded in the [verification strategy](../../tests/STRATEGY.md); they do not qualify the future
server OS or establish a general performance guarantee.

Owner recovery and private access CLI administration remain independent of the optional Inngest cell
configuration. They select the administrative configuration path, which starts no cell and ignores
unrelated job-runtime JSON. The ordinary server still validates that JSON strictly. Explicit local
mode and owner-state process exclusion continue to apply. Actual offline child-process recovery with
malformed job configuration is covered by `tests/owner-runtime.test.ts`, alongside the Windows ACL
drift/link regressions; this is the local I13/T01 recovery-independence case.

The fresh complete 1,191-case default run passed with all three added Windows ACL regressions and
the malformed-runtime-configuration recovery assertion included. The
[final evidence table](../../tests/STRATEGY.md#final-frozen-local-evidence) preserves the initial failed
batch, serial reproduction, correction and independent source/security review. The two opt-in
Inngest native cases were run separately; no server OS or full I13 family qualification is inferred.
