# E01 completion verification strategy

Scope: local durable execution foundations, 2026-11-11. This extends the existing 74-case local checkpoint and does not certify remote providers, PostgreSQL multi-process execution, container boundaries, real off-host storage, authentication ceremonies or complete V1 release families.

Use Vitest against fresh real PGlite stores, fixed/injected clocks and an in-process qualified fixture adapter. Test the actual consumer entry point and committed results, not only helper transitions or mocked method calls. A temporary on-disk database exercises reopen/restart. Reuse the existing owner/project helpers, strict domain errors and audit primitives; source implementation belongs to the engine worker.

| Priority | Behavior | Evidence families |
| --- | --- | --- |
| Highest | Concurrent identical requests converge to one operation, changed payload conflicts, invalid project/environment/reference ancestry leaves no admitted intent | T09, T34, T37 |
| Highest | Immutable proposal hash/revision and recent owner verification bind approval; services, stale verification and expired/replayed approvals fail | T22, T37 |
| Highest | Expiry and new activation epochs fence stale writes; expired submitted effects become uncertain and are reconciled without blindly executing again | T07, T18, T23, T37 |
| Highest | Concurrent budget admission cannot overspend; unknown outcomes keep reservations, settlement and actual overshoot remain visible | T24, T26 |
| High | Grant authorization checks actor, resource, tool/destination, expiry and revocation; cancellation revokes authority and preserves cleanup failures | T22, T24 |
| High | Worker tick consumes a persisted intention after reopen; heartbeat and provider evidence preserve a single logical effect | T18, T23 |
| High | Audit export cursor continuity and a separately supplied anchor reject tampering, gaps, reordering and a truncated tail | T25, T37 |
| High | Retention never expires unresolved intent and preserves effect evidence for the advertised restore window plus seven days | T07, T18, T37 |

Target roughly 20–30 behavioral scenarios, with parameterization only where it tests a distinct denial. Keep fixtures bounded: no arbitrary sleeps, no remote side effects and no broad snapshots. Invalid outcome tests must assert surviving durable state as well as an error. Concurrency tests use independent engine objects sharing the store rather than pretending PGlite proves separate PostgreSQL process isolation.

Execution order: strict admission/reference checks; leases/consumer/recovery; approval/grant/budget checks; audit/retention. Existing checkpoint tests remain regression gates, with intended repository-update idempotency signature changes adapted explicitly. Coverage and mutation percentages are unmeasured until a real measurement is run; counts are not a substitute.

## Executed checkpoint

Four new test files contain 32 expanded behavioral scenarios. The final targeted run passed 32/32 in 25.89 seconds against real PGlite. An earlier strengthening of the overshoot case first failed on a real missing-evidence reconciliation bug, then passed after remediation. The strengthened scenario checks that missing receipt evidence keeps the reservation/uncertainty, definitive evidence closes the run, the overrun incident remains and actual usage is charged once. A separate whitespace-proof case confirms malformed proof preserves known cost and uncertainty through reconciliation until an actual receipt arrives. All five new test/helper files pass Biome.

The suite also caught a permanently held overrun reservation during the initial 30-case pass (29 passed, one failed); that defect was fixed before the 31-case green run. Added consumer cases reject forged scope/effect/command context and recheck approval after enqueue while allowing unrelated queued work to continue.

Minimal legacy compatibility changes add seven repository-update idempotency keys across four existing files and change two project-schema expectations from 400 to final-contract 422. Malformed JSON and invalid idempotency keys retain their existing separate handling. No authentication expectations were weakened. A final application-wide regression pass remains the parent integration gate after owner authentication is connected.
