# E06 application events and per-cell Inngest — test strategy

Date: 2026-11-12. Owner: GAUNTLET satellite. Criticity: production.
Framework: existing Vitest 5.1.0 / Node 24, PGlite integration stores; native HTTP laboratory separately identified.

## Contract before implementation

The user requested an actual local connection between application publications and jobs, and an Inngest integration per project and environment. Existing F18/F20, T17/T18/T20 and recovery HOLD requirements remain binding. The previous 1,146-test / 41-browser remediation checkpoint is a baseline, not evidence for this change. No server, production containment or all-service PITR qualification is implied.

## Acceptance-to-test mapping

| ID | Observable requirement | Layer / proposed evidence |
| --- | --- | --- |
| T-E06-B01 | A published application event and its job-delivery intent commit together, without coupling the independent app DB to the owner DB | App integration; successful and rolled-back publication |
| T-E06-B02 | Identical publication replay yields one durable intent; changed input under the same key conflicts | App integration, retained receipt |
| T-E06-B03 | Undelivered intent survives actual app-store close/reopen and user-stream pruning | Disk-backed restart integration |
| T-E06-B04 | Unavailable delivery retains intent; acknowledgement loss can replay safely without duplicating a control-side run | App + jobs integration using actual durable stores |
| T-E06-A01 | Service ingress binds exact project, environment and epoch; wrong material, foreign scope and stale authority create no run/receipt | Signed HTTP contract integration, adversarial table cases |
| T-E06-A02 | Exact authenticated replay is safe and an altered event under the same identity conflicts | Service HTTP integration |
| T-E06-A03 | Recovery HOLD, suspended project or expired preview blocks dispatch/ingestion while preserving durable intent | Lifecycle integration |
| T-E06-I01 | Each cell owns separate Inngest registration identity, endpoint authority and persistence configuration | Configuration/registration contract |
| T-E06-I02 | Trusted registered handlers run only for their exact cell and signed admitted attempt; browser input cannot register code or forge authority | Worker HTTP contract and Foundation execution integration |
| T-E06-I03 | Unknown or cancelled/stale attempts cannot materialize success or external outbox intent after lease fencing | Foundation/worker integration |
| T-E06-L01 | Trusted application publication commits a durable intent, reaches the correct real per-cell Inngest SDK worker, and completes the matching Foundation job with its business payload, for two independent cells; foreign keys and unsigned callbacks create no foreign work | Explicit native process/HTTP lab; report actual prerequisites/results |
| T-E06-R01 | The main controller defaults to no cells and accepts only bounded explicit scope/listener metadata, rejecting ambiguous fixture/native modes and reused or reserved ports | Pure main configuration contracts |
| T-E06-R02 | Preparation uses existing owner project/environment and current enabled backend settings, composes with the same owner store, binds once and releases app runtime locks on listener collision | Real owner-store and private local application preparation integration |
| T-E06-R03 | The main-process composition accepts an authenticated trusted business route, reaches its scoped terminal job in the owner dashboard's engine, and parks its producer without controller failure when the owner disables the backend | Additional explicit actual native process/HTTP lab, with post-disable pump observation |

## Existing coverage to reuse

`tests/jobs-isolation.test.ts` already covers internal Actor project access, queue HOLD/suspension/expiry, effect-key cell separation and fixture engine restart. `tests/backend-events.test.ts` already covers private SSE cursors, publication idempotency, user isolation, revocation and app-store reopen. New tests must exercise the new service boundary and durable bridge, rather than repeat those old unit cases with mocks.

## Execution order and limits

1. Agree interfaces with the production implementer before test authoring.
2. Write durable bridge and authenticated ingress regressions first; record valid RED where implementations are absent.
3. Add SDK/worker contracts and actual local Inngest HTTP lab once official pinned APIs and executable availability are known.
4. Run focused suites, types/lint and curated behavioural mutations; root owns broader regression/build gates and independent review.

All new fixtures use synthetic ephemeral authority. Do not read `.env*` or sensitive-named files. No global installation, system configuration, external deployment or Git mutation. Missing native prerequisites must be stated explicitly rather than counted as passing qualification. Coverage and mutation percentages are not measured yet; a curated mutant count is not an exhaustive score.

Official Vitest current mocking documentation was checked on 2026-11-12 at https://vitest.dev/guide/mocking.html; these tests should prefer real stores and HTTP responses, avoiding unnecessary module mocks.
