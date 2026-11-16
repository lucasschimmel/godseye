# Coding runner core implementation report

Status: implemented; targeted TypeScript check passes. Independent tests and fresh review remain orchestrator-owned. No production runtime/server wiring was edited by this worker. No Git command, paid request or system mutation performed.

## Owned paths

New: packages/contracts/src/coding.ts; packages/contracts/src/coding-endpoints.ts; packages/core/src/coding.ts; packages/core/src/coding-state.ts; packages/core/src/coding-preparation.ts; packages/core/src/coding-execution.ts; packages/store/src/coding-schema.ts; packages/store/migrations/0021_coding.sql; apps/control-api/src/coding-routes.ts; apps/console/src/components/agents-coding.tsx.

Integrated: packages/contracts/src/index.ts, foundations.ts, http-endpoints.ts; packages/core/src/index.ts, infrastructure.ts, infra-heavy.ts; packages/store/src/schema.ts; apps/control-api/src/app.ts; packages/control-client/src/index.ts; apps/console/src/components/agents-panel.tsx; generated docs/contracts/control-openapi.json.

## Behavior

Durable immutable repository/commit preparations work without KVM. Separate CodingEngine consumes Foundation coding.run tasks, exact source verification before queue, canonical budget reservation and global heavy-task admission. CodingOptions.capacity explicitly bounds qualification resources including VMM overhead; singleton coding resource pool stays occupied through uncertain cleanup. Undefined capacity/provider fails closed. Actual physical pool/resource isolation remains runtime-owned evidence, never inferred from config/fakes.

Strict private CodingProvider seam supports Codex and Claude Code with typed qualification, task correlation, nonrepeating submit/inspect/stop. Qualification checks exact preparation/source/runner, <=60-second freshness, broker-only network, finite resources, bounded API billing. Native execution must independently enforce these facts. The public API exposes logical worktree identity/disposition, strict patch/test/preview/usage evidence, explicit unavailable states and owner management. No user-controlled host paths, argv, URLs or upstream session IDs.

Artifacts verify actual UTF-8 sizes and SHA-256; requested failed checks retain known failed evidence/patch rather than losing them. Reconciliation suppresses cancelled/epoch-changed/scope-changed/expired output while resolving physical truth. Closing dispatch/lease guards and synchronous deadline checks roll back result acceptance if authority expires during awaited writes. Cancellation journals revocation before stop; unresolved physical cleanup keeps unknown/quarantined state and retained capacity. Cost settles conservatively at full admitted ceiling; vendor subscription billing never counts as free.

## Validation

`node node_modules/typescript/bin/tsc --noEmit` passed after final changes.
Targeted Biome formatting/lint on all 19 touched TypeScript/TSX files completed; final fixes on four changed files passed.
`node --import tsx scripts/contracts.mjs` regenerated current OpenAPI successfully.
No independent/native/browser test result is claimed here; tests worker owns those checks.

## Follow-ups for orchestrator

- Review/tests may refine final lease/reconciliation and partial enqueue failure semantics.
- Production remains unavailable until runtime physical KVM, CLI and hard billing qualification; no server wiring claims otherwise.
- Existing API version is retained at 1.12.0 pending root additive-version policy decision.
- The initial UI deliberately exposes no verified delivery preview; it reports unavailable or not requested, and never turns CLI URL output into deployment authority.

## Review closure

CR-CODE-01..04 implemented; exact production path hashes and validation in reviews/coding-runners-core-fix-freeze.json. Focused coding tests 61/61 passed, including held-environment physical reconciliation. API is now 1.13.0, OpenAPI matches. Final targeted Biome and TypeScript pass. Generic Foundation cancellation and browser download regressions remain GAUNTLET-owned. No runtime/server edits.
