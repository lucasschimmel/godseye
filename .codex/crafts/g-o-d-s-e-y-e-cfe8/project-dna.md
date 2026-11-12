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
