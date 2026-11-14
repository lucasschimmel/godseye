# Local Codex and Claude Code runners

Date: 2026-11-14. E07.S05 continuation, local only. Owner's scoped-agent orchestration
preference applies. Preserve prior dirty work. No paid calls, publication or server setup.

## Decisions and assumptions

ASSUMED: support both vendor protocols, with explicit separate private opt-in bindings.
No reuse of desktop/global vendor homes or production administration credentials.
No automatic commit, push, merge, deployment or external publication. Results are owner
reviewable patches and independently labeled test/preview evidence.

The accepted F43/I10 contract requires disposable KVM for arbitrary repository/agent
commands. gVisor data tools do not qualify this scope. Hardware exposes nested KVM,
but device access and workspace-local hypervisor/guest installation are unqualified.
Investigate a reversible invocation without system configuration/global installation;
record unavailable honestly if qualification cannot be established. Never enable host,
TCG, container or gVisor fallback. Native protocol tests are not KVM qualification.

Adopt coding-runners-core-proposal.md with these bindings:

- Separate CodingEngine reuses actual Foundation admission, budget, epoch, grants,
  journal and heavy-task controls. Do not widen Hermes profile/provider authority.
- Derive repository from owner project configuration; freeze complete binding, scope,
  revisions and exact source commit. Owner SHA is requested, independently verified
  source evidence is required before physical admission. Logical worktree IDs only.
- Immutable preparations are available without runtime. Availability must be visible
  and checked again at final dispatch; no reservation leak on rejection.
- Both CLI adapters use bounded noninteractive typed protocols. Repository-controlled
  hooks/configs/filters and test/build code may execute only inside qualified guest.
- A task receives one copied repo/worktree and task-scoped model/egress policy. No
  shared writable Git metadata, host mounts, management routes or ambient identity.
- Persist intent and correlation before submission. Reconcile unknown effects read-only,
  never resubmit. Stop acknowledgement is not stopped proof. Retain capacity and sole
  patch evidence through uncertain cleanup. Final transaction fences follow last await.
- Typed result binds task/preparation/source/worktree and bytes/digests. CLI summary,
  test exit/status, patch and preview are separate evidence. No URL-as-preview proof.
- Vendor cost/usage limitations explicit; bounded attempts/time/output/resources and
  conservative reservation; no hidden retry/premium fallback or unknown-as-free billing.
- Strict private qualification receipts bind runner/version, runtime/image/policy hashes,
  preparation/repository/commit identity, observed/expiry timestamps (maximum60seconds),
  bounded resources, broker-only networking and bounded API billing. Revalidate before
  admission and final submit; receipt fields alone never certify physical containment.
- Require explicit server-owned coding pool capacity, with one global heavy allocation
  reserving the entire initial pool through physical uncertainty. Runtime checks actual
  outer VMM overhead/resource availability; configuration is not measured host capacity.

## Ownership and dependency order

One dependent continuation; interface freeze precedes parallel module implementation.
Not an independent-epic swarm. Core owns contracts/store/core/API/client/UI/OpenAPI;
runtime owns isolated executor/repo materialization/install/protocol scripts and native
proof; GAUNTLET owns independent tests/mutations and evidence. Shared server/package
wiring explicitly handed off. Root owns plan/state, orchestration and final gates.
Fresh FABER and security/doc satellites follow when slots free. No real checkout Git
mutation. Disposable test repositories remain under unique test-owned directories.

## Acceptance contract

| Criterion | Test ID | Observable behavior / failure |
| --- | --- | --- |
| AC-781 | T-AC-781 | Owner-only strict versioned repository/task contracts; deny service, host paths, argv, extra authority and malformed revisions. |
| AC-782 | T-AC-782 | Freeze complete project/environment/repository/source identity; stale binding, epoch, hold or revision cannot admit/dispatch. |
| AC-783 | T-AC-783 | Durable preparation and admission idempotency; changed duplicate conflicts; atomic budget/heavy capacity; unavailable runtime leaks no admission. |
| AC-784 | T-AC-784 | Server-minted task-private repository/worktree; no shared writable source/Git metadata, hooks outside guest or automatic real-ref changes. |
| AC-785 | T-AC-785 | Codex noninteractive structured event/result adapter validates actual pinned protocol; no ambient desktop auth or hidden retries. |
| AC-786 | T-AC-786 | Claude Code noninteractive structured event/result adapter validates actual pinned protocol; no upstream broad approval/ambient authority. |
| AC-787 | T-AC-787 | Qualified disposable KVM before arbitrary code; strict resource/mount/network/identity inspection; unavailable defaults fail closed, never native/TCG fallback. |
| AC-788 | T-AC-788 | Intent and exact runtime correlation precede effects; crash/unknown/restart inspect only, no physical replay. |
| AC-789 | T-AC-789 | Cancel/expiry/epoch/grant changes revoke dispatch and late publication; exact owned stop proof or retained unknown/quarantine, preserve unrelated task. |
| AC-790 | T-AC-790 | Bounded patch/log/artifact bytes and hash/source binding; current authority after final awaited result write; no revoked output. |
| AC-791 | T-AC-791 | Finite requests/time/resource/output/cost policy; unknown vendor usage explicit, no bill reconciliation or paid entitlement claim. |
| AC-792 | T-AC-792 | Test evidence is actual trusted observed exit/status; preview links independently verified delivery record or explicit unavailable. |
| AC-793 | T-AC-793 | Owner UI prepares/selects project/environment/runner, observes availability, tasks/worktrees/results, cancels/reconciles and downloads inert patch. |
| AC-794 | T-AC-794 | Existing Hermes/tools/delivery/auth behavior preserved; migration, OpenAPI, final regression/build/scans/review and spec/plan truthful. |

## Gate calibration

GAUNTLET owns exact strategy/traceability. Distinguish strict-provider fixtures, actual
CLI protocol, actual Git/worktree mechanisms, KVM physical containment and paid vendor
entitlement. No test fixture can certify a real adapter. Curated behavioral mutants
must include at least an authority/uncertainty boundary; no blanket mutation score.
Run static/focused checks, source freeze and fresh review, then appropriate ordinary
regressions, canonical build/smoke. Serialize shared artifact builders as prior record.

Memory: consulted existing godseye context pack, active decisions and repository
playbook. Prior fixed-tool continuation:1426ordinary/13native/3browser, independent
final fence defect fixed. Prediction: prediction-1794649036-ca1d66e1.
