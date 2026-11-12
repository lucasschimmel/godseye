# Local infrastructure inventory and isolated cell provisioning

Date: 2026-11-11. Scope: user-authorized local E02.S03 implementation following ADR-002; no remote server access, host installation, firewall/system configuration or provider activation without qualification. Bun1.4.4 package manager, Node24 runtime, existing strict owner/auth/access and FoundationEngine foundations remain authoritative. Sequential production implementation; mandatory independent test/security/docs/git satellites.

## Reuse and placement

Use one bare-metal Proxmox host, one professional VM, a separate games VM and optional host-created disposable task VM. Cells are Docker/gVisor application/network/data allocations inside the professional VM; no nested Proxmox or per-project VM farm. E03 databases/full lifecycle and E05 public delivery remain separate.

Reuse FoundationEngine immutable execution plans, durable pump, effects, stable identities, lease/fence/grant/epoch validation and reconciliation. Do not build a second operation worker. Existing unqualified adapters refuse createPlan; preserve that guard. Store a separate immutable PREPARATION/compiled manifest which may be viewed while execution admission remains unavailable. Persist physical allocation IDs independently of logical environment rows so replacement/restore can coexist paused. Do not change logical project registration into provisioned state.

## Inventory and evidence

Persist versioned desired host/guest/pool/disk/network inventory separately from collector-owned observations with source, timestamp, revision, parent relationship and qualification reasons. Owner HTTP can declare desired resources but cannot submit observed/qualified booleans, provider IDs, paths or successful inspection evidence. Provider observations arrive through server-owned registered collectors; expired/stale, changed or incompatible observation blocks new admission. No fictional AX41 CPU/RAM/address measurements.

Provide an actual local-system collector using safe native Node OS/filesystem metadata. Label it development-controller/local-PC; it is not observed Hetzner or a qualified professional VM. Permit trusted provider collectors for host/guest/Docker observations. Sanitize raw responses before storage/HTTP (no environment, daemon auth/proxy strings or material). Refresh and mutation APIs are owner-only, recent-passkey protected, strict and idempotent with optimistic revisions.

Host/guest roles and topology are constrained by ADR-002. Preserve finite headroom. Declaring inventory does not allocate live resources. UI must distinguish declared, observed, stale, prepared, reserved, provisioning, verified, unknown and quarantined states.

## Immutable policy compiler

Accept a narrow application workload with registered project/environment, immutable pinned image/artifact reference and finite CPU/RAM/PIDs/tmp/data limits. Reject unknown fields and all Compose/Docker escape hatches: privileged, native runtime selection, host networking/PID/IPC, devices, capabilities, control sockets, arbitrary bind paths/volumes/networks/provider IDs, unbounded limits and public database/admin ports. No build instructions or shell interpolation into a host command.

Compile server-owned deterministic resource names, opaque allocation/data IDs, ownership binding, app identity, distinct private dual-stack networks and exact profile hash. Required application profile: runsc systrap, non-root UID/GID, read-only root filesystem, all capabilities dropped, no-new-privileges, appropriate seccomp, scoped bounded temporary writes and quota-managed persistent data. No silent runc/native fallback. Database/trusted-native profiles are not selectable by application input.

Admission must require actual compatible observed runtime/profile, enforced CPU/memory/PIDs, real persistent-data quota backend, both-family network/firewall controls, verified immutable artifact source and capacity. Docker volume names, writable-layer limits or tmpfs size do not prove persistent-directory quotas. A configured boolean alone cannot qualify execution. Private provider configuration/qualification is not a browser endpoint. No default Docker/provider adapter becomes qualified simply because it exists.

## Resource and network admission

Use one database transaction for reservations, optimistic observation/policy versions and network uniqueness. Reserve CPU/RAM/PIDs/storage at the professional pool, and validate host guest commitments/headroom atomically. Do not charge cell memory twice at the physical level: the professional VM's reserved capacity already contains its cells. Account for host/professional data capacity and real quota allocations separately from monetary Foundation budgets.

Allocate non-overlapping RFC1918/private IPv4 and ULA IPv6 subnets from registered pools; reject canonical aliases/overlap across cells and mapped/invalid/public/link-local/multicast misuse. Do not copy public routed /64 into every Docker bridge. Store allocation identity and exact family/protocol/port uniqueness. One public IPv4 baseline, second only with explicit justified owner exception, third refused. Do not publish app/database/admin ports here; public routing/TLS needs E05 qualification. Prepared ingress/egress policy is deny-by-default with explicit typed allows, never raw firewall commands.

Local resource numbers and observed host relationships must be explicit. Missing capacity, stale collector data, unsupported runtime, unqualified quota/firewall, pool exhaustion or address collision refuses admission before any effect.

## Provision, inspect, reconcile

Bind each accepted preparation/hash to a real Foundation cell.lifecycle operation and server-selected infrastructure adapter. Persist physical reservation and stable per-step intentions BEFORE provider mutation, with exact project/environment/allocation/epoch/manifest/ownership identities. Capture inputs before awaits and revalidate current authority, capacity/observation revisions, lease/grant/epoch/fence immediately before every privileged dispatch and after inspection. A late worker or changed runtime/policy cannot make a cell ready.

Implement typed private provider boundaries and an actual bounded local Docker Engine transport/renderer where compatible (Unix socket/named pipe only as operator configuration, never caller URL or shell string). Provider capability/host helper interfaces must explicitly represent quota/firewall enforcement and real inspect evidence; unavailable dependencies are fail-closed. Default runtime wiring exposes preparation/inventory but enables no remote provider. A local fixture can admit its own synthetic target for contract tests; it cannot mark a real host qualified.

Create private networks/data allocations/sandboxes only through compiled policy. Inspect actual created or rediscovered resources against the complete effective profile BEFORE marking verified: runtime/systrap, identity/security flags, resources, mounts, networks/IPAM, no published management ports and exact ownership. Registered mappings contain actual opaque provider IDs; submitted JSON is not proof of enforcement.

Unknown or interrupted effects retain reservations and stable step identities until reconciliation proves exact owned resource state or absence. Discover by controlled stable names/ownership binding plus exact configuration; labels or name prefix alone cannot authorize adoption/deletion. Quarantine foreign/drifted/orphan resources, keep evidence visible, never global prune. Cancellation/epoch change revokes authority; it cannot claim an in-flight effect was undone. Preserve data and uncertain reservations; release only after verified cleanup/absence. Do not add unrequested destructive project purge.

## Local proof boundary

Current Docker Desktop daemon is unavailable. WSL Ubuntu uid1000/kernel6.6.87.2 supports user namespaces and has cgroup2; runsc/dockerd are not installed. A separate GAUNTLET worker is preparing pinned rootless runsc systrap with a minimal private OCI bundle (never runsc do or host-root mount), bounded fixture commands/network none, checksum verification and no system changes. This can prove supported Linux syscall/isolation mechanisms, not Docker firewall, real data quotas, Proxmox or Hetzner topology. Unsupported capability must remain visibly unqualified. Real Docker transport contract/fault tests must be labeled separately from containment evidence.

## Acceptance

| Criterion | Observable acceptance | Verification |
| --- | --- | --- |
| AC-19 | Desired inventory and collector observations are distinct, versioned and scoped; real local-PC data is labeled local, stale/forged observation cannot admit execution. | T-AC-19; inventory/core/HTTP/browser |
| AC-20 | Immutable compiler rejects container escapes, caller paths/IDs and unbounded resources; exact runsc/systrap/non-root/security/network/data policy is server-owned and drift blocks readiness. | T-AC-20; compiler/provider inspection |
| AC-21 | Atomic host/guest/pro-pool reservations preserve headroom without double counting; dual-stack pools and address/protocol/port uniqueness reject overlaps/collisions. | T-AC-21; concurrent admission/IP policy |
| AC-22 | Accepted preparation drives actual FoundationEngine consumer with durable steps and exact scoped mappings; only complete inspected profile can become verified. | T-AC-22; real pump/provider contract |
| AC-23 | Lost receipts/restart/cancel retain unknown effects and reservations; reconcile adopts only exact owned resources, quarantines drift/foreign resources and never repeats blindly or prunes globally. | T-AC-23; fault/restart/cleanup |
| AC-24 | Strict owner API/client/OpenAPI and infrastructure UI manage inventory/preparation/admission/status honestly; service/cross-cell/caller authority and missing freshness fail. | T-AC-24; HTTP/client/browser |
| AC-25 | Available local runtime evidence and unsupported quota/network/runtime denial are reproducible with pinned tools and isolated fixtures; no simulated result certifies real containment. | T-AC-25; Linux lab + capability refusal |
| AC-26 | Input snapshots and post-I/O dispatch/inspection gates fence revocation, cancellation, stale observation/policy and epoch/lease changes; durable intent/evidence survives failure. | T-AC-26; race/fault/mutation |

Keep 215 unit/integration and16 browser baseline behavior; add risk-driven tests first against stable interfaces. Use existing native Bao fixtures without actual user material. Full check/build/smoke/browser, selected meaningful mutations, real Gitleaks/dependency audit, fresh security/FABER review and traceability precede local commit. No full V1 or remote/provider qualification claim.
