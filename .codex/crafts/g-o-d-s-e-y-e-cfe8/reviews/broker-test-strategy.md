# E02.S02 local broker test strategy

Generated 2026-11-11. GAUNTLET strategy/recon only; no implementation or tests changed.

## Scope and evidence

The accepted story is owner-operated OpenBao, per-cell policies, managed static-service rotation and short task grants, with seal/unseal/recovery rehearsal. I08 separates runtime, migration, deployment, backup and controller authority. D05 requires revoking old upstream access after a controlled transition, while the UI exposes status rather than values. T08/T22/T31/T40 remain full V1 families; local slices cannot close their remote recovery/network prerequisites.

Baseline evidence supplied by the preceding checkpoint is 153 passing Vitest cases and 14 browser journeys. Existing `FoundationEngine` tests cover immutable admission, fresh exact approvals, grants, cancellation, lease/epoch fencing and reconciliation. Existing owner fixtures provide real owner sessions, the private local-command proof and an isolated PGlite store. None currently prove an OpenBao credential boundary. Coverage and full mutation percentages are not measured.

Stack: TypeScript/Hono/Drizzle/PGlite, Vitest and Playwright, Node24 application runtime. Bun package-manager migration is an independent preceding story. Context7 is unavailable; current official OpenBao API documentation was read instead. No real environment file, signing material, private credential file or production account was inspected.

The download landing page cached v2.7.1; the orchestrator queried the official GitHub release API and reports v2.7.2 Windows ZIP available. The downloaded archive, exact version and checksum must be pinned and recorded by the lab runner. No binary was downloaded or executed during this strategy task.

## Architecture critique

- `Actor.projectIds` is too broad for runtime credential lookup. Verified service identity must bind one project, environment/cell and purpose; provider paths and permitted material references come from that binding. Service input cannot select a foreign environment, arbitrary OpenBao path or policy. Knowing another identity/grant ID confers no authority.
- Metadata-only owner APIs and a filesystem-authorized private import path keep values out of browser traffic. A private import must still enforce fresh owner intent for policy/privilege changes; filesystem recovery authority is a separate explicit boundary, not a browser session shortcut.
- Opaque service proof values should be generated once, stored only as a keyed digest or hash of adequate-entropy random material, never echoed by list/get/status endpoints, and compared without secret-dependent early equality. Revocation must be checked server-side on every redemption. A proof's purpose cannot be selected by the caller.
- Service proof revocation and upstream credential revocation are different actions. Once a static value has been mounted, merely revoking its broker identity cannot remove knowledge of that value. Report outstanding upstream revocation/transition separately.
- Reuse FoundationEngine validation on every task handoff/redemption, including current run/worker, exact command, environment, grant, fence, activation epoch, cancellation, expiry, allowed tool/destination and cumulative use. A valid mint-time check does not authorize future use after cancellation.
- KV v2 version changes alone do not satisfy D05. Stage a candidate, transition through a qualified trusted runtime/target adapter, retain the prior working version until definitive transition, then revoke old upstream access and record evidence. Missing adapters must refuse the operation rather than accepting a UI acknowledgment as proof.
- Unknown provider writes, transition outcomes and revoke outcomes remain unknown. Durable intent and provider CAS/version/effect identity must prevent blind duplicate creation after timeout or restart. Reconciliation must distinguish definitely absent, succeeded and still unknown.
- Values should never enter control rows, idempotency receipts, audit summaries, browser JSON, generated OpenAPI examples or raw upstream error text. Avoid a plain low-entropy material hash in public metadata; use keyed fingerprints where material-bearing idempotency needs comparison.
- A sealed/unavailable store blocks new lookups, grants, imports and rotation. It must not delete already mounted static material or revoke a healthy running app merely because OpenBao is temporarily down. Existing static availability does not imply new cold starts can succeed.

## High-priority observable tests

Names below are proposed behavior IDs, to be bound to local acceptance aliases by the orchestrator. Tests should be authored from this list before inspecting the new implementation. All test values are ephemeral, held in memory, and never printed in successful or failed runner output.

| ID / family | Layer | Behavior and assertions |
| --- | --- | --- |
| B01 / T01,T22 | HTTP + real owner fixture | Anonymous, project service and a forged owner header cannot list/administer broker identities, policies, imports or rotation. Valid owner metadata reads succeed. No native service proof can be exchanged for an owner session. |
| B02 / T08,T22 | PGlite + broker | Create two projects, each with dev/prod environments and runtime/migration/deploy/backup identities. Runtime A-dev can redeem only its approved runtime reference; A-prod, A-migration and every B reference are denied before provider I/O. |
| B03 / T22,T34 | Parser/property | Reject foreign project/environment ancestry, unknown purpose, arbitrary path/URL/policy, extra authority fields, traversal and encoded delimiters. Generate combinations across the scope product; no cross-scope result may succeed. |
| B04 / T08,T22 | HTTP + CLI boundary | Registration/import uses the approved private mechanism; owner API accepts no material-bearing fields and exposes only bounded metadata. Missing, forged, expired and replayed local proof fails without provider or registry change. |
| B05 / T08,T37 | PGlite/concurrency | Concurrent identical identity/import commands converge to one effect. Reusing a key with changed scope/material fails. Reopen storage and replay without issuing another provider mutation. No raw material is persisted in receipt/audit/control rows. |
| B06 / T08 | Broker + identity authentication | Correct opaque service proof works; altered, expired or revoked proof fails. Rotation revokes only the selected proof and preserves B and other-purpose identities. The old proof does not work after reopening storage. |
| B07 / T08,T34 | Leakage/fault contract | Unique fixture markers in imported values/proofs/provider responses do not appear in any public owner response, audit record, bounded error, logs or generated contract. A provider exception containing the marker yields a safe error, not its original message/body. |
| B08 / T08,T40 | Fault integration | Sealed, uninitialized, unreachable, unauthorized and malformed-provider states produce distinct sanitized readiness/degraded states where useful, with no new grant/import/rotation. A previously delivered static consumer fixture retains its working material unchanged. |
| B09 / T08,T37 | Real OpenBao + broker | KV writes require CAS; a concurrent version change cannot overwrite a newer accepted candidate. A lost write response is reconciled against the recorded expected version/effect; retry does not append a second version. |
| B10 / T08,D05 | Broker + trusted transition fixture | Candidate remains staged while old service access works. Commit requires transition evidence tied to identity, candidate version and exact effect. A forged/foreign/stale receipt cannot activate or revoke. On confirmed handoff, revoke old upstream access, keep new access working, leave unrelated services unchanged. This proves broker logic only until a real target is used. |
| B11 / T08,T23,T37 | Fault/restart | Inject interruption after provider stage, after consumer handoff, and after old revoke but before local acknowledgment. Reopen control state and reconcile each case. No false success, early prior-value deletion or blind repeated upstream mutation. |
| B12 / T08,T22 | Admission | With no qualified runtime/target transition adapter, production rotation/activation remains unavailable. Owner metadata, planning and safe cancellation remain usable; a submitted checkbox/evidence string is not a qualification bypass. |
| B13 / T22,T23 | Foundation + private broker | A currently valid task may redeem only the exact permitted identity/tool/destination. Change each recorded context component independently; worker/run/command/grant/environment/fence/epoch mismatch fails. Enqueue-time authority does not replace use-time validation. |
| B14 / T22,T24 | Clock + real store | Expire grant/lease or cancel task between issue and redemption; old handoff is denied. Advance activation epoch and reject both prior task proof and old service binding where activation fencing applies. Renewal cannot widen scope or exceed parent lifetime. |
| B15 / T22,T26 | Concurrency | Parallel redemptions cannot exceed single-use or cumulative-use/cost limits. Revocation racing a queued redemption follows an explicitly serialized authority boundary; a completed revoke prevents later redemption. |
| B16 / T08,T22 | Real OpenBao | Authenticate the actual scoped role/proof, then directly attempt another cell's KV data and metadata, policy mutation, role/token creation, mounts/sys and broader listing. Exact expected denies must occur at OpenBao, not only in the GODSEYE wrapper. Default/root policies must not be attached. |
| B17 / T08,T22 | Real OpenBao | Short nonrenewable task credential expires or reaches its use limit as configured; direct lookup/read then fails. Revoke through the supported accessor/lease boundary and verify access fails without exposing proof values. Wrapped delivery, if used, validates exact creation path and unwraps once only. |
| B18 / T08,T31 | Real non-dev OpenBao | Initialize only a fresh lab instance, verify sealed before unseal, require the configured threshold, reject incorrect fragments, unseal and read the known fixture. Seal again and observe broker fail-closed state. No fragment/root material enters runner logs or control metadata. |
| B19 / T31 | Real non-dev OpenBao | Stop process, restart the same encrypted raft data and verify it starts sealed. Unseal using independent in-memory fixture recovery material; recover scoped role/policy/version and retain cross-cell denials. This proves local cold-start recovery only. |
| B20 / T31 | Real OpenBao snapshot lab | Restore a lab snapshot into separately owned replacement temp capacity with original process unavailable; recover using the correct retained material, verify fixture value and ACL denials, keep consumer/jobs inactive. Missing or wrong recovery material cannot produce success. Record that same-machine fixture retention is not off-host qualification. |
| B21 / T33,T08 | Browser | Owner sees sealed/unavailable/provider-ready states, scoped identity metadata and rotation stages with no value reveal. Fresh confirmation gates sensitive policy actions; service-only access cannot open these pages. One browser journey supplements API assertions. |

## Parser, property and mutation targets

Bound fuzz cases target scope IDs, purpose enums, material-reference names, provider JSON/status/size, TTL/use-limit bounds, proof parsing and rotation receipts. Property checks exercise project × environment × purpose × revoked/active × current/prior epoch. Keep fixed seeds and bounded iterations; report those bounds rather than calling them exhaustive.

New-code mutation experiments should remove one meaningful guard at a time: environment match, purpose match, live revocation check, expiry check, current epoch/fence, exact staged-version receipt, CAS, last working-version preservation, provider-error sanitization and no-adapter admission. Mutation evidence must be tied to these new broker behaviors. The old nine selected mutations are historical evidence and cannot establish this module's mutation score.

## Feasible real Windows lab

1. Download a pinned native Windows amd64 ZIP from the official OpenBao GitHub release, alongside its official checksums/signatures. Verify checksum and, when tooling permits, release signature. Record version/archive hash and signature verification status. Never install globally or reuse user OpenBao state.
2. Extract only the executable into ignored local tooling. Create a disposable private temp root using the existing protected-directory helper. Allocate loopback API and cluster ports, write only non-sensitive raft/listener configuration, and spawn a bounded non-dev server. `disable_mlock`/TLS-disabled loopback, if required in this Windows fixture, are explicit lab limitations, never production recommendations.
3. Do not use `bao server -dev` for recovery evidence: it is initialized/unsealed automatically and may print root material. Initialize through HTTP with a small fixture-only Shamir threshold (for example three shares/two required). Keep the returned shares and root proof in test-process memory and send them only to that owned loopback server. No CLI arguments, environment dumps or test attachment may carry them.
4. Configure a non-root limited broker role/policy, exact per-cell KV v2 and service roles. Exercise actual adapter calls and direct forbidden requests with service proofs. Root authority is only the lab provisioner; passing tests with root alone does not qualify the broker policy.
5. Use separate test-process lifecycle operations for seal, restart and snapshot replacement. Capture bounded sanitized startup diagnostics that exclude initialization responses and material. Never print raw HTTP request/response objects on assertion failures; assert booleans/status/code/metadata instead.
6. On completion or failure stop and await owned process exit, close stores/streams and remove only resolved owned fixture paths. Prove process/port cleanup. Apply distinct measured bounds to server startup, HTTP, child lifetime and full recovery scenario; do not put a long child deadline inside a shorter global test deadline.

Official native Windows artifacts make this feasible without Docker. Feasibility is not execution: every lab case remains `not_run` until the actual binary, policy and requests run successfully. If bootstrap fails, report the exact unavailable gate and retain first-party tests without relabeling an HTTP simulator as real OpenBao.

## Execution order and acceptance limits

First finish Bun's frozen-lock install and baseline regression. Then implement the fixed broker contracts and scoped identity/metadata boundary; author B01–B08/B12 before provider integration. Next validate the actual OpenBao adapter/policies with B09/B16–B19, then task access B13–B17 and rotation reconciliation B10–B11. Browser B21 and snapshot replacement B20 follow a stable API. Full regression/build/contract generation and a fresh security review close the local slice.

Highest-risk work is integration/recovery, not a fast scaffold: identity and proof checks are small-to-medium test tasks, rotation concurrency and Foundation grant linkage are medium, real binary lifecycle/snapshot fixtures and target transition qualification are large. No hours estimate is defensible before the selected binary and adapter contracts run. Prioritize scope denial, no-value leakage and sealed fail-closed behavior first.

Real PostgreSQL role/password transition remains unqualified until an actual database target is exercised; a fixture consumer proves state-machine logic only. The future server's TLS/private network, OS sandbox, off-host recovery custody, cell mount isolation, backup transport and real controller role isolation remain E00/E02.S03/E03/E12 work. Existing static availability while sealed is a property of retained consumer material, not permission to embed controller authority in app images or build contexts.

## Typed result at strategy handoff

```json
{
  "coverage": {"line": null, "branch": null},
  "mutation": {"score": null, "survivors": []},
  "flaky": [],
  "layers_run": ["spec-to-risk reconnaissance", "existing-boundary source inspection", "official OpenBao documentation lookup"],
  "gaps": ["all new broker behavior tests pending", "real OpenBao binary and role policy not executed", "real upstream static rotation not qualified", "off-host and server isolation qualification deferred"]
}
```

## Primary references consulted

- [OpenBao download page](https://openbao.org/downloads/) and [official releases](https://github.com/openbao/openbao/releases): native Windows artifact feasibility; pin exact actual release before execution.
- [AppRole](https://openbao.org/docs/auth/approle/) and [token API](https://openbao.org/docs/api/auth/token/): authenticated role constraints, limited service/task proof lifecycle.
- [KV v2 API](https://openbao.org/docs/api/secret/kv/kv-v2/): version/CAS semantics.
- [Response wrapping](https://openbao.org/docs/concepts/response-wrapping/): single-use delivery and exact creation-path validation when adopted.
- [Seal/unseal](https://openbao.org/docs/concepts/seal/) and [health API](https://openbao.org/docs/api/system/health/): sealed startup and readiness behavior.
- [Storage recovery](https://openbao.org/docs/concepts/storage/) and [raft snapshot API](https://openbao.org/docs/api/system/storage/raft/): encrypted-data backup/restore semantics.
- [Database engines](https://openbao.org/docs/secrets/databases/): static and dynamic upstream roles are separate from arbitrary KV versioning.

## Execution update — 2026-11-11

The pinned Windows2.7.2 native archive was downloaded and its published SHA256 verified. `scripts/install-openbao.mjs` now reproduces this setup without a global install and records a non-sensitive manifest. Linux/macOS x64/arm64 extraction paths are implemented but were not executed here. Release signature verification was not performed. The exact Windows archive hash is `b058d30eac461e78e56305d3aa7371c061405a060f364aa20999dc3a309264f4`.

Actual binary execution rejected the obsolete `file` backend. The fixture therefore uses supported embedded Raft storage in a private disposable directory. It starts initialized but sealed, retains three Shamir shares with a threshold of two only in memory, reaches an unsealed leader, writes KVv2, cold-restarts sealed, unseals and recovers the retained value. Root and shares never enter files, reports or runner output. Single-node election readiness and Windows Raft initialization use measured bounded waits.

Implemented test sources: `openbao-provider.test.ts` (8 real provider cases), `access-provider-faults.test.ts` (5 owned transport-simulator cases), `access-authority.test.ts` (13 actual PGlite/broker cases), `access-task.test.ts` (10 actual FoundationEngine/broker cases), `access-rotation.test.ts` (11 actual PGlite/broker cases) and `access-cli.test.ts` (3 private child-process/real-OpenBao cases). Each targeted slice passed. The orchestrator records the final combined run; these are not a whole-V1 result or coverage percentage.

The five CLI invocations in the primary private-channel case measured73.077seconds, with88.36seconds for the two-case suite including real OpenBao startup. Each CLI process is bounded at45seconds. The scenario deadline is explicitly composed as five child deadlines plus30seconds for seed/reopen/verification; the lock-denial case has one child deadline plus30seconds. No global timeout or behavioral assertion was relaxed.

Six new selected behavioral mutations extend the existing nine-scenario isolated runner: task-vs-static purpose, current activation epoch, recomputed material HMAC, actual controller policy text, blank transition evidence and single-charge task use. All fifteen selected mutants were killed; baseline and restored selections each passed15 cases, none survived or were invalid, and the original source digest check passed. Finished2026-11-11T17:17:07.824Z. Original source files are never mutated. Full mutation and coverage percentages remain unmeasured.

Fresh review confirmed three private-boundary regressions, now covered: identity revocation/epoch changes during rotation lookup cannot dispatch an adapter; mutable caller context/use cannot replace a cancelled run with another live grant; and copy-then-fail synchronous/async consumers retain a committed metadata-only attempt and unknown outcome without a delivered-success claim. Explicit provider-auth renewal rejects replacement without --replace and preserves existing authority, then admits the new exact limited authority with --replace. Targeted regressions pass. Historical15/17 mutation reports are retained. The final18-case selection passed on corrected sources:18 killed,0 surviving/invalid, baseline18/restored18 passed and original source digests unchanged. Finished2026-11-11T17:27:38.164Z.
