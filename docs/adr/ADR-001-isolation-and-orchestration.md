# ADR-001: Isolate project environments with KVM and run containers inside them

Date: 2026-11-11
Status: superseded placement proposal; see [ADR-002](ADR-002-professional-vm-and-dual-stack.md)

## Context

G.O.D.S.E.Y.E is a private owner-operated application platform on one reinstallable Hetzner AX41. Games, public applications, databases, durable jobs and tool-using agents share physical capacity. The owner requires project A to remain unable to administer or read project B after an application compromise, including distinct database credentials. The target is a near-complete V1, not a reduced product launch.

The earlier architecture separated broad activity zones but still allowed several projects to share one application VM and PostgreSQL cluster. That is superseded by the project/environment execution-cell model below. Ordinary containers share their node kernel; namespace, network, database and management controls remain separate concerns. [1][2]

## Decision

Use Proxmox/KVM as the host virtualization layer. Provision a separate Linux VM for each project/environment cell, including separate production and nonproduction cells. Docker Engine and Compose package the cell's application, worker, authentication/file components, PostgreSQL and durable workflow services. No project receives another cell's engine, network, volume or database identity.

The PostgreSQL instance, PGDATA/WAL and roles belong to that cell. Inngest instances and installation signing/event keys are also cell-specific; a separate platform Inngest instance schedules privileged operational work. A central dashboard aggregates through restricted adapters instead of distributing shared infrastructure credentials to project code. This avoids treating a function/event-name prefix as a tenant boundary. [3][4]

The control, edge and games services are trusted infrastructure outside project cells. Builds, untrusted previews and general agent shell tasks use disposable KVM guests allocated directly by Proxmox, not nested virtualization inside an execution VM. A scheduler admits work against a finite memory/CPU/disk budget. A build VM has no production mounts or management credentials.

Coolify is the initial Docker deployment provider for separately provisioned Linux guests; VM creation and firewall enforcement belong to G.O.D.S.E.Y.E's infrastructure adapter. Keep infrastructure and deployment interfaces separate. Do not assume Coolify supplies native Kubernetes management or hypervisor provisioning. [5]

## Comparison

| Option | Useful capabilities | Boundary and costs | V1 position |
| --- | --- | --- | --- |
| Docker/Compose on one shared application VM | Packaging, lifecycle, bridge networks, limits | Shared guest kernel and daemon; published ports and host mounts need explicit policy | Insufficient as the sole cross-project boundary |
| One K3s node, namespace per project | Kubernetes API, reconciliation, RBAC, policy, quotas | Same node kernel; namespaces alone do not establish strong tenancy; added cluster operations | Valid alternative, not selected for one host |
| KVM VM per project/environment, Docker inside | Separate guest kernels, independent service/data lifecycle | Guest OS overhead, more patching and finite capacity | Selected V1 baseline |
| gVisor or Kata | Additional userspace-kernel or VM sandboxing | Compatibility, performance and provider integration must be qualified | Candidate future execution provider |
| Separate physical host per project | Separate hardware failure/resource domains | Larger cost and fleet | Needed only when sensitivity/capacity/recovery justifies it |

Kubernetes is not dismissed as unprofessional. Its advantages become useful for a larger fleet and declarative workload operations. Security depends on actual admission, identity, network, storage and runtime policies; adopting the API does not create a separate kernel. [2]

## Why K3s is not the initial provider

K3s's documented server minimum is 2 cores and 2 GB RAM, excluding workloads, so hardware eligibility is not the objection. One physical AX41 still cannot provide host-failure availability. Multiple cluster VMs on it do not change that. [6]

If a Kubernetes provider is implemented, it must supply namespaces per project/environment, least-privilege RBAC/service accounts, Restricted Pod Security admission, enforced default-deny ingress/egress, storage isolation, quotas, API access control and encrypted datastore secrets. K3s already includes a kube-router-based NetworkPolicy controller; default Flannel does not mean policies are necessarily unenforced. A custom CNI requires an explicit policy-controller configuration. Single-server K3s often uses SQLite, so do not assume an etcd datastore. [6][7][8]

Kubernetes is a later provider with equivalent isolation evidence, not an automatic migration promised by V1. A shared-kernel Kubernetes placement must never silently replace the specified KVM boundary. Use separated worker VMs/trust groups or a qualified sandbox runtime if that provider is adopted.

## Database rationale

A database name plus username/password provides SQL authorization, not an independent PostgreSQL server. Roles and WAL are shared at cluster scope. PostgreSQL grants database CONNECT/TEMPORARY to PUBLIC by default; superusers and privileged owners can bypass access controls. Distinct passwords alone therefore do not meet the isolation contract. [3][9]

Each cell gets its own PostgreSQL instance and private data volume, with different identities for application services, migrations, read-only analysis and backup. This separates physical database recovery and administration by cell. It still shares the AX41 disks and hypervisor and requires off-host backups. PITR operates on a whole cluster; a per-cell cluster prevents rolling back an unrelated project's database. [10]

## Consequences

### Positive

- An application compromise and even guest-root compromise have a guest boundary before reaching another project.
- Production and development do not share a guest kernel, database server, signing key or writable filesystem.
- A PostgreSQL upgrade, restore or credential rotation can target one environment.
- Docker remains an ordinary packaging format; Coolify remains replaceable.

### Negative

- More VM, PostgreSQL, Inngest and Redis processes consume RAM, disk and administration time.
- Capacity may permit fewer simultaneous projects than the earlier shared-services proposal. This is not quantified before qualification.
- Central edge/control, backup administration and the hypervisor remain privileged shared dependencies.
- VM escape, hardware failure and physical resource contention remain possible; this is not a claim of perfect isolation or high availability.

### Neutral

- Project creation becomes asynchronous infrastructure provisioning with rollback/reconciliation.
- V1 must reject placement when reserved capacity is unavailable; it must not weaken the isolation profile automatically.
- Default guest sizes, port ranges and timeouts are configuration values defined in the V1 contracts and admission inventory.

## Acceptance and reversibility

Qualification gate E00 proves the target engine topology, guest isolation, per-cell database restore, Inngest persistence/recovery and Hermes execution boundary before product implementation depends on them. Tests T01-T08 and T21-T24 are specified in [the test strategy](../../tests/STRATEGY.md). A failed capacity or integration gate revises the proposed ADR, or adds hardware; it does not authorize sharing protected credentials or disabling mandatory isolation.

This ADR stays proposed until qualification and owner acceptance. Accepted ADRs are superseded by a new decision rather than rewritten. Images, per-cell manifests, database exports and provider mappings preserve an exit path; migration to a different deployer still requires an explicit transition plan.

## Sources and research method

All sources accessed 2026-11-11. Related pages from one vendor form one independence group. Claims about the selected composition are architectural inferences, not vendor certification. Confidence: medium; coverage: official documentation only, with no live-host qualification.

1. [Docker Engine security](https://docs.docker.com/engine/security/), [rootless mode](https://docs.docker.com/engine/security/rootless/), [firewall behavior](https://docs.docker.com/engine/network/packet-filtering-firewalls/) — Docker.
2. [Kubernetes multi-tenancy](https://kubernetes.io/docs/concepts/security/multi-tenancy/) — Kubernetes.
3. [PostgreSQL database/cluster boundaries](https://www.postgresql.org/docs/18/manage-ag-overview.html), [cluster-global roles](https://www.postgresql.org/docs/18/database-roles.html) — PostgreSQL.
4. [Inngest self-host installation keys, storage and beta qualification](https://www.inngest.com/docs/platform-and-operations/self-host-inngest) — Inngest.
5. [Coolify connected servers](https://coolify.io/docs/core/infrastructure/servers/overview), [runtime model](https://coolify.io/docs/core/how-coolify-works), [security model](https://coolify.io/docs/core/security-model) — Coolify.
6. [K3s requirements](https://docs.k3s.io/installation/requirements), [architecture and HA](https://docs.k3s.io/architecture) — K3s.
7. [K3s NetworkPolicy controller](https://docs.k3s.io/networking/networking-services#network-policy-controller), [secret encryption](https://docs.k3s.io/security/secrets-encryption) — K3s.
8. [Pod Security Standards](https://kubernetes.io/docs/concepts/security/pod-security-standards/), [Secrets](https://kubernetes.io/docs/concepts/configuration/secret/) — Kubernetes.
9. [PostgreSQL privileges](https://www.postgresql.org/docs/18/ddl-priv.html), [RLS bypass rules](https://www.postgresql.org/docs/18/ddl-rowsecurity.html) — PostgreSQL.
10. [PITR boundaries](https://www.postgresql.org/docs/18/continuous-archiving.html), [filesystem backup consistency](https://www.postgresql.org/docs/18/backup-file.html) — PostgreSQL.
11. [QEMU supported virtualization security model](https://www.qemu.org/docs/master/system/security.html), [Proxmox virtualization features](https://www.proxmox.com/en/products/proxmox-virtual-environment/features) — QEMU; Proxmox, separate groups.
12. [gVisor compatibility](https://gvisor.dev/docs/user_guide/compatibility/), [Kata Containers](https://katacontainers.io/) — gVisor; Kata, separate groups.

SCOUT used two narrow researchers, three search queries each, and direct official-page reads. The synthesis adds the execution-cell decision and explicitly considers K3s, runtime sandboxes, physical separation and shared database alternatives. Proxmox manual endpoints returned 403/502; QEMU and the public Proxmox feature page support the virtualization rationale, but the chosen Proxmox release's API/RBAC behavior remains an E00 gate. The preceding research snapshots retain Hermes/Laya/toolchain evidence. No specific container runtime, engine version, capacity, exploit resistance or recovery time has been tested.

Fresh-context review: specification/research and plan reviews completed. The reviewers confirmed the baseline and required corrections to restore side-effect activation, complete action/actor policy, numerical Laya gates and explicit isolation implementation ownership. Those corrections passed incremental re-review with no remaining findings. No runtime isolation, capacity or recovery evidence has been produced.
