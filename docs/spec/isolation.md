# V1 isolation and data contract

Status: V1 implementation contract, 2026-11-11. No professional/server infrastructure has been provisioned or qualified. A dedicated local OCI lab has verified selected gVisor mechanisms, without qualifying Docker/VM networking or persistent quotas. Current placement authority is [ADR-002](../adr/ADR-002-professional-vm-and-dual-stack.md): one professional VM with sandboxed applications, plus a separate games VM. This supersedes ADR-001 per-project guest placement; databases remain independent.

The verified [local E03 checkpoint](../adr/ADR-007-independent-postgresql-cells.md) adds immutable independent PostgreSQL policies and a ten-check, three-cluster native-process laboratory with actual TLS/HBA, privileges, connection ceilings and restart checks. Local static/unit/browser/build and scoped mutation/review gates passed; [run evidence](../../tests/STRATEGY.md) preserves their limits. Its shared WSL host/UID does not qualify Docker/VM containment or hard data/WAL quotas. Default database execution remains unconfigured. Project/environment metadata and preview expiry do not constitute physical provisioning or automatic teardown.

The subsequent [local held-recovery implementation](../adr/ADR-008-local-postgresql-held-recovery.md) adds exact physical full/differential backups, archive checks and restore to a new held environment/allocation. Eleven actual pgBackRest/PostgreSQL cases passed in 49.52 seconds; final local checks passed 596/596 unit/integration cases, 24/24 browser journeys and build/smoke. A physical clone retains source system/catalog identity while destination paths/WAL/network/ownership differ, with all inherited configuration/HBA/TLS/hooks replaced before startup. Default recovery execution remains unconfigured; schedule execution and safe activation remain unavailable. The existing per-run Foundation journal is not complete business-effect coverage. Actual producer fencing, ancillary file/auth/config recovery, off-host durability, production RPO/RTO and rotation remain unqualified; D07-D10 release requirements below remain mandatory.

## Threat model and execution cells

Assume an Internet-facing application can be compromised, an attacker can read its runtime credentials, project code can be malicious, and an agent can encounter adversarial web/log content. Protect every other project's private services/data and the control plane. Applications are isolated with gVisor plus network/filesystem/identity policies. Professional-VM root, shared Docker daemon or guest-kernel compromise can affect all professional cells and is explicitly outside that containment guarantee. The games and disposable-task VMs still have outer KVM boundaries. Hypervisor/control-plane compromise, physical-host failure and side-channel resistance remain shared risks.

An execution cell is one `project_id + environment_id`, a set of gVisor application/service sandboxes, private network identities, independent quota-managed data directories/volumes and a scoped service inventory inside the professional VM. Production, development and persistent previews are different cells. No implicit trust group combines different projects. Compose stacks and provider policy group each cell; they do not create another VM or hypervisor. A disposable build/scanner/tool guest is a separate execution allocation, with a narrowly scoped task grant and an expiry.

The common control plane is intentionally privileged and private. Public applications cannot reach its administrative APIs. The owner can explicitly inspect several projects through it; project identities and task grants cannot request that global authority. Publicly published anonymous application resources remain public: isolation protects private/privileged access, not anonymity of public websites.

## Required isolation controls

Every normative rule below includes its future validation IDs. Those tests are defined in [STRATEGY](../../tests/STRATEGY.md); their existence here is not a claim that they pass.

| ID | Required behavior | Verification |
| --- | --- | --- |
| I01 | Allocate independent cell sandboxes/networks/data allocations inside the professional VM. Applications use inspected gVisor systrap profiles; a project cannot choose unrelated data, networks or provider IDs. No per-project VM or nested Proxmox is allocated. | T03, T09 |
| I02 | Separate cell networks with professional-VM Docker/forwarding and anti-spoofing policy; host firewall separates professional/games/task VMs. Deny cross-cell and management access on IPv4/IPv6; application/container-root cannot modify VM/host enforcement. | T02, T03 |
| I03 | Publish only registered web routes at the edge and explicit game ports. Never publish PostgreSQL, Redis, Docker, Inngest administration, Hermes or the hypervisor on public interfaces. | T02, T13 |
| I04 | Administrative access requires the private network plus owner authentication. A cell service identity is rejected by console/admin endpoints even when routing is available. | T01, T02 |
| I05 | Application profiles require gVisor systrap with no silent native fallback. Signed trusted data/infrastructure profiles are separately qualified. Container specifications reject privileged mode, host networking/PID/IPC, device passthrough, arbitrary host paths and Docker/control sockets. Run app processes as non-root, drop capabilities, prevent privilege escalation, enforce seccomp and scoped write paths. | T04 |
| I06 | Host VM sizes and professional-VM cell CPU/RAM/process/temp/data quotas are finite. Managed directories need real filesystem quotas; volume names alone are insufficient. Both host and professional-pool reservations are atomic and preserve headroom. | T05, T36 |
| I07 | Each cell uses its own PostgreSQL instance, PGDATA/WAL, application database and scoped accounts. Each cell's Inngest instance/signing/event credentials and Redis state are separate from all others and the platform orchestrator. | T06, T20 |
| I08 | Runtime and migration identities differ; deploy/backup/controller credentials never enter app images, browser responses, build contexts or general agent environments. Credential lookup derives scope from verified identity. | T06, T08, T22 |
| I09 | Cell file/auth/realtime APIs verify project, environment, resource and subject; an ID, URL path, Host header or event prefix alone cannot grant access. | T14, T16, T17, T20 |
| I10 | General build and agent shell commands run in disposable KVM guests created directly by the host adapter. They have no protected disk mounts or production administration credentials; all task grants expire/revoke. | T03, T22, T24 |
| I10a | **Owner-accepted deviation (server only, unqualified):** nested KVM is unavailable on the disposable work VM `godseye-work`, so coding tasks may instead run in a per-task gVisor (`runsc` systrap) or rootless-container sandbox inside that VM (`disposable-vm-container`). This is weaker than I10 (shared VM kernel); the VM is the outer boundary and the runner stays `available:false` until qualification evidence exists. I10 is unchanged for the local WSL2 profile. | T03, T22, T24 |
| I11 | Every Hermes profile/home has one owner process and belongs to one project/environment/role. Profile separation is supplemented by sandbox/filesystem and tool authorization boundaries. No central home stores every project's writable memory. | T21, T22 |
| I12 | All provider actions are selected from typed, authorized operations. User-controlled Compose/Docker arguments, SQL, paths, endpoints or opaque provider IDs cannot escape the policy compiler. | T04, T34 |
| I13 | Infrastructure/deployment controllers are privileged private services. Minimize their VM/resource grants; keep host/owner break-glass recovery independent of the dashboard. Never describe their compromise as contained by project credentials. | T01, T03, T31 |
| I14 | Telemetry ingestion binds labels to authenticated cell identity, redacts sensitive data, and enforces scope on query/export. A project cannot relabel its records as another project or retrieve another project's agent artifacts. | T25, T26, T38 |
| I15 | Egress is policy-controlled through host-enforced routes/proxies; block management, other cells, link-local/metadata and private destinations unless a named grant permits them. Revalidate resolved addresses and redirects; DNS changes cannot turn an allowed public URL into private reachability. | T02, T22 |
| I16 | Backups have project-specific destinations/permissions and deletion separation where supported. A cell can neither enumerate/read another cell's backups nor delete the owner's recovery copy. | T07, T30, T31 |

The professional VM's Docker daemon and the platform's delivery/credential controllers are trusted shared administration (Coolify was dropped, ADR-021). App processes never receive its socket or administration credentials. Rootless/user namespaces are extra defenses where compatible, not separate kernels or assumed engine features. No application Docker daemon runs on the Proxmox host. Validate required runtime/configuration before starting application code, then inspect actual created/recreated containers; a submitted Compose field alone is not proof. E00/T04 must demonstrate startup rejection when runsc is unavailable or the rendered profile is wrong.

Docker-published-port and firewall interactions must be tested on the selected iptables/nftables backend. UFW alone is not the enforcement design. Restrictions must cover forwarded/NAT and IPv6 traffic and survive reboot/engine upgrades; do not blindly apply an iptables-specific chain to nftables. These details elaborate I02-I05. [Docker firewall reference](https://docs.docker.com/engine/network/packet-filtering-firewalls/)

The local E02.S03 implementation keeps desired inventory separate from trusted observations and immutable preparation separate from admitted execution. Qualification includes effective-profile inspection before application code starts, real persistent-data enforcement and separately observed IPv4/IPv6 host/forwarding controls. Docker internal networks alone still permit some gateway/host paths. [ADR-006](../adr/ADR-006-local-inventory-and-cell-provisioning.md) and the [infrastructure guide](../development/infrastructure.md) record the source-reviewed local boundary and passing 325-case check, build/smoke, eighteen browser journeys and four bounded laboratory checks. No I01-I16 requirement is weakened.

## Connection matrix

Default is deny; listed allows are narrow flows, not whole-network trust. The enforcement inventory records source identity, destination, protocol, purpose and expiry. T02 validates all paths and negative counterparts.

| Source | Allowed destination/purpose | Explicitly denied |
| --- | --- | --- |
| Public Internet | Edge HTTPS to registered application routes; selected game TCP/UDP ports | Administrative services and database/worker management routes |
| Owner private client | Console; authenticated break-glass endpoints | Unauthenticated administrative actions |
| Edge | Registered web port on each cell | Database, Redis, hypervisor and agent administration |
| App container A | Its own authorized auth/data/file services, local event ingress, configured external integrations | B private endpoints, platform tools/admin, Docker and migration credentials |
| Worker A | A's database with its own grants; A's workflow service; declared integrations | B resources and platform workflow/signing credentials |
| Task guest A | Assigned repository/artifact endpoint, allowed scan target, model/decision gateway, telemetry | Other task disks; B private resources; production admin and hypervisor |
| Control adapters | Named host, cell, deployment and run-management endpoints | Arbitrary client-supplied destinations or unvalidated resource mappings |
| Games VM | Required game/bot endpoints and scoped telemetry | Professional cells, control data and backup repositories |
| Backup worker | Its cell database/files; designated off-host repository | Unrelated cell backup credentials and other repository prefixes |

## Database identity contract

Different passwords are mandatory but insufficient without different grants and infrastructure. Generate independent random credentials per identity and cell; keep secret material in an encrypted owner-operated credential store. Brokered task grants are short-lived. No credential appears in committed manifests, audit messages or SDK client configuration.

The proposed V1 credential provider is self-hosted OpenBao, with per-cell deny-by-default policies and a private broker. Use managed static service credentials for ordinary app availability, with controlled rotation; use leased/dynamic credentials for suitable short tasks after qualification. Recovery material stays off-host. Cold-start seal/unseal is an explicit owner recovery step unless an independently qualified self-hosted auto-unseal root is configured. A sealed/unavailable store blocks new provisioning/grants/rotation with a visible degraded state; it does not erase mounted static credentials from existing cells. Tests T08/T22/T31/T40 verify this behavior. [OpenBao PostgreSQL](https://openbao.org/docs/secrets/databases/postgresql/), [policies](https://openbao.org/docs/concepts/policies/), [seal behavior](https://openbao.org/docs/concepts/seal/).

The local E02.S02 broker is implemented with metadata-only owner management, exact cell/purpose identity proofs, private material handoff and FoundationEngine-bound task redemption. Separate native OpenBao ACL/CAS/seal/restart cases passed; real upstream service transition/revocation and off-host recovery remain unqualified. See [service access](../development/service-access.md) and [ADR-005](../adr/ADR-005-bun-and-local-service-authority.md). No transition adapter is admitted by ordinary local configuration alone.

| Identity | Allowed authority | Forbidden authority |
| --- | --- | --- |
| Cell bootstrap/admin | Create local databases/roles, configure the instance, rotate credentials | Any other cell; routine application request handling |
| Migration owner | DDL for the assigned application schema, reviewed migration artifacts | Deployment into another cell; broad OS/file/program roles |
| API runtime | Required DML/sequence access on assigned objects | Ownership, SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS |
| Worker runtime | Required objects/functions for its job set | Implicit reuse of API, migration or platform credentials |
| Auth runtime | Auth tables/session operations | Unrelated application data unless explicitly required |
| Analysis reader | Selected sanitized views or approved read scope | Full credential/session tables and write/DDL |
| Backup identity | Complete authorized backup of this cell's instance and archive | Other cells; assuming a partial RLS-filtered dump is a complete backup |

| ID | Database behavior | Verification |
| --- | --- | --- |
| D01 | Initialize a distinct PostgreSQL cluster per cell; never substitute a schema or database on a shared cross-project instance. Share neither PGDATA nor WAL directories. | T06, T07 |
| D02 | Configure database/schema/function default grants; revoke unintended PUBLIC access and grant only intended role membership/connections. Runtime is not an owner. | T06 |
| D03 | Use SCRAM credentials and restrictive HBA address/database/user matching. TCP clients validate server identity with TLS `verify-full`; private Unix sockets are allowed for local trusted administration only. | T06 |
| D04 | Migrations use separate injected credentials and an operation lock. Failure leaves a resumable journal and stops promotion; image rollback never implies schema rollback. | T12, T35 |
| D05 | Rotate a single service credential without exposing other credentials. Revoke old access after a controlled connection transition; the UI shows status, not the value. | T08 |
| D06 | Allocate per-service connection limits and per-cell storage/archive budgets. Unbounded pools and WAL growth raise an incident and fail admission for additional resources. | T05, T06, T40 |
| D07 | Use a qualified PostgreSQL physical backup/WAL-archive tool, initially pgBackRest, to an off-host repository; track recoverable archive position and backup age. Logical export is an additional portability feature. | T07, T30 |
| D08 | Restore into a new isolated cell with schedulers/dispatchers/agents paused. Fence the prior cell's producers and grants before activation; reconcile effects after the recovery point against a non-rewound effect journal/provider evidence. Validate and explicitly promote; never overwrite B or automatically replay restored pending effects. | T07, T18, T31, T35 |
| D09 | Back up database/file/auth configuration as a named recovery set with known timestamps. PITR consistency for database data does not imply identical-time files or external side effects. | T07, T30 |
| D10 | Deletion is staged: stop ingress/jobs, revoke grants, verify recovery policy, tombstone and quarantine resources, then purge at the configured deadline. A failed purge remains visible and auditable. | T24, T38 |

[PostgreSQL HBA](https://www.postgresql.org/docs/18/auth-pg-hba-conf.html), [TLS](https://www.postgresql.org/docs/18/libpq-ssl.html), [pg_dump and RLS](https://www.postgresql.org/docs/18/app-pgdump.html), and [pgBackRest](https://pgbackrest.org/user-guide.html) establish the mechanisms; the role layout and recovery workflow above are G.O.D.S.E.Y.E requirements.

## Data and job ownership

Cell PostgreSQL contains separate application/auth objects and a workflow-engine database with separate service roles. Cell Redis and Inngest stay private to that cell. The global control database stores desired/observed inventory, operation metadata, scoped usage and audit history; it does not become a shared application database.

This deliberately changes the earlier single-shared-Inngest proposal. The dashboard presents one Jobs area, but its backend routes authorized operations to the owning cell engine. Platform schedules invoke a project-scoped adapter; project workers never receive the platform engine's keys. A job continues in its own cell if the console is offline. If a pinned release cannot meet this boundary, qualification fails rather than distributing shared administrative keys.

Application writes and event creation use a local transactional outbox; a dispatcher sends through that cell's event ingress and reconciles uncertain delivery. External side effects carry application-level deduplication or reconciliation. Hermes unknown outcomes block automatic repetition until resolved. Inngest remains the sole calendar authority for centrally managed work; Hermes calendar definitions stay empty for those tasks. T18-T24 validate these boundaries.

### Side-effect-safe restore activation

The control plane keeps an effect-intent/result journal and a monotonically increasing cell activation epoch outside the cell being rewound. Entries contain scoped business-effect IDs, provider evidence references and status, not full application payloads. Restored engines, outboxes and agent sessions are recovery evidence, not automatically runnable queues. D08/T07/T18/T31 require the following activation sequence:

1. Admit the restore destination isolated and paused. Do not revive old cron, outbox dispatch, agent runs or outbound-effect grants from a VM snapshot.
2. Record a new activation epoch and fence/revoke the old cell and all its producers at trusted gateways. Stop its jobs and disable effect egress; never activate both cells concurrently.
3. Compare restored intent with the surviving non-rewound journal and provider evidence for actions after the chosen database recovery time. Preserve stable logical effect IDs rather than minting new retry identities.
4. Mark insufficient evidence `unknown`; require provider reconciliation or explicit owner resolution. If the whole platform journal was also recovered from an older backup, treat the missing interval as uncertain instead of assuming nothing happened.
5. Enable only reconciled definitions under the new epoch after owner activation approval. Keep quarantined old state for evidence/recovery; archive it before any later purge.

PITR does not reverse sent messages, published content or other external effects. A recovered database can be consistent while the business process still needs manual resolution. A successful restore therefore reports data validation and job/effect activation as separate states. The activation epoch is enforced by brokers; a value inside guest configuration cannot authorize itself.

## Proposed capacity and operational defaults

These are versioned configuration defaults and qualification targets, not measurements or hardware promises. Tests T05/T36/T40 enforce the values that survive E00. Release pins are recorded in a tested compatibility matrix before implementation depends on them.

| Setting | Initial target/default | Verification |
| --- | --- | --- |
| Host memory allocation | 8 GiB host/cache/headroom, 16 GiB games VM, 32 GiB professional VM (control plus project services), 8 GiB optional disposable-job VM pool, conditional on 64 GiB usable RAM | T05, T36 |
| Cell memory reservation | Within the professional VM, start from aggregate service reservations of 4 GiB production and 2 GiB development/preview per cell; qualify/rescale actual service limits and keep control headroom. | T05, T36 |
| Concurrent heavy task guests | One per physical host initially; queue others | T05, T24 |
| CPU accounting | Reserve and cap guest vCPU time; six physical cores/twelve SMT threads are shared, not twelve full isolated cores | T05, T36 |
| Storage admission | Reserve host guest-disk maximums and professional cell filesystem quotas plus backup/cache allowance; at least 20% usable host pool headroom; no unchecked thin overcommit | T05, T40 |
| Project quotas | Per-cell storage, connections, requests, file uploads, job concurrency and model spend; cannot exceed admitted host resources | T05, T26 |
| Adapter call timeout | 10 seconds per attempt; long work is asynchronous | T23, T34 |
| Operation deduplication | Keep resolved platform idempotency records at least 7 days after terminal outcome; unresolved intents never expire. Effect records survive at least the longest advertised restore window plus 7 days. Native provider retention cannot replace them. | T07, T18, T23, T37 |
| Task leases | Heartbeat 15 seconds, lease 60 seconds, reconciler every 30 seconds; expiry revokes grants and records uncertainty | T23, T24 |
| Preview TTL | 48 hours after inactivity, capped by project quota; tombstone/cleanup visible | T10, T38 |
| Backup objectives | Production database RPO <=15 minutes when off-host archiving is healthy; project restore RTO <=4 hours on available replacement capacity | T07, T31 |
| File/config objectives | RPO <=24 hours; show actual recovery timestamps separately from database archive position | T30, T31 |
| Retention defaults | Logs 7 days, metrics 30 days, execution/usage metadata 90 days, security/audit records 180 days, deleted-cell quarantine 7 days | T25, T30, T38 |
| Backup schedule/retention | Weekly full and daily differential, continuous WAL archiving; retain at least two completed full generations with their dependent archives; file/config snapshots daily with 14 daily copies | T07, T30 |

Stop/reject new allocations before exhausting protected host capacity. No host-side admission decision can promise arbitrary game latency; T36 measures a representative game workload alongside applications and execution. If the server (EX44) cannot meet the reference profile, change admitted sizes/counts or add a host; keep I01-I16 intact.

Database backup status has distinct states: configured, backup-created, recoverable-archive-healthy, restore-verified, stale and failed. Report objective breaches immediately; a green backup job alone is not a green recovery capability. Hypervisor or live-volume snapshots are additional recovery aids only after database consistency has been established, not a substitute for qualified backups.
