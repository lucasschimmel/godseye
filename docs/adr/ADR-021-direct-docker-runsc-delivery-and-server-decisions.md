# ADR-021: Direct Docker + runsc delivery, PostgreSQL 17/18 split and WireGuard-only console

Date: 2026-11-16
Status: accepted (owner decisions of 2026-11-15, recorded in entry 015 of the [execution ledger](../operations/dedicated-server-execution.md); implemented and deployed on the dedicated server)
Supersedes: the Coolify provider choice in [ADR-001](ADR-001-isolation-and-orchestration.md) and [ADR-002](ADR-002-professional-vm-and-dual-stack.md); the single-PostgreSQL-version assumption of [ADR-007](ADR-007-independent-postgresql-cells.md) for the server.

## Context

The V1 documents named Coolify as the first replaceable deployment provider and assumed one PostgreSQL
generation. The dedicated server work (P05-P07, entries 010-017) showed that:

- the delivery adapters the platform needs (immutable image by digest, per-environment network, Caddy route
  file, label-based reconciliation, rollback by retained digest) are small, and a second deployment engine
  with its own database, UI and credentials would add a privileged component that must itself be
  qualified and kept off the owner's attack surface;
- the control database was already installed as PostgreSQL 17 with the distribution pgBackRest 2.55.1,
  while project cells were qualified locally and on the server with PostgreSQL 18 and pgBackRest 2.60.0;
- the server is a Hetzner `EX44-1-LTD` (not the AX41 of the first specification), and only HTTP(S) for
  registered applications and the exact game port are meant to be public.

## Decision

1. **Delivery without Coolify.** The control API delivers through its own adapters on `godseye-pro`:
   `apps/control-api/src/delivery/docker-runtime.ts` creates every application container with
   `--runtime=runsc` (configurable, default `runsc`), a read-only root, all capabilities dropped and a
   per-environment network; it derives all state from Docker labels and the Caddy route files and refuses
   to treat a container as owned unless the inspected runtime is `runsc`. Other adapters in the same
   directory handle the GitHub App token exchange, the private registry, Jenkins and the edge Caddy routes.
   The deployment-provider seam in `packages/core` stays, so a different engine can replace the Docker
   adapter later (F39); Coolify is no longer a planned or installed component. The Docker socket is still
   never mounted into applications, builds or agent tasks.
2. **PostgreSQL split.** The control and metadata database stays on PostgreSQL 17 with the distribution
   pgBackRest 2.55.1 (one stanza, off-host Backblaze B2). Project cells run PostgreSQL 18 (PGDG, 18.7 on the
   server) with pgBackRest 2.60.0, one independent instance, data directory, WAL, roles and stanza per cell
   ([dedicated cells](../development/dedicated-cells.md), evidence
   [cells-deploy](../operations/evidence/cells-deploy.md)). Neither version is shared across the boundary.
3. **Console reachable only over WireGuard.** The console and owner API are served on
   `console.godseye.lucasschimmel.fr`, whose DNS record is a private address (`10.20.1.11`) reachable only
   through the host's `wg0`; the public listener serves registered application hosts and `healthz` and
   answers 404 for any other host. Proxmox (`8006`) and host SSH (`22`) are also WireGuard-only. Owner
   passkeys are enrolled on that real origin.
4. **Hardware record.** The machine is a Hetzner `EX44-1-LTD` (Intel i5-13500, 62.57 GiB usable RAM, two
   NVMe in a ZFS mirror). Specifications that quote AX41 capacity are historical; the measured figures are
   in the ledger (sections 1-2 and entry 021).

## Consequences

- Provider qualification now means qualifying the in-repository Docker/runsc, registry, Jenkins and Caddy
  adapters on the server; the live GitHub App, registry, scanner and a real preview/rollback were not run
  when this ADR was written.
- Two PostgreSQL major versions and two pgBackRest versions are maintained side by side; upgrades of either
  need their own restore drill.
- A lost WireGuard peer set removes access to the console; recovery follows
  [break-glass](../operations/break-glass.md).
- Historical research and ADR text that mentions Coolify or the AX41 is kept as the record of the earlier
  decision and carries a pointer to this ADR.
