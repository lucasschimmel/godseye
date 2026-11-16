# ADR-006: Evidence-bound local inventory and cell provisioning

- Status: verified local implementation, source review and bounded unit/build/browser/laboratory evidence
- Date: 2026-11-11
- Related decisions: [ADR-002](ADR-002-professional-vm-and-dual-stack.md), [ADR-003](ADR-003-local-first-and-ci.md), [ADR-004](ADR-004-owner-authority-and-foundations.md), [ADR-005](ADR-005-bun-and-local-service-authority.md)

## Context

The owner requested the next E02.S03 infrastructure inventory and isolated-environment provisioning work while keeping all work local. Logical project/environment registration, passkey owner authority, scoped service access and FoundationEngine execution already exist. A planned environment row does not identify a running cell, and a monetary budget reservation does not reserve physical CPU, memory, data or network capacity.

The accepted placement has one professional VM with sandboxed applications, a separate games VM and an optional host-created disposable work VM. The development PC is not the AX41. Docker is unavailable locally; WSL can exercise selected gVisor mechanisms without changing the operating-system configuration. These facts require preparation and truthful refusal before real host qualification, rather than invented infrastructure readiness.

## Decision

Separate owner-declared desired inventory from versioned collector observations and qualification evidence. Label local OS/filesystem readings as development-controller evidence. Preserve unknown/unavailable facts, source and freshness; reject stale or caller-authored qualification as execution authority.

Use a strict immutable application policy compiler with server-owned allocation identities, names, private dual-stack networks and ownership bindings. Require gVisor systrap, non-root execution, a read-only root and finite resource limits. Real persistent quota and both-family host/forwarding controls are independent admission gates. A Docker volume name, tmpfs size or internal bridge is insufficient to prove them.

Keep compiled preparation separate from admitted execution. Reuse the existing FoundationEngine consumer, effects, approval/grant and lease/epoch/fence controls. Reserve physical capacity and network uniqueness atomically with admission, preserving host/professional-pool headroom without charging cell memory twice at the host. Logical environment and physical allocation identities remain separate.

Create application sandboxes stopped, inspect the actual effective profile before application code starts, then recheck before verified readiness. Snapshot mutable input before awaits and revalidate current scope, observation/policy revisions and live task authority before privileged dispatch. Persist durable per-step intent first. Reconcile exact owned state after uncertainty; retain reservations and quarantine drift/foreign resources rather than adopting by label or pruning globally.

Use a dedicated pinned, unprivileged OCI laboratory for local gVisor evidence. It is separate from the default unit/integration command and fails explicitly if its platform requirements are unavailable. It never selects a weaker runtime to obtain a passing result.

## Consequences

The dashboard distinguishes desired, observed, stale, prepared and allocated state instead of claiming configuration is deployment. The default LocalSystemCollector reports actual development-PC OS/filesystem metadata, unavailable PID capacity and no qualified provider. Local preparation remains useful while a missing runtime, quota backend, firewall policy or trusted artifact prevents admission. Private provider integration requires a separately qualified target and cannot be enabled with an owner JSON boolean.

The one-professional-VM model retains its shared trusted root/daemon/kernel boundary. This decision does not turn containers into separate kernels or close E00. Actual server installation, persistent-data enforcement, network policy, deployed data services and recovery remain operational qualification work in their owning stories.

A direct rootless runsc probe cannot certify the Docker or VM topology. Its use of `ignore-cgroups` specifically excludes CPU/memory/PID and persistent-quota claims. The installer checks published SHA-256 values; signatures and unexecuted platform paths remain explicit limitations.

## Alternatives

- Reusing logical environment IDs as physical identities would conflate a source with later isolated restore/replacement allocations.
- Adding a second infrastructure queue would duplicate the surviving effect and authority journal and create inconsistent retry behavior.
- Treating desired inventory or provider labels as qualification would let declaration or rediscovery bypass enforcement.
- Silently falling back to native containers or relying only on Docker internal networks would weaken the accepted isolation contract.

## Verification

The fresh plan review passed. The dedicated Windows/WSL gVisor laboratory passed four checks in 14.65 seconds, then passed the explicit standard alias with 4/4 checks in 17.027 seconds (17.26 seconds total), covering the pinned runtime, non-root/private/read-only root behavior, bounded tmpfs and paired fixture-only IPv4/IPv6 denial. The combined `bun run check` passed 325/325 cases across thirty files in 244.70 seconds, with build/built-API smoke and thirty-one selected mutation experiments also passing. The final browser suite passed 18/18 journeys in 73.155046 seconds (JUnit), and all 26 local traceability criteria passed. Independent source review passed after four confirmed defects were fixed and reverified: late-start protective-stop races, exact target binding of fresh runtime proof, reservation release under unresolved provider intent, and stopped-versus-running Docker address inspection. The minor French UI-copy delta passed a supplementary scoped review. The [operator guide](../development/infrastructure.md) records API `1.2.0`, the owner workflow and exact laboratory commands. The [verification strategy](../../tests/STRATEGY.md) records final aggregates without certifying remote infrastructure.
