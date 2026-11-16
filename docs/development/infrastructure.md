# Local infrastructure inventory and cell preparation

Status: local E02.S03 implementation verified by combined unit/build, browser and bounded laboratory checks, 2026-11-11. The owner console exposes inventory and preparation at `/infrastructure`, with control API version `1.2.0`. No dedicated-server, Docker daemon, firewall or personal application environment has been configured by this stage.

## Inventory and evidence

Keep desired inventory separate from observations. The owner declares finite host/guest/pool budgets and the intended topology. A server-owned collector supplies timestamped, versioned observations. An owner declaration, submitted inspection object or `qualified: true` field cannot authorize execution.

The default `LocalSystemCollector` identifies the development controller and reads native OS/filesystem metadata without probing Docker sockets or remote hosts. It reports CPU parallelism, total memory, available space on the working-directory filesystem, and separate filesystem total/available values. PID capacity is `null`; provider binding and physical-host capacity are unavailable. Every execution qualification flag is false. These are local-PC readings, not measured dedicated-server (EX44) capacity or a complete disk inventory. A free-space reading does not prove a managed-directory quota. Observations expire after five minutes; stale or incompatible evidence blocks new admission while inventory remains inspectable.

The placement follows [ADR-002](../adr/ADR-002-professional-vm-and-dual-stack.md): one physical Proxmox host, one professional VM, a separate games VM and an optional sibling disposable task VM. Applications live in independent cells inside the professional VM. Neither a nested hypervisor nor a per-project VM farm is introduced.

## Owner workflow and API

Open **Infrastructure** and confirm the owner passkey before mutations. Refresh observations to inspect the actual local controller. Declare the intended host, guests, pool/headroom and private address pools; form defaults are desired-plan examples, never observations. A second public IPv4 needs a recorded justification. Choose a registered project/environment, a digest-pinned image and finite application resources, then prepare the immutable profile. Review its hash and proposed subnets before requesting admission.

All routes below are relative to `/api/v1` and require the fixed owner's session. Mutations also require recent passkey verification and `Idempotency-Key`. Desired inventory/observation changes use expected revisions; workload preparation binds the project's revision; admission names the preparation ID and exact hash. Callers cannot submit collector observations or effective provider IDs.

| Method/path | Result |
| --- | --- |
| `GET /infrastructure` | Desired and observed inventory, provenance/freshness, execution reasons, preparations and allocations |
| `PUT /infrastructure/inventory` | Versioned desired topology, finite host/guest/pool budgets and private address pools |
| `POST /infrastructure/refresh` | Fresh server-owned collector observation, without promoting desired values into evidence |
| `POST /infrastructure/preparations` | Immutable compiled application preparation; 201 does not mean resources were provisioned |
| `POST /infrastructure/admissions` | Exact-hash owner decision and Foundation admission; 202 means accepted durable work, not verified readiness |

The generated [control OpenAPI](../contracts/control-openapi.json) and internal owner client describe the exact request/response shapes. Schema-invalid input returns 422, conflicting keys or stale revisions return 409, and missing qualified execution capability returns 503. The default runtime has no qualified provider, so inventory/preparation work remains available while execution is refused. Starting a Docker daemon or setting a browser flag alone cannot change this boundary.

Queued/running work uses the existing Foundation cancellation path. Unknown/quarantined work uses recorded reconciliation. A protective stop is not project deletion and does not erase persistent data. Changed inventory/observation/policy revisions require a new valid preparation rather than editing an old hash.

## Prepare before admitting

An immutable preparation binds a registered project/environment to a pinned workload and a compiled isolation policy. It can be reviewed even when execution is unavailable. Preparation is not a running allocation or proof that an image, runtime or host has been qualified.

The compiler accepts a narrow application contract and derives resource names, allocation identities, network mappings and ownership bindings. It rejects arbitrary Compose/Docker options, provider IDs, host paths, control sockets, devices, privileged mode, host networking/PID/IPC, native application runtime selection and unbounded resources.

The application profile fixes gVisor `runsc` systrap, UID/GID `65532:65532`, a read-only root, all capabilities dropped, no-new-privileges, runtime-default seccomp, finite CPU/memory/PIDs, bounded `/tmp` and quota-managed `/data`. The OCI image digest must match the workload's artifact digest. The public compiled-manifest schema is strict; it is not an arbitrary JSON extension surface. Different volume names, a container writable-layer size or a tmpfs limit are not evidence of a real persistent-data quota.

Admission requires fresh, compatible observations and independently qualified provider capabilities. The runtime must not silently select `runc` when gVisor is absent. The local unavailable state is an explicit refusal, not an automatic demonstration or simulation mode.

## Capacity and network reservations

Reserve professional-pool CPU, memory, process and storage budgets in the same transaction that admits the durable operation. Recheck host guest commitments and headroom atomically. Cell resources are contained within the professional VM budget; do not add the same cell memory to physical-host commitments a second time.

Allocate distinct private IPv4 and ULA IPv6 subnets from registered pools. Reject canonical aliases, overlaps and subnet collisions. Compiled application publication is empty; actual external protocol/port allocation remains in the qualified delivery/game integrations. Do not copy a routed public `/64` onto unrelated Docker bridges. The public address target remains one IPv4; a second needs an explicit owner-reviewed justification, and a third is refused.

Prepared network policy is deny-by-default. Docker's internal-network setting alone does not block every bridge-gateway/host-service path. Both IPv4 and IPv6 host/forwarding enforcement require separate evidence. This stage does not publish database/admin ports or make an application publicly routable; domain/TLS delivery remains E05.

## Headroom, pressure and bounded heavy work (E02.S04)

`GET /infrastructure/headroom` reports, per host and professional pool, capacity, committed, protected reserve and free for CPU, memory, data storage, WAL and PIDs. Committed values come from the existing reservation ledgers; capacity requires a fresh professional-VM observation, otherwise the value is `unknown` (never healthy). Pressure is `ok`/`warn`/`critical`/`unknown` from (committed + protected reserve) / capacity with thresholds 80 % and 95 % (`INFRASTRUCTURE_PRESSURE` in the contracts). WAL shares the data volume's capacity and pressure.

Heavy tasks (agent runs, builds, database backup/restore/export/migrate and recovery full/diff/restore) share the single Foundation queue: at most one runs at a time and four wait (`HEAVY_TASK_LIMITS`). A further intention is refused inside the enqueue transaction with `HEAVY_QUEUE_FULL` (429) and holds no budget or reservation; the headroom view shows the running/waiting counts and whether the queue is full. The worker claim leaves a heavy run queued while the slot is taken.

`PUT /infrastructure/admission` (owner, fresh passkey, `Idempotency-Key`, expected revision, reason required to pause) pauses or reopens new admission. A pause refuses non-protective enqueues with `ADMISSION_PAUSED` (409) and sets `executionAvailable=false`; reads, reconciliation, stops/quarantine/cancel, approvals and recovery restores continue, and work admitted before the pause is still consumed. Migration `0014_infra_admission.sql` stores the switch.

## Execution and recovery

The existing FoundationEngine owns the operation, consumer, effect identity, lease, epoch/fence and task grant. Admission binds the exact preparation hash into its cell command and exact owner approval; the generic Foundation endpoints cannot bypass fresh authority or atomic physical reservations. Physical allocations remain separate from logical environment rows, allowing later replacement/restore destinations to coexist without changing the source cell into a new identity.

Persist each provider-step intention before dispatch. Create a sandbox stopped, inspect its actual effective runtime, identity, flags, limits, mounts, IPAM and ownership before starting application code, then inspect again before reporting a verified allocation. Caller-supplied JSON is not effective enforcement evidence.

The concrete Docker protocol adapter uses bounded, typed local Engine requests and private helper interfaces for persistent quotas, both-family firewall policy, runtime configuration and immutable artifact verification. Helper proofs must be fresh and bound to the exact provider, target and generation. Real helper implementations have not been installed or qualified here. Inspection rejects unexpected published ports or image-declared volumes; rediscovery uses stable names plus complete ownership/configuration evidence. A verified allocation and successful Foundation terminal outcome settle in one transaction.

A lost receipt, cancellation, expired worker or epoch change cannot prove an in-flight effect disappeared. Retain uncertain allocations and reservations until exact owned state or absence is established. Reconciliation uses stable resource mappings and configuration/ownership evidence. A label or name prefix alone cannot authorize adoption or deletion. Drifted, foreign or orphaned resources remain quarantined and visible; no global prune or destructive project purge is implied.

Protective-stop attempts are durable. An earlier stop does not prove safety while an already dispatched start can still finish. Cleanup stays pending until the uncertainty is resolved; an error, lost acknowledgment, or acknowledgment racing inspection cannot release reservations merely because a resource appeared absent. The UI distinguishes allocation state from cleanup state and keeps protective stops/data retention visible.

## Dedicated gVisor laboratory

The laboratory installer and [dedicated Vitest configuration](../../vitest.infra-lab.config.ts) are separate from the default unit/integration suite. Run from the repository root on a compatible Linux user-namespace environment or the existing Ubuntu WSL distribution:

```sh
bun run runsc:install
bun run test:infra:lab
```

The installer caches verified archives under ignored `artifacts/tools`; it installs no system runtime or daemon. The explicit lab fails with an actionable unsupported-capability result rather than silently skipping or downgrading its runtime. The default Vitest suite explicitly excludes the dedicated lab file. The Jenkins template has a separate `godseye-linux-userns-node24-bun144` stage with its own tool installation, JUnit and artifact collection; no Jenkins execution is claimed.

The final `bun run test:infra:lab` run passed 4/4 checks in 17.027 seconds (17.26 seconds total), following an earlier 14.65-second pass on Windows/WSL Ubuntu: pinned gVisor `release-20261102.0` with Alpine 3.24.4 BusyBox/musl, guest UID 1000 without capabilities, own/foreign fixture-root separation, read-only root, a 1 MiB tmpfs rejecting a 2 MiB write, and IPv4/IPv6 refusal against fixture-owned listeners with successful control connections outside the guest. Installation verifies published archive SHA-256 checksums; release signatures were not verified.

The helper uses owned temporary namespaces and a minimal OCI root, never `runsc do` or a mount of the host root. No system installation or kernel/firewall change is required. The recorded run explicitly used `ignore-cgroups`: it proves neither CPU/RAM/PID enforcement nor persistent quotas. Direct OCI/network-none evidence does not qualify Docker firewall behavior, a professional VM, Proxmox/Hetzner routing or production containment. Only Windows/WSL was executed; other supported code paths need their own evidence.

## Qualification and continuation

The final combined `bun run check` passed 325/325 cases across thirty files in 244.70 seconds, including lint, types and generated-contract consistency. Build and built-API smoke passed on the frozen source. All thirty-one selected mutation experiments were killed, with green baseline/restored runs and unchanged original sources; this is not a full mutation score. The final browser suite passed 18/18 journeys in 73.155046 seconds (JUnit), and all 26 local traceability criteria passed. The source-hashed independent security review passed after four confirmed defects were fixed and reverified: late starts versus protective stops, fresh runtime proof binding to the exact target, reservation release under unresolved provider intent, and stopped-container configured addresses versus running operational addresses. The minor French UI-copy delta passed a supplementary scoped review. Detailed final evidence belongs in the [verification strategy](../../tests/STRATEGY.md).

E00 still qualifies actual hardware, addresses, guest/host networking, runtime compatibility, persistent quotas and recovery before remote providers execute. E03 owns independent PostgreSQL/data lifecycle and E05 owns public deployment/ingress. See [ADR-006](../adr/ADR-006-local-inventory-and-cell-provisioning.md), the [development plan](../plan/v1-development.md), [isolation contract](../spec/isolation.md), [networking contract](../spec/networking.md) and [verification strategy](../../tests/STRATEGY.md).
