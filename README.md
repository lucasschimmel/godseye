# G.O.D.S.E.Y.E

Private application hosting and operations platform for a solo owner: project backends, deployments, independent data services, durable jobs, Hermes agents, local decisions, usage and recovery.

**Status: local foundations, owner/service access, infrastructure, independent PostgreSQL cells, held physical recovery, application delivery and the application backend/SDK.** The console requires an owner passkey. The control plane includes durable execution, authority/budget boundaries, audit export, signed GitHub intake, metadata-only OpenBao/service-identity management and evidence-bound inventory/cell preparation. The preceding E03 checkpoint passed 421 unit/integration cases, 21 browser journeys, ten native PostgreSQL checks across three independent instances and 47 selected mutation experiments. The recovery continuation has separate eleven-case actual-tool evidence, passed independent backend/UI reviews and 61 selected mutation kills, with two affected cases rechecked after the final fix. The preceding recovery verification passed 596/596 unit/integration cases across 45 files in 408.36 seconds, 24/24 browser journeys in 140.767398 seconds (JUnit), static checks and final build/smoke. Default recovery execution is unconfigured and activation is blocked. Remote infrastructure, Jenkins execution and the complete V1 release remain unqualified.

The preceding local E05 checkpoint added `/pipelines` policy/source/build/release/preview management and owner API `1.5.0`. Its source/executor are unconfigured by default; GitHub App/Jenkins/Coolify/guest/registry/domain-TLS qualification remains open. The combined run passed 851/851 unit/integration cases across 58 files in 569.99 seconds wall time and 28/28 browser journeys in 163.404282 seconds (JUnit), including four delivery journeys. Static checks (320 linted files, types and API `1.5.0` consistency), build/smoke and frozen backend/UI source reviews passed. The narrow responsive-CSS follow-up passed four delivery browser journeys in 58.082768 seconds with refreshed desktop/mobile visual checks; all thirteen selected delivery mutations were killed with green baseline/restored checks and unchanged original sources. Final build/smoke passed after the stylesheet change. See [application delivery](docs/development/application-delivery.md).

## Run locally

The E04 continuation adds an independent application backend and custom TypeScript SDK, with separate application identities, private resumable files, scoped domain events and private held recovery. Owner project pages prepare backend settings through control API `1.6.0`; the application API has its own `1.0.0` contract. `bun run backend:dev --help` describes the explicit standalone local fixture; managed applications require the private controller lifecycle guard. `bun run build:sdk` produces a standalone browser package/declarations, and `bun run build:backend` builds the Node template. Local configuration does not connect a hosted runtime. See [application backend operations](docs/development/application-backend.md) and [ADR-010](docs/adr/ADR-010-independent-application-backend.md) for contracts and verification boundaries.

E04 verification has passed 31/31 browser journeys (181.393319 seconds JUnit), thirteen selected M74–M86 mutation experiments with passing baseline/restored checks and unchanged original sources (257.091 seconds), canonical builds, compiled-template HTTP/restart and standalone SDK-consumer checks. Lint (381 files), types, generated control OpenAPI `1.6.0`, frozen backend/UI source reviews and 62/62 local traceability links passed. Final combined unit/integration verification passed 972/972 cases across 72 files in 751.83 seconds (Vitest; 752.705 seconds for the whole command). The earlier 851-case result is the preceding E05 checkpoint.

The private repository uses `develop` for ongoing implementation and `main` for releases. See [Git workflow](docs/development/git-workflow.md) for the owner-requested branch, commit and pull-request conventions.

Use Node.js 24 and Bun 1.4.4. Bun manages the workspace, dependency lockfile and script commands; the application and existing test tools still execute on Node.js 24. Docker is not needed for the default PGlite database.

```sh
bun install --frozen-lockfile
bun run dev
```

Open [the local console](http://localhost:4300). In a second terminal, prepare the first owner enrollment:

```sh
bun run owner:setup
```

Open the single-use link printed by the command and register your own device passkey or security key. The browser ceremony requires your presence; virtual authenticators used by tests do not enroll the real owner. There is no public signup or developer-owner bypass. See [owner access and recovery](docs/development/owner-access.md).

The API listens on `127.0.0.1:4301`. The control database persists under `.local/control`; private identity/process state defaults to `.local/control-state`. Local mode remains mandatory and production startup is refused while private remote admission is unqualified.

The console can register projects, prepare separate development/production configurations, associate repositories, validate local configuration, manage owner keys/sessions and register scoped service identities/slots at `/access`. At `/infrastructure`, the owner can declare desired topology, refresh actual local-controller metadata, prepare immutable application profiles and inspect admission reasons or allocation state. Default startup has no qualified infrastructure provider. OpenBao is unconfigured unless the local operator supplies limited provider authority. Staging values and issuing proofs use offline private commands; the console has no reveal endpoint. Planned environments are not running containers. GitHub events remain `pending_verification`; Jenkins dispatch and automatic deployments are not active.

```sh
bun run bao:install
bun run check
bun run build
bun run smoke:built
bun run playwright install chromium
bun run test:e2e
```

Use `bun run test` for the existing Vitest suite. Plain `bun test` selects Bun's different test runner and is not this repository's verification command. CI installs from the committed `bun.lock` with `--frozen-lockfile`.

The explicit gVisor laboratory has separate platform requirements and is excluded from the default suite:

```sh
bun run runsc:install
bun run test:infra:lab
```

See the [infrastructure guide](docs/development/infrastructure.md) before interpreting that laboratory as host/provider qualification.

The separate native PostgreSQL 18.6 laboratory uses an existing non-root Ubuntu amd64 environment (WSL on Windows):

```sh
bun run postgres:install
bun run test:database:lab
```

The installer verifies Ubuntu signed metadata and package hashes, then extracts into the project cache without a system installation. The lab tests independent clusters, actual grants, SCRAM/TLS, connection limits and restart persistence. Its shared host/UID does not qualify Docker/VM containment or hard quotas. Database execution remains unconfigured by default. See [project/database operations](docs/development/project-databases.md) for metadata/previews, exact prepare/admit lifecycle and the remaining backup/PITR/rotation gates.

Project detail pages support revision-protected metadata/environment policy edits and bounded persistent preview registration; `/databases` exposes immutable preparation and verified allocation state. Preview expiry blocks new provision/resume and permits protective database suspension. It does not automatically purge services or data. Whole-project all-service suspension, export and purge remain future acceptance work.

The `/databases` recovery section prepares physical full/differential backups, continuous archive checks and restore to a new held environment/allocation. Source data is retained; the physical clone retains source catalog/system identity. Private execution requires exact independently qualified provider authority, which default startup does not configure. E04 supplies a separate local application file/auth/config recovery set; coordinated hosted recovery, complete business-effect reconciliation and actual producer fencing remain unqualified, so all-service activation stays blocked. Weekly/daily scheduling is prepared-only.

The separate signed-tool recovery laboratory passed eleven checks in 49.52 seconds with PostgreSQL 18.6 and pgBackRest 2.60.0:

```sh
bun run postgres:install
bun run postgres:recovery:install
bun run test:recovery:lab
```

See [physical backup and held recovery](docs/development/postgresql-recovery.md) for prerequisites, API `1.4.0`, retention/capacity, reports and the finite local evidence boundary. Native process tests do not qualify off-host durability, containment, hard quotas, production RPO/RTO or safe activation.

The infrastructure continuation passed 325 unit/integration cases across thirty files in 244.70 seconds, generated-contract/type checks, build and built-API smoke. Eighteen browser journeys passed in 73.155046 seconds (JUnit), and the explicit laboratory alias passed four checks in 17.027 seconds (17.26 seconds total). Thirty-one selected mutations were killed and 26 local criteria were traced; these are not complete V1 mutation, coverage or traceability scores. The preceding service-broker baseline was 215 unit/integration cases and sixteen browser cases. These results cover local behavior; the [verification strategy](tests/STRATEGY.md) records exact run evidence and the remaining release gates.

The preceding independent-database checkpoint passed `bun run test --maxWorkers=1`: 421/421 cases across 37 files in 676.45 seconds. Lint (238 files), type checking and generated API `1.3.0` consistency passed separately, followed by final build/smoke and 21/21 browser journeys in 112.584583 seconds (JUnit). All 47 selected mutations were killed after one surviving experiment exposed a redundant database-uniqueness guard and the public 409 assertion was strengthened. These are bounded local results, not complete V1 coverage or qualification; the verification strategy preserves the failure and rerun history.

At `/pipelines`, a recent owner passkey confirmation permits exact expiring delivery policies, independent-source synchronization, build/release preparation, retained-image rollback and synthetic-data PR previews. The repository auto-deploy preference alone grants no authority. TTL/verified PR closure permits protective stop/unpublish of owned ephemeral runtime only; persistent-data purge still requires separate fresh approval. The trusted local managed-provider laboratory passed twelve checks in 4.21 seconds and can be rerun with `bun run test:delivery:lab`; it is also part of the default Vitest suite. Local fixture processes do not qualify untrusted builds or remote deployment.

See [local development](docs/development/local.md), [control foundations](docs/development/foundations.md), [service access and OpenBao](docs/development/service-access.md), [infrastructure inventory and cell preparation](docs/development/infrastructure.md), [independent project databases](docs/development/project-databases.md) and [CI preparation](docs/development/ci.md) for current commands and qualification boundaries.

| Workspace                 | Responsibility                                                                  |
| ------------------------- | ------------------------------------------------------------------------------- |
| `apps/console`            | Private React/TanStack Start console and owner-access UI                        |
| `apps/control-api`        | Authenticated local Hono boundary, owner administration and private access CLI  |
| `apps/backend-template`   | Explicit local application template and authenticated domain-route example      |
| `packages/contracts`      | Versioned requests, response schemas and OpenAPI definitions                    |
| `packages/control-client` | Internal typed owner API client; separate from the application SDK              |
| `packages/app-backend`    | Independent application authentication, private files, SSE and held recovery    |
| `packages/sdk`            | Versioned TypeScript application client and standalone browser artifact         |
| `packages/core`           | Project, execution, grant, budget, audit, OpenBao broker and signed-event logic |
| `packages/store`          | Checksummed migrations and Drizzle/PGlite/PostgreSQL storage                    |

## Implementation baseline

The target has Proxmox once on the physical host, with one professional VM and one games VM. Docker/Compose and gVisor systrap provide the planned application isolation inside the professional VM; there is no nested Proxmox. An optional disposable work VM is a sibling on the host. Each cell will have independent PostgreSQL, data/WAL, service credentials and Inngest installation state. Coolify is the first replaceable deployment engine. These infrastructure properties still require E00 qualification.

The target is the complete V1 scope, not an MVP. Security, recovery and essential journeys remain release gates; “90%” does not waive them.

## Read in order

1. [Architecture overview](docs/architecture.md)
2. [Current placement and dual-stack decision](docs/adr/ADR-002-professional-vm-and-dual-stack.md)
3. [Local-first and CI sequencing](docs/adr/ADR-003-local-first-and-ci.md)
4. [Owner authority and foundations](docs/adr/ADR-004-owner-authority-and-foundations.md)
5. [Bun and local service authority](docs/adr/ADR-005-bun-and-local-service-authority.md)
6. [Evidence-bound inventory and cell provisioning](docs/adr/ADR-006-local-inventory-and-cell-provisioning.md)
7. [Independent PostgreSQL cells and durable database lifecycle](docs/adr/ADR-007-independent-postgresql-cells.md)
8. [Physical PostgreSQL backup and new held recovery environments](docs/adr/ADR-008-local-postgresql-held-recovery.md)
9. [Local application delivery with exact standing authority](docs/adr/ADR-009-local-application-delivery.md)
10. [Independent application backend and project SDK](docs/adr/ADR-010-independent-application-backend.md)
11. [V1 functional requirements](docs/spec/v1.md)
12. [Isolation/data contract](docs/spec/isolation.md) and [networking contract](docs/spec/networking.md)
13. [Development plan](docs/plan/v1-development.md) and [verification strategy](tests/STRATEGY.md)

Historical research remains under [docs/research](docs/research/2026-11-11-architecture.md). The dedicated local gVisor laboratory has verified selected root/filesystem/network-none mechanisms; it does not qualify the professional Docker/VM topology. Dedicated-server installation, persistent quotas, off-host recovery objectives and host capacity/soak requirements remain unverified.
