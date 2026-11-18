# CI preparation and GitHub delivery

Status: local CI preparation and source-intake implementation, updated 2026-11-12. Jenkins has not been started or qualified. The private repository exists, but these files do not configure a live GitHub App, Jenkins agent, image registry or deployment provider. The current control API is `1.9.0`; older versioned verification below describes its original checkpoint.

## Available artifacts

The Jenkins post-build archive must retain `artifacts/playwright-results/**`, the actual Playwright
trace/screenshot directory, before workspace cleanup. JUnit statuses and CI metadata do not replace
those diagnostic files. The local regression verifies path compatibility; a real Jenkins artifact
upload and runner execution remain qualification work. The `godseye-platform` job follows release
`main` only (SCM polling and the nightly pass are defined on that job). `develop` is verified before a
release by running the manual `godseye-platform-candidate` job (parameter `BRANCH`, default `develop`),
then a release PR from `develop` to `main` is merged with the owner's explicit decision. Until the first
release reaches `main`, the automatic job has nothing to build.

| Artifact | Purpose |
| --- | --- |
| `Jenkinsfile` | Trusted platform pipeline: locked install, lint/types, all-scope dependency audit, tests, build/built-API smoke and browser journeys |
| `infra/jenkins/Dockerfile` | Pinned Jenkins 2.580.2 / Java 21 controller image and declared plugin installation |
| `infra/jenkins/plugins.txt` | Explicit top-level plugin versions; transitive compatibility still requires a real image build |
| `infra/jenkins/jenkins.yaml` | Configuration as Code: owner account, authorization, zero controller executors and a trusted-main platform job |
| `compose.ci.yaml` | Private local Jenkins controller with a loopback-published port |
| `compose.local.yaml` | Optional `postgres` development profile with a loopback-published port |
| `packages/core/src/github.ts` | Signed raw-byte event validation, receipt deduplication and transactional project fanout |
| `scripts/ci-report.mjs` | Evidence metadata generation; it does not certify successful checks or deployment |
| `scripts/install-openbao.mjs` | Installs the pinned, published-checksum-verified native OpenBao laboratory tool into ignored build artifacts |
| `scripts/install-runsc.mjs` | Downloads pinned gVisor and minimal Alpine fixture archives into ignored local tooling; no system installation |
| `vitest.infra-lab.config.ts` | Dedicated explicit OCI lab, separate from the default unit/integration suite |
| `scripts/install-pgbackrest.mjs` | Project-local signed PGDG pgBackRest extraction with signed Ubuntu dependencies |
| `vitest.recovery-lab.config.ts` | Explicit actual PostgreSQL/pgBackRest paused-recovery suite, separate from default tests |

The controller has no Docker socket mount and no built-in executor. The pipeline requires an externally provisioned agent with the label `godseye-isolated-node24-bun144`. That label alone does not provide isolation. The agent must be deployed and qualified in the disposable work VM or another explicitly qualified runner, with Node.js 24, Bun 1.4.4, Git and the Linux libraries required by Chromium. Bun installs the frozen workspace and runs scripts; Node.js remains the application/test runtime. Project code must not execute on the controller or on the professional VM's production Docker daemon. Follow [Jenkins controller isolation guidance](https://www.jenkins.io/doc/book/security/controller-isolation/).

The complete test suite also needs `bun run bao:install` before `bun run test` or `bun run check`. Ignored local tooling is not present after a clean checkout. The provider tests launch a disposable local non-dev OpenBao instance with private Raft storage and in-memory initialization/recovery material; installing that tool does not connect CI to the owner's store. Native Windows laboratory results do not qualify the future Linux agent or Jenkins runtime.

The explicit gVisor lab requires a compatible Linux user-namespace environment; Windows qualification used the existing Ubuntu WSL distribution. The pipeline has a separate `godseye-linux-userns-node24-bun144` agent stage that checks Linux/Bun, installs frozen dependencies, runs `bun run runsc:install` and then `bun run test:infra:lab`. That stage collects its own `artifacts/test-results/infra-lab.xml` JUnit and artifact output, with missing evidence treated as failure. It does not silently skip or use a native-container fallback. The current four-case local run proves selected OCI mechanisms only: it explicitly ignores cgroups and cannot qualify Docker forwarding, persistent quotas, a professional VM or outer KVM isolation. The agent and Jenkins execution themselves remain unqualified. See [infrastructure preparation](infrastructure.md).

The prepared independent-database and paused-recovery stages use `godseye-ubuntu2604-amd64-node24-bun144`. The recovery stage performs frozen install, then `bun run postgres:install`, `bun run postgres:recovery:install` and `bun run test:recovery:lab`. It collects `artifacts/test-results/recovery-lab.xml` and `artifacts/test-results/recovery-lab-observation.json`, with missing evidence treated as failure. It does not produce a `recovery-lab-report.json`. The local eleven-case run passed in 49.52 seconds; this does not demonstrate Jenkins execution or production provider qualification. Prerequisites and exact scope are in [physical backup and held recovery](postgresql-recovery.md).

## Local controller preparation

The Docker CLI is present in the development environment, but the Docker daemon was unavailable during preparation. Both Compose files passed `config --quiet` with placeholder environment values only. This validates interpolation and Compose structure, not that the image builds, plugins are compatible, Configuration as Code loads or a pipeline executes.

Supply configuration through a private process environment or local secret mechanism. The CI Compose file requires `JENKINS_OWNER_ID`, `JENKINS_OWNER_PASSWORD` and `GODSEYE_SOURCE_URL`. The source URL must identify the trusted owner-controlled G.O.D.S.E.Y.E repository; no source repository is configured automatically. The default private Jenkins URL is `http://127.0.0.1:8081/`, overridable with `JENKINS_PRIVATE_URL` and `GODSEYE_LOCAL_JENKINS_PORT` as appropriate.

The PostgreSQL service is separate: `compose.local.yaml --profile postgres` requires `GODSEYE_LOCAL_DATABASE_PASSWORD` and publishes port 5433 by default (`GODSEYE_LOCAL_DATABASE_PORT` overrides it). Its CI variables are independent. Use the default PGlite application mode when Docker services are not needed.

Once a Docker daemon and the required local configuration are available:

```sh
docker compose -f compose.ci.yaml config --quiet
docker compose -f compose.ci.yaml up -d --build jenkins
```

The controller remains private on loopback. No unauthenticated setup wizard or public management endpoint should be exposed. Attach a qualified agent before running the job. For private repository checkout, create a least-privilege read credential through the owner's Jenkins administration interface and set the optional `GODSEYE_SOURCE_CREDENTIALS_ID` to its identifier. That identifier references the stored credential; it is not the credential value. Do not embed credentials in the source URL or give the build production access.

The platform job follows `main`, polls SCM approximately every ten minutes and runs a nightly test pass using Jenkins' hashed scheduling. The schedules become active only after the job/pipeline has actually been loaded and executed. This job is for the trusted G.O.D.S.E.Y.E repository. It does not discover pull requests or create arbitrary project pipelines, and it contains no deployment stage. GitHub Actions is not used for builds (its only workflow is the external uptime observer described at the end of this page), and the absence of Actions builds does not remove compute, storage, maintenance or third-party API limits.

## GitHub event intake

The local API accepts `POST /hooks/github` with `Content-Type: application/json`, `X-GitHub-Event`, `X-GitHub-Delivery` and `X-Hub-Signature-256`. Configure `GODSEYE_GITHUB_WEBHOOK_KEY` privately. The signature is HMAC-SHA256 over the exact received bytes and is checked before JSON parsing, following [GitHub's delivery validation documentation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

Non-deleted branch pushes and same-repository PR `opened`, `synchronize`, `reopened` and `closed` events whose repository ID, installation ID, full repository name and tracked branch match a recorded project binding create CI intentions. Forks are not admitted. A shared repository may match several projects; all matching projects receive their own run inside one transaction. Retried identical deliveries create no duplicate runs. Reusing a delivery ID with different authenticated contents returns 409. Accepted events begin at `pending_verification`.

The local E05 DeliveryEngine now composes the existing Foundation worker with independent source verification, build/artifact evidence, serialized readiness/promotion, rollback and bounded preview cleanup. Its source adapter checks current installation/repository/ref/PR state, and its private managed-provider seam can support a qualified build/deployment integration. Default startup configures neither provider. No live GitHub App token exchange, Jenkins build dispatch, registry/scanner or Docker/runsc execution (Coolify was dropped, ADR-021) has been qualified. Receiving a webhook remains distinct from a verified source or an up-to-date serving release. See [application delivery](application-delivery.md) and T41–T43 release qualification.

## Compiled application contract checks

Local artifact validation executes the compiled backend, not only TypeScript source. The backend
bundle resolves both `@godseye/app-backend` and its new `@godseye/contracts` workspace dependency
into the Node.js 24 artifact; external runtime dependencies remain explicit. The independent
compiled-template restart and built-SDK consumer checks catch unresolved workspace imports that
a source-only test or successful bundling command could miss. Their current run is recorded in
the [verification strategy](../../tests/STRATEGY.md).

The final canonical console/API/standalone SDK/declarations/backend build passed, followed by an
actual built-API smoke check in 8.67 seconds with the dedicated server disconnected. This is local
artifact evidence; it does not qualify Jenkins, an isolated build agent or a deployment provider.

## Autonomous jobs and external-persistence checks

The E06 completion slice adds a separate process-level qualification target: owner HTTP must be
absent while a trusted supervisor and per-cell workers execute against the same PostgreSQL control
journal. External workflow PostgreSQL and Redis must be real services with private independent
authority/state; PGlite and embedded Inngest storage cannot satisfy this check. A health endpoint
or generated Compose document is insufficient proof of waiting-workflow restart.

The local tools are installed into ignored project artifacts:

```sh
bun run postgres:install
bun run redis:install
bun run inngest:install
```

The PostgreSQL and Redis installers extract signed Ubuntu packages as an unprivileged user,
using the existing Ubuntu WSL distribution on Windows. They do not use `apt install`, `sudo`,
system services or a Docker daemon. Redis is pinned to the patched Ubuntu package
`5:8.0.5-1ubuntu0.1` (Redis8.0.5); acquisition verifies archive signatures, index and package
SHA256/size. Native-process evidence remains separate from a Linux Jenkins/VM/container run.

The supported operator provisioning command is `bun run jobs:services start --directory .local/jobs-services --cells path/to/cells.json --platform path/to/platform.json`; it writes private bindings without printing material. `bun run jobs:start` starts the separate supervisor and `bun run build:jobs` builds its independent artifacts. See the [runtime guide](application-jobs.md#start-and-stop-persistent-local-services) for explicit configuration and the PGlite migration boundary. Final local gates pass: 1,225 default cases, eleven separately executed opt-in native cases, seven selected mutation kills, canonical build/built smoke and frozen source/security review. No UI changed, so the previous browser results are historical; no new browser run is claimed. The earlier
Inngest suite and its 1,191-case checkpoint remain historical evidence for the previous source.
Do not enable an automated deployment or claim this stage runs in Jenkins until the corresponding
agent, actual services, retained JUnit and failure cleanup have been qualified.

## Required delivery policy

The owner may authorize a bounded standing production delivery policy for a repository, installation, branch and target project/environment. This is the explicit exception introduced by F46; it does not grant an agent general production authority.

Before promoting any such release, the trusted broker must verify the exact source identity and current branch head, successful required checks, immutable artifact digest/provenance, admitted resources, configuration/schema compatibility and a qualified deployment provider. It must recheck freshness at promotion so a delayed older build cannot replace a newer accepted revision. Unknown submission or deployment outcomes must be reconciled before retry. Disabling or editing the standing policy invalidates queued authority.

Destructive/incompatible migrations, live restore activation, privilege expansion, domain changes outside the standing target and data purge continue to require their existing fresh owner approval. A failed build or readiness check keeps the previous deployment serving; image rollback does not rewind a database. The repository checkbox stores only a preference. `/pipelines` creates a separate fresh-owner, exact expiring policy; its automatic behavior requires qualified private providers and cannot activate restored cells. Retained-image rollback uses current verified CI source authority and a separate fresh owner action.

TTL/verified PR closure authorizes owned ephemeral preview stop/unpublish, not persistent PostgreSQL/volume destruction or final purge. A successful cleanup request is only preparation until exact resource absence is inspected. Unknown effects/reservations remain visible. The platform Jenkinsfile still contains no hosted-application deployment stage; local DeliveryEngine source does not turn the trusted platform pipeline into a qualified user-application runner.

`bun run test:delivery:lab` selects twelve trusted disposable fixture tests against the actual managed provider (focused result: 4.21 seconds), also included in default Vitest. The fixture proves actual local hashing/process/HTTP readiness/traffic/cleanup behavior, not untrusted-code isolation, Jenkins/guest execution or DNS/TLS. The combined run passed 851/851 unit/integration cases across 58 files in 569.99 seconds wall time and 28/28 browser journeys in 163.404282 seconds (JUnit), including four delivery journeys. Static checks (320 linted files, types and API `1.5.0` consistency), build/smoke and frozen backend/UI source reviews passed. The narrow responsive-CSS follow-up passed four delivery browser journeys in 58.082768 seconds with refreshed desktop/mobile visual checks; all thirteen selected delivery mutations were killed with green baseline/restored checks and unchanged original sources. Final build/smoke passed after the stylesheet change.

## External uptime observer (GitHub Actions)

`.github/workflows/external-observer.yml` is the single GitHub Actions workflow. It is an observer, not a build system: Jenkins remains the build and release authority. A dead server cannot report its own death (spec DS11/E08), so this check runs outside the server's failure domain.

- Schedule: every five minutes plus manual `workflow_dispatch`. GitHub runs scheduled workflows only from the default branch (`main`), so the observer starts after the first release PR reaches `main`. GitHub may delay or skip scheduled runs under load.
- Checks: `https://godseye.lucasschimmel.fr/healthz` returns 200 with body `godseye-edge-ok`; the presented TLS certificate is valid for at least 14 more days; none of the ports 22, 8006, 8080, 8200, 5432 and 6379 accepts a TCP connection on the public IPv4 of that host.
- Least privilege: `permissions: {}`, no secrets, no repository checkout and no third-party actions (plain `curl`, `openssl` and bash on the hosted runner), so there is nothing to pin or leak. Any action added later must be pinned by full commit SHA after verification.
- Notification: a failed run makes GitHub email the repository owner (the user who last changed the schedule) under their Actions notification settings; check that failed-workflow email is enabled in the GitHub account. This is GitHub's notification, not the platform's E08 notifier.
- Cost: the schedule runs every thirty minutes, 48 runs a day, about 1,440 billed minutes a month on a private repository (each run bills at least one minute), which fits the 2,000 included minutes of a free plan. A five-minute cadence would be about 8,600 a month; raise the frequency only on a plan that includes enough minutes. Detection of an outage therefore takes up to thirty minutes.
- Not covered: only public behaviour is observed. The private console, internal services, delivered applications and the WireGuard side are not probed.

## Jenkins on the console, incidents and kept evidence

- **Console (Plateforme > Livraison):** the read-only builds panel (`GET /infrastructure/jenkins`) shows, per job, the last builds with state, branch, **commit** (the workspace checkout: a non-lightweight job such as the candidate records the pipeline-definition revision first and the tested revision last, and the last one is reported), start and duration, plus the build **agents** (online or offline, executors, busy) and the **queue** (length, stuck items, oldest wait). Unreadable state is stated (`Indisponible`), never shown as empty. Build links point to the private controller and open only with WireGuard active; the page says so.
- **Incidents:** `ciHealthFindings` feeds the controller's system incident evaluation (kind `health`, keys `ci:build:<job>`, `ci:agent:<name>`, `ci:queue:stalled`, `ci:jenkins:unreachable`). A failed latest build of `godseye-platform` is critical, other conditions are warnings; an incident clears only when evidence of recovery was read (a later successful build, the agent online, the queue moving, the controller readable). An aborted build neither raises nor clears. Delivery to Discord uses the existing notification channel contract; without a configured channel the incident stays `unconfigured` but visible.
- **Dependency audit gate:** `bun audit --audit-level=high` in the Jenkinsfile carries one explicit waiver, `GHSA-fc5q-39xc-vjpf` (picomatch, no patched release published). Remove it when `bun audit` is clean without it.
- **Evidence outside Jenkins:** `infra/dedicated-server/p15-archive-ci-evidence.sh` (daily timer `godseye-ci-evidence.timer` on the pro VM) stores per finished build `meta.json`, `console.log`, `test-report.json`, the archived artifacts (raw JUnit XML since the Jenkinsfile archives `artifacts/test-results/*.xml`) and a `MANIFEST.sha256` under `/var/lib/godseye/ci-evidence/<job>/<build>/`, and a `jenkins-config/<stamp>.json` fingerprint (Jenkins version, plugins, controller `numExecutors`/`mode` read from the instance, SHA-256 of each loaded JCasC file). Files are root-owned, group `godseye`, 0640, and contain no credential.

## Browser journeys on the CI agent

`bun run test:e2e:sequential` (`scripts/e2e-sequential.mjs`) runs each Playwright project on its own with a single isolated application, one JUnit file per project (`artifacts/test-results/e2e-<project>.xml`) and a non-zero exit if any project failed. Plain `bun run test:e2e` still starts every isolated application at once, which exhausts the 6 GiB agent (the kernel killed browsers and servers). Each application is considered ready only when `/api/v1/health` answers through the console proxy, so a journey never reaches a closed API port.

The native PostgreSQL and pgBackRest recovery laboratories (`Jenkinsfile.ubuntu-labs`) need an Ubuntu 26.04 amd64 agent labelled `godseye-ubuntu2604-amd64-node24-bun144`. The server agent is Debian 13, so they are not part of the platform pipeline (a stage waiting for a label nobody carries stalled the pipeline until its timeout). Add that agent and a `godseye-ubuntu-labs` job to run them; until then PostgreSQL 18 behavior on the server is evidenced by the per-cell deployment (`docs/operations/evidence/cells-deploy.md`). The platform pipeline timeout is 45 minutes.
