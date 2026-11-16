# Local E04 application backend verification strategy

Generated: 2026-11-12. Owner: GAUNTLET satellite. Criticity: production. This strategy
continues the frozen 851-unit/28-browser delivery checkpoint without claiming those
historical executions as evidence for E04. TEST_FRAMEWORK = Vitest 5.1.0 and
Playwright 1.65.0; Node.js 24 runs tools and application code, Bun 1.4.4 manages the
workspace. Application cells use actual independent PGlite stores locally; their
process/OS isolation and production PostgreSQL service roles remain E00 qualification.

## Risk and scope

The new boundary is deliberately independent of the owner control plane. App-user
authentication must not grant owner authority, and neither a valid owner cookie nor
another project's credentials may become an app-user session. File paths, quotas,
resumable offsets and expiring grants must survive races/restarts without exposing
private bytes. Realtime must not turn a user-scoped domain feed into a generic table
subscription or retain unbounded slow-client buffers. The SDK must validate actual
HTTP responses and preserve these same boundaries rather than masking errors.

No new E04 tests existed at strategy time. Line/branch coverage is not measured;
selected source mutations will be reported as bounded probes, not an exhaustive score.

## Ordered verification matrix

| Family / proposed target | Observable scenario | Layer / priority / effort |
| --- | --- | --- |
| T14 / app-backend runtime, auth and store | Real signup/signin/session/logout; same email can exist in independent project/environment stores; A cookie cannot authenticate B; owner/app cookies are mutually unusable; exact origins and methods; expiry/revocation; restart preserves identity; lifecycle HOLD denies effects after awaited work | HTTP integration / high / large |
| T14/T34 / app contract | Reject hidden privilege, scope, filesystem and provider fields; malformed JSON, unsupported versions and errors contain no auth/session/material leakage; unknown native BetterAuth routes remain unavailable | HTTP and strict schema / high / medium |
| T16/T30 / private file service | Real streamed bytes, SHA-256 and metadata; private user ownership, cross-cell/user denial; opaque server names; traversal/link escape refusal; finite object/total limits with concurrent reservations; interrupted upload resumes at exact offset; mismatch cannot commit; delete/tombstone retains honest cleanup/recovery state | Real filesystem/HTTP integration / high / large |
| T16 / download grants | Exact file/user/cell binding, finite expiry, bearer/replay policy, session/grant revocation, no default public URL; byte ranges and streaming remain bounded | HTTP integration / high / medium |
| T17 / domain events | Trusted server-only publish; exact recipient/cell; durable cursor replay across restart; expired/foreign/ahead cursor requests refetch; retention and payload bounds; authorization rechecked during stream; cancellation releases connection; slow subscriber cannot accumulate unlimited bytes | Stream integration / high / large |
| T15/T34 / TypeScript SDK | Actual runtime fetch exercises auth/files/events; version/shape errors surfaced; typed custom route helper; UTF-8 SSE chunk parsing, limits, cursor and abort/reconnect semantics; no owner/control/Cloud Supabase dependency | Contract and integration / high / large |
| T15/T34 / backend template | Explicit local fixture configuration, separate owned data/files, default fail-closed runtime admission, real loopback HTTP smoke, restart persistence; no real account enrollment | Process/HTTP / high / medium |
| T33 / owner backend management | Authenticated desktop/mobile navigation, usable metadata/configuration, honest unavailable/running/local states, held environments excluded, fresh owner changes and strict API; no secret reveal or fake deployment claim | Owner HTTP and browser / high / medium |

## Execution discipline

1. Freeze the public factory/configuration and route contract with the implementer.
2. Auth vertical slice: write failing tests against real factories, run focused tests,
   resolve boundary defects, retain exact result before files begins.
3. Files vertical slice: own temporary directories, real bytes, concurrent requests,
   cleanup without recursive traversal of unknown paths; run focused tests.
4. Realtime vertical slice: read bounded chunks through actual streams with explicit
   cancellation/deadlines, test durable recovery and revocation.
5. SDK/template and owner UI flows compose actual first-party components.
6. Freeze production, run the combined regression once; only new failures/edits justify
   repeats. Root schedules global suites, build and source review.
7. Selected mutations cover removed cell/user checks, ignored quota/offset/hash,
   expired grant/cursor, disabled stream revocation and SDK version/shape checks.
   Require clean baseline/restored tests and unchanged original source hashes.

Existing owner fixtures, PGlite patterns, request helpers and browser enrollment are
reused where they preserve actual boundary behavior. Native BetterAuth internals are
not tested for their own sake; user-visible authentication and authorization are.
All generated accounts, keys, file bytes and URLs are synthetic and disposable.

## Explicit limits

No server changes, external OAuth account setup, production secrets, remote GitHub,
Jenkins, Coolify, Docker/gVisor containment, hard filesystem quotas, off-host backup
or full all-service recovery activation is exercised or certified by this tranche.
The optional OAuth mechanism can be validated through configuration/denial contracts
without claiming a live provider sign-in. No test may silently skip a mandatory case
because a mechanism is unavailable; record the boundary and surface it to root.

## Actual focused verification history

The completed focused execution covered **121 cases across fourteen files** in
**258.67 seconds**. It passed118 and failed three stale fixture assumptions after
the producer added instance-lock metadata and bounded file-list pagination. The
actual file isolation assertions were preserved; the test now counts only opaque
UUID object names, compares the linked-root directory before/after, and expects the
empty public page `{files:[],nextCursor:null}`. The same three affected scenarios
passed **3/3 in22.30 seconds** afterward. Evidence is preserved separately as
`artifacts/test-results/backend-focused.xml` and
`artifacts/test-results/backend-files-post-lock.xml`. This is not a claim that the
first complete focused execution passed121/121.

The focused files cover:

| File | Actual scenarios |
| --- | ---: |
| backend-auth.test.ts | 24 |
| backend-control.test.ts | 23 |
| backend-files.test.ts | 17 |
| backend-file-limits.test.ts | 7 |
| backend-file-faults.test.ts | 4 |
| backend-download-limits.test.ts | 6 |
| backend-oauth.test.ts | 3 |
| backend-events.test.ts | 9 |
| backend-stream-limits.test.ts | 5 |
| backend-recovery.test.ts | 5 |
| backend-template.test.ts | 2 |
| backend-request-fencing.test.ts | 1 |
| sdk-integration.test.ts | 7 |
| sdk-contract.test.ts | 8 |

The actual HTTP template case starts source code, authenticates through the real
SDK, exercises the authenticated `/hello` route and uploads bytes, then restarts
the **compiled backend artifact** against the retained private store/files and
verifies the same session and bytes. The second artifact case builds/imports the
actual browser SDK, inspects its no-server-import metafile result and typechecks an
independent TypeScript consumer. These are included within121, not additional lab
counts.

Configured OAuth is exercised against a disposable real local HTTP provider with
PKCE, actual exchange/profile requests, altered-state denial and exact callback
origin denial. No real provider account was contacted. The deliberately narrowed
first-party OAuth configuration supports explicit endpoints; arbitrary third-party
plugin callback configuration is not promised.

Actual recovery exports/restores private bytes and the captured auth/config state
into another held environment of the same project. A later user/file is excluded
from the recovery point. Component timestamps retain the local clock domain and
an unknown external PostgreSQL recovery point/gap; no all-service activation is
claimed. New sessions are not restored. Fault cases force the second database
transaction to roll back after physical append/unlink, then reopen the actual
store and verify retained reservations, exact-chunk reconciliation and tombstone
cleanup. A shortened physical prefix exercises crash-safe upload recovery.

Earlier defect discovery is intentionally retained: reserved SQL `offset` and
prepared multiple-statement startup failures; foreign OAuth callback acceptance,
native auth response API-version loss, a PGlite initialization lock inside PGDATA,
and a custom POST callback querying the global PGlite client from inside an active
transaction. All received narrow producer fixes and actual regression checks. The
custom-route run failed its scenario/cleanup deadlines; the separate combined run
holding the same old module was deliberately stopped before completion. Neither
is reported green. The external TSC consumer needed
the current TypeScript7 `--ignoreConfig` flag; that was a fixture correction.

Three new owner browser journeys passed **3/3 in55.6 seconds** before the final
padding refinement. Desktop/mobile screenshots were actually inspected, revealing
flush panel padding that the root corrected. Whole button/text/clipping-ancestor
assertions are retained; the root's complete browser regression will validate the
final styled source and refresh screenshots. These three journeys supplement the
existing28 rather than imply a second full-suite execution.

Selected mutation suite M74–M86 is prepared in the existing temporary-copy runner.
Every exact target is unique after formatting. It covers listener/store/user scope,
strict signup, quotas, digest and grant expiry, event cursor signatures, lifecycle
HOLD, cancellation cleanup, SDK version/schema validation and retained uncertain
cleanup quota. Baseline, restoration and original-source hashes are mandatory.
The selected mutation execution passed: **13 baseline /13 killed /13 restored**,
zero survivors/invalids and `sourceUnchanged:true`, **257.091 seconds** wall time.
The report is `reviews/mutations-backend.json`; historical and delivery mutation
selections remain separate and were not rerun. Original production source files
were never mutated. The root's complete old+new regression remains authoritative
for final integration evidence.
