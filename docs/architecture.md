# G.O.D.S.E.Y.E architecture overview

Status: V1 baseline (2026-11-11), updated 2026-11-16. The platform software is implemented and deployed on the dedicated server (Hetzner `EX44-1-LTD`); qualification gaps are tracked in the [execution ledger](operations/dedicated-server-execution.md) and the [gap inventory](reviews/2026-11-16-gap-inventory.md). The owner accepted a custom SDK, one professional VM and a separate games VM. Current placement/network authority: [ADR-002](adr/ADR-002-professional-vm-and-dual-stack.md); delivery engine, PostgreSQL 17/18 split and WireGuard-only console: [ADR-021](adr/ADR-021-direct-docker-runsc-delivery-and-server-decisions.md).

## One hypervisor and two permanent VMs

```text
EX44 physical host
  Proxmox installed ONCE: routing, firewall and VM lifecycle
  |
  +-- Professional VM: G.O.D.S.E.Y.E and all normal pro projects
  |     +-- private console (WireGuard only), control API, Docker/runsc delivery, OpenBao broker
  |     +-- dual-stack HTTPS ingress
  |     +-- project A: sandboxed apps, private database/files/jobs
  |     +-- project B: sandboxed apps, private database/files/jobs
  |     +-- separate development/production/preview cell resources
  |
  +-- Games/personal VM: game servers and Discord bots
  |
  +-- Optional disposable work VM: builds and unsafe tool tasks
```

The optional worker is a bounded sibling directly on the physical Proxmox host, not a VM per project or a hypervisor inside the professional VM. It queues heavy work when unavailable. Projects themselves remain inside the professional VM.

## Project isolation inside the professional VM

Docker/Compose packages services. Application and compatible project-worker processes use gVisor `runsc` with the `systrap` platform, which requires no nested hardware virtualization. Every project/environment cell has separate application sandboxes, Docker networks, filesystem-quota-managed data allocations, credentials, PostgreSQL instance and workflow state/keys. Development, production and previews do not share those resources.

Trusted database and infrastructure services use separately qualified native runtime profiles where required. No application receives the Docker socket, migration/backup/controller credentials, arbitrary mounts or another project's network. The delivery adapter selects `--runtime=runsc` itself and verifies the effective runtime by inspection after deploy and redeploy; unsupported workloads do not silently fall back to native execution. The control database runs PostgreSQL 17; project cells run PostgreSQL 18, each with its own instance and backup stanza.

This is a revised trust boundary: professional-VM root, daemon or kernel compromise can affect every professional project. It is not equivalent to the earlier separate-kernel-per-project proposal. The host still isolates professional, games and optional work VMs. The [isolation contract](spec/isolation.md) and [network matrix](spec/networking.md) define observable controls, not perfect containment guarantees.

## IPv6-first, one shared public IPv4

The host retains one public IPv4. NAT44 supplies outgoing compatibility; TCP 80/443 forwards to the professional HTTPS ingress and allocated game ports to the games VM. A records for many sites can share that IPv4. A second is only a justified fixed-port/protocol exception; the maximum is two.

Route selected addresses from Hetzner's assigned IPv6 allocation to the VMs. Publish application AAAA records to the professional ingress IPv6 after verified reachability/TLS/firewall checks; games use their IPv6 where supported. Prefer working IPv6 for external integrations, keep IPv4 fallback for IPv4-only clients/providers. Public IPv6 does not mean public database/admin access.

Docker project networks use private IPv4 and non-overlapping ULA IPv6 pools. Do not copy the public /64 across unrelated links/bridges or assume each project needs a public address. [The network specification](spec/networking.md) fixes routing, address limits, ingress/egress, DNS, game ports and dual-stack tests.

## Product and implementation

The owner console uses TanStack Start, React, TypeScript, Tailwind, shadcn/ui and TanStack Query/Table. Hono/Zod, Drizzle/PostgreSQL and Better Auth provide custom API/runtime templates. Bun workspaces/package management, Node.js24, Biome/Husky, Vitest/Playwright and independent CI are the local baseline; Hermes/Laya retain separately qualified Python runtimes.

The backend provides project/environment lifecycle, independent databases and identities, application auth/files, realtime domain/job events, custom SDK, migrations, backup/PITR and export/import without Supabase Cloud. Inngest remains cell-scoped plus a trusted platform scheduler. Hermes is central to operational/security/market/research/coding skills; Laya supplies evaluated local decisions. Usage accounting remains separate.

Deployment runs through the platform's own replaceable Docker + `runsc` adapter (Coolify, the first candidate, was dropped: [ADR-021](adr/ADR-021-direct-docker-runsc-delivery-and-server-decisions.md)). It does not provision project VMs and is not assumed to manage Kubernetes. Kubernetes remains an evaluated later provider rather than an additional platform installed beside Docker for the same applications.

## Authoritative documents

- [Dedicated-server specification](spec/dedicated-server.md) and [installation/qualification plan](plan/dedicated-server-installation.md): target-specific infrastructure requirements and pending P00–P09 execution phases.

- [Current decision and sources](adr/ADR-002-professional-vm-and-dual-stack.md); [superseded per-project-VM decision](adr/ADR-001-isolation-and-orchestration.md).
- [V1 functional requirements](spec/v1.md): 43 required capabilities.
- [Isolation/data](spec/isolation.md): 16 isolation and 10 data controls.
- [Networking](spec/networking.md): 8 IPv6/shared-IPv4 controls.
- [Development plan](plan/v1-development.md): 13 epics and 48 stories.
- [Verification strategy](../tests/STRATEGY.md): 40 future test families.
- [Boundary contracts](contracts/README.md): proposed schemas and authorization semantics.

E00 qualifies actual hardware, runtime/provider compatibility, real data quotas and both IP families before implementation depends on them. The full V1 scope remains; no runtime test or deployed feature is claimed.
