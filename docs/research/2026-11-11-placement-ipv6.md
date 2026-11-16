---
node_type: research
topic: godseye-control-platform
date: 2026-11-11
mode: web
freshness_expires: 2026-12-11
confidence: medium
coverage: "partial: official documentation and revised placement/network specification; live qualification pending"
supersedes: 2026-11-11-snapshot-v3.md
---

# G.O.D.S.E.Y.E professional VM and IPv6-first placement

## Verdict

Install Proxmox only on the AX41: one professional VM, one games VM and optionally one bounded disposable work VM.
Inside the professional VM use Docker/Compose with gVisor systrap application sandboxes and separate project/environment data, networks and identities.
Target one shared public IPv4, maximum two by justified exception, with routed IPv6 and dual-stack ingress/egress compatibility.

## Delta

The owner clarified that the professional VM should contain ordinary professional projects. The previous proposal created each project VM directly on the physical hypervisor, not inside another VM, but that changed the intended coarse split. ADR-002 and active specifications now replace that placement. The previous separate-guest-kernel isolation guarantee is explicitly withdrawn for projects sharing the professional VM.

The optional work guest is only for unsafe builds/general tool execution and is directly on the physical hypervisor. No nested Proxmox/KVM is required. Public address use is independent of the number of projects: private services share routed/proxied access instead of consuming public IPv4 addresses each.

## Findings

- gVisor documents a Docker runtime and the systrap platform, which works inside an existing VM without selecting its KVM backend. Runtime installation, explicit selection and workload compatibility still need qualification. [1]
- Coolify's supported custom Docker options include `--runtime`; Compose has a runtime field. This supports the proposed adapter integration, but the effective configuration must be inspected after deploy/redeploy. [2][3]
- Shared professional-VM infrastructure remains a common privileged/kernel failure boundary. gVisor and scoped project policies reduce application exposure; they are not equivalent to a VM per project. [4]
- Hetzner documents routed dedicated-server IPv6 addressing and a Proxmox NAT/routing layout. One shared IPv4 can serve private guest outbound traffic and selected inbound forwards; actual address/route configuration remains to inspect. [5]
- Use A records for the shared IPv4 ingress and AAAA for verified routed IPv6 ingress. IPv4-only clients still need the retained IPv4-capable path. Game ports need protocol-specific allocations; a second IPv4 is an exception for demonstrated conflicts. [5][6]
- IPv6 needs its own host/VM firewall validation. Robot filtering is IPv4-only by default with a separate optional IPv6 filter and limitations; it is not the entire precise access policy. [7]
- Avoid placing the same public /64 on unrelated links or assuming it supplies several standard SLAAC /64 networks. Use qualified static guest routes and private non-overlapping ULA container networks. [5][8][9]

## Contested choices

**Docker/gVisor versus K3s:** K3s is viable inside the professional VM but requires different deployment integration and additional runtime/network configuration. Retaining the documented Coolify/Docker runtime selection path avoids an unrelated platform pivot. Kubernetes remains an evaluated later provider, not a nested hypervisor or an automatic security upgrade.

**One professional VM versus per-project guests:** the selected model matches the owner's clarified operating model and reduces per-VM overhead. Professional-VM root/daemon/kernel compromise can affect all projects; the outer KVM boundary protects the games/task separation, not every professional tenant.

**IPv6-first versus IPv6-only:** prefer working IPv6 but retain IPv4 proxy/NAT for real compatibility. No per-project public IPv4 is required. Published IPv6 is globally routable addressing, not permission to bypass private database/admin policy.

## Sources

All accessed 2026-11-11; same-vendor pages form one independence group. Composition and quotas are proposed, not measured.

1. [gVisor Docker integration](https://gvisor.dev/docs/user_guide/quick_start/docker/), [platforms](https://gvisor.dev/docs/user_guide/platforms/) — gVisor.
2. [Coolify supported Docker options](https://coolify.io/docs/applications/builds/custom-docker-options), [Compose](https://coolify.io/docs/applications/builds/docker-compose) — Coolify.
3. [Compose runtime](https://docs.docker.com/reference/compose-file/services/#runtime) — Docker.
4. [gVisor security](https://gvisor.dev/docs/architecture_guide/security/), [compatibility](https://gvisor.dev/docs/user_guide/compatibility/) — gVisor.
5. [Hetzner official Proxmox/NAT guide](https://community.hetzner.com/tutorials/install-and-configure-proxmox_ve/), [dedicated address routing](https://docs.hetzner.com/robot/dedicated-server/ip/additional-ip-adresses/) — Hetzner.
6. [Dual stack and DNS](https://www.rfc-editor.org/rfc/rfc4213.html#section-2) — IETF.
7. [Robot firewall](https://docs.hetzner.com/robot/dedicated-server/firewall/) — Hetzner.
8. [IPv6 prefix boundary](https://www.rfc-editor.org/rfc/rfc7421.html#section-4.3) — IETF.
9. [Docker IPv6/ULA](https://docs.docker.com/engine/daemon/ipv6/), [bridge behavior](https://docs.docker.com/engine/network/drivers/bridge/) — Docker.

## Method

SCOUT used three initial focused queries and two narrow primary-source researchers, with two search queries each: seven queries total plus direct official-page reads. It compared the K3s alternative, checked the actual documented Coolify runtime selection surface, and traced Hetzner IPv6/NAT/firewall behavior to official sources. No live host routing, effective runtime, syscall compatibility, quotas, performance or security tests were executed. Exact addresses and the selected static route layout remain qualification inputs.

Current contracts are in the project repository: `docs/adr/ADR-002-professional-vm-and-dual-stack.md`, `docs/spec/networking.md`, updated architecture/isolation/plan/schema and test strategy. This refresh supersedes v3 placement while retaining the existing functional V1 scope. Fresh-context review passed with no confirmed findings after checking the decisive official integration/network sources. Documentation mechanics and runtime evidence remain separate; runtime behavior is unverified.
