# E07 local approved agent orchestration — implementation report

Requested scope implemented and locally verified on 2026-11-14. No dedicated-server changes, paid model requests, private binding changes or Git mutations. This closes the requested orchestration software tranche; it does not certify whole E07/V1 deployment or native vendor protocol parity.

## Delivered behavior

- Immutable finite single-project/environment DAGs (12 steps): model-only Hermes, separately prepared Codex/Claude Code tasks, owner clarification. Frozen revisions, hashes, activation epoch, finite aggregate budget and authority window.
- Exact hash approval with recent verified owner passkey. Agents/service identities cannot approve. Safe rejection, cancellation and read-only reconciliation preserve owner recovery access.
- Durable deterministic child identities and source receipts; real Foundation reservations, grants, effect journal, heavy capacity and isolated existing adapters. Restarts/concurrent ticks/lost admission replies reuse the same task.
- Explicit bounded quoted dependency result transfer, never authority transfer. Unknown/failed children stop the complete plan; unknown effects never automatically resume or resubmit.
- Clarification creates a separately approved new pending continuation with only unexecuted effectful steps and inert answered-question provenance; completed prefix evidence remains on the original.
- Strict current successful Hermes whole-JSON output yields deduplicated pending proposals only. Invalid source data/overflow affects its plan, not unrelated administration. Protective stop failures retain uncertainty/resources and quarantine, with no fake stopped proof.
- Parent authority checked at admission, claim, actual dispatch and final awaited SQL/result boundary. Expiry during final Foundation success recording rolls back publication. Unknown effects revoke the parent atomically before read-only reconciliation.
- Owner HTTP/typed client/OpenAPI1.14.0, migration0022, real background scheduler startup/shutdown, structured responsive console and inert evidence display.

## Acceptance and evidence

Canonical AC-701..712: orchestration-design.md. T-AC-701..710 are behavior tests across seven focused files; T-AC-711 is the desktop/mobile owner browser journey. T-AC-712 is the composite build/contracts/lint/types/smoke/documentation qualification gate, not an extra unit test.

- Focused: 59/59 final frozen cases in 7 files (130.57s), plus one disjoint actual CodingProvider.stop-throws regression (6.88s): 60 unique. JSON overlap checked0.
- Existing relevant regression: 656 passed, 1 legacy opt-in skipped, 55 files, 533.21s. This is not a full-repository test run.
- Combined related ordinary checks:716 passed; browser results kept separate.
- Browser:2/2 real owner desktop/mobile journeys, JUnit60.418002s, no response fixtures; actual enrollment/project/profile/plan approval/clarification/new pending continuation/rejection. Inert script and viewport/ancestor clipping checked. Root visually inspected actual desktop/mobile output; mobile heading polished.
- Mutation:3 selected meaningful source-copy operators killed, baseline/restored green and production hashes unchanged. One preliminary adapter-only redundant guard survived because the later Foundation fence still protects the outcome; retained honestly, no generalized mutation/coverage percentage.
- Final TypeScript and Biome676 files passed. OpenAPI generated/check passed. Canonical final build session88974 exit0; unchanged original15s built smoke session81634 exit0, local health reachable and remote server disconnected.
- AEGIS public-source Gitleaks791 paths/~7.33MB:0 new actual credentials; one unchanged synthetic backend validation placeholder. Bun audit0 advisories; no new dependency. Semgrep and SBOM tools unavailable, no SAST/SBOM/native-CVE certification claim.
- Independent SECURITY-AUDITOR/FABER source review passes0 open confirmed findings; history and independent bounded PGlite overflow probe retained. Exact final coding stop-failure execution evidence attributed to tests satellite.
- 508 public production-source input hashes frozen in artifacts/orchestration-source-final.json, independently rechecked unchanged after final build/smoke. Protected/private basenames excluded; no private file content read.

Machine evidence: artifacts/test-results/orchestration-aggregate.json; focused JSON reports, regression/browser JUnit, mutation reports; reviews/orchestration-tests.json and orchestration-security.json. Public operations guide: docs/development/agent-orchestration.md; ADR-018; spec/plan per-story state.

## Explicit limits

Serialized children within a plan; Hermes plan children are model-only and cannot inherit data-tool grants. Arbitrary repository execution remains in the separate KVM coding path. No automatic deployment/publication/preview or new broad native Hermes session approvals. Provider bindings remain explicit and unavailable by default. No new paid-provider/native-VM/remote-host qualification was attempted. E08 billing reconciliation, E09 operational skill bundles, dedicated-host containment/autonomy/recovery, native paused-tool parity and complete V1 acceptance remain separate recorded work.
