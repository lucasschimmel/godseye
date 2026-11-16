# Local application delivery

Status: local E05 implementation, 2026-11-12. Owner API `1.5.0` and the `/pipelines` console implement local policy/source/build/release/preview management. Default source and executor are **unconfigured**, and remote qualification remains **unqualified**. The combined run passed 851/851 unit/integration cases across 58 files in 569.99 seconds wall time and 28/28 browser journeys in 163.404282 seconds (JUnit), including four delivery journeys. Static checks (320 linted files, types and API `1.5.0` consistency), build/smoke and frozen backend/UI source reviews passed. The narrow responsive-CSS follow-up passed four delivery browser journeys in 58.082768 seconds with refreshed desktop/mobile visual checks; all thirteen selected delivery mutations were killed with green baseline/restored checks and unchanged original sources. Final build/smoke passed after the stylesheet change. The preceding 596-unit/24-browser recovery checkpoint is historical evidence. Migration lane, scanner threshold and usage (migration 0012) were re-verified on 2026-11-12: 282 delivery unit/integration cases, 5/5 delivery browser journeys and 16/16 selected delivery mutations killed. This does not complete full E05 or V1.

## Configure and authorize a project

Run the ordinary [local startup](local.md), enroll/sign in with the owner passkey and register a project. In its project page, bind the numeric GitHub repository/installation IDs, full repository name and followed branch. The repository `autoDeploy` checkbox stores a preference; it grants no standing delivery authority.

Open `/pipelines` and confirm owner identity with a recent passkey ceremony. Create a separate delivery policy for the exact project's development or production environment and current project/environment revisions. Recovery-held environments and ordinary manually registered previews cannot be standing-policy targets. Policy creation remains useful without a connected provider; it neither checks out code nor deploys resources.

Choose `static` or `node`, a relative repository context such as `.` or `apps/web`, unique named required checks, artifact/resource ceilings, preview limits, expiry and optional automatic delivery. Unknown keys are rejected. Repository URLs, absolute paths, arbitrary commands, credentials, source SHAs, provider IDs and artifact attestations cannot be supplied as execution authority.

| Policy field | Accepted range |
| --- | --- |
| Expiry | Future time, no more than 30 days from creation |
| Required checks | 1–16 unique names |
| Maximum artifact size | 1–4096 MiB |
| Concurrent previews | 0–8 per policy; at most eight retained project previews |
| Preview TTL | 1–720 hours, additionally bounded by policy expiry |
| CPU per stage | 10–64000 millicores |
| Memory per stage | 32–262144 MiB |
| Storage per stage | 1–4096 GiB |
| Process ceiling | 8–4096 |

Policies snapshot repository binding and revisions. Expiry/revocation, project suspension, metadata/repository revision drift and recovery HOLD prevent stale work from gaining delivery authority. Revoke with the current policy revision; create a new policy when its scope must change. Revocation does not prove an already serving resource has stopped. Retained resources and uncertain outcomes still require exact inspection/cleanup.

## Synchronize and build

Raw-byte HMAC intake accepts matching nondeleted branch pushes and same-repository PR `opened`, `synchronize`, `reopened` and `closed` events. Shared repositories fan out transactionally to matching projects. Exact replay is deduplicated; conflicting reuse of a delivery ID returns 409. A queued `pending_verification` event is an intention, not current-head or successful-build evidence.

Use **Synchroniser GitHub** for the policy. Synchronization independently checks installation access, repository identity and the current branch/PR head before producing immutable preparations. For PRs it verifies base repository/ref, head repository/ref/SHA and current open state. Forks are denied. Stale source events become superseded; event timestamps or arrival order cannot authorize an old build or destroy a reopened preview.

Review the exact prepared hash and admit its build. A private source provider and independently qualified executor are required for real work. The existing FoundationEngine owns execution, leases, fences, epochs, scoped grants, capacity and durable effect intentions. No repository script runs on the controller. Generic Foundation commands, service actors and the legacy preference cannot manufacture the private delivery delegation.

Trusted build evidence binds artifact digest/size, source repository/installation/commit, recipe, builder, unique passing checks, scan result, configuration/schema compatibility and provenance. Owner HTTP has no artifact-attestation endpoint. Repository-authored success output and mutable image tags cannot confer trusted artifact identity.

## Release, rollback and uncertainty

A successful build exposes **Préparer le déploiement**. Release preparation selects that exact artifact; admission reserves the serialized environment lane. Source and policy/provider generation are checked again around external I/O. Stage, inspected readiness/smoke and compatible configuration/schema must precede traffic selection. Failed pre-promotion checks leave the prior artifact serving.

The default scheduler starts with the local API but does no delivery work while source/executor are absent. With qualified providers and an active policy's explicit `autoDeploy` authority, it synchronizes events, prepares/admit builds and releases through Foundation. Manual policy mode retains owner preparation/admission. The scheduler never authorizes rollback or broadens the stored policy.

History distinguishes prepared, reserved, building, built, staged, active, retired, released, unknown and quarantined outcomes. A successful request or provider process exit alone is not active traffic. Existing and staged runtimes plus retained artifacts consume shared environment/professional capacity; unknown effects retain their reservations.

Use **Réconcilier sans relancer** for uncertain runs. This uses Foundation's read-only reconciliation path and exact persisted intentions/resources; it does not repeat a lost-acknowledgment build, promotion or cleanup blindly. Missing evidence preserves uncertainty.

For **Préparer un retour d’image**, select an eligible inspected prior deployment with a retained artifact and a current CI source intention. The current source must independently verify against the active policy, while artifact identity remains that of the selected older release. The earlier artifact's historical CI head cannot stand in for current source authority. Current recipe/configuration and required checks must still accept the retained evidence. Rollback requires a fresh exact owner action and switches only the image/traffic; it never rewinds a database. Destructive/incompatible migration, new privileges, domain rerouting and live recovery activation remain separately authorized/unqualified.

## Preview lifecycle

A verified same-repository PR receives a distinct server-owned environment with finite resources and an expiry no later than policy expiry. Data is empty/synthetic only; production databases/files/identities are never cloned into it. Prepared metadata is not a running cell. Display a URL only for a currently active, unexpired preview after exact inspected runtime/endpoint evidence. Expired previews lose their displayed URL even before physical cleanup is confirmed.

TTL expiry or independently verified PR closure permits protective stop/unpublish and disposal of exact owned ephemeral application/build/staged resources. **Préparer l’arrêt des previews expirées** prepares bounded cleanup intentions; a 200 response is not proof of physical absence. The scheduler can admit cleanup even after ordinary standing delivery authority expires or is revoked. PR closure is rechecked so an obsolete close event cannot stop a reopened PR.

Unknown or late effects remain visible and retain capacity. A preview is retired only after exact owned-resource absence is inspected; retain its metadata tombstone and protected recovery/audit history. This operation does not authorize generic cell quarantine, persistent PostgreSQL/volume destruction, project/source deletion or final purge. Persistent-data purge remains a separate fresh-approved operation under the [V1 authority table](../spec/v1.md).

## Owner API 1.5.0

All paths below are under `/api/v1` and require authenticated owner access. All mutations require `Idempotency-Key` and fresh passkey authority. The generated [OpenAPI](../contracts/control-openapi.json), [strict schemas](../../packages/contracts/src/delivery.ts) and internal owner client define exact DTOs. There is no delivery CLI or browser credential-enrollment command.

| Method/path | Request and result |
| --- | --- |
| `GET /delivery` | Metadata overview; source/execution configuration and literal remote `unqualified`; 200 |
| `POST /delivery/policies` | Registered project/environment, revisions and bounded policy; 201 |
| `POST /delivery/policies/:id/revoke` | `{ expectedRevision }`; 200 |
| `POST /delivery/synchronize` | `{ policyId }`; preparation IDs and blocked count; 200 |
| `POST /delivery/preparations` | `{ policyId, ciRunId, intent, artifactId?, deploymentId? }`; immutable preparation; 201 |
| `POST /delivery/admissions` | `{ preparationId, expectedHash }`; reserved delivery run; 201 |
| `POST /delivery/cleanup` | `{}`; expired-preview cleanup preparation IDs and blocked count; 200 |

Preparation intents are `build`, `release`, `rollback` and `cleanup`. A build cannot accept artifact/deployment references; release requires a trusted artifact, rollback an eligible prior deployment and cleanup an exact owned ephemeral preview. `POST /foundation/runs/:id/reconcile` is the existing owner reconciliation route, not a new delivery executor API. Validation/conflicts/unavailable providers expose safe codes without private material or raw tool logs.

## Migration lane, scanner evidence and local usage (migration 0012)

- **Migration declaration.** Trusted build evidence declares `migration: { class, hash }` with class `none`, `compatible`, `reversible` or `destructive` (destructive also covers anything the previous image cannot tolerate; it must pair with `schemaCompatibility: "incompatible"`). A release preparation copies the artifact's exact declaration into its hashed manifest; execution rechecks it against the retained evidence.
- **Promotion gate.** Admitting a `destructive` release needs `approveMigrationHash` equal to the declared hash from a fresh owner action; standing `autoDeploy` authority never promotes it. The approval is stored per plan and rechecked at reservation and every dispatch. An approval for any other class is rejected.
- **Serialized lane.** A release whose class is not `none` takes a durable, fenced per-environment lock (`delivery_migration_locks`) before staging. Readiness precedes traffic selection and the holder is re-verified immediately before promotion. The lock is released on active success or a proven no-effect failure, and becomes `uncertain` (visible in `/pipelines`, blocking further releases) when the outcome is unknown, until reconciliation proves it.
- **Rollback.** An earlier image is excluded (`MIGRATION_NOT_BACKWARD_COMPATIBLE`, listed in `rollbackBlocked`) when any later release declared `reversible` or `destructive`. Restoring data stays a separate operation.
- **Scanner evidence.** Build evidence carries `scanner` (id, version, database digest, severity summary, artifact digest binding); `artifact.scan` remains. The policy's optional `scanThreshold` (default `high`) blocks findings at or above it; unclassified findings always block (`SCAN_GATE_FAILED`).
- **Usage.** Providers may report CPU milliseconds, peak memory, disk and duration, stored per run (`delivery_usage`) and shown per run and preview with `costMicros` fixed at 0, labelled "non facturé en local".
- Builder evidence lacking `scanner` or `migration`, including artifacts retained before this change, is rejected (fail closed).

## Private server adapters (unqualified)

`apps/control-api/src/delivery/` holds optional adapters, enabled only by absolute paths to private files (rendered by OpenBao): `GODSEYE_GITHUB_APP_BINDING` (`{ issuer, privateKeyPath }`; the PEM is read through the same private-file checks) and `GODSEYE_DELIVERY_BINDING` (provider identity and `appDomain`, Jenkins URL/user/token path/job, private registry URL/prefix/optional credentials path, Caddy container and route directory). Without them the engine stays unconfigured. The adapters never self-qualify (`qualification()` is `null`).

The read-only platform build list (`GET /infrastructure/jenkins`, shown as « Builds de la plateforme » on the delivery page) uses a separate optional binding: `GODSEYE_PLATFORM_JENKINS_BINDING`, an absolute path to a private file `{ baseUrl, user, tokenPath }` read with the same private-file checks (the token file holds a Jenkins API token with read-only permission on the `godseye-platform` and `godseye-platform-candidate` jobs; no value is stored in the repository). Reads use a 4 s deadline and report the last 8 builds per job; an unreachable controller is shown as « Indisponible » with a reason. In local mode, or without the binding, the endpoint answers `not_connected` and the overview `jenkins` capability stays `unconfigured`; it becomes `configured` only when the binding exists.

- **GitHub:** RS256 App JWT (60 s backdated `iat`, 9 minute lifetime) and cached read-only installation tokens feed the existing allowlisted source verifier, which denies forks.
- **Build:** the per-project `godseye-app-build` job in `infra/jenkins/jenkins.yaml` runs the server-owned `build-app.sh` on an isolated agent, pushes a tag per build and archives `evidence.json`. The controller submits with a deterministic idempotency token, reconciles lost submissions from the Jenkins queue/build record, re-reads the build's recorded parameters, recomputes digest and size from registry bytes and derives `BuildEvidence` (including provenance hash). Trivy counts come from the job and are gated by the policy threshold. Only the checks the job really ran (`build`, `image-scan`) can satisfy a policy; others fail closed.
- **Runtime:** Docker with `--runtime=runsc`, an `--internal` network per environment, read-only rootfs, `--cap-drop ALL`, `no-new-privileges`, memory/CPU/pids limits and no published ports. State is derived from container labels and the Caddy route file (`<routeDirectory>/<environmentId>.caddy`, a complete `https://<environmentId>.<appDomain>` site block imported by the edge Caddyfile, so each app host gets its own HTTP-01 certificate), so every step is idempotent and `inspect` reconciles unknown results. Promotion validates then reloads Caddy and restores the previous route on failure; rollback restages a retained digest. Images are never removed by the adapter.
- **Owner inputs:** GitHub App creation/installation and private key, registry credentials, digest-pinned base images (including the Caddy image, `GODSEYE_CADDY_IMAGE`), and the independent qualification. The edge image is built locally with `p10-build-edge-caddy-image.sh` (OVH DNS-01 module) and pinned by image ID. The OVH DNS-01 credentials (zone-scoped to `lucasschimmel.fr`, created by the owner, held in OpenBao `godseye/edge/ovh`, see [owner access](owner-access.md)) issue the console certificate and also permit a later wildcard `*.godseye.lucasschimmel.fr` (`tls { dns ovh { ... } }` on a `*.godseye.lucasschimmel.fr` site); app route files keep per-host HTTP-01 by default and need no token. Optional tuning in the `tls` block via `GODSEYE_CONSOLE_TLS_DIRECTIVE`: `resolvers 1.1.1.1 9.9.9.9`, `propagation_delay 30s`, `propagation_timeout 5m` (default 2m), `dns_challenge_override_domain`. The edge is the container `godseye-edge` installed by `infra/dedicated-server/p10-install-edge-caddy.sh` (template, not executed). Delivery binding values that must match it: `runtime.caddyContainer = "godseye-edge"`, `runtime.routeDirectory = "/etc/godseye/caddy/apps.d"` (mounted read-only at `/etc/caddy/apps.d`), `provider.appDomain = "godseye.lucasschimmel.fr"`; the runtime validates and reloads with `docker exec godseye-edge caddy validate|reload --config /etc/caddy/Caddyfile` and joins the edge to each `gdy-env-<environmentId>` network. Let's Encrypt state lives in the named volumes `godseye-edge-data`/`godseye-edge-config`. Install templates (not executed) are `infra/dedicated-server/p10-*.sh`.

## Custom domains (owner API 1.16.0, migration 0025)

An environment can be reached on its own domain in addition to `<environmentId>.<appDomain>`. Design and trade-offs: [ADR-020](../adr/ADR-020-custom-application-domains.md).

- **Configure:** add `domains: { cnameTarget, publicIpv4: [...], resolvers?: [...] }` to the `GODSEYE_DELIVERY_BINDING` file (for example `cnameTarget = "godseye.lucasschimmel.fr"` and the public IPv4 of the edge). Without it the project page shows the capability as unavailable and `POST /projects/:id/domains` returns 503. The edge must be reinstalled from the current `p10-install-edge-caddy.sh` so its Caddyfile carries `on_demand_tls { ask http://<edge gateway>:4300/api/v1/domains/ask }` and the 404 catch-all.
- **Flow:** the owner adds a hostname (fresh passkey session) and gets a `pending_verification` binding. For `dns` they point a subdomain with a CNAME at the platform host, or an apex with A records at the public IPv4; for `txt` they publish `_godseye-challenge.<host>` = `godseye-verify=<token>`. *Verify* reads DNS through the injected resolver: success makes the binding `verified`, the route is published and it becomes `active`; no record keeps it pending; a record pointing elsewhere makes it `failed` (re-verify after fixing DNS). Re-verifying an `active` binding whose DNS moved away fails it and withdraws the route. *Remove* (fresh passkey session) withdraws the route first.
- **Routes:** the control API writes `<routeDirectory>/<environmentId>.domains.caddy` (header `# godseye-domains environment=... upstream=... hosts=...`), one `https://<host> { tls { on_demand } reverse_proxy ... }` block per verified host, validated and reloaded like platform routes and restored on failure. A promotion or rollback retargets it in the same reload; with no deployment the hosts answer 503.
- **Guard:** `GET /api/v1/domains/ask?domain=<host>` is unauthenticated and answers 200 only for `verified`/`active` bindings, else 404; Caddy therefore never requests a certificate for an unverified name.
- **Limits and refusals:** five live domains per project; a hostname can be live in one binding only; platform hostnames, wildcards, IP literals, ports and reserved suffixes are refused; an apex that already resolves to foreign addresses is refused at add time.
- **Not qualified:** no live DNS, Let's Encrypt or Caddy run was performed; the Caddyfile `on_demand`/catch-all behavior must be confirmed with `caddy validate` and the post-install curl checks on the guest. Certificates are not revoked on removal, and domains are not yet listed among lifecycle purge blockers.

## Actual local laboratory and qualification limits

```sh
bun run test:delivery:lab
```

This alias selects `tests/delivery-lab.test.ts`, which is also included in the default Vitest suite. It uses trusted disposable fixture builds, production `ManagedDeliveryProvider`, actual artifact bytes/hashes, child processes and loopback HTTP readiness/traffic-switch/rollback/cleanup. The final unit run included **12 fixture checks in 3.24 seconds**; the earlier focused run passed in 4.21 seconds. Do not add those twelve checks to the unit aggregate. It does not connect a GitHub account or deploy a user's application. Exact combined history and the remaining follow-up are recorded below and in [verification history](../../tests/STRATEGY.md).

The final combined `bun run test` run passed **851/851 cases across 58 files in 569.99 seconds wall time**. JUnit aggregates 1029.9576847 seconds across suites; that is not wall time. The full browser run passed **28/28 in 163.404282 seconds (JUnit)**, including four new delivery journeys. Lint checked 320 files; types, generated API `1.5.0` consistency and build/built-API smoke passed. All 52 local traceability criteria are recorded as verified; this is local acceptance, not complete V1 release certification. No native PostgreSQL laboratory was rerun for this delivery checkpoint.

Defensive backend source review passed on 44 reviewed hashes after eight resolved items; UI source review passed after five resolved items. Neither report certifies remote providers or a complete security penetration test. Coordinator screenshot review subsequently found layout clipping and prompted a narrow responsive-CSS correction. After that change, all four delivery browser journeys passed in 58.082768 seconds; the coordinator inspected refreshed desktop/mobile screenshots and confirmed the identity controls, cleanup button and text no longer clip. The earlier full 28-journey run remains archived separately; this rechecks four existing journeys and does not create 32 unique cases. Final build and compiled-API smoke passed after the CSS change; backend production code remained unchanged.

The scoped `bun run test:mutation:delivery` run killed **13/13 selected mutations** in 132.631 seconds: twelve new M62–M73 plus affected historical M07. All thirteen baseline/restored checks passed, with zero survivors/invalid cases and unchanged original sources. The report is `.codex/crafts/g-o-d-s-e-y-e-cfe8/reviews/mutations-delivery.json`. The earlier 61-case matrix was not rerun and retains its historical scope; no exhaustive mutation/coverage percentage is inferred. Preliminary Gitleaks history/373-file source scanning reported zero findings; final staged secret scanning remains pending.

The local API constructs no source/executor provider by default. The GitHub adapter and managed delivery transport are private integration seams; a configuration boolean or browser association cannot qualify them. `configured` means an adapter was supplied, not that remote capability passed admission. Live GitHub App enrollment/token exchange, Jenkins controller/disposable build guest, registry/scanner authority, Coolify deployment, Docker/gVisor quotas/firewall, DNS/TLS/public preview domains, production migrations and off-host durability remain unqualified. A native trusted fixture cannot establish untrusted-code containment. See [CI preparation](ci.md) and [ADR-009](../adr/ADR-009-local-application-delivery.md).
