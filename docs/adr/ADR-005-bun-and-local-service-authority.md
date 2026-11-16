# ADR-005: Bun package management and local service authority

- Status: verified local implementation; server qualification remains pending
- Date: 2026-11-11
- Related decisions: [ADR-003](ADR-003-local-first-and-ci.md), [ADR-004](ADR-004-owner-authority-and-foundations.md)

## Context

The owner explicitly replaced pnpm with Bun and requested the next planned E02.S02 secrets/service-identity boundary while retaining local-only development. The existing owner passkeys and durable execution controls establish who may administer the platform; they do not yet establish which project/environment service may consume a particular value.

The accepted isolation contract requires separate runtime and migration identities, excludes controller/deploy/backup credentials from applications and builds, and derives credential scope from verified identity. OpenBao is the specified owner-operated provider. A local provider integration must not turn a dashboard identifier, an owner-looking request field or an arbitrary provider path into authority.

## Decision

Use Bun 1.4.4 for workspace dependency management, the committed text lockfile and script invocation. Keep Node.js 24 as the qualified application/test runtime. Use `bun run test` for the existing Vitest suite; this decision does not replace it with Bun's test runner or qualify the application on Bun's runtime.

Use the local service broker against OpenBao with deny-by-default project/environment/purpose scope. Each service identity binds one registered project, one environment owned by that project and one purpose: runtime, migration, deploy or backup. Non-runtime identities bind a worker ID and require actual short task authority. Verify identity before deriving provider paths. A service identity cannot authenticate as the owner or administer console routes.

Keep the dashboard and owner HTTP surface metadata-only. Material enters through an explicit trusted local operator channel and is delivered through a private broker handoff to an authorized consumer. Do not expose values through a reveal endpoint, process arguments, audit records, public errors, control-table plaintext or general agent environments. Local operator import may require stopping the controller and acquiring its existing state-directory lock; it must not open a live PGlite store concurrently.

Separate static runtime access from short task authority. A task redemption must validate the actual recorded FoundationEngine worker, scope, command, grant, lease, epoch/fence, cancellation and expiry. Recheck after provider I/O before delivery. A check at issuance alone is insufficient.

Treat rotation as a controlled service transition. Stage a replacement, then require a qualified consumer adapter to establish the connection transition and old upstream-access revocation. A KV version increment or owner checkbox is not proof of D05. Persist pending/unknown effects and reconcile provider evidence before retry. After an uncertain revocation, do not assume the old access still works or route back blindly.

Use a disposable native OpenBao 2.7.2 loopback laboratory for actual ACL, CAS, revocation and seal/unseal/cold-restart evidence. Use persistent Raft storage because the pinned native binary does not support the proposed file backend. Keep fixture initialization/root/unseal material in memory and out of reports. Production private networking, off-host recovery and real database connection transitions retain separate qualification gates.

## Consequences

The package-manager change preserves the pinned dependency graph and existing Node-based checks. Contributors and CI need the pinned Bun version as well as Node.js 24. The migration used a checksum-verified project-local executable; the later local tool-manager installation made standard `bun` resolve 1.4.4 without changing the global/default selection.

The control plane retains references, revisions, scoped identity records and effect state while OpenBao retains material. A sealed or unavailable provider blocks new issuance, import, reads and rotation. It does not erase already mounted static application values; broker revocation and upstream credential revocation are separate states. Normal startup registers no target transition adapter. The controller's exact limited policy cannot write ACLs or mint provider identities; the operator supplies provider authority through a private offline command.

Provider and consumer qualification remains operational work. The default unavailable state cannot be treated as successful provisioning, and local Raft recovery does not demonstrate off-host recovery. Runtime/container/network isolation and the future hosted-project SDK remain separate stories.

## Verification

The Bun migration passed the existing 153-case Vitest suite, fourteen browser cases, generated-contract consistency, type checking, build and built-API smoke after a clean dependency installation. The frozen reinstall preserved the lockfile; the dependency audit reported zero advisories.

The final combined `bun run check` passed 215/215 cases across twenty files, including eight real native OpenBao cases for compiled scope denial, CAS, limited-policy validation, TTL/revocation, seal/unseal and cold Raft restart. Build and built-API smoke passed after the final security fixes. Eighteen selected mutation experiments and eighteen local traceability criteria passed; no exhaustive coverage score is inferred. The complete browser regression passed 16/16 cases in 53.8 seconds. Record detailed evidence in the [verification strategy](../../tests/STRATEGY.md), preserve the distinction from the [full V1 plan](../plan/v1-development.md), and use the [operator guide](../development/service-access.md) for exact commands. This ADR does not close E00 or certify a V1 release.
