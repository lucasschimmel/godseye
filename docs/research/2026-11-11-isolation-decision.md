---
node_type: research
topic: godseye-control-platform
date: 2026-11-11
mode: web
freshness_expires: 2026-12-11
confidence: medium
coverage: "partial: official documentation and specification review; no live provider, capacity or isolation tests"
supersedes: 2026-11-11-snapshot-v2.md
---

# G.O.D.S.E.Y.E isolation and complete V1 scope

## Verdict

Use Proxmox/KVM with a dedicated guest per project/environment, and Docker/Compose inside that boundary.
Use independent PostgreSQL instances, credentials/data/WAL and Inngest state/keys per cell; aggregate through the private platform.
Deliver the complete defined V1 through 13 ordered epics, with explicit isolation/recovery evidence before release.

## Delta

The user explicitly requested stronger project isolation, a Docker-versus-Kubernetes evaluation, separate database access and a near-complete V1 instead of an MVP. This supersedes the earlier shared-application-VM/shared-PostgreSQL and shared-project-Inngest assumptions. Hermes remains core, Inngest remains self-hosted, Laya remains local typed decisions, Coolify remains the initial replaceable engine, and the accepted custom SDK avoids Supabase Cloud/protocol dependence.

The implementation baseline is proposed and needs E00 qualification; source documentation does not establish workload capacity, exploit resistance or recovery time. Existing immutable research snapshots remain historical evidence, not the current product contract.

## Findings

- Docker supplies packaging and namespace/cgroup controls; the daemon and its configuration remain privileged attack surfaces. Rootless operation is an additional mitigation, not a separate guest kernel. [1]
- Kubernetes tenancy requires several policies beyond namespaces. K3s is hardware-eligible on the listed AX41, but its documented baseline excludes workloads. Its built-in kube-router policy controller is real; describing default K3s as necessarily unable to enforce NetworkPolicy would be incorrect. [2][3]
- KVM/QEMU supports a guest-isolation security model, subject to supported accelerators/machine types and vulnerabilities. VMs on one host do not eliminate physical failure or administrator compromise. [4]
- PostgreSQL databases on one cluster share roles and recovery administration. Distinct login/password pairs need deliberate grants and do not create separate instances. The proposed per-cell cluster makes restore/upgrade authority cell-specific. [5]
- PostgreSQL PITR is cluster recovery, and live file copies are not automatically valid backups. A qualified base/WAL tool and off-host storage remain necessary; pgBackRest is the proposed provider. [6][7]
- Coolify documents SSH-connected Docker deployment servers. It can therefore target preprovisioned Linux guests, while VM provisioning remains a separate adapter. Native Kubernetes management is not assumed. [8]
- The self-host Inngest guide documents installation-level keys and a single-node beta mode. Cell-specific engines avoid granting cross-project signing material; production use remains a pinned-release persistence/recovery gate. [9]
- Self-hosted OpenBao documents path policies, PostgreSQL static/dynamic credentials and seal/unseal behavior. Its proposed use requires offline recovery material, bounded cell policies and an explicit degraded state when sealed. [10]

The resulting V1 contract contains 43 functional requirements, 16 isolation controls, 10 data controls, 48 stories in 13 epics and 40 future test families. These are specification counts, not implemented features or passed runtime tests. The plan includes remote coding, personal games/bots, owner UX, deployment/data services, scoped agent skills, costs and recovery.

## Contested choices

**K3s versus guest boundaries:** orchestration/reconciliation is useful, but one shared node does not supply a separate kernel per project. The proposed V1 prioritizes KVM isolation. A later Kubernetes provider must preserve the accepted trust boundaries; merely moving workloads into namespaces is not equivalent. [2][3][4]

**Dedicated services versus density:** per-cell PostgreSQL/Inngest/Redis and guests increase overhead. The 64 GiB memory envelope is a hypothesis with admission controls, not a supported project-count promise. Capacity failure must reduce admitted workload or add hardware rather than silently reintroduce shared protected identities.

**Independent restores versus external effects:** restoring a cell can rewind its outbox/workflow history after a real external action. The specification therefore pauses restored producers, fences the old cell, uses an independent effect journal/activation epoch and reconciles gaps before resuming. Whole-host recovery with missing effect history remains unknown/manual resolution rather than automatic replay. This is a design requirement, not a vendor exactly-once guarantee.

**Near-complete V1 versus scope inflation:** all requested essential areas are included. Native Kubernetes/custom deployer implementations, public customer hosting, physical-host HA and unchanged Supabase protocol parity stay outside V1. Internal checkpoints can be partial; a V1 release cannot waive failed isolation/recovery gates to claim an arbitrary 90% score.

## Sources

All accessed 2026-11-11. Multiple pages of one organization form one independence group; no extra corroboration is inferred from page count.

1. [Docker security](https://docs.docker.com/engine/security/), [rootless](https://docs.docker.com/engine/security/rootless/), [firewalls](https://docs.docker.com/engine/network/packet-filtering-firewalls/) — Docker.
2. [Kubernetes multi-tenancy](https://kubernetes.io/docs/concepts/security/multi-tenancy/), [Pod Security](https://kubernetes.io/docs/concepts/security/pod-security-standards/) — Kubernetes.
3. [K3s requirements](https://docs.k3s.io/installation/requirements), [NetworkPolicy](https://docs.k3s.io/networking/networking-services#network-policy-controller), [architecture](https://docs.k3s.io/architecture) — K3s.
4. [QEMU security model](https://www.qemu.org/docs/master/system/security.html), [Proxmox features](https://www.proxmox.com/en/products/proxmox-virtual-environment/features) — QEMU; Proxmox, distinct groups.
5. [PostgreSQL cluster/database boundaries](https://www.postgresql.org/docs/18/manage-ag-overview.html), [roles](https://www.postgresql.org/docs/18/database-roles.html), [privileges](https://www.postgresql.org/docs/18/ddl-priv.html), [RLS](https://www.postgresql.org/docs/18/ddl-rowsecurity.html) — PostgreSQL.
6. [PITR](https://www.postgresql.org/docs/18/continuous-archiving.html), [backup consistency](https://www.postgresql.org/docs/18/backup-file.html), [TLS](https://www.postgresql.org/docs/18/libpq-ssl.html) — PostgreSQL.
7. [pgBackRest guide](https://pgbackrest.org/user-guide.html) — pgBackRest.
8. [Coolify servers](https://coolify.io/docs/core/infrastructure/servers/overview), [runtime](https://coolify.io/docs/core/how-coolify-works), [security](https://coolify.io/docs/core/security-model) — Coolify.
9. [Inngest self-hosting](https://www.inngest.com/docs/platform-and-operations/self-host-inngest) — Inngest.
10. [OpenBao PostgreSQL credentials](https://openbao.org/docs/secrets/databases/postgresql/), [policies](https://openbao.org/docs/concepts/policies/), [seal/unseal](https://openbao.org/docs/concepts/seal/) — OpenBao.

## Method and review

SCOUT refreshed the earlier dossier with two narrow primary-source researchers and centralized synthesis. Six of twelve planned search queries were used; remaining inspection followed direct official links. Proxmox manual endpoints returned 403/502; the public feature page and QEMU security documentation support the conceptual choice, while Proxmox release-specific API/RBAC behavior remains unqualified.

Queries actually run:

1. `site.docs.docker.com security rootless iptables ufw Docker daemon attack surface`
2. `site:kubernetes.io multi tenancy namespace isolation network policies security checklist`
3. `site:docs.k3s.io architecture single server requirements secrets encryption`
4. `site.postgresql.org docs current database cluster roles privileges CONNECT PUBLIC continuous archiving`
5. `site:coolify.io/docs servers multiple servers Kubernetes Docker supported`
6. `site:coolify.io/docs Kubernetes support not supported`

Fresh-context specification/research and plan critics confirmed the architecture. Their findings led to paused/fenced restore activation with effect reconciliation, exhaustive action/actor policy, frozen numeric Laya targets and explicit ownership for every isolation control. Both affected contracts passed incremental re-review. Review coverage does not include live infrastructure, actual test outcomes, provider-release compatibility, production data migration, visual UI quality or measured capacity. Documentation link/reference/JSON syntax checks are separate mechanical checks, not runtime evidence.

Canonical implementation artifacts in the project repository: `docs/spec/v1.md`, `docs/spec/isolation.md`, `docs/plan/v1-development.md`, `docs/contracts/`, `tests/STRATEGY.md`, and `docs/adr/ADR-001-isolation-and-orchestration.md`. No implementation or deployment has occurred in this research phase.
