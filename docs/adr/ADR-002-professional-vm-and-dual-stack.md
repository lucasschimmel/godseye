# ADR-002: Keep one professional VM and use shared IPv4 with IPv6-first networking

Date: 2026-11-11
Status: proposed current V1 baseline; supersedes ADR-001 project/environment VM placement

## Context

The owner wants the original coarse split: one professional G.O.D.S.E.Y.E VM and a separate games/personal VM on the AX41, with project isolation inside the professional VM. The previous specification moved every project/environment into its own host-level guest; that was not nested Proxmox, but it changed this intended model and was poorly explained.

The owner also requires one public IPv4 as the target, with at most two if a concrete protocol/port need justifies the second. Prefer IPv6 wherever endpoints support it, while retaining compatibility with IPv4-only clients and integrations.

## Decision

Install **Proxmox once on the physical AX41**. It hosts two permanent Linux VMs: professional and games/personal. An optional bounded disposable work VM, also directly on Proxmox, runs unsafe builds/scanner/agent shell tasks. No Proxmox, nested hypervisor or project VM farm runs inside G.O.D.S.E.Y.E.

Inside the professional VM use Docker/Compose with **gVisor `runsc`, using its `systrap` platform, for application and compatible project-worker services**. Each project/environment cell has separate application sandboxes, networks, managed data directories/volumes, identities, quotas, PostgreSQL instance and workflow keys/state. PostgreSQL and trusted infrastructure services may use a qualified native runtime profile; applications cannot request that profile. Keep privileged deployment/credential tooling private and outside application sandboxes.

Retain Coolify as the first deployment provider. Its documented Custom Docker Options include `--runtime`; Compose documents a `runtime` service field. The provider must explicitly select and inspect the effective `runsc` configuration after deploy/redeploy, and fail closed if the required runtime or policy is missing. This documents a supported integration surface, not a tested end-to-end guarantee. [1][2][3]

The gVisor systrap platform is suitable inside a VM without `/dev/kvm`; its KVM backend is not selected. Workload syscall/network/filesystem compatibility and performance remain qualification gates. Native database/infrastructure processes still share the professional VM's kernel. **Professional-VM root/daemon/kernel compromise is a shared compromise boundary**, unlike the superseded per-project KVM proposal. Normal project access controls and sandboxing reduce exposure but must not be described as identical to separate guest kernels. [1][4]

## Topology

```text
AX41 physical host: Proxmox, routing and host firewall
  |
  +-- Professional VM: G.O.D.S.E.Y.E
  |     +-- private control API, Coolify and credential broker
  |     +-- dual-stack HTTPS ingress
  |     +-- project A: gVisor apps + private A data/job services
  |     +-- project B: gVisor apps + private B data/job services
  |     +-- other independently authorized environments
  |
  +-- Games/personal VM: game servers and bots
  |
  +-- optional disposable task VM: one heavy task at a time
```

The optional work VM preserves an outer boundary for arbitrary Dockerfile builds and tool code; it is not a guest per application and not nested virtualization. If that worker is unavailable, unsafe work queues or uses a separately qualified isolated CI provider. Do not run arbitrary build instructions natively on the shared professional Docker daemon as a silent fallback.

## Network decision

Use the host's one public IPv4 for NAT44 outbound and selected inbound forwards. TCP 80/443 reaches only the professional ingress; it routes domains to the correct application. Explicit TCP/UDP game ports reach the games VM. Other management/database ports are not published. Domains can share an IP because the HTTPS ingress owns hostname/TLS routing. A second IPv4 is only a documented exception for a fixed-port/protocol collision or similar demonstrated need. [5]

Hetzner documents a routed IPv6 `/64` for dedicated servers. Route selected static addresses to the VMs, keep the host's upstream MAC visible, and enforce firewalling on both IP families. The precise `/128` routes/bridge arrangement is qualified against the actual Robot assignment; do not place the same public `/64` onto several independent bridges or assume several SLAAC `/64`s can be extracted from one `/64`. Project container networks use separately generated ULA space, not copies of that public prefix. [5][6][7]

Publish application `A` records to the shared IPv4 and `AAAA` records to the professional ingress IPv6 after both paths work. Game IPv6 is published when the game/client supports it. Prefer IPv6 for qualified outbound endpoints; keep NAT44 for IPv4-only endpoints. IPv6-only origins require the retained IPv4-capable proxy for IPv4-only clients. A shared public IP does not require sharing application networks, credentials or databases. [5][8]

Robot's firewall filters IPv4 by default; IPv6 filtering is separate and has limitations. Host and professional-VM rules are authoritative for precise cross-VM/project policy. Permit essential ICMPv6/neighbor discovery/path-MTU handling; test IPv6 directly, including any address that lacks a public DNS name. [6][9]

## Alternatives and consequences

- **Per-project KVM guests:** stronger separate-kernel boundary, but not selected under the clarified one-professional-VM constraint. Remains an explicit future escape hatch for a particularly sensitive workload, not the default.
- **K3s/containerd inside the professional VM:** viable orchestration alternative; it would require a native Kubernetes deployment provider and additional runtime/network policy work. It does not automatically improve the shared-kernel boundary. Retain the simpler documented Coolify/Docker/runtime path for V1.
- **Plain containers only:** retain for explicitly trusted native infrastructure; not the required application profile. No silent downgrade when gVisor fails.
- **IPv6-only services:** reduce IPv4 use but do not support every current client/integration. Dual-stack ingress plus one shared IPv4 balances reachability and address use.

The professional VM now holds the project allocation pool as well as control services. Initial memory hypothesis on a 64 GiB host: 32 GiB professional, 16 GiB games, 8 GiB optional work, 8 GiB host/cache/headroom. Project limits partition the professional VM allocation and need real data-directory quotas; distinct Docker volume names alone do not enforce disk quotas. E00 may resize workloads but cannot claim unmeasured project capacity.

## Qualification and acceptance

T02/T03/T04/T05 verify sandbox/filesystem/network/resource separation and the outer VM boundaries. T06/T20 retain independent database/job identities. T02/T13/T36 verify one-IPv4 operation, dual-stack DNS/ingress/egress, game port allocation, direct IPv6 denial and forwarding after reboot. Runtime absence or incompatibility blocks the corresponding workload rather than switching it to native execution. Full requirements and plan stay in force except placement-specific clauses superseded here.

## Sources and method

All accessed 2026-11-11. Same-vendor pages form one independence group. The composition is a proposed architecture; no compatibility, latency, load, isolation or routing test has run.

1. [gVisor Docker integration](https://gvisor.dev/docs/user_guide/quick_start/docker/), [platforms and systrap](https://gvisor.dev/docs/user_guide/platforms/) — gVisor.
2. [Coolify custom Docker options](https://coolify.io/docs/applications/builds/custom-docker-options), [Compose](https://coolify.io/docs/applications/builds/docker-compose) — Coolify.
3. [Docker Compose runtime](https://docs.docker.com/reference/compose-file/services/#runtime) — Docker.
4. [gVisor security](https://gvisor.dev/docs/architecture_guide/security/), [compatibility](https://gvisor.dev/docs/user_guide/compatibility/) — gVisor.
5. [Hetzner official Proxmox routing/NAT guide](https://community.hetzner.com/tutorials/install-and-configure-proxmox_ve/) — Hetzner.
6. [Hetzner dedicated address routing](https://docs.hetzner.com/robot/dedicated-server/ip/additional-ip-adresses/) — Hetzner.
7. [IPv6 prefix boundary and SLAAC](https://www.rfc-editor.org/rfc/rfc7421.html#section-4.3) — IETF.
8. [Dual stack and DNS](https://www.rfc-editor.org/rfc/rfc4213.html#section-2) — IETF.
9. [Robot firewall IPv6 scope](https://docs.hetzner.com/robot/dedicated-server/firewall/) — Hetzner.
10. [Docker IPv6/ULA](https://docs.docker.com/engine/daemon/ipv6/), [bridge behavior](https://docs.docker.com/engine/network/drivers/bridge/) — Docker.

SCOUT used three initial focused queries and two narrow researchers with two queries each, then direct official-page reads. K3s was considered and not selected, avoiding an unsupported Coolify-to-Kubernetes assumption. Remaining uncertainties: actual assigned prefix/routes, gVisor compatibility for each service, Coolify rendered policy/runtime, VM firewall backends/quotas and hardware capacity. This supersedes ADR-001 placement and the v3 research snapshot without changing their historical content.

Fresh-context review: passed with no confirmed findings. The critic checked placement consistency, documented runtime selection, shared-kernel limits, IPv6 routing and address/firewall policy against decisive official sources. Actual runtime configuration, quotas, workload compatibility and routing remain E00 tests.
