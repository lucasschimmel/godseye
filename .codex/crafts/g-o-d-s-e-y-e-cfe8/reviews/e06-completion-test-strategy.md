# E06 completion — behavioral test strategy

Generated: 2026-11-12. GAUNTLET, production criticity, Node 24 / Vitest 5.1.0.
The existing 1,191 ordinary cases and two separately enabled native cases are the
historical baseline, not proof of the new autonomous topology.

## Required observable contract

| Canonical ID | Executable ID / file | Observable behavior and failure rule | Layer / evidence |
| --- | --- | --- | --- |
| T-E06-W01 | `T-E06-D02`; `jobs-runtime-config.test.ts`, `jobs-autonomous-native.test.ts` | A cell receives only its own authority; owner DSN and other keys never enter its process. Windows-injected account-location metadata is explicitly distinguished from supplied authority. | Strict corpus and actual child environment presence probe. |
| T-E06-W02 | `T-E06-D03`; `jobs-autonomous-native.test.ts`, `jobs-autonomous-crash-native.test.ts` | Owner HTTP may stop while a real event completes; supervisor SIGKILL releases owned children and the same source/journal reopens. | Compiled runtime, actual owner/API and supervisor child termination. |
| T-E06-W03 | `T-E06-D02`; `jobs-runtime-ipc.test.ts`, `jobs-runtime-broker.test.ts` | Scope, producer, immutable content and RPC sequence are connection-bound; foreign/replayed requests cannot broaden authority. | Real journals plus bounded malformed-message corpus. |
| T-E06-W04 | `T-E06-D01`; `jobs-consumer-partition.test.ts`, `jobs-autonomous-crash-native.test.ts` | Consumer partitions cannot reject/claim/fence another adapter/environment; a second PostgreSQL supervisor is refused and actual advisory-session loss stops admission. | Deterministic queues and actual independent PostgreSQL clients/processes. |
| T-E06-W05 | `T-E06-D04`; `jobs-runtime-ipc.test.ts`, `jobs-runtime-broker.test.ts`, `jobs-autonomous-native.test.ts` | Deadline/death/lost authority preserves protected uncertainty; late results cannot settle or repeat effects; bounded physical slots remain occupied. | Deferred-boundary faults and actual killed child. |
| T-E06-W06 | `T-E06-D04`; `jobs-runtime-broker.test.ts`, `jobs-autonomous-native.test.ts` | Current HOLD, epoch and admission remain effective after awaited boundaries. Read-only reconciliation cannot acquire mutation authority or outbox writes. | Real Foundation epochs and independent read-only worker probe. |
| T-E06-C01 | `T-E06-D05`; `jobs-cron-event-identity.test.ts`, `jobs-autonomous-native.test.ts` | Live cron catalog changes preserve worker identity; actual Inngest owns fires; canonical RFC3339 IDs deduplicate and stale hashes refuse admission. | Actual calendar fire and native registration SQL. |
| T-E06-P01 | Same ID; `jobs-runtime-config.test.ts`, `inngest-compose.test.ts`, `inngest-persistence-native.test.ts` | Both authenticated external stores are mandatory and independent; no embedded fallback or workflow superuser. | Input corpus, deployment contract and actual authentication/outage. |
| T-E06-P02 | Same ID; `inngest-persistence-native.test.ts` | Actual workflow sleep resumes once after engine/Redis/PostgreSQL restart, with event/run history retained. | Signed SDK, real AOF state and explicit PostgreSQL history rows. |
| T-E06-P03 | Same ID; `inngest-persistence-native.test.ts`, `jobs-autonomous-native.test.ts` | Cell/platform keys, workflows and data stores remain distinct; foreign authority and app-to-platform work cannot invoke a function. | Actual two-store authentication and platform completion. |
| T-E06-P04 | Same ID / D03,D04 lifecycle aliases; `test_jobs_services.py`, native crash tests | Failed state writes preserve the previous complete authority document; cleanup attempts every independently owned resource and refuses foreign identities. | Eight standard-library failure regressions and actual process cleanup/reopen. |

The D-series executable IDs are retained aliases from the implementation design;
W01–W06/C01/P01–P04 are the canonical public acceptance contract. Every alias is
mapped explicitly above, rather than treating a missing literal W tag as missing proof.

## Execution order and boundaries

1. Draft this contract before reading new production implementation; agree public seams
   with the production satellite. Reuse existing Foundation/backend/native PG fixtures.
2. Author deterministic admission, adapter-routing, RPC and catalog cases first. Obtain
   targeted RED evidence where the prior implementation exposes the seam.
3. Run external PostgreSQL/Redis and actual Inngest/process evidence through an explicit
   opt-in native lab. The default suite may skip that lab, but completion requires a
   separate successful lab run. A mock Redis or PGlite run cannot satisfy T-E06-P02.
4. Mutate selected authority, routing and persistence-fallback branches in isolated
   copies. Report the curated scope, baseline/restored passes and survivors explicitly;
   do not describe this as an exhaustive mutation score.
5. Root runs final static/build/focused/broader checks serially. No concurrent Vitest
   runs or artifact-building test processes share the filesystem module cache.

No UI behavior is planned to change, so an extra browser suite cannot replace these
process and persistence tests. Existing browser regression remains a root-calibrated
gate. Docker daemon was previously unavailable: native WSL evidence is acceptable
for local software durability, never as container/firewall/quota or remote-server
qualification. Coverage percentages have not been measured and will not be invented.

Highest risks are shared-journal cross-consumption, accidental owner DSN propagation,
RPC replay/late settlement, lifecycle drift while HTTP is offline, and an apparent
successful restart that silently used embedded storage. Those are mandatory rather
than happy-path-only checks. Expected effort is large for the native restart topology,
medium for authority/routing/catalog integration, and small for strict input corpora.
