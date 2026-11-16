# Local Agent Center

The owner console at `/agents` binds Hermes profiles to real projects and
environments, admits bounded conversation tasks and retains their results. This
extends the [installation checkpoint](hermes.md); the old administrative setup
snapshots remain immutable and are not live task homes.

The later [advanced chat guide](hermes-chat.md) adds multi-turn context, real streaming,
immutable text artifacts and exact existing-plan owner approvals. The one-task boundary
below remains the unit of model admission; its earlier polling-only scope is historical.
The latest [approved orchestration](agent-orchestration.md) adds bounded new-plan
proposals, exact approval and platform-owned clarification through API `1.14.0`.

## Prepare the local runtime

```powershell
bun run hermes:install
bun run hermes:runtime:install
```

Windows uses the existing non-root Ubuntu WSL distribution. The second command
builds a separate frozen execution environment for the pinned Hermes Runs API.
It adds the upstream HTTP dependency family without changing the previously
verified minimal installation. The upstream extra is named `sms`, but no SMS
integration is configured or enabled. No global package or system service is installed.
An incomplete or modified installation is refused; retained partial files are
not adopted as a qualified runtime.

## Bind a profile

Sign in to the local owner console, open **Agent Center**, and confirm the owner
identity. Select a project, environment and role, then create a profile. The
available roles are operations, security and research/marketing. Recovering,
expired, suspended and quarantined scopes cannot admit ordinary tasks.

The initial allowlist contains `gpt-6-luna`, selected for the owner's request for
an inexpensive OpenAI model. On 2026-11-13, the documented Standard text prices are
$0.10 per million input tokens and $0.50 per million output tokens. These prices
are reference data, not an account entitlement or billing guarantee. See
[model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna)
and [current pricing](https://developers.openai.com/api/docs/pricing).

Only `godseye-context@1.0.0` is admitted, with its exact catalog digest. Role,
project and environment are immutable binding identities; changing model/limits
requires the current revision and no unresolved task. Scope revisions invalidate
stale profiles, which must be explicitly reconfigured. Pausing blocks admission;
it is not a substitute for stopping an existing task.

## Configure private OpenAI material

The owner HTTP API never accepts an API key, provider URL, filesystem path or
arbitrary toolset. Explicit typed tool policies/grants follow the [tools guide](hermes-tools.md). Local bootstrap material uses a private scoped binding file. Obtain the
project/environment UUIDs from **Identifiants du périmètre** in the profile card.
Enter the API key privately on this computer; never paste it into chat, a task,
a command argument, source control or a browser form.

Example masked PowerShell input, replacing the UUID placeholders:

```powershell
$taskHermesKey = Read-Host "OpenAI API key" -AsSecureString
$taskHermesPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskHermesKey)
try {
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskHermesPointer) |
    bun run hermes:bind --project PROJECT_UUID --environment ENVIRONMENT_UUID --role operations
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskHermesPointer)
  $taskHermesKey.Dispose()
}
```

Repeat for each exact intended scope/role. The helper accepts one key on stdin,
protects `.local/hermes-access/bindings.json` with the existing native private-file
guards, and prints only scope metadata and the file path. It replaces only the
selected binding and preserves other scopes. Aliases, hardlinks and concurrent
changes are refused. Writes use a flushed stage and atomic rename; Windows host
power-loss durability is not qualified by this local helper.

Set `GODSEYE_HERMES_BINDINGS_FILE` to that absolute path in the process launching
`bun run dev`, then restart the local API. This process environment value is a
path, not the key. Without a matching binding, profile metadata remains available
and launch is explicitly unavailable. Editing the binding file requires restarting
the API. Deployed OpenBao material injection and provider rotation remain separate
qualification work.

## Launch and follow a task

Select a profile in **Nouvelle tâche**. Configure the project's budget explicitly
if needed; it is shared with Foundation operations and is never increased by a
task launch. Defaults reserve at most $0.01 per task, with one request/turn,
1,024 output tokens and a 120-second deadline. Profile bounds are at most 2,048
output tokens, 300 seconds and $0.10 reserved. Input is bounded to 8,192 UTF-8 bytes.

Submit a text request. The API persists the exact profile snapshot, task input,
idempotency receipt and submission intention, then uses the existing Foundation
plan/queue, grant, heavy-task admission and budget reservation. No new scheduler
or visual automation system is introduced. The controller worker runs independently
of the browser. Closing the browser does not cancel a task; controller shutdown
protectively stops its owned runtimes and preserves uncertain history for inspection.

The Agent Center polls bounded private views every three seconds. It distinguishes
queued, running, stopped, failed, completed, cancelling and uncertain states.
Task details retain bounded state history and the final plain-text result. Missing
usage stays unknown. The current budget accounting is conservative reservation
accounting; it does not claim to reproduce OpenAI's invoice. E08 owns full price,
attempt and billing reconciliation.

One live or uncertain task retains each profile. Profile cards expose its active
task even when it is outside the latest 100 history entries. The local retention
cap is 500 tasks, 64 profiles and 100 state events per task. Automatic task purge
and long-term artifact export remain outside this checkpoint. The later chat guide
defines local conversations, draft artifacts and exact-plan owner approvals.

## Cancellation, uncertainty and restart

**Demander l’arrêt** is available to an authenticated owner without a new approval
or passkey step-up. An accepted stop is not a stopped executor. The profile,
budget and admission remain retained until physical stop is proven. Deadlines
and uncertain submission do not release actual-call capacity.

**Vérifier le résultat** performs read-only reconciliation against the retained
task identity. It never starts a new API host, renews execution grants or repeats
a model POST. The original provider identity and private runtime journal survive
controller restart. If the result cannot be proven, it remains uncertain.

Cancellation through the generic Foundation API and environment epoch revocation
also retain the logical stop. A later provider success cannot publish output or
restore task success after authority was revoked. Proven physical stop may still
settle the reservation and release the profile. A fresh task is a separate owner
request; never infer that a missing response made the old task disappear.

## Local execution boundary

Each admitted task materializes a separate private mutable home from exact verified
skill/configuration files. The original installation and setup snapshots remain
unchanged. A first-party lifetime wrapper hosts the actual pinned Hermes
`APIServerAdapter` Runs API directly. The general messaging gateway, session-authority
runner and unrelated watchers are not started. This API host has no general MCP, shell, browser, delegation, publication, memory or
skill-learning authority. The selected skill is explicitly preloaded and checked
before admission. Default tasks are conversation/draft tasks. The opt-in
[tools continuation](hermes-tools.md) adds only five fixed isolated data operations
with an explicit immutable task grant; native Hermes/model transport remain outside
that helper sandbox.

Hermes receives a scoped broker credential. The actual OpenAI material stays in
the first-party egress broker. That broker binds the model, output-token ceiling,
single durable physical attempt by default (or the explicitly granted finite tool loop) and deadline, authorizes immediately before I/O,
uses a fixed OpenAI HTTPS endpoint and refuses redirects and background retries.
Owned child handles and a parent-death channel govern cleanup; persisted numeric
PIDs are not kill authority. Native qualification uses an explicit programmatic
loopback model fixture, unavailable through HTTP or environment configuration.

The Python socket guard and separate homes are defense in depth, not a hostile-code
OS sandbox or host firewall. General tool execution/disposable guests, external
publication connectors, native canonical paused controls, coding runners, E09 operational skills and
dedicated-host networking/quotas/recovery remain pending. The dedicated server is
unchanged by this implementation.


## Measured qualification

The actual pinned Runs API completes a text task against a loopback model fixture,
rejects a tool-shaped model reply before dispatch, and cancels a held model request.
Each scenario records exactly one physical model request with the selected model,
reviewed skill, no tools and the output cap. Cancellation explicitly releases the
controlled upstream after requesting stop, then requires actual handler settlement
and retained stopped proof. Two read-only inspections perform no replay. This does
not establish instantaneous interruption of a remote OpenAI model or paid entitlement.
See the [test strategy](../../tests/STRATEGY.md#local-agent-center-continuation--2026-11-13)
for exact evidence and the remaining coverage boundaries.

## Task-scoped data-tool continuation

The [tools guide](hermes-tools.md) documents the optional local executor, operator
installation/bootstrap and profile ceilings. Select explicit rights and copied UTF-8
inputs for each task or chat turn. Defaults above remain one request/no-tools;
granted tasks instead permit at most four model POSTs and three calls under the
same total task cost reservation. Histories show call outcomes and cleanup state.
Unknown physical work retains capacity and cannot replay. After successful
nonrevoked settlement and physical stop, standalone outputs are bounded digest-verified
tool-journal snapshots, downloaded by the console as local `text/plain` Blobs. Chat
outputs additionally enter the immutable chat artifact store and its inert attachment
endpoint. This trusted catalog does not enable arbitrary shell/build tools.

This continuation's final local gates passed, including aggregate regression,
separate actual-native and browser cases, selected mutations, contracts/build/smoke
and independent reviews. The [tools guide](hermes-tools.md#measured-local-evidence)
records exact counts and scanner limits. Its current-availability section records
the unavailable WSL user manager; successful qualification does not start an executor.

## Separate repository coding tasks

The [coding runner guide](coding-runners.md) describes the separate local E07.S05
Codex/Claude Code section at `/agents`: immutable repository/commit preparations,
Foundation-backed admission, logical worktrees, patch/test-log downloads and
protective cancellation/reconciliation. Hermes profiles and tool grants do not
authorize these runners. Private API bindings and disposable KVM qualification
are separate; default startup remains unavailable. Both actual pinned CLI chains passed in Windows/Ubuntu WSL KVM against scripted
models; three actual Foundation/provider/controller/broker/KVM composition cases passed with only upstream HTTPS replaced by a trusted fixture; no paid request occurred.

Coding launch proposes an owner-editable $0.50 Codex/$0.10 Claude reservation,
preserves manual edits and requires fresh explicit admission; project budgets
and Hermes defaults are unchanged. The physically qualified adapter is
Windows/Ubuntu WSL2 only. Retained coding records preserve frozen source/image
and patch/log evidence; the live guest-RAM worktree/home is not resumable.

## Approved orchestration continuation

The [orchestration guide](agent-orchestration.md) adds local `/agents` plan composition,
exact recent-passkey approval/rejection, child observation, bounded clarification,
cancellation and read-only reconciliation through control API `1.14.0`. Plans freeze
current profiles/coding preparations and execute only through existing Foundation
authority. Successful current Hermes whole-output strict plan JSON can produce
pending proposals automatically or by owner import; it never self-approves.
Hermes orchestration children are model-only. Explicit dependency-output handoff is
bounded quoted inert context; repository code uses the separate coding KVM runner.
Answered clarification creates a newly reviewed pending remaining-effectful suffix
and retains completed evidence without replay. See the
[story table](../plan/v1-development.md#local-e07-orchestration--2026-11-14) for local
completion versus remaining native vendor, paid-provider, deployed host, E08/E09,
preview and connector qualification. Platform controls grant no broad native session
approval or automatic deployment/publication. Final orchestration verification is
recorded in the verification strategy.
