# Local development

Status: local foundations, owner/service access, infrastructure/data/recovery, application delivery and E04 application-backend implementation, 2026-11-12; combined unit/build, browser and scoped laboratory verification passed. The [V1 specification](../spec/v1.md) remains the release target.

## Startup and owner access

Use Node.js 24 and Bun 1.4.4 from the repository root:

```sh
bun install --frozen-lockfile
bun run dev
```

Bun is the package manager and script entry point. Node.js 24 remains the application/test runtime; this change does not qualify a Bun-runtime replacement. The committed `bun.lock` and root workspace configuration replace the previous package-manager files. Use `bun run test` for Vitest; plain `bun test` invokes a different runner.

The launcher starts Hono and TanStack Start on loopback. Open `http://localhost:4300`; API health is `http://127.0.0.1:4301/api/v1/health`. The browser uses the canonical localhost origin for WebAuthn. Visiting the older 127.0.0.1 console address redirects to that origin.

For the first owner, run `bun run owner:setup` in a second terminal and open its one-use enrollment link. An actual passkey ceremony is required. Later visits use the enrolled passkey. [Owner access](owner-access.md) documents additional keys, session revocation and online/offline recovery.

The default database is PGlite persisted under `.local/control`. Identity/process state is separate at `.local/control-state`, including private signing material and the instance lock. Both directories are ignored by Git. Ordered, checksummed migrations preserve existing local data and reject drift in an already applied migration. Keep real database/identity state out of commits and diagnostic output.

## Configuration

Set variables in the launching process. The launcher does not load dotenv files.

| Variable | Default or behavior |
| --- | --- |
| `GODSEYE_MODE` | Launcher selects `local`; direct API startup requires it. |
| `GODSEYE_CONSOLE_PORT` | `4300`; integer from 1024 to 65535. The owner WebAuthn origin uses localhost at this port. |
| `GODSEYE_API_PORT` | `4301`; integer from 1024 to 65535. |
| `GODSEYE_DATA_DIR` | `.local/control`, resolved from the repository root. |
| `GODSEYE_STATE_DIR` | Defaults to the data-directory path followed by `-state`; keeps private owner/process state outside PGDATA. |
| `GODSEYE_DATABASE_URL` | Selects the PostgreSQL driver. Use only a dedicated development database; startup applies control migrations. |
| `GODSEYE_GITHUB_WEBHOOK_KEY` | Private key for signed GitHub intake; no default is supplied. |
| `GODSEYE_BAO_ADDRESS` | Optional explicit loopback OpenBao origin; unset means unconfigured. See [service access](service-access.md). |
| `GODSEYE_BAO_MOUNT` | KV v2 mount, default `godseye`; the provider checks the exact compiled limited policy for that mount. |
| `NODE_ENV` | Startup refuses `production` while private remote admission is unqualified. |

Data and identity directories are protected before use. Shared roots and linked private-state entries are rejected. A permission or process-lock failure stops startup; it does not select a weaker identity mode. The PostgreSQL Compose profile remains optional, and real PostgreSQL multi-process behavior still needs qualification.

## Current journeys and API

The owner can register a project, inspect its two planned environment configurations, bind a repository, validate local configuration, inspect operation/audit history, manage owner keys/sessions and manage scoped service identities/slots at `/access`. These configuration actions do not provision infrastructure. The auto-deploy checkbox stores a preference only.

Private `/api/v1` routes require the authenticated fixed owner. Health and sanitized owner-session status are public local reads; the local administration endpoint requires separate filesystem-derived HMAC proof. `/hooks/github` uses its own raw-body HMAC authority. The passkey wire routes under `/api/auth` are an explicit allowlist; public signup, password/social login and public native session inspection are unavailable.

Project creation, repository updates and local operation requests require `Idempotency-Key`. Repository changes and local validation also require `expectedRevision`. Schema-invalid input returns 422, malformed JSON returns 400, request collisions/stale revisions return 409 and unavailable infrastructure returns 503. Errors expose safe codes/request IDs rather than storage connection details.

The [control foundations](foundations.md) describe immutable plans, scoped references, qualified-adapter admission, durable execution, grants, budgets and anchored audit export. Their owner-only HTTP surface never exposes worker claim/finish/heartbeat authority. The internal control client is separate from the [application SDK and backend](application-backend.md) introduced in E04.

The [service-access guide](service-access.md) documents `bao:install`, public `access:policy`, and the offline private `access:provider-auth`, `access:stage` and `access:issue` commands. Stop the controller for private commands: they acquire its state-directory lock. Values enter through stdin and proofs are written to private handoff files, never browser responses. Normal startup registers no target transition adapter, so stage/activation availability must remain distinct.

At `/infrastructure`, the owner can declare desired topology, refresh native local-controller metadata and prepare a digest-pinned workload for a registered environment. The [infrastructure guide](infrastructure.md) documents the API `1.2.0` routes, revision/idempotency/freshness rules, immutable preparation and allocation/reconciliation states. Default startup has no qualified execution provider. A local-PC observation is not AX41 inventory, and a compiled preparation is not a running cell.

At `/databases`, the owner can prepare full/differential backups, archive checks and a restore to a new held environment using [control API `1.4.0`](postgresql-recovery.md). Default recovery execution remains unconfigured. Physical recovery does not activate applications/jobs/agents or automatically combine the separate E04 application file/auth/config recovery set; all-service activation remains blocked. The separate signed-tool lab runs with `bun run postgres:install`, `bun run postgres:recovery:install` and `bun run test:recovery:lab`. Its eleven-case local result does not qualify off-host recovery, hard quotas or production RPO/RTO. Independent recovery backend/UI reviews and selected mutation checks passed; final local unit/integration (596/596), browser (24/24), static and build/smoke checks passed.

At `/pipelines`, [application delivery](application-delivery.md) exposes API `1.5.0` policy creation/revocation, source synchronization, exact build/release/rollback preparations, admissions, preview cleanup and history. Confirm the owner passkey before mutations. The repository auto-deploy preference grants no authority; automatic delivery requires a separate active exact expiring policy and qualified private providers. Default startup supplies neither source nor executor, so local configuration does not connect GitHub, run repository code or deploy an application. The scheduler starts but remains idle without them. Recovery-held environments stay ineligible.

Use `bun run test:delivery:lab` for the trusted disposable managed-provider fixture (also included in default Vitest). Its focused twelve-case/4.21-second result proves actual local byte/process/loopback behavior only. The combined run passed 851/851 unit/integration cases across 58 files in 569.99 seconds wall time and 28/28 browser journeys in 163.404282 seconds (JUnit), including four delivery journeys. Static checks (320 linted files, types and API `1.5.0` consistency), build/smoke and frozen backend/UI source reviews passed. The narrow responsive-CSS follow-up passed four delivery browser journeys in 58.082768 seconds with refreshed desktop/mobile visual checks; all thirteen selected delivery mutations were killed with green baseline/restored checks and unchanged original sources. Final build/smoke passed after the stylesheet change. In particular, real GitHub App/Jenkins/Coolify/isolated guest/registry/DNS-TLS remain unqualified.

## Verification

The E04 application runtime has a separate application identity/store/listener. Project detail pages prepare its desired per-environment settings through owner API `1.6.0`; this form never starts a runtime or receives private material. The [application backend guide](application-backend.md) distinguishes local runtime composition, application API `1.0.0`, actual verification and remaining hosted qualification.

Its full browser regression passed 31/31 journeys in 181.393319 seconds (JUnit); thirteen selected M74–M86 mutants were killed with green baseline/restored checks and unchanged original sources in 257.091 seconds. Canonical builds, final affected backend rebuild, actual compiled-template HTTP/restart and SDK-consumer checks, lint (381 files), types, control OpenAPI `1.6.0` consistency, frozen source reviews and 62 local trace links passed. Final combined unit/integration verification passed 972/972 cases across 72 files in 751.83 seconds (Vitest; 752.705 seconds for the whole command). The private repository's [Git workflow](git-workflow.md) keeps ongoing implementation on `develop` and release publication on `main`.

```sh
bun run bao:install
bun run check
bun run contracts:check
bun run build
bun run smoke:built
bun run playwright install chromium
bun run test:e2e
```

Vitest uses real isolated PGlite stores. The OpenBao provider cases require the pinned executable installed by `bao:install` and start their own disposable non-dev Raft instance; they do not initialize a personal store. Browser tests perform real WebAuthn registration/authentication through virtual authenticators, with separate runtime data/identity directories. Virtual tests do not create a passkey for the real owner's account. Reports remain under ignored `artifacts/`.

The preceding service-access continuation passed 215 unit/integration cases and sixteen browser cases (five console, two service-access and nine native owner-authentication journeys). Console/access browser projects use separate application processes, temporary data/state and ports. See the [verification strategy](../../tests/STRATEGY.md) for exact timings, mutation/scanner scope and outstanding infrastructure gates.

That 215/16 result is the preceding baseline. The infrastructure continuation's final `bun run check` passed 325/325 cases across thirty files in 244.70 seconds, with lint, types and generated-contract consistency; build and built-API smoke also passed. Thirty-one selected mutations were killed with green baseline/restored checks and unchanged original sources. The final browser run passed 18/18 journeys in 73.155046 seconds (JUnit); the explicit laboratory alias passed 4/4 checks in 17.027 seconds (17.26 seconds total). All 26 local traceability criteria passed. Fresh source review passed after four confirmed defects were fixed and independently reverified; a scoped French UI-copy review passed separately.

The gVisor laboratory is a separate explicit suite on a compatible Linux/user-namespace environment or the existing Ubuntu WSL distribution:

```sh
bun run runsc:install
bun run test:infra:lab
```

Its four recorded Windows/WSL checks pass, but `ignore-cgroups` excludes CPU/RAM/PID and persistent-quota qualification. The default unit command explicitly excludes this lab file, and the explicit command fails on unavailable prerequisites rather than skipping or weakening isolation. See [infrastructure preparation](infrastructure.md) for the full proof boundary.

`bun run check` includes generated-contract consistency. Run `bun run contracts:generate` after deliberately changing the shared HTTP schemas, review the generated OpenAPI diff, then run `bun run contracts:check` to detect drift.

`bun run smoke:built` starts the built API against independent local state and checks health. `bun run test:mutation` is a separate curated mutation experiment; its selected results are not an exhaustive mutation/coverage score. The [verification strategy](../../tests/STRATEGY.md) records the tested slices and remaining release families.

## Dedicated-server transition

No dedicated server was accessed or changed by this local stage. The reported Ubuntu 26.04 reset, AX41 inventory and Rescue access remain to verify. The later supported Debian/Proxmox installation must qualify hardware, dual-stack networking, sandbox/data boundaries and recovery before providers can execute. Owner passkeys for localhost are local-development credentials; deployment at a different management origin requires its own qualified enrollment/recovery process.
