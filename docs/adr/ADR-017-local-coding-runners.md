# ADR-017: Local disposable coding runners

Status: accepted for local implementation, 2026-11-14; local KVM composition verified.

## Context

F43 requires repository/worktree tasks for Codex or Claude Code with owner-reviewable
patch/test/preview evidence. I10 requires disposable KVM for arbitrary repository
commands. The fixed trusted data tools in ADR-016 cannot qualify that execution.
Desktop vendor authentication and production administrator credentials must not
become task authority. Local implementation does not authorize paid calls,
publication or dedicated-server setup.

## Decision

Add a separate CodingEngine under the existing Foundation queue, reservations,
heavy-work controls, epochs, grants, leases and durable effect journal. Freeze
project/environment revisions, complete configured repository identity and exact
source commit in an immutable preparation. Independently verify source before
admission and physical dispatch. Metadata preparations remain available without
an execution provider. Keep the control API additive at `1.13.0`.

Copy private registered local Git objects as inert bytes. Run all Git commands and
repository/configuration/test code only inside a task-private disposable KVM guest
through a trusted worker, with isolated writable worktree/metadata. Fixed trusted
host parsing validates object headers/sizes/hashes without executing Git. The
current physically qualified adapter is Windows/Ubuntu WSL2; native Linux/Proxmox
execution remains deployment work. No host, TCG,
container or gVisor fallback is allowed. Require current independently observed
qualification, resource limits, broker-only model networking, exact source/image/
policy identity and an explicitly configured pool including hypervisor overhead.

Use separately opted-in private API bindings for both pinned CLI adapters. Do not
reuse desktop/global homes, subscription OAuth material or ambient credentials.
The broker fixes model/endpoints and finite attempt/byte/time/output bounds,
durably predebits a conservative upper cost and checks live Foundation authority
before each physical model request. Expired price review or unavailable proof
refuses dispatch. Subscription entitlement and invoice reconciliation are not
inferred from local protocol success.

Persist intent and correlation before effects. Unknown effects are inspected
read-only and never replayed; stop acknowledgement cannot release actual-call
capacity. Preserve quarantined resources until exact physical cleanup proof.
Fence result publication after awaited writes against current owner/task authority.
Return source-bound, bounded, digest-verified patch/test-log bytes separately from
CLI summary and usage. Preview remains unavailable without independent delivery
authority/evidence. Never commit, push, merge, deploy or publish automatically.

## Consequences

The owner can prepare exact repository tasks, observe runner availability and
manage retained task/worktree evidence without widening Hermes authority. Private
operator bindings and current physical qualification are required for launch;
default startup is unavailable. The guest worktree/CLI home is ephemeral RAM;
retention preserves frozen source/image and output evidence, without persistent
CLI resume or VM reattachment. The source backend initially requires the complete loose-object
closure and does not automatically clone configured GitHub repositories.

Local Linux mechanisms, KVM boot, parser/provider fixtures, actual vendor CLI
execution and paid entitlement are distinct proof levels. The
[operator guide](../development/coding-runners.md) records the current gate and
limitations. Complete E07, native paused controls, E09 operational bundles,
dedicated-host containment and full V1 acceptance remain separate work. Existing
accepted ADRs remain unchanged.

Three actual Foundation/provider/controller/production-broker/KVM composition
cases passed independently (Claude, Codex and epoch fencing), with only upstream
HTTPS replaced by a trusted fixture and no paid calls. The local adapter and
qualification do not authorize dedicated-server execution or paid entitlement.

## Addendum 2026-11-15: server work-VM profile

The server has no nested KVM. By owner decision the coding runner may use the disposable
work VM `godseye-work` as the boundary, with a per-task gVisor (`runsc` systrap) or
rootless-container sandbox, reported as `disposable-vm-container`. This is weaker than the
KVM microVM (shared VM kernel) and deviates from spec I10 only on the server (I10a). It is
an adapter/profile addition: the SSH transport, pinned host key and Debian profile checks
are in the [operator guide](../development/coding-runners.md). The runner stays
`available:false` until sandbox qualification evidence exists; no qualification claim in
this ADR extends to it.
