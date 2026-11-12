# CI preparation and GitHub delivery

Status: local configuration and event intake, 2026-11-11. Jenkins has not been started or qualified in this checkpoint. No GitHub App, remote repository, Jenkins agent, image registry or deployment provider is connected by these files.

## Available artifacts

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

The platform job follows `main`, polls SCM approximately every ten minutes and runs a nightly test pass using Jenkins' hashed scheduling. The schedules become active only after the job/pipeline has actually been loaded and executed. This job is for the trusted G.O.D.S.E.Y.E repository. It does not discover pull requests or create arbitrary project pipelines, and it contains no deployment stage. The absence of GitHub Actions does not remove compute, storage, maintenance or third-party API limits.

## GitHub event intake

The local API accepts `POST /hooks/github` with `Content-Type: application/json`, `X-GitHub-Event`, `X-GitHub-Delivery` and `X-Hub-Signature-256`. Configure `GODSEYE_GITHUB_WEBHOOK_KEY` privately. The signature is HMAC-SHA256 over the exact received bytes and is checked before JSON parsing, following [GitHub's delivery validation documentation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

Non-deleted branch pushes and same-repository PR `opened`, `synchronize`, `reopened` and `closed` events whose repository ID, installation ID, full repository name and tracked branch match a recorded project binding create CI intentions. Forks are not admitted. A shared repository may match several projects; all matching projects receive their own run inside one transaction. Retried identical deliveries create no duplicate runs. Reusing a delivery ID with different authenticated contents returns 409. Accepted events begin at `pending_verification`.

The local E05 DeliveryEngine now composes the existing Foundation worker with independent source verification, build/artifact evidence, serialized readiness/promotion, rollback and bounded preview cleanup. Its source adapter checks current installation/repository/ref/PR state, and its private managed-provider seam can support a qualified build/deployment integration. Default startup configures neither provider. No live GitHub App token exchange, Jenkins build dispatch, registry/scanner or Coolify execution has been qualified. Receiving a webhook remains distinct from a verified source or an up-to-date serving release. See [application delivery](application-delivery.md) and T41–T43 release qualification.

## Required delivery policy

The owner may authorize a bounded standing production delivery policy for a repository, installation, branch and target project/environment. This is the explicit exception introduced by F46; it does not grant an agent general production authority.

Before promoting any such release, the trusted broker must verify the exact source identity and current branch head, successful required checks, immutable artifact digest/provenance, admitted resources, configuration/schema compatibility and a qualified deployment provider. It must recheck freshness at promotion so a delayed older build cannot replace a newer accepted revision. Unknown submission or deployment outcomes must be reconciled before retry. Disabling or editing the standing policy invalidates queued authority.

Destructive/incompatible migrations, live restore activation, privilege expansion, domain changes outside the standing target and data purge continue to require their existing fresh owner approval. A failed build or readiness check keeps the previous deployment serving; image rollback does not rewind a database. The repository checkbox stores only a preference. `/pipelines` creates a separate fresh-owner, exact expiring policy; its automatic behavior requires qualified private providers and cannot activate restored cells. Retained-image rollback uses current verified CI source authority and a separate fresh owner action.

TTL/verified PR closure authorizes owned ephemeral preview stop/unpublish, not persistent PostgreSQL/volume destruction or final purge. A successful cleanup request is only preparation until exact resource absence is inspected. Unknown effects/reservations remain visible. The platform Jenkinsfile still contains no hosted-application deployment stage; local DeliveryEngine source does not turn the trusted platform pipeline into a qualified user-application runner.

`bun run test:delivery:lab` selects twelve trusted disposable fixture tests against the actual managed provider (focused result: 4.21 seconds), also included in default Vitest. The fixture proves actual local hashing/process/HTTP readiness/traffic/cleanup behavior, not untrusted-code isolation, Jenkins/guest execution or DNS/TLS. The combined run passed 851/851 unit/integration cases across 58 files in 569.99 seconds wall time and 28/28 browser journeys in 163.404282 seconds (JUnit), including four delivery journeys. Static checks (320 linted files, types and API `1.5.0` consistency), build/smoke and frozen backend/UI source reviews passed. The narrow responsive-CSS follow-up passed four delivery browser journeys in 58.082768 seconds with refreshed desktop/mobile visual checks; all thirteen selected delivery mutations were killed with green baseline/restored checks and unchanged original sources. Final build/smoke passed after the stylesheet change.
