# Dedicated-server implementation and qualification plan

Status: documentation ready for review, 2026-11-13. **Every execution phase is pending.** This task creates a plan; it does not log into, reinstall or change the dedicated server.

Contract: [dedicated-server specification](../spec/dedicated-server.md). Dependencies: [networking](../spec/networking.md), [isolation/recovery](../spec/isolation.md), [product development plan](v1-development.md), [placement ADR](../adr/ADR-002-professional-vm-and-dual-stack.md).

## Execution rules

1. Preserve the current machine and workstation-independent recovery access until inventory is complete. The owner previously allowed reinstallation; revalidate current data/ownership immediately before a destructive step rather than treating an old empty-server report as a fresh observation.
2. Prepare exact target-bound commands/configuration only after identifying addresses, disks and installed versions. No copy/paste destructive shell recipes with guessed interfaces or device names.
3. Advance on recorded evidence, not elapsed time. Maintain an old verified route/session while testing its replacement. Use scheduled network rollback and external probes before committing access changes.
4. Keep desired configuration separate from actual/qualified observations. A local test, rendered Compose file or successful API response does not establish remote containment or recoverability.
5. Software gaps and provider limitations are work items. Unsupported capability stays disabled; do not switch to privileged/native workloads or expose private services to make a test pass.
6. Store scripts/IaC, sanitized manifests, version pins and validation evidence on develop through the [Git workflow](../development/git-workflow.md). Keep live keys/account values outside Git. Main remains release-only.

No calendar estimate is promised before hardware/network measurements. A replacement-machine restore test and72-hour soak require real capacity/time; neither can be waived by calling a phase an MVP.

## Dependency sequence

```text
P00 Inventory and preservation
  -> P01 Exact install/recovery preparation
  -> P02 Proxmox + storage + bootstrap management
  -> P03 Private access + dual-stack routing/firewall
  -> P04 Permanent guests + capacity
  -> P05 Professional runtime + A/B isolation qualification
  -> P06 Off-host backups + held recovery
  -> P07 Delivery/CI + G.O.D.S.E.Y.E provider admission
  -> P08 Real services, games and operational alerts
  -> P09 Load/soak/recovery acceptance and handoff
```

Some documentation/IaC may be prepared locally earlier. Enabling a dependent runtime still requires the preceding operational gates.

## P00 — Inventory and preservation

State: pending. Maps to E00.S01 and DS01.

- Read provider ownership/assignment, actual OS/boot mode, CPU/SVM, usable RAM, NIC/MAC/MTU and IPv4/IPv6 routes.
- Record every disk by serial/by-id, size, health/wear and current partitions/RAID; determine SATA versus NVMe from observation.
- List current services and data, even after a reported reset. Record preserve/export/discard decisions and prove recovery of anything retained.
- Verify Robot, Rescue and available console access; identify a recovery device/contact independent of the currently used PC.
- List domains/DNS authority, desired game servers/bots and required protocol/ports; identify candidate backup location and key custody without purchasing anything.
- Define the representative workload before benchmarking: game/player/tick profile, application request rate/concurrency, error and p95/p99 latency ceilings, acceptable game jitter and resource-pressure limits. These remain measured/owner-specific inputs, not invented service guarantees.

Deliverables: sanitized inventory worksheet, actual capacity, current-service list, ownership/preservation record and unknown-input register.

Acceptance: DS01 complete with no unknown destructive target or unresolved retained data. Failure: remain read-only; no reinstall.

## P01 — Installation and rollback preparation

State: pending. Depends P00; maps to DS02/DS05.

- Pin supported Proxmox/Debian installer/repositories and exact guest/runtime candidates using current vendor documentation.
- Choose ZFS mirror versus RAID1/LVM using observed health/boot compatibility. Write the exact partition/boot plan and capacity equation; never configure both accidentally.
- Prepare reproducible hostname/time/DNS/users/private-access and firewall configuration with placeholders replaced only in a private deployment inventory.
- Prepare bootstrap access rules, scheduled network rollback, a second verified session and Rescue recovery steps. Capture configuration before any network change.
- Document reinstall window and concrete data-loss consequences. Confirm the observed inventory still matches the approved destructive target set.

Deliverables: target-specific install worksheet, version matrix, storage plan, access transition/rollback plan and configuration artifact hashes.

Acceptance: recovery access and a correct installation procedure are available without the professional VM or this PC. Failure: no formatting or public access closure.

## P02 — Bare-metal Proxmox and mirrored storage

State: pending. Depends P01; maps to DS02.

- Enter provider Rescue and install the chosen supported bare-metal base, replacing Ubuntu only within the recorded reinstall scope.
- Configure mirror/boot/storage, correct repositories, time synchronization, management identity/MFA and current security patches.
- Keep the hypervisor minimal: no Docker apps, databases, Jenkins executors or game services on it.
- Verify pool/device health, actual usable storage, boot paths, restart and recovery procedure. Record disk replacement/boot repair instructions.

Deliverables: installed version/kernel/repository record, disk layout, health report, reboot evidence and sanitized host baseline.

Acceptance: DS02 passes; observed capacity is substituted into all subsequent budgets. Failure: recover via Rescue/reinstall supported base; preserve retained-data backup and known working access.

## P03 — Private administration and dual-stack network

State: pending. Depends P02; maps to DS04/DS05.

- Bring up the selected host/private-access endpoint and test it from an independent owner device/network before restricting public bootstrap administration.
- Define separate guest links, private IPv4/ULA pools, actual routed public IPv6 guest addresses and upstream return routes. Qualify /128 routing or the documented single-prefix layout before freezing addresses.
- Configure host input/forwarding, IPv4 NAT and exact80/443/game forwards. Select compatible firewall backends; preserve required ICMPv6 and MTU behavior.
- Apply Robot filtering as an additional upstream layer only after its rules and IPv6 behavior are verified.
- Test allowed/denied traffic from external IPv4-only and IPv6-capable vantage points, guest-to-host and guest-to-guest paths; repeat after reboot and private-access failure.

Deliverables: private address/route inventory, sanitized flow/port matrix, packet-filter backend versions, two-family probe results and rollback timings.

Acceptance: DS04/DS05 pass; no public admin/database exposure through either family. Failure: automatic rollback to the last tested route/ruleset, or Rescue recovery; do not improvise broad ACCEPT rules.

## P04 — Guests and resource admission

State: pending. Depends P03; maps to DS03.

- Create professional and games VMs with pinned guest images, scoped administrator keys and guest-agent support where qualified.
- Reserve host memory/headroom first, then pro/games; create the optional work VM only within measured remaining capacity.
- Set guest disk maxima and CPU/RAM ceilings; record physical-pool and in-VM subdivisions without double counting. Keep at least20% usable disk headroom with snapshot growth accounted for.
- Verify guest reboot order, clock, updates, private management, professional/games separation and quota/capacity rejection behavior.

Deliverables: VM identities, image digests, resource commitments, storage/disk quotas and observed boot/restart evidence.

Acceptance: DS03 passes with host capacity preserved. Failure: stop optional/heavy work, resize or queue workloads; do not consume emergency headroom or weaken VM isolation.

## P05 — Professional runtime and isolation fixtures

State: pending. Depends P04; maps to E00.S02/S03 and DS06/DS07.

- Install pinned Docker/Compose/gVisor and trusted helpers in the professional VM; qualify systrap and compatible native infrastructure profiles separately.
- Create two disposable A/B project cells with development/production boundaries, independent data/WAL/identities/workflow state and real disk limits.
- Inspect actual sandbox/user/mount/capability/runtime settings; test no Docker socket, cross-cell file/network/material denial and direct IPv6 denial.
- Exercise CPU/memory/PID/disk exhaustion using fixture-owned resources; verify unrelated cells, games and the host retain required headroom.
- Inspect policies again after Coolify deploy/redeploy and host/guest reboot; do not accept only an initial manifest.

Deliverables: effective runtime/compatibility matrix, A/B positive/negative evidence, quotas/dual-stack results and exact ownership/cleanup records.

Acceptance: DS06/DS07 pass for each enabled profile. Failure: isolate the fixture, retain uncertain resources/reservations, reconcile before retry; incompatible profiles remain unavailable.

## P06 — Off-host backup and held restore

State: pending. Depends P05; maps to DS09/DS10/DS14 preparation.

- Select and qualify actual off-host storage, encryption/material custody, scopes, deletion separation, throughput and retention. A same-host VM is not off-host protection.
- Configure pgBackRest full/differential/WAL plus daily files/auth/config snapshots and control/OpenBao/game recovery coverage.
- Verify at least two complete full generations with dependent WAL and14 daily file/config retention policy; identify missing historical copies honestly during initial rollout.
- Restore a chosen recovery point into a new held target; measure timestamps, bytes/catalog/auth integrity, archive gap and actual restore duration.
- Rehearse seal/unseal and lost-controller/key custody from protected external copies. Validate backup read/recovery on clean replacement capacity when available.
- Keep producers and external side effects stopped. Missing platform-effect journal/fencing evidence blocks all-service activation and remains a software task, not a successful operational checkbox.

Deliverables: scoped off-host policies, archive/age observations, restore report, measured RPO/RTO and incomplete-coverage register.

Acceptance: DS09 demonstrated; DS10/DS14 remain pending until their full activation/replacement tests pass. Failure: do not call the platform production-recoverable; retain original/source and held destination.

## P07 — Delivery, CI and controller integration

State: pending. Depends P05/P06 for stateful workloads; maps to DS08/DS13.

- Install the private console/control metadata DB, OpenBao, replaceable Coolify broker and optional private registry using qualified profiles.
- Bind real provider/transport target IDs, versions, observations, quotas and private material references to G.O.D.S.E.Y.E admission. Never toggle a boolean to turn fixture evidence into qualification.
- Configure GitHub App exact repository/installation/branch bindings and signed webhooks; respect main release and develop integration roles. Keep owner-created finite delivery policies mandatory.
- Qualify Jenkins with zero controller executors and disposable work-VM agents. Separate source checkout, scan/artifact publication and scoped deployment authorities.
- Exercise immutable build/check/provenance, readiness failure preserving previous traffic, compatible rollback, isolated synthetic preview and TTL cleanup. Prove lost-result reconciliation without duplicate effects.
- Add HTTPS domains through owned DNS authority; publish AAAA only after actual IPv6 listener/TLS/renewal checks. Keep admin URLs private.

Deliverables: provider admission evidence, actual GitHub/Jenkins/registry/hosting compatibility, retained release artifacts and dual-stack TLS report.

Acceptance: DS08/DS13 pass for enabled actions. Failure: leave previous version serving; queue unavailable runners, revoke affected grants and reconcile unknown dispatches. Do not expose the daemon or bypass approval gates.

## P08 — Real services and operational checks

State: pending. Depends P07; maps to DS07/DS11.

- Roll out two representative application projects with separate prod/dev cells, backups, application identity/files and qualified per-cell Inngest state.
- Enable Inngest/Hermes/Laya only when their current software, compatibility, budget and recovery contracts actually pass; record remaining implementation work explicitly.
- Deploy the selected game/bot reference workload in the personal VM; register exact TCP/UDP ports, saves, restart and recovery procedure.
- Qualify application-consistent game-save backup using the particular game's save/flush/stop procedure; a live filesystem copy alone does not establish a usable save.
- Establish scoped telemetry, bounded retention, external owner notifications and whole-host observer. Test actual delivery of disk/pool, WAL/backup, service and certificate alerts.
- Verify controller/guest restart ordering, private-access survival during pro-VM outage, and observable unknown/unavailable service states.

Deliverables: registered real workloads and limits, measured reference load, operational dashboards, verified alerts and per-service runbooks.

Acceptance: DS07/DS11 pass; unqualified services remain disabled and visible. Failure: suspend the affected rollout, preserve data and revert its artifact/configuration rather than unrelated environments.

## P09 — Soak, disaster recovery and handoff

State: pending. Depends P08; maps to E00.S05/E12 and DS12/DS14.

- Run72hours of representative two-project prod/dev load plus games and one bounded heavy task. Record packet latency/jitter, IO/memory pressure, restarts, resource admission and archive lag.
- Exercise bounded provider outage/cancellation/revocation, dropped acknowledgements, mirror-maintenance/reboot and upgrade/rollback drills using explicit maintenance scope.
- Rebuild the required recovery set on clean replacement capacity; demonstrate owner access, credential custody and safe held restoration. Source remains retained until success is verified.
- Close the DS01–DS14 evidence ledger; map it to the product T01–T43 register and retain unresolved software/physical qualifications. Full product release still requires its own acceptance families.
- Produce as-built topology, measured capacity/project limits, compatibility pins, recovery runbook and owner walkthrough. Record actual recurring costs from invoices/selected services, not guessed catalog prices.

Acceptance: every enabled capability has current evidence; DS12/DS14 pass for full infrastructure acceptance. Failure: classify and repair, then rerun affected scenarios and the necessary soak interval; keep the prior qualified operating envelope.

## Evidence and handoff structure

Use a future sanitized record per executed step:

| Field | Required content |
| --- | --- |
| Identity | Phase/DS ID, exact target and operator |
| Baseline | Date, actual versions, configuration/artifact hashes and prior state |
| Procedure | Reviewed command/script reference and bounded change scope |
| Verification | Expected/actual allow and deny results, external probe family and measurements |
| Recovery | Rollback path, prior resources retained, unknown effects and remaining reservations |
| Decision | Passed/failed/blocked, observed limitations and next permitted phase |

Keep private deployment inventories and recovery material outside this repository. Commit only sanitized templates/configuration and evidence. This plan contains no completed remote test or implied approval to run an unreviewed destructive recipe.

## Inputs to collect when installation is requested

Robot/server access method, actual read-only inventory, private admin device(s), domain/DNS authority, chosen games/bots and port needs, off-host destination/cost approval, recovery key custody and maintenance availability. These are execution inputs, not blockers to completing the present documentation task.
