# Project DNA

- Node24 native loading does not remap workspace relative `.js` imports to TypeScript inside a Vite configuration; the shared constants are imported directly from their `.ts` module there. Application imports are bundled or handled by tsx.
- Generated routeTree.gen.ts is tracked so clean CI type checking has router types before running Vite.
- PGlite is the local development store, not proof of real PostgreSQL multiprocess behavior or project isolation.
- Local API validates control configuration only. Deployment and CI records must stay pending when consumers/providers are missing.
- A GitHub repository/branch may bind multiple monorepo projects: intake fans out transactionally with delivery/project uniqueness.
- Root runtime dependencies are declared explicitly for the bundled control API; migrations are copied beside the bundle.
- No V1 release gates were waived by introducing the local-first checkpoint.

## Owner and execution foundations — 2026-11-11

- Better Auth registration requires Drizzle adapter `transaction: true`; consume the single-use ticket through the current internal transaction, not a separate database connection.
- Default-deny native auth HTTP routes and validate first-party response DTOs. Browser identity fields never become an Actor. The internal control client is not the future application SDK.
- Absolute eight-hour sessions and five-minute passkey freshness are separate controls. Owner recovery depends on trusted local filesystem authority and revokes old access while preserving projects.
- Windows private directories replace only the protected DACL and preserve filesystem ownership. Use Windows PowerShell's .NET Framework access-control methods with a bounded module path; Set-Acl autoload inherited from PowerShell 7 was unreliable. Reject links/shared-root aliases before permission changes; never traverse an unchecked link recursively.
- Foundation provider failures and blank evidence remain uncertain until definitive reconciliation. Preserve known actual cost and overrun incidents while retaining uncertain reservations.
- Local PGlite, loopback authentication and checked-in OpenAPI do not qualify remote providers, private networking, Jenkins execution, off-host recovery or real PostgreSQL multi-process behavior.

## Bun and local service authority — 2026-11-11

- Explicit user preference replaces pnpm with Bun for this repo. Bun1.4.4 clean isolated/frozen installs retain pins and scoped security override; Node24 remains runtime. Existing Proto shim reads package engines, so installing the version into its catalog (without global pin) makes normal commands usable.
- OpenBao2.7.2 native Windows uses single-node Raft for disposable qualification; the former file storage backend is unsupported. Cold startup seals again; initialize/unseal fixture material remains in memory and is never published.
- Broker authority binds exact project, environment, purpose and (for task identities) worker. Reuse actual FoundationEngine lease/grant/epoch/fence checks before and after provider I/O. Metadata IDs and a project-wide Actor are insufficient.
- Check authority after all staged material reads and before rotation dispatch; a settlement-only check is too late. Treat post-dispatch cancellation as uncertainty rather than claiming an effect was undone.
- Snapshot mutable task context AND use before the first await. Otherwise a caller can swap a cancelled run for another valid one and move later checks away from the charged grant.
- Commit a metadata-only handoff intent before callback execution. A copied value cannot be rolled back when a callback or final transaction commit fails; keep unknown/denied outcome evidence and sanitize exceptions.
- Native provider ACL/CAS/seal/restart tests and synthetic qualified target fixtures do not qualify real database rotation or off-host recovery. Do not register a target adapter merely because a boolean configuration exists.
- Browser files must not share mutable store assumptions: the new access journey polluted a formerly empty overview fixture. Use real independent Playwright project stores/ports, preserving genuine empty-state assertions.

## Local inventory and isolated provision — 2026-11-11

- Desired inventory is never observation or qualification. Local native OS/filesystem readings describe the development controller; no Docker fallback or owner-supplied proof authorizes execution.
- Join physical capacity/IP reservations and exact immutable manifest authority into Foundation admission/terminal settlement; do not double count cells already inside the professional VM budget.
- In-flight starts can complete after protective stops. Keep stop attempts durable/repeatable and retain reservations while any mutation may materialize; provider errors/lost acknowledgments do not prove quiescence.
- Bind every fresh runtime/quota/firewall proof to the exact target and provider generation. Inspect configured stopped-network policy before start and assigned operational addresses afterward.
- Real rootless OCI systrap lab evidence is useful but does not qualify Docker host/gateway isolation, cgroups or persistent storage quotas. Keep actual unsupported mechanisms fail-closed.
- User confirms local-only progression now. Physical Proxmox remains a later host installation, with professional and games sibling VMs; one IPv4 target, maximum two with justification.

## Local projects and independent PostgreSQL — 2026-11-11

- One FoundationEngine composes application and database admission/settlement hooks; atomic reservations count both kinds inside the same environment/professional pool. PostgreSQL temp_file_limit is disk per backend, not tmpfs memory; reserve maximum connections times temp budget and disable parallel workers.
- Independent native PostgreSQL clusters validate real grants and transport, but their shared WSL UID/kernel do not qualify Docker/VM containment or hard quotas. Signed Ubuntu package extraction avoids system installation and service configuration.
- Inspect current/default/column ACLs, not only role flags/schema privileges. Restrictive initial bootstrap is insufficient evidence after privilege drift.
- Persist last verified physical scope separately from monotonically advancing queued admission generation. Cancelling undispatched lifecycle work must not fabricate a new physical generation.
- Renew lifecycle preparation against the retained immutable allocation after ordinary metadata or fresh observation changes; read-only reconciliation may refresh compatible observation evidence without repeating mutations.
- Revision-bound inner DOM forms reset stale fields while stable component hooks retain save confirmation. Pair draft values with their revision and keep datetime-local conversions in the browser timezone.
- Six backend and two UI review entries were independently resolved. The global421-unit/21-browser checkpoint and10 native PG cases do not close all E03/E00/V1 work; aggregate project lifecycle, backup/PITR, rotation and deployed host enforcement remain explicit.

## Physical backup and held recovery — 2026-11-11

- Physical PostgreSQL restore keeps the source system identifier, role/database catalogue and original material lineage. Destination allocation, WAL/data/network identities and replacement configuration are distinct. Never call fresh bootstrap or derive catalogue names from the new destination ID.
- A recovery-held environment cannot use normal database/app/service/task entry points. Validate trusted run/context/effect identity before ancestry/HOLD checks, while keeping HOLD before charges and provider dispatch; retain historical409 fencing semantics for forged contexts.
- pgBackRest2.60.0 must use command-specific options; stanza/check/archive-push reject --repo. Normalize strict ISO owner timestamps into PostgreSQL recovery-target syntax. Replace source archive/HBA/TLS/includes/external hooks before target startup.
- Paused plus an earlier replay timestamp does not prove the target was reached. Bind actual configured target/time/timeline and automatic-stop/LSN/row evidence. Local native tests cannot qualify off-host storage or hard quotas.
- Reconciliation needs separate exact read-only material authority after mutation grants are revoked; do not revive the old mutation grant. Fresh identities/worker authority may rebind retained archive material under explicit owner action; custody disaster recovery remains unqualified.
- Archive health is a fresh observation, not a one-time backup outcome. Explicit durable checks update the same manifest/window; deduplicate permanent repository/headroom commitments and retain unknown staging/targets.
- Keep at least two full generations and dependent WAL; bound advertised intervals to non-rewound effect-journal retention. Foundation run IDs do not establish complete business-effect coverage, and epoch advancement alone does not fence all external producers.
- New environment kinds need explicit labels and selector eligibility in every existing view. A prepared held record is not proof of a physically restored instance.

## Local application delivery — contract decisions

- Exact GitHub numeric installation/repository and current branch/PR head are independently verified; signed event bytes only request work.
- Owner-created finite standing policy is the only automatic delivery authority; legacy repository autoDeploy is a preference.
- TTL/PR-close cleanup permits protective stop/unpublish and owned ephemeral application disposal, preserving persistent data/tombstones/history. Final data purge retains fresh approval.
- Sequential delivery implementation reuses one Foundation queue, exact immutable manifests, recovery HOLD and capacity. Local trusted fixture execution cannot qualify arbitrary repository builds or deployed providers.
- Source adapter inputs must be copied before the first awaited installation lookup; GAUNTLET exposed a mutable-binding authority race before source slice completion.

## Local delivery verification — 2026-11-12

- Local E05 complete:851/851unit58files569.99s;28/28browser163.404282s plus4affectedpost-style58.082768s;12actualtrustedNode/HTTPlabcasesincluded;13curatedmutantskilled withbaseline/restored13andoriginalsourcesunchanged.
- Real first-party source/provider/Foundation composition catches strict-shape mismatches hidden by typed fakes. Revalidate durable authority inside terminal settlement after evidence writes. Preserve old physical provider binding for cleanup; no newly retargeted absence can retire old resources.
- Ordinary unknown previews need exact read-only reconciliation allowance without mutation authority or HOLD bypass. TTL safety remains possible when source configuration is removed.
- Check current policy checks/configuration against retained artifacts, independently of their original build policy. Rollback selects current accepted source separately from old immutable artifact.
- Existing owner-assurance flex layout and bare form classes were unsuitable for delivery forms. Scoped delivery CSS and whole mobile action/text/ancestor bounds fixed clipping missed by document-width checks. Screenshots were actually inspected.
- Future SYNAPSE pack should read repo-scoped crafts-godseye.md extension; global crafts playbook already has72bullets and needs separate curation. Outcome outcome-1794440654-2cec90d7 joins prediction-1794437345-fbf46ef9.
- Remote GitHub/Jenkins/Coolify/registry/guest/domainTLS, production migrations and all-service recovery remain unqualified; no server mutation or owner enrollment occurred.

## Local E04 and GitHub publication — 2026-11-12
- Independent app identities/files/events use packages/app-backend, never controlowner tables; packages/sdk is the app client, packages/control-client stays owner-only.
- Physical file effects need durable pre-I/O reservation/intents/tombstones, exact prefix/hash reconciliation and retained quota. SQL rollback does not undo bytes.
- Capture request epoch before body/lane waits; PGlite transaction callbacks must not query the global client. Pass the current transaction into domain work/session checks.
- Enforce one runtime per store/root; keep instance locks OUTSIDE PGDATA, preserve store UUID binding and fence PostgreSQL advisory-session loss.
- Download/SSE lifetime cancellation must release actual capacity; shutdown awaits retained descriptor-close promises before releasing runtime ownership.
- Actual local OAuth2, files, SSE, held recovery, compiled-template HTTP restart and independent built-SDK TypeScript consumer are tested. Cross-service PITR/off-host/activation remain explicitly unqualified.
- Full E04 gate972unit72files751.83sVitest/752.705commandwall;31browser181.393319s;13selectedmutations257.091s;62localcriteria. Original native PostgreSQL/pgBackRest labs were not rerun this tranche.
- User explicitly requests PRIVATE GitHub godseye: README-only main initially, mainreservedreleases via PR; developactive with granular smallresponsibilitycommits. Preserve original coarsehistory on localbackuprefs. No externalserverdeployment authorized.
- Repository workflow is docs/development/git-workflow.md. Repo-scoped crafts-godseye playbook holds new durable lessons; graph fallback remains grep.

## E01–E06 audit remediation — 2026-11-12

- R1–R4 corrected locally with sixteen RED-to-GREEN regressions; full1146unit93files1033.11s/41browser315.46236s/five selected mutation kills and independent review passed. Original source unchanged by mutation experiments; reviewed fourteen-file hashes verified after global regression.
- Reject definition changes while any run is nonterminal; an owner editing a new definition is not reconciliation of an old unknown effect.
- Deadlines fence observations and retain actual-call capacity until settlement. Filter occupied cell/destination scopes before pagination; otherwise fifty older pending rows can starve healthy work.
- Reapproval uses a separate capacity-only hook in the existing transaction, not physical provider reservation. Test production InfrastructureEngine wiring and failed receipt rollback.
- Jenkins archive patterns must cover actual configured Playwright trace/screenshot output before cleanup. Prepared Jenkins is still not a qualified CI runtime.
- Current public spec/plan and internal state explicitly keep E03/E05/E06 software work separate from dedicated-host qualification. No new user preference beyond confirmed local-only scope; no commit/push or server change.

## Local E06 application events and Inngest — 2026-11-12

- Final requested local integration is implemented on the existing owner Store/Jobs view, independently configured per-cell native engines and signed SDK endpoints. Default remains off; exact prepared backend scope/revision, six listener identities and producer store UUID are server-owned.
- Source event payload stays in its application store; control receipts retain metadata/digest/run refs only. Engine HTTP acceptance does not acknowledge source delivery: durable domain admission does. Transport attempts may change while domain identity remains fixed.
- Include payload acquisition in the execution deadline, retain actual-call slots, and forbid late loader invocation. Unknown/cancelled effects, missing history and unresolved outbox block source-payload disposal; rotate settlement scans beyond occupied rows.
- Verify real pinned OSS behavior: SDK PUT registration, minimum five free queue workers, and loopback hostname normalization at the exact port. Native embedded storage does not qualify external Redis/workflow PostgreSQL or host containment.
- Actual compiled backend restart caught an external workspace-contract import; bundle both first-party dependencies. Windows1301-entry ACL profile took44.736s with per-file processes and2.993s after read-only canonical batching, retaining native drift/link/containment checks and original CLI deadlines. Admin recovery ignores unrelated engine configuration, without weakening server or base security validation.
- Final1191ordinary cases across100collectedfiles (2native cases separately passed),41browser,6selectedmutationkills,494-filelint/types/OpenAPI1.9/build/smoke and independent58-pathsource review passed. Initial failed batches remain historical evidence. No new user preference: local-only scope/Bun retained; no owner enrollment, server or Git mutation.
- Outcome outcome-1794513363-0ff094dc joins prediction-1794507901-34943bc7. Full graph remains legacy grep/stale; scoped147-export delta and12test-ID trace are recorded.

## Autonomous E06 local completion — 2026-11-12
- Trusted supervisor is independent of owner HTTP; cell code runs in scope-bound child processes with sanitized environments. Session-held PostgreSQL singleton loss fences admission after every awaited authorization boundary. Read-only reconciliation has a separate current-lease checkpoint and cannot renew mutation authority.
- Native guardian holds the actual ChildProcess handle; never kill persisted numeric PIDs. Atomic private service state and independent all-resource cleanup preserve restart authority. Inngest1.52 cron identities are canonical UTC RFC3339, not opaque IDs; actual dynamic calendar tests exposed the mismatch.
- Final1225ordinary/11separate native/8Python/7curatedkills,47frozenproductionhashes,static/build/smoke/docs passed. Docker/VM/untrusted-code/capacity/off-host/coordinated recovery remains unqualified. No new user preference beyond confirmed local-only/Bun/customSDK; no dedicated-server/Git/actualownerdata mutation.

## Local Hermes setup — 2026-11-13

- Installed immutable pinned Hermes0.23.1/CPython3.14.9, frozen minimal PM environment; actual status/offline smoke/idempotence passed. OpenAI API selected by owner, no key/modelcall.
- Three role templates and exact bootstrap skill catalog; immutable scoped snapshots with CAS promotion/retained rollback. Scope bindings are local declarations, runtimeHome=null/runEnabled=false. Agent Center, real binding, mutable run-home materializer and other E07 stories remain pending.
- Actual upstream config loads create auth.lock/config backups. Native qualification uses mutable disposable copies and re-verifies the original immutable snapshot. Read-only verification must not mkdir missing profile/revision paths; regression caught/fixed poisoning inspection.
-57ordinary/2separate native/7curatedkills,10sourcefrozenreview,static/build/smoke/147doclinks passed. Initial built smoke timed out, unchanged retry passed; no deadline adjustment or proven latency cause. Full existing/browser suites not rerun for this isolated scope.
- Outcome outcome-1794600401-39c31fe0 joins prediction-1794599505-a351a7bc. No ownerdata/server/Git mutation.

## Local Agent Center continuation — 2026-11-13

- Bound profiles and tasks reuse Foundation authority, budgets and heavy queue; no second scheduler. Default runtime unconfigured without private bindings.
- Real Hermes direct APIServerAdapter avoids unrelated general-gateway session authority. Explicit exact skill preload and model-only broker enforce one physical attempt; tools denied at request, response and dispatch.
- Observation merges never rewind durable attempt count; known run identity survives exceptions. Generic cancellation/epoch revocation masks late result. Keep helper ownership until actual HTTP handler settlement.
- Verified local scope:1329ordinary,3nativeRuns+1Pythonhelper,7AgentCenter+2existingbrowser,4curatedkills,53sourcehashes; fullchat/generaltools/approvals/coding runners/E08/E09/host remain open.

## Advanced local Hermes chat — 2026-11-13

- Keep actual API-only Runs event/history protocol separate from native canonical/legacy broad approvals; initial inbox links existing exact plans only. Pending1h proposal deadline differs from effective5min Foundation approval.
- Freeze failed send CAS body/key across revision refresh; keep drafts/intents scoped per conversation. Read stream cursor+pruned suffix atomically and create artifacts/proposals only in actual successful nonrevoked settlement.
- Verified complete default regression in disjoint serialized-builder/remainder groups;1360ordinary plus separate native/browser/mutation proof. Dedicated host/general tools/native paused controls/coding runners remain unqualified.

E08: freeze reviewed price revision at intent, retain nullable exclusive token categories and provider request header IDs only. Accounting is data after cancellation, never renewed authority. Unknown physical effects retain budget obligations; missing token evidence after confirmed completion does not hold concurrency forever. Detector coverage is exact owned keys, never global kinds. Delete all expired full logs, keep minimal health metadata. Capture budget CAS revision with visible form values; refetch must reset both. Current-source native broker proof is not full Coding/KVM qualification.
