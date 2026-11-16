# Local application delivery contract

Status: authorized continuation of the accepted E05 plan; local implementation only.
Baseline: 64c9eee; 596 unit/integration cases and 24 browser cases. Production
provider/host qualification remains separate from first-party behavior.

## Assumptions and scope

- ASSUMED: GitHub.com GitHub App integration, exact numeric installation/repository
  identity and named branch; shared repositories may fan out to multiple projects.
- ASSUMED: existing web/API projects support static and Node build recipes. The
  controller never executes arbitrary repository scripts on its host.
- ASSUMED: same-repository, open PRs may receive empty/synthetic-data previews;
  fork PRs are rejected by default. Preview identity/data never comes from production.
- ASSUMED: use a provider seam that can accommodate Coolify now and a custom engine
  later. No external account registration, connection or deployment occurs this run.
- ASSUMED: an owner-created bounded standing policy enables ordinary compatible
  automatic delivery. Incompatible/destructive migrations, new privileges, live
  recovery activation, domain rerouting and production rollback retain exact fresh
  approval; no standing policy authorizes these implicitly.
- User already authorized implementation following the spec/plan. No new approval
  gate is required for reversible local work. No remote effects are authorized.

## Reuse and authority

Reuse raw-byte signed GitHub intake/deduplication/fanout, repository configuration,
one InfrastructureEngine.foundation, immutable references/plans, leases, epochs,
grants, durable effect intents, reconciliation, capacity and recovery holds. Reuse
owner freshness/idempotency/revisions and private control client/OpenAPI. No second
queue, fake owner actor, browser credential input or browser execution authority.

DeliveryEngine composes into InfrastructureEngine. Narrow private delegated
Foundation authority binds an exact server-compiled manifest and an active policy;
the generic owner API cannot manufacture or widen it. Admission, lease validation,
provider dispatch and final settlement enforce ancestry, HOLD, policy/source and
provider generation. Post-I/O authority changes preserve uncertain effects.

## Source and standing policy

Fresh owner creates/revokes a revision-bound policy: exact project/environment,
repository installation/ID/name/ref snapshot, bounded recipe/context/checks/artifact
size/resources, expiry, auto-delivery and preview limits. Legacy repository
autoDeploy preference alone never grants authority. Expiry is at most thirty days;
previews are at most eight, TTL at most thirty days. Mutations are idempotent.

Source provider independently resolves installation access/repository identity and
the exact current branch/PR head before build and again before promotion. A signed
webhook is an intention, not current-head proof. PR open state, head/base repository
and ref/SHA are verified independently. Out-of-order close/reopen deliveries cannot
destroy a current preview merely through their arrival order. Revoked/suspended
installation, removed repository, policy/source drift or unavailability block work.
GitHub transport uses configured origin, bounded requests and private credentials;
browser URLs/SHAs/provider IDs cannot select a privileged source.

## Artifact and release

An immutable preparation freezes policy/source/recipe/provider/profile and target.
Trusted build provider supplies content digest, size, source and recipe lineage,
builder identity, check/scan/provenance evidence. HTTP has no artifact-attestation
endpoint. No artifact from another cell/source/build/recipe may be adopted.

Durable build/stage/readiness/smoke/promote/cleanup effects use existing Foundation
intent/fence/reconciliation. Serialize each environment's release/migration lane;
reserve capacity atomically and retain uncertain/staged resources until absence is
verified. Default providers are unavailable. A queued deployment is not success.
Only exact readiness/smoke and compatible configuration/schema evidence permit
traffic switch. The prior serving release remains on failed pre-promotion checks.

History lists immutable releases and eligible retained artifacts. Rollback switches
only to a compatible retained artifact under the appropriate exact authority; it
never restores or rewinds a database. Full production migration execution remains
unqualified, so unsupported compatibility changes block promotion.

## Preview lifecycle

Server creates a distinct preview environment for the verified project/PR. Resource
and address/runtime/ingress mappings are server-owned, bounded and isolated from
production. All preview data is empty/synthetic; no clone or production material.
Show a URL only after inspected readiness of the owned endpoint. TTL/verified PR
closure requests cleanup, but unknown teardown remains visible/quarantined and
retains reservations. Retire metadata only after definitive owned-resource absence.
Never globally prune or delete a project/source/production environment.

TTL/close authority covers protective stop/unpublish and disposal of exact owned
ephemeral build/staged application resources only. It does not authorize generic
cell quarantine, persistent PostgreSQL/volume destruction or final purge. Keep a
metadata tombstone and protected recovery/audit history; final persistent-data
purge remains a separate fresh-approved operation under the V1 authority table.

## Typed boundary inventory

Implementation must provide strict runtime schemas (unknown keys rejected) and
exported inferred types for: Create/RevokeDeliveryPolicy, SynchronizeDelivery,
PrepareDelivery, AdmitDelivery, DeliveryManifest, DeliveryPolicyView,
DeliveryArtifactView, DeploymentView, PreviewView and DeliveryOverview.
Owner inputs contain references/revisions/finite policy values only; immutable
source/artifact/provider attestations are private typed provider results.

Private provider scope binds project/environment/policy/manifest/run and fence;
source binding binds numeric installation/repository, full name, exact branch and
optional PR. Trusted inspection returns exact resource identity and generation,
artifact digest/provenance, configured/observed readiness and active/absent state.
Foundation delegated authority is a private callback over that exact compiled
manifest and its stored active policy, never an input DTO field. Producer owns
concrete schemas and must publish frozen signatures before GAUNTLET integration.

## Observable local surface

Owner-only strict HTTP/client/OpenAPI 1.5 and French dashboard manage policies,
source synchronization, preparation/admission, preview lifecycle and release
history/progress. Missing source/build/runtime/ingress providers remain explicit.
Expose metadata/references and sanitized errors, not commands/paths/credentials or
untrusted logs. Existing recovery-held environments remain ineligible everywhere.

## Verification and sequence

1. Source/policy vertical slice: signed push/PR replay/fanout, exact live head,
   policy freshness/revocation and strict HTTP contract, then touched tests.
2. Delivery slice: actual Foundation consumer/build/artifact/stage/readiness/smoke/
   promotion/rollback, fault/restart/race/uncertainty tests, then touched tests.
3. Preview/UI slice: dedicated bounded metadata/allocation, close/TTL cleanup and
   owner/browser journeys, then combined gates and independent review.

GAUNTLET owns tests and selected mutation probes; independent FABER/security review
must refute bypass/race hypotheses. A disposable local laboratory executes only
trusted fixture builds, content hashing and actual loopback HTTP readiness/traffic
switch/rollback/cleanup. It demonstrates provider contract behavior, not isolation
of untrusted builds. Preserve baseline full unit/browser suites, static checks,
contract consistency, build and built smoke. Trace AC-44 through AC-52 to tests.

Sequential production implementation with mandatory satellites; no parallel epic
swarm because shared Foundation/contracts/schema create dependencies. Graph grep
fallback remains declared. Context7 unavailable; official docs + installed types.

## Qualification limits

No live GitHub App enrollment/token exchange, Jenkins controller/isolated guest,
registry/scan authority, Coolify host, Docker/gVisor quotas/firewall, DNS/TLS/public
preview domain, production migration or off-host durability certification. Native
local fixture evidence cannot enable a real provider. Existing E00/E03/E04/E12
remaining acceptance remains open. No claim that full E05 or V1 is complete.

## Current authoritative references (2026-11-11)

- https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
- https://docs.github.com/en/rest/apps/installations
- https://docs.github.com/en/rest/git/refs#get-a-reference
- https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request
- https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app
- https://coolify.io/docs/api/endpoints/deployments/get-deployment-by-uuid
- https://coolify.io/docs/api/endpoints/applications/start-application-by-uuid
- https://zod.dev/api
- https://orm.drizzle.team/docs/transactions
- https://tanstack.com/router/latest/docs/guide/data-loading
