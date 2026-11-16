# Dedicated-server completeness recheck

Date: 2026-11-13. Scope: the owner's original hosting/agent/CI requests, current V1 F01–F46, isolation I01–I16, data D01–D10 and networking N01–N08. Artifacts: [server specification](../spec/dedicated-server.md), [installation plan](../plan/dedicated-server-installation.md).

This is a documentation coverage check. **No server access or executed infrastructure acceptance is claimed.** All P00–P09 phases and DS01–DS18 execution evidence remain pending. Current local software implementation and its remaining gaps are tracked separately in the [V1 plan](../plan/v1-development.md).

## Original-request coverage

| Request / operational concern | Explicit contract | Installation / acceptance |
| --- | --- | --- |
| AX41 Finland; verify actual CPU/RAM/disks rather than infer a variant | Spec1 and3 | P00/P01; DS01/DS02 |
| Proxmox splits the physical dedicated server once; no nested hypervisor | Spec2 | P02/P04; DS02/DS03 |
| Professional VM separated from games and Discord bots | Spec2/4/5 service inventory | P03/P04/P08; DS03/DS06/DS18 |
| Optional isolated disposable build/agent guest, not one project VM each | Spec2/3/5 | P04/P05/P07; DS03/DS08 |
| Every project AND prod/dev/preview have separate runtime/data/network authority | Spec2/4/5 | P05/P07; DS06/DS07 |
| Docker/Compose+gVisor inspected after deployment; no automatic native/Kubernetes switch | Spec5 | P05; DS06 |
| One public IPv4 target, two maximum only with justification | Spec4 | P00/P03; DS04 |
| IPv6 ingress/egress, ULA relay/translation, IPv4 fallback, filters and reboot | Spec4 | P03/P07; DS04/DS05 |
| Private owner dashboard, passkeys, MFA, scoped accounts and independent Rescue/VPN recovery | Spec4/5/6 | P01–P04/P07; DS02/DS05/DS13 |
| Own application backends, per-cell user auth, private files, realtime and TypeScript SDK | Spec5 service inventory | P05/P07/P08; DS07/DS13 |
| Independent PostgreSQL instances/data/WAL/roles per project/environment | Spec5 | P05/P06; DS07/DS09 |
| Coolify first, replaceable deployment provider; owned domains and TLS | Spec4/5 | P05 restricted baseline, P07 delivery admission; DS04/DS13 |
| GitHub App exact source binding, source-triggered delivery, previews and compatible rollback | Spec5 CI/CD | P07; DS08/DS13/DS15 |
| Jenkins replaces Actions execution: private controller, zero executors, isolated agents | Spec5 inventory/CI/CD | P07; DS08/DS15 |
| Jenkins recurring tests, source triggers, artifact/JUnit retention and missed runs | Spec5 CI/CD | P07/P08; DS15/DS16 |
| main presentation/releases; develop initially supplies executable platform source | Spec5 CI/CD, explicit current main-only configuration gap | P07; DS15 |
| Self-hosted Inngest/Redis/workflow persistence, cron/outbox/retries/cancellation | Spec5 inventory/periodic work | P05/P08; DS07/DS16 |
| Hermes Agent Center, versioned skills, scoped role homes and task grants | Spec5 inventory/agent policy | P08; DS16/DS17 |
| Recurrent owned-app security, log analysis, competitor watch and marketing drafts | Spec5 agents | P08; DS17 |
| Social posting/replies only with explicit publication authority | Spec5 agent policy | P08; DS17/DS18 |
| Codex/Claude Code remote repository work while PC is off | Spec5 runner/autonomous supervision | P07/P08; DS08/DS16/DS17 |
| Laya cheap local decisions, evaluated/bounded; no n8n or generic model replacement | Spec3/5 and inherited F29 | P08; DS17 |
| Dashboard resource usage, per-job/module/skill tokens/costs and in-flight budgets | Spec5 usage policy | P08; DS11/DS17 |
| Resource admission, quotas, ZFS ARC/cache/swap limits, bounded heavy-task queue | Spec3/5 | P01/P04/P05/P09; DS03/DS06/DS12 |
| Backups outside the AX41, key custody, PITR and held recovery without duplicate side effects | Spec6 | P06/P09; DS09/DS10/DS14 |
| External alerts, protected audit copy, redacted logs and scoped attribution | Spec5/6 | P06/P08; DS11/DS18 |
| Start/restart/stop, failure reconciliation, boot ordering and safe maintenance | Spec5/6 | P02–P09; DS02/DS10/DS16 |
| Export/migration, staged deletion, quarantine and persistent-data purge | Spec5 owner control/6 | P08/P09; DS18 |
| Capacity validation and72-hour mixed application/game/heavy-task soak | Spec3/7 | P09; DS12 |

## Complete feature-family trace

Ranges below enumerate the canonical requirement IDs; inclusion means the infrastructure obligation is assigned, not that its product implementation passes.

| Product requirements | Infrastructure ownership | Plan / DS gate |
| --- | --- | --- |
| F01 | Private owner network/authentication/recovery | P03/P07; DS05/DS13 |
| F02 | Actual scoped health/resources/jobs/spend/decisions and freshness | P08; DS11/DS17/DS18 |
| F03–F04 | Scoped project/environment lifecycle and separate cells | P05/P08; DS06/DS18 |
| F05–F06 | Observed infrastructure, enforced profiles and admitted quotas | P00/P04/P05; DS01/DS03/DS06 |
| F07 | Owned domains, dual-stack ingress and certificate lifecycle | P03/P07; DS04/DS11 |
| F08–F11 | Isolated immutable builds, readiness, previews and compatible rollback | P07; DS08/DS13/DS15 |
| F12–F15 | Independent databases/roles, migrations, physical recovery and held activation | P05/P06/P07; DS07/DS09/DS10 |
| F16–F19 | Per-cell application identity/files/realtime/SDK runtime | P05/P08; DS07/DS13 |
| F20–F21 | Durable per-cell jobs/cron/outbox and effect reconciliation | P06/P08; DS07/DS10/DS16 |
| F22–F25 | Hermes profiles/skills/chat, grants, cancellation and unknown runs | P08; DS16/DS17 |
| F26–F29 | Security/log/market/marketing skills and evaluated local Laya decisions | P08; DS17 |
| F30–F31 | Model/tool/local consumption, unknown usage, prices and budgets | P08; DS17 |
| F32–F33 | Scoped logs/metrics/traces, incidents and external notifications | P08; DS11/DS18 |
| F34–F35 | Approval inbox and protected/off-host verifiable audit | P06/P08; DS13/DS18 |
| F36 | Separate games/bots with scoped management | P04/P08; DS03/DS18 |
| F37–F38 | Replacement-host recovery, exports/imports and reversible migrations | P06/P08/P09; DS09/DS14/DS18 |
| F39 | Replaceable qualified adapters and stable contracts | P05/P07; DS06/DS13 |
| F40 | Owner desktop/mobile/error/stale journeys | Product UI gate, rechecked against real providers in P08/P09; DS13/DS18 |
| F41–F42 | Retention/deletion policy and bounded physical resource pressure | P04/P08/P09; DS03/DS12/DS18 |
| F43 | Isolated supported remote coding runner | P07/P08; DS08/DS16/DS17 |
| F44–F46 | Actual private Jenkins, exact GitHub intake and bounded standing delivery policy | P07; DS13/DS15 |

| Mandatory control family | Where retained |
| --- | --- |
| I01–I06 | Spec2–5; P03–P05: VM/cell execution, private access, runtime and quotas |
| I07–I09 | Spec5 service/identity inventory; P05–P08: independent data and scoped runtime/auth/files/events |
| I10–I13 | Spec2/5: disposable KVM tools, scoped Hermes homes, typed operations and privileged management separation |
| I14–I16 | Spec4–6: telemetry attribution/redaction, DNS/redirect/metadata egress denial, scoped off-host backup authority |
| D01–D06 | Spec5/6 and inherited isolation contract; P05–P07: independent PGDATA/WAL, grants/HBA/TLS/roles/rotation/locks/connection budgets |
| D07–D10 | Spec5/6; P06/P08/P09: physical backups, held restore, timestamp/effect gaps and staged deletion |
| N01–N04 | Spec4; P03/P04: address ceiling, shared web ingress, protocol port registry and persistent guest routing |
| N05–N08 | Spec4; P03/P07: verified AAAA/TLS, working IPv6 egress/fallback, private cell pools and both-family filtering |

## Recheck corrections and remaining uncertainty

The original documents already covered Proxmox once on the host, pro/games/work guests, Jenkins isolation, IPv4/IPv6, cells/independent PostgreSQL, TLS, backups and recovery. This recheck made the following explicit rather than relying on product-document inheritance:

- Full service-placement/operations inventory, per-service supervision and dependency order.
- Real nightly/source-triggered Jenkins checks and the current main-only prepared job configuration mismatch with a README-only main. **Changing Jenkinsfile/JCasC is a future P07 implementation step, not done here.**
- Signed public callback ingress without public administration; actual ULA-to-public IPv6 egress and DNS/redirect restrictions.
- PC-off/SSH-disconnected autonomy, cron timezone/DST and one scheduler owner per task.
- Hermes skills/remote coding, Laya evaluation limits, per-run/module token/cost attribution and budget refusal.
- ZFS ARC/caches, sealed-store boot readiness, scoped accounts/rotation, off-host audit, at-rest encryption decisions and lifecycle/export/purge obligations.
- DS15–DS18 gates now prevent treating installed services as completed CI/autonomy/agent/accounting functionality.
- Installation order now distinguishes host/guest/container/receiver network subgates and restricted platform installation in P05, recovery qualification in P06, then delivery admission in P07. No test requires an uninstalled service to have already passed.

No application feature is removed because it is not yet implemented. Host baseline can be accepted in stages; full V1 still requires every applicable F/I/D/N control and product test. Native Kubernetes hosting, nested Proxmox, per-project ordinary VMs, multi-host HA, large local generative models, unchanged Supabase protocol parity and n8n/visual modular automation are not introduced by this recheck.

Still to resolve from real inspection/owner input: disk variant/health/usable capacity, actual addresses/routes, domains/DNS, game workloads/ports, backup destination/cost/custody and exact compatible version pins. No physical-machine completeness guarantee can be made without that inventory and execution evidence.

Independent fresh-context review results are retained in [the review report](dedicated-server-recheck.json). It reviews documentation completeness; it does not certify a deployed host or executed test family.
