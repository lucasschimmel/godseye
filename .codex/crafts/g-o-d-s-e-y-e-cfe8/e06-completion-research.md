# E06 autonomous workers and external persistence — 2026-11-12

Mode: SCOUT --docs, official-source digest; sequential research, no comparison or external deployment. Parent owns SYNAPSE publication. Existing Inngest research remains applicable; this is its scoped completion delta.

## Verdict

Pinned Inngest 1.52.0 genuinely selects external PostgreSQL for configuration/history and Redis for queue/run state when BOTH URIs are supplied. Require both in the external profile; never silently fall back to embedded stores. The event ingress stream remains in-memory, so retain the application outbox until durable Foundation receipt and replay the same domain event ID after engine failure. [1–4]

Local qualification is feasible without Docker/global installation: existing signed PostgreSQL18.6 binaries plus newly signed/extracted Redis8.0.5 through Ubuntu26.04 WSL, called by Windows Node24/native Inngest. This is process-level persistence evidence, not Docker/VM/network containment qualification.

## Findings

- Exact flags/env: `--postgres-uri` / `INNGEST_POSTGRES_URI`, `--redis-uri` / `INNGEST_REDIS_URI`. Pool `--postgres-max-open-conns` must exceed1; max idle cannot exceed open. Four engine listener ports remain HTTP/gateway/gatewayGRPC/executorGRPC. Keep `queue-workers>=5` (10 bounded default; prior actual scanner liveness finding). [1,2]
- External PostgreSQL connects using pgx, pings and applies embedded Goose migrations on startup. Workflow schema ownership/DDL rights are needed; cluster superuser is unnecessary. Apps/functions/events/history/function runs/finishes/traces and worker connection metadata reside in the workflow database. Distinct role+database per environment, ideally per-cell process as existing project policy prescribes. [3,4]
- One supplied Redis URI feeds sharded/unsharded state+queue clients, constraints/batches/cancellation, Connect state and separate realtime publisher/subscriber clients. Embedded miniredis is selected only when URI is empty. With BOTH external URIs present, ordinary workflow persistence does not need a SQLite volume. Do not enable experimental DuckDB dual-write. [2]
- `config.Dev` still configures an in-memory EventStream. `/e` acceptance is not a durable domain receipt, even with external queue/history stores. Existing application transactional outbox + immutable domain ID + durable Foundation receipt is required to repair the acceptance-to-run scheduling crash window. [2,5]
- Redis AOF writes replay at restart. `appendfsync everysec` has an acknowledged-write loss window; use `appendfsync always` for strict local crash evidence and state the chosen RPO explicitly. `maxmemory-policy noeviction` makes capacity failures visible instead of silently deleting job state. Persistent AOF directory must survive process replacement. [6]
- Connect is optional transport, not prerequisite for process autonomy. Existing signed HTTP serve worker can run independently. If Connect is selected, SDK4.26.2 supports `apps`, `instanceId`, `maxWorkerConcurrency`, `gatewayUrl`, `handleShutdownSignals`, `close`/`closed`/state. Node24 supports built-in WebSocket. SDK docs require externalizing `inngest` and `inngest/*` when bundling, retaining package worker-thread runner assets. Self-hosted explicit gateway uses `ws://<private-engine>:<gateway-port>/v0/connect`. [7, installed SDK types]
- `--poll-interval` refreshes serve app configurations; default start0 disables polling. Dynamic GODSEYE catalog reconciliation must still compare authority/hash and cannot permit old paused/deleted functions to mutate. Startup manual SDK PUT is the verified OSS registration path; v2sync501 from prior actual lab remains applicable. [1, prior dossier]

## Local tools and evidence

Read-only host inventory 2026-11-12:

- Docker CLI present, daemon named pipe absent; no container was started.
- Ubuntu26.04 WSL x86_64, non-root uid1000, Python3/gcc/make/curl/tar present. No global Redis/Node/Go command was installed.
- Existing project cache `artifacts/tools/postgres/18.6/root`; reuse `tests/pg-lab-host.ts` and private socket or authenticated loopback topology. PostgreSQL installer already verifies Ubuntu signed metadata.
- Added `scripts/install-redis.py` and `.mjs`: extraction only into `artifacts/tools/redis/8.0.5/root`, no apt/sudo/service/system change. Pinned package `5:8.0.5-1ubuntu0.1` from Ubuntu resolute-updates/security universe (patched release, rather than unpatched base8.0.5-1). Extract `redis-server`, `redis-tools`, `liblzf1`; current WSL has jemalloc/atomic/SSL/systemd/stdC++ dependencies.
- Acquisition verifies `gpgv` using Ubuntu archive keyring, signed Packages.xz SHA256+size and each .deb SHA256+size; exact Redis package pin fails closed on metadata drift. Fresh owned staging extraction; existing tools compared with verified bytes rather than overwritten. Cache leaf links/hardlinks and extraction escapes refused.
- Exact native binary `<cache>/root/usr/bin/redis-server`; environment `LD_LIBRARY_PATH=<cache>/root/usr/lib/x86_64-linux-gnu`. `node scripts/install-redis.mjs` first acquisition passed exit0 and reports actual Redis8.0.5 jemalloc build. Reverification after staging hardening belongs to parent final gates.
- Native harness owned by GAUNTLET satellite: separate temp data dirs/auth/loopback ports, restart preserving AOF and PG, foreign-cell negative probes, controller HTTP process absent. Never print generated auth/DB URIs or private config contents.

## Qualification criteria / remaining boundaries

Prove actual authenticated PostgreSQL tables are populated and Redis contains live run state, then resume a pending/durable step after engine kill and service restart with original directories. Prove already completed effects are not repeated, stable source event replay does not duplicate jobs, denied/HOLD/epoch fences remain enforced, and dashboard/API can be stopped while cell worker executes. An engine health200 alone is insufficient. Host-wide power failure, deployed VM/Docker limits, resource contention and coordinated cross-service disaster recovery remain outside native local evidence.

## Sources (accessed 2026-11-12; independence group upstream project per product)

1. [Inngest1.52 startup flags](https://github.com/inngest/inngest/blob/v1.52.0/cmd/start/cmd.go), [startup validation](https://github.com/inngest/inngest/blob/v1.52.0/cmd/start/start.go).
2. [Pinned devserver external clients/adapter wiring](https://github.com/inngest/inngest/blob/v1.52.0/pkg/devserver/devserver.go).
3. [Pinned PostgreSQL migration/open implementation](https://github.com/inngest/inngest/blob/v1.52.0/pkg/db/postgres/migrations.go).
4. [Pinned PostgreSQL schema](https://github.com/inngest/inngest/blob/v1.52.0/pkg/db/postgres/schema.sql), [adapter](https://github.com/inngest/inngest/blob/v1.52.0/pkg/db/postgres/adapter.go).
5. [Default config](https://github.com/inngest/inngest/blob/v1.52.0/pkg/config/config.go), [messaging](https://github.com/inngest/inngest/blob/v1.52.0/pkg/config/messaging.go).
6. [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/).
7. [Inngest Connect worker lifecycle/configuration/bundling](https://www.inngest.com/docs/durable-execution/deploying-functions/connect).
8. [Inngest self-hosting](https://www.inngest.com/docs/self-hosting): doc prose still says database support soon while flags and implemented PostgreSQL adapter already work; pinned source and actual execution govern.
9. [Ubuntu signed security index](https://archive.ubuntu.com/ubuntu/dists/resolute-security/InRelease), [universe index](https://archive.ubuntu.com/ubuntu/dists/resolute-security/universe/binary-amd64/Packages.xz), [Redis patched tools](https://archive.ubuntu.com/ubuntu/pool/universe/r/redis/redis-tools_8.0.5-1ubuntu0.1_amd64.deb).

## Method

Cached prior research reused; official docs + tagged source + installed SDK declarations checked. Live Ubuntu package metadata checked for base/updates/security, then installer cryptographically verified acquisition. No engine/process persistence experiment by this satellite; parent/test satellite own actual runtime proof. Pure docs digest skips separate FABER research verdict; implementation and installer remain subject to final independent security review.
