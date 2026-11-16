# Hermes isolated tools — GAUNTLET test strategy

Run: godseye-local-hermes-tools. Date: 2026-11-14. Criticity: production.
Framework: installed Vitest 5.1.0 / Playwright 1.65.0, TypeScript strict and Python native helpers. Status: focused and root final verification complete after frozen design and independent plan-review pass. New ordinary66, actual native11, selected legacy native2, browser3 and curated source-copy mutation5/5 pass. Root final aggregate is1,426 ordinary passes/28 default native skips/132 files with zero failures; the66 focused cases are already included. Exact distinct identities/artifacts and physical qualification limits are in `hermes-tools-test-results.json` and `hermes-tools-test-matrix.md`; complete gates are in `hermes-tools-final-gates.json`. The planning matrix below is retained as design history.

## Existing evidence and narrow reuse

- `reviews/hermes-chat-final-gates.json`: 1,360 ordinary passes, 17 default native skips. Retain the disjoint serialized `backend-template.test.ts` group and two-worker remainder. Root coordinates full regression/build.
- `tests/helpers/agents-fixture.ts`: real PGlite store, InfrastructureEngine and Foundation admission/budget/consumer; scripted provider is useful for deterministic authority races but cannot qualify physical execution.
- `tests/agents-tasks.test.ts`, `agents-persistence.test.ts`, `agents-chat-persistence.test.ts`: existing scope, reservation, generic cancellation/epoch, unknown reconciliation, late-result suppression and physical store reopen patterns. Extend actual new tool behavior instead of duplicating old assertions.
- `tests/helpers/agents-native-fixture.ts` and `agents-model.py`: actual WSL loopback model HTTP server, counted requests, held response, incremental SSE/truncation, clean fixture lifetime. Extend with a finite scripted tool-call/continuation sequence; only the model is simulated. Existing `--tool-reply` returns an unsupported tool and does not exercise permitted execution.
- `tests/agents-chat-native.test.ts`: actual pinned Hermes Runs path and two explicit requests; native tests currently use counted authorization callbacks, so a new end-to-end composition must also prove actual Foundation authority reaches the executor.
- `tests/runsc-lab.py` / `runsc-fixture.ts`: checksum-pinned archives, rootless systrap, nonroot UID, gVisor marker, read-only root, empty capabilities, network-none, bounded tmpfs and positive IPv4/IPv6 host controls. This lab uses `--ignore-cgroups=true`; cgroup, persistent quota, Docker and signature qualification are explicitly false. Reusing its reported success cannot qualify hard CPU/RAM/PID containment.
- `tests/e2e/agents.spec.ts` and chat browser fixtures: real owner enrollment/project/profile/task route setup and viewport inspection patterns. Label response fixtures separately from native end-to-end evidence.

## Required behavior matrix

| ID | Layer / target | Required observable evidence | Effort |
| --- | --- | --- | --- |
| T-TOOLS-01 | Contract: profile/task permission input and owner HTTP | Exact finite allowlist, reject unknown tool/schema fields and unsupported policies; stale revision/foreign scope/freshness/approval and budget fail before dispatch. Default profiles retain no tools. | medium |
| T-TOOLS-02 | Real Foundation/tool integration | Server-derived capability binds task, project, environment, workspace, tool name, arguments/digest, epoch, lease and bounded resource policy; copied/foreign/stale authority cannot dispatch. Mutating caller inputs during preparation cannot retarget checks. | large |
| T-TOOLS-03 | Real executor / pinned native | Allowed bounded command produces observed output and file write/read round trip inside its own disposable workspace; fresh task cannot observe prior or sibling task/project/environment/workspace data. Capture actual invocation/correlation counts. | large |
| T-TOOLS-04 | Parser + file boundary | Reject absolute paths, drive/UNC/device paths, traversal variants, NUL, mixed separators, encoded traversal, symlink/hardlink escapes, outside-root destinations, unsupported operations and over-limit UTF-8 bytes. Assert outside sentinel unchanged and data absent from result. Use fixture-only harmless sentinels. | medium |
| T-TOOLS-05 | Physical containment | Actual root is read-only; only permitted disposable workspace/tmp are writable; no arbitrary host bind mounts, host environment, capability or inherited descriptor visibility. Prove nonroot, empty effective capabilities, no-new-privileges and positive/negative mount controls through actual execution. | large |
| T-TOOLS-06 | Physical network | Own fixture IPv4/IPv6 listeners are reachable from fixture host and receive no guest connections; guest network attempts fail. Executor cannot reach model/broker/controller endpoints. Do not make external network requests. | medium |
| T-TOOLS-07 | Physical limits / unsupported capability | Probe actual process descendants, CPU time, resident memory, storage, output and wall deadline bounds under the supported policy. An unavailable mechanism makes requested profile unavailable before admission/dispatch, with precise reason. Timeout alone is not RAM/CPU/PID proof. | large |
| T-TOOLS-08 | Deterministic dispatch/settlement races | Revoke lease/epoch, cancel, hold, expire exact approval, exhaust budget or lose authority after staging but before spawn: zero physical starts. Revoke during execution: protective stop; late output cannot become success/artifact. Retain reservation until physical stop proof. | large |
| T-TOOLS-09 | Physical failure + durable reconciliation | Controlled lost spawn acknowledgment after one actual start: unknown/correlated intent survives store reopen; reconciliation inspects retained identity, never replays command; inaccessible reconciliation retains unknown/reservation; terminal label without physical quiescence is insufficient. | large |
| T-TOOLS-10 | Actual pinned Hermes + loopback model | Model emits approved command/file calls, actual Hermes dispatches through first-party scoped executor, model continuation sees bounded allowed result; record actual model posts/tool starts/results and no paid calls. Unsupported call/material request rejected without executor start; broker cannot forward arbitrary host data. | large |
| T-TOOLS-11 | Browser: actual owner HTTP + labeled contracts | Owner sees current available/unavailable permission capability, bounded task result and tool events; scope/revision changes retain correct selection and fail stale save; cancellation/unknown states do not display success; desktop/mobile controls remain in viewport. | medium |
| T-TOOLS-12 | Isolated source-copy mutation | Kill allowlist bypass, scope binding bypass, traversal/root-check bypass, authority-before-spawn removal, revoked publication, replay-on-unknown and unbounded result mutants with behavior assertions. Establish baseline and restored pass; hash originals before/after. | medium |

All listed items are high risk. Existing foundation-only cases are PARTIAL evidence; the new physical command/file path is NO_TEST until implemented. Stack docs: consult current official Vitest/Playwright documentation or installed type declarations before authoring; Context7 is unavailable in this environment.

## Order and safety constraints

1. Freeze design with concrete executor, minimum support capability and admission policy. Independent binary plan review must pass before production implementation; defects return to architect.
2. Draft test names/assertions from the frozen requirements before reading implementation. Add deterministic contract/authority tests and finite model fixture protocol.
3. Establish executable physical positive control first, then sibling/root/network/resource negative probes. Run exact new pinned-native path separately; missing capabilities are failed admission checks, never silent native skips or host-process fallbacks.
4. Add durable lost-ack/reconciliation and revocation edges through explicit owned fixture controls. Simulation is permitted only for the model and deliberate physical failure edges; identify each seam in results.
5. Run focused suite, native qualification, browser workflow and curated source-copy mutation; root coordinates complete regression/static/build. No coverage or mutation percentage is claimed without measurement.

No secret-bearing input files are read: do not inspect `.env*`, SSH private keys, or basenames containing secret/credential/password/token/api_key. Use generated harmless fixture values only. No Git mutations, real provider calls, server changes, global installs or blanket host root mounts. Cleanup verifies exact absolute owned temporary paths and does not follow links. Native fixture resource stress must itself be bounded externally and cannot proceed without a supported enforceable limit.

## Gate report

Results must separate ordinary real-Foundation integration, actual executor isolation, actual pinned Hermes/model transport, labeled browser contracts, and curated mutation sensitivity. Report `{coverage:{line,branch},mutation:{score,survivors},flaky,layers_run,gaps}` and exact commands/artifacts. Native isolation evidence includes positive controls, observed enforcement, unavailable capabilities, original installation integrity and retained identities. A mocked executor is never isolation qualification; independent runsc lab evidence is never silently attributed to the new tool runtime.

## Frozen acceptance bindings (normative)

The parent froze `hermes-tools-design.md` and adopted `hermes-tools-core-contract-proposal.md`. Independent plan review passed in `hermes-tools-plan-review.json`. The earlier T-TOOLS labels are planning groups only; generated test names use the following canonical IDs exclusively.

| Canonical ID | Required test families |
| --- | --- |
| T-AC-761 | Profile ceiling plus explicit per-task subset/caps; absent grant, duplicates, expansion, service identity and stale scope deny before dispatch. |
| T-AC-762 | Copied seeds in server-minted task allocation; task/project/environment/workspace and ambient host data isolation. |
| T-AC-763 | Real pinned Hermes + loopback scripted model emits permitted call, traverses real Foundation journal and physical typed helper, observes result and bounded final response. |
| T-AC-764 | Physical ROroot/nonroot/no capabilities/no network; all-descendant cgroup membership, 512MiB aggregate RAM/swap0/128 tasks/500m CPU and 4MiB tmpfs observed enforcement. Small separate owned kernel probe units establish OOM/PID refusal without unbounded stress. |
| T-AC-765 | Strict five-tool schemas; scratch/artifacts paths only; no-follow, regular-file and link/traversal/entry/depth/byte limits. |
| T-AC-766 | Authority revocation across preparation/dispatch/settlement; no late success/export or expanded capability. |
| T-AC-767 | Persisted exact intent/allocation/call digest; safe retained receipt replay; changed duplicates conflict; unknown/store restart never physically replays. |
| T-AC-768 | Actual exact-unit/OCI cleanup after cancel/EOF/deadline, unrelated sentinel survives, reservation held until stop proof. |
| T-AC-769 | At most four real model requests and three tool calls; whole-task conservative spend before each model POST; read/write/output/workspace/time budgets; no retry/fallback/free unknown usage. |
| T-AC-770 | Actual artifacts only beneath artifacts/, bounded hash/bytes verification, successful nonrevoked parent settlement and inert scoped owner download. |
| T-AC-771 | Real owner ceiling/task grant/seed setup and tool status/result/cleanup/unavailable visibility; mobile/desktop. Label any response fixtures. |
| T-AC-772 | Legacy null/absent policy preserves hashes, no-tools behavior, previous chat/tasks/approvals/private bindings. |
| T-AC-773 | Inspect/reconcile only observes/stops retained exact identity; foreign receipts/scope/unit deny; audit/errors omit private argument/material. |
| T-AC-774 | Strict versioned HTTP/OpenAPI/private consumers plus malformed authority refusal and final gates/source freeze. |

The fixed typed catalog supersedes the exploratory command test in T-TOOLS-03: no arbitrary code/argv/shell is admitted. Generic shell/build remains unqualified under I10. Logical workspace is <=1MiB, with smaller seed/write/read/output budgets; physical tmpfs is 4MiB including metadata/staging. Resource probes qualify this fixed profile only. The old runsc lab remains separate evidence.

## Measured closure

Independent review passed before production. The focused new ordinary set is57 strict contract cases and9 real Foundation admission cases; existing5 Agent Center contract cases pass separately. The actual native set has4 direct isolated-executor cases,4 real Foundation+executor journal/revocation/expiry cases, and3 complete pinned Hermes+Foundation+executor cases. Only the model is replaced in the complete chain. Two selected current legacy native cases preserve one-request no-tools and incremental successful-history behavior. Three owner-browser cases pass, with real setup and explicitly labeled response fixtures for model task states. The390px mobile viewport screenshot was inspected without style/mask modifications.

Five curated source-copy mutants are killed by behavior assertions with green baseline/restored executions and original source hashes unchanged within each run: duplicate tools, traversal, UTF-8 cap, durable JSONB key-order identity and final transaction authority fence. Real pre-fix composition exposed the Foundation underscore catalog mismatch and canonical identity bug; fresh review HTR-001 gained a deterministic real-transaction/actual-executor regression. No fake executor is used for physical qualification.

Results: `hermes-tools-test-results.json`; canonical14-criterion qualification matrix: `hermes-tools-test-matrix.md`; physical mechanism reports: `hermes-tools-production-native-evidence.md` and historical `hermes-tools-native-capability-probes.json`. Coverage line/branch and whole-suite mutation percentage remain unmeasured. No flaky result was observed in these runs, and no flakiness-history campaign is claimed. Separate runtime proof reports sampled production cgroup membership, smaller controlled OOM/PID probes and lab tmpfs exhaustion rather than production4MiB exhaustion. Hostile physical links/special files are not constructible through the catalog and were not injected; path schemas, fixed data-only helper checks and fresh source review are complementary evidence. General shell/code/KVM, paid provider and deployed-host qualification remain excluded.

Root final gates passed in `hermes-tools-final-gates.json`: disjoint builder2 cases/18.86s plus remainder1,424/1,082.09s gives1,426 ordinary passes,28 default native skips,132 files and1,100.95s summed Vitest wall time, zero failures. JUnit has1,454 cases but1,452 display labels due to two existing Infinity/NaN parameterized pairs serialized as JSON null within-file; cross-group overlap is zero. Canonical build/first built smoke, lint615 files, types and control API1.12 contracts pass. Frozen68 production hashes have zero drift, and HTR-001 plus HTD-001 are resolved. Focused counts and separate native/browser/mutation selections are not added to the ordinary aggregate.
