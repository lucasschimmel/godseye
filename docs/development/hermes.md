# Local Hermes installation and profile preparation

This historical E07 setup checkpoint prepares Hermes and its configuration. It does not enable agent
runs. The dedicated server is unchanged. The owner selected the OpenAI API and three
roles: `operations`, `security`, `research-marketing`.

## Install and inspect

Requirements: Node.js 24, Bun and an existing non-root Linux x64 environment.
Windows uses the existing Ubuntu WSL distribution; select another with
`GODSEYE_HERMES_WSL_DISTRO`.

```powershell
bun run hermes:install
bun run hermes:install status
bun run hermes:install smoke
bun run hermes:local catalog
bun run hermes:local profiles
```

The installer verifies Hermes `0.23.1`, commit
`3b421578588243f920886e6fe79a6faa87ea026e`, and CPython `3.14.9`. It builds a minimal
sealed PM environment from upstream's frozen lock. Files stay in native ext4 storage
under the account's `.local/share/godseye-hermes/<workspace-sha256>/tools/0.23.1`.
The workspace is canonicalized before hashing. No global package, alias, account
Hermes home, system service or dedicated-host setting changes.

`status` verifies provenance and immutable files. `smoke` checks actual upstream
imports/configuration/version with socket and DNS operations refused inside its
test process. It does not contact OpenAI or instantiate an agent. Incomplete
installations remain unavailable. Recognized interrupted staging is retained for
inspection and safe retry; foreign, linked or changed installations are refused.

## Prepare a scoped profile

Supply intended project and environment UUIDs explicitly:

```powershell
bun run hermes:local prepare --project PROJECT_UUID --environment ENVIRONMENT_UUID --role operations
bun run hermes:local prepare --project PROJECT_UUID --environment ENVIRONMENT_UUID --role security
bun run hermes:local prepare --project PROJECT_UUID --environment ENVIRONMENT_UUID --role research-marketing
bun run hermes:local inspect --profile PROFILE_UUID
bun run hermes:local verify --profile PROFILE_UUID
```

Replace uppercase placeholders; they are not accepted literal identifiers. Optional
`--model OPENAI_MODEL_ID` records a model choice; otherwise it stays unconfigured.
The CLI never requests, reads or prints a provider key and does not test connectivity.

First preparation selects its immutable revision. Different subsequent configuration
stages a revision; identical input returns the same profile/revision. Every declared
project/environment/role has an independent home, identity and copied skill files.
The profile UUID is deterministic for this workspace and scope. Views explicitly show
`binding: declared-local`, `runEnabled: false`, `admission: not-qualified` and
`providerConnected: false`. Existing project ownership, recovery holds, task grants
and budgets are not checked or issued by this administrative setup CLI.

Profiles live in the sibling native `profiles` directory. No real project or owner
data is opened, created or migrated. Qualification fixtures use disposable scopes.
The returned `home` is explicitly `homeKind: immutable-setup-snapshot`, with
`runtimeHome: null`. Do not start upstream against that snapshot: even config imports
create authentication locks and configuration backups. Native qualification copies
the generated files to a disposable mutable probe home and verifies the original
snapshot remains intact. Materializing private mutable run homes under task ownership
belongs to the later execution integration.

## Promote and return to a retained revision

```powershell
bun run hermes:local promote --profile PROFILE_UUID --revision TARGET_SHA256 --expected-revision CURRENT_SHA256
```

Use exact values from `inspect`. Both snapshots are verified before expected-current
CAS replaces the pointer. Stale expectations are refused. Rollback uses this same
command with an earlier retained target; newer snapshots remain intact. Selecting
a setup revision grants no execution power. Limits are 64 profiles and 32 retained
revisions per profile, plus bounded interrupted staging. Automatic purge is absent.

An OS lock excludes concurrent setup writers and releases on death without stored-PID
killing. Missing targets are refused by read-only verification without creating
directories. Pre-publication failures preserve the old pointer. A post-publication
directory-sync failure reports uncertainty and retains the valid pointer for explicit
inspection; never assume the old revision is still active after that failure.

## Version skills

The reviewed [catalog](../../infra/hermes/catalog.json) supplies one small
`godseye-context@1.0.0` bootstrap skill for all roles. Operational bundles belong to
E09. Community or learned skills are not imported here.

Add a semantic-version directory under `infra/hermes/skills`, review its documents,
and update the catalog's exact version, provenance, Hermes compatibility and SHA-256
entries. Text hashing normalizes CRLF to LF. Files must all be declared; executable
assets, aliases, hardlinks, changed hashes and unreviewed files are refused.
Re-prepare desired profiles, inspect the revision, then explicitly promote it.
Retained snapshots keep their exact documents after catalog updates.

Prepared configuration opts out of bundled seeding, external/project discovery,
automatic loading, learning/curation, memory, inline shell and template expansion.
CLI/API toolsets are empty; MCP servers and the web application are disabled or
unconfigured. The wrapper exposes no chat, gateway, scheduler or command passthrough.

## Agent Center continuation and remaining E07 gates

The [Agent Center guide](agent-center.md) describes the later owner/project binding,
private execution environment, mutable task homes, durable Runs correlation, budget
admission and cancellation/unknown-run reconciliation. These are provided by the control
server integration; this setup wrapper still exposes no command passthrough or execution.
The [chat guide](hermes-chat.md) records later streaming, artifacts and exact existing-plan
inbox support. The [tools guide](hermes-tools.md) records the later opt-in isolated trusted
data catalog. Native paused clarifications, arbitrary shell/build disposable tools and
coding runners remain pending. WSL homes do not qualify hostile-code containment.
Docker/gVisor/VM, networking, resource and recovery release gates remain unchanged.
Provider usage is not a reconciled invoice; E08 retains that reporting responsibility.

References: [installation](https://hermes-agent.nousresearch.com/docs/getting-started/installation),
[profiles](https://hermes-agent.nousresearch.com/docs/user-guide/profiles),
[skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills),
[OpenAI API identities](https://developers.openai.com/api/docs/guides/api-keys).
Pinned source governs the qualified configuration.

The later trusted-data-tool continuation has passed its local verification gates;
see the [tools guide](hermes-tools.md#measured-local-evidence) for final measured
results and current runtime availability. This installer checkpoint still grants
no task execution by itself.
