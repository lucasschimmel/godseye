# ADR-016: Task-scoped isolated Hermes data tools

Status: accepted for local implementation, 2026-11-14.

## Context

The owner requested useful local Hermes tools with isolated execution and explicit
task permissions. ADR-014 and ADR-015 established no-tools, single-request task and
chat boundaries. The local runtime can qualify a fixed trusted data helper under
gVisor and an outer cgroup, while arbitrary shell/build/project-code execution
continues to require disposable KVM under I10.

## Decision

Partially supersede the blanket no-tools/single-request restrictions in
[ADR-014](ADR-014-owner-bound-agent-center.md) and
[ADR-015](ADR-015-durable-hermes-chat-and-exact-plan-inbox.md) only for explicit
versioned first-party data-tool grants. Preserve both accepted records unchanged.
Keep their restrictions as the default when a grant is absent.

The exact five tools list/read/write/search task-private copied UTF-8 scratch and
artifact data, or validate JSON. A nullable owner profile policy is a ceiling; an
immutable explicit task/chat-turn subset is required separately. Neither service
callers nor model responses can grant, expand or approve authority. Preserve legacy
profile hashes when policy is absent. Do not expose caller host paths or native units.

Keep native Hermes and model/broker execution outside the sandbox. Run only a fixed,
trusted non-evaluating helper inside pinned gVisor systrap under an actual verified
outer user-service cgroup, with read-only root, nonroot, no capabilities/network,
512 MiB RAM, swap zero, 500 millicores and 128 tasks. Use a physical 4 MiB tmpfs
and independently enforce logical UTF-8 file and cumulative byte caps at or below
1 MiB. No arbitrary command, native registry or untrusted project code is admitted.
Refuse when the qualified runtime or explicit grant is unavailable; no host fallback.

Reuse real Foundation reservations, grants, leases and execution journal. Bound the
whole task to four model POSTs and three calls; debit conservative aggregate attempt
cost before I/O within one total task reservation. Persist call intention, input
identity and exact allocation before dispatch. Fence current authority after awaits
and at final settlement. Unknown effects retain capacity and never replay.

Cleanup and inspection bind exact systemd unit invocation and OCI identity. Parent
EOF, cancellation and deadline request protective cleanup; persisted PIDs are never
kill authority. Stop requests do not free retained capacity until physical absence
is proved. Expose bounded actual artifact snapshots only on successful nonrevoked
settlement with stopped proof. Chat turns insert snapshots into the existing
immutable chat artifact store and inert attachment endpoint. Standalone tasks expose
digest-verified retained tool-journal snapshots through `toolsDetail`, with local
`text/plain` Blob downloads in the console, without chat artifact IDs/storage rows.
Do not alter exact-plan inbox approval semantics.

Installation and optional foreground WSL bootstrap are explicit operator commands.
Default bootstrap refuses an unavailable manager; only the explicit activation flag
may start/reset the exact user manager. Do not create linger, persistent/system
configuration or model-triggered privileged repair.

## Consequences

Standalone tasks and separately admitted chat turns can perform useful bounded data
work while preserving legacy no-tools operation. Operational state distinguishes
known results from unknown execution and physical cleanup. Inspection cannot relaunch
or regrant. The operator must retain the local foreground bootstrap while needed.

This qualification applies to the trusted catalog only. Arbitrary shell/build/KVM,
coding runners, native broad approvals, E09 skill bundles, provider invoices,
dedicated-host containment and full E07 acceptance remain separate. Physical proof,
fixtures and pending gates are distinguished in the
[operator guide](../development/hermes-tools.md) and verification records.

The local implementation's final acceptance/review/build gates passed on 2026-11-14,
with HTR-001 expiry fencing and HTD-001 artifact-delivery documentation resolved.
The tools guide retains measured results and availability observations separately
from this decision; successful qualification does not imply an always-running service.
