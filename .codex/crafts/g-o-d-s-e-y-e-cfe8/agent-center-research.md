# Hermes Agent Center — pinned Runs API integration research

Date: 2026-11-13. SCOUT `--docs`; coverage: pinned wire and configuration/source
analysis only. Existing setup research is reused; no new provider/model call,
gateway launch, private-home read, global installation or server change occurred.
All Hermes source references below are at commit
`3b421578588243f920886e6fe79a6faa87ea026e` / release `0.23.1`.

## Verdict

Use the authenticated Runs API behind the owner controller, with independent
mutable runtime homes and private API credentials. Persist controller intent,
provider run ID, idempotency key and exact runtime identity before trusting a
terminal observation. Empty API toolsets support an initial model-only task.
Raw Runs API admission does not itself enforce a maximum output-token budget;
this needs a qualified trusted construction/egress seam before paid activation.

## Startup and identity

- Foreground CLI: `<venv>/bin/python -B <source>/hermes gateway run --quiet
  --external-supervisor`. This avoids system service installation; `gateway run`
  is the documented WSL/Docker foreground mode [2].
- Set an explicit private mutable `HERMES_HOME`, private child `HOME`/XDG roots,
  `HERMES_RUNTIME_DIR=<tool>/runtime`, `HERMES_INSTALL_ROOT=<tool>/identity`,
  `PYTHONNOUSERSITE=1`, `PYTHONDONTWRITEBYTECODE=1`,
  `HERMES_DISABLE_LAZY_INSTALLS=1`. Strip ambient provider/material/preload vars.
- API environment: `API_SERVER_ENABLED=true`, `API_SERVER_HOST=127.0.0.1`, explicit
  `API_SERVER_PORT`, private random `API_SERVER_KEY` (minimum 16 characters; use a
  cryptographically generated value). No CORS origin is needed for server-to-server
  owner-controller access [1][3]. Never expose that bearer key in owner API views.
- A profile's API credential participates in run ownership and idempotency scope.
  Retain it and the same runtime home through reconciliation; rotating it or
  creating a new home after a lost response can evade prior-run deduplication.
- `gateway.multiplex_profiles: false`, explicit only-API platform selection and
  `gateway.api_server.max_concurrent_runs: 1` prevent implicit profile aggregation
  and bound this narrow runtime's concurrent run count [3][4].
- A setup snapshot cannot be a live home: even config import writes `auth.lock`
  and configuration backups. Copy only exact verified recipe files to an owned
  mutable home. Retain immutable snapshot identity and digest separately.

## Exact Runs wire

All endpoints use `Authorization: Bearer <private-api-key>` [1][3][4].

| Request | Contract |
| --- | --- |
| `POST /v1/runs` | `{input: string, session_id?: string, instructions?: string, model?: string, provider?: string, model_options?: object}`; optional conversation/history/response chain exists but should not be exposed in initial strict controller schema. Returns HTTP 202 `{run_id, status: "started"}`. |
| `Idempotency-Key` | 1–255 visible ASCII bytes. Durable 24-hour ledger, scoped by API profile and credential. Exact replay returns the original ID and `Idempotency-Replayed: true`; changed payload returns 409 `idempotency_key_conflict`. |
| Fingerprint | Whole JSON body plus `X-Hermes-Session-Key`, canonicalized with sorted keys. Never change instructions/history while replaying admission. |
| `GET /v1/runs/{id}` | `{object:"hermes.run",run_id,status,created_at,updated_at,session_id?,model?,output?,error?,usage?,runtime?,pending_controls?,admission_id?,execution_generation?}`. Keep server-owned subset only. |
| `GET /v1/runs/{id}/events` | SSE; data objects `{event,run_id,timestamp,seq,...}` and numeric SSE `id`. Supply `Last-Event-ID` or `last_seq` to resume. Ignore `: open` / `: keepalive` comments. `replay.truncated` requires state refetch. |
| `POST /v1/runs/{id}/stop` | Empty JSON object; returns `{status:"stopping"}`. Work stays tracked until executor exits, then `cancelled`; stop receipt is not physical termination proof. |
| `POST /v1/runs/{id}/resolve-unknown` | Exact `{admission_id,execution_generation}`. Only canonical authority advertises this feature. Resolution acknowledges lost execution without replay and returns canonical terminal receipt plus run ID. Exact repeat safe; stale identity gives 409. |
| `POST /v1/runs/{id}/approval` | Canonical exact `{request_id:<prompt_id>,execution_generation,choice:"once"|"deny"}`; check pending current control and capability. No identityless/bulk decisions. |
| `POST /v1/runs/{id}/clarify` | Exact `{request_id,execution_generation,answer}`; resolves an existing waiting control, does not create a new model turn. |

Statuses include `queued`, `running`, `waiting_for_approval`, `stopping`,
`completed`, `failed`, `cancelled`, `interrupted`, and canonical `unknown`.
Gateway graceful shutdown persists interrupted before asking its agent to stop;
canonical owner restart mid-turn can instead yield nonterminal unknown. A timeout,
network loss, expired status or mismatched runtime is not permission to retry under
a fresh idempotency key. Preserve conservative controller uncertainty.

Terminal status retention is one hour (`_RUN_STATUS_TTL=3600`); unconsumed event
transport expires after five minutes. SSE backlog is 1000 and subscriber queue 256;
slow writes have a five-second deadline. A live run remains counted after stream
expiration. Controller persistence must outlive this provider transport [4].

Reported usage contains `input_tokens`, `output_tokens`, `total_tokens`,
`cache_read_tokens`, `cache_write_tokens`. `runtime` reports the actual served
provider/model and `route_source`, not merely the requested alias. Treat absent
usage as unknown; do not synthesize zeros or full billing closure [1][4].

## Exact skills and no-tools policy

`POST /v1/runs` has no consumed preload-skills field [4]. Explicit selected skill
loading can use a per-run mutable config `skills.auto_load:[exact-canonical-name]`
and preflight the upstream function:

```python
from agent.skill_commands import build_auto_load_prompt
prompt, loaded, missing = build_auto_load_prompt(
    task_id=controller_task_id, user_config=verified_config, home_override=runtime_home
)
# Require exact selected names, no missing, nonempty expected prompt before admission.
```

The helper otherwise logs/skips missing or disabled skills; it deliberately does
not fail the run. GODSEYE must enforce its own exact reviewed version/hash loading.
Do not use raw `build_preloaded_skills_prompt` without explicit active home scope;
it has no `home_override` argument [5].

`platform_toolsets.api_server:[]` is honored: the adapter resolves the configured
set and passes exact `enabled_toolsets=[]` to the real `AIAgent` [3]. Keep
`platform_toolsets.cli:[]`, `agent.coding_context:off`, no MCP/plugins, no bundled
seed, project/external discovery disabled, inline shell/template execution off,
memory/curator/title/background/compression off. Also set
`agent.environment_probe:false` because the default warms a subprocess environment
probe at agent construction [6]. A model-only run does not qualify shell/OS sandbox
isolation or future privileged tools.

## Provider and budget seams

The owner chose OpenAI; parent selected `gpt-6-luna` after current official model
research. This digest does not independently establish that model's price or
entitlement. Production should force the exact approved provider/model and official
HTTPS base URL, clear `fallback_providers:[]` and `fallback_model:null`, and avoid
user-controlled endpoint/route/history overrides [3][7].

`model_options` on Runs decodes reasoning and service tier; request-level
`max_tokens` is ignored. `_create_agent` does **not** pass an output token limit.
`AIAgent` constructor supports explicit `max_tokens` and `run_budget_seconds` [3][6].
A narrow trusted bootstrap factory/subclass can inject them while retaining the
real upstream engine; qualify the actual final wire and forbid tool widening.

Actual primary SDK construction sets `max_retries=0`; an older config comment that
says SDK retries are doubled is stale. Set `agent.api_max_retries:1` (minimum 1,
single attempt), `auto_recovery_cycles:0`, `run_budget_seconds:<bound>` and
`intent_ack_continuation:false`. Disable all optional auxiliary calls. Even then,
finite turn wrap-up, malformed/empty reply recovery and future client paths mean a
physical provider-request cap should be independently enforced if admission
reservation assumes an exact attempt count [6][8].

For deterministic native qualification, explicit `model.api_mode:chat_completions`
is honored for the direct OpenAI transport. The pinned provider resolver expands
the `openai` alias to internal `custom` (`runtime_provider_custom.py:652–666`);
that label does not authorize arbitrary endpoints. The local
fixture can use `base_url:http://127.0.0.1:<port>/v1` with a fake model response;
production must not expose that arbitrary-endpoint capability to the owner UI.
This exercises the real model client without paid or external calls [7].

## Sources

Single independence group: authoritative NousResearch pinned source plus current
official API documentation. Source inspected from verified local installation;
website opened on 2026-11-13 to check continued availability. No broad web search.

1. [Official API server guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server).
2. [Foreground gateway CLI](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/hermes_cli/subcommands/gateway.py).
3. [API adapter and agent creation](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/gateway/platforms/api_server.py).
4. [Runs admission/control/events](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/gateway/platforms/api_server_runs.py).
5. [Explicit skill prompt loading](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/agent/skill_commands.py).
6. [Agent construction/config limits](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/agent/agent_init.py).
7. [Provider resolution/modes](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/hermes_cli/runtime_provider.py).
8. [Actual primary SDK construction](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/agent/agent_runtime_helpers.py).

## Remaining research/qualification

Native qualification has now started real gateways and admitted correlated Runs
against a deterministic loopback OpenAI fixture, without paid calls. The original
minimal installation lacks `aiohttp`; a separate immutable execution environment
(`execution/0.23.1-api-v1`) was therefore built from a verified source copy using
the pinned upstream `sms` extra (`aiohttp==3.14.5` and its dependencies), without
activating an SMS adapter. The original core source/venv manifest remains intact.

The first-party bootstrap injects bounded agent construction, suppresses all tool
dispatch, and restricts Python socket use to its scoped egress broker. The broker
owns the real provider credential, independently enforces one physical attempt,
the fixed OpenAI endpoint/model, output and conservative input monetary bounds,
and rejects tool-shaped responses before Hermes receives them. This is a
model-only local execution boundary, not an OS sandbox for hostile Python code.

The positive native qualification passed on 2026-11-13: actual private Runs
admission through the native agent and the loopback model fixture returned
`succeeded`, a stable vendor run ID, the expected response and physical
`stopped:true`. Seven authority checks were observed. The fixture received
exactly one request with `gpt-6-luna`, no tools, output cap 1024, `n:1`, streaming
enabled and the reviewed skill body present. No paid provider call occurred.
The actual broker plus installed OpenAI 2.54 streaming SDK also completed an
isolated fixture round trip. The dedicated bootstrap hosts the unchanged first-party
`APIServerAdapter` directly: generic messaging `GatewayRunner` session authority
and background turn runners are unnecessary for this model-only task scope.
This preserves the upstream Runs API, durable idempotency, authentication and
native agent engine while narrowing the execution surface.
Do not treat fixture evidence as real OpenAI entitlement or paid activation.

The broker retains its owner until the actual request handler settles, bounded
by its original network deadline plus cleanup allowance. A protective stop
acknowledgement is not physical completion, and remote provider billing
termination is never inferred from closing a local stream. Unknown outcomes
retain their conservative reservation and never trigger a new Runs POST.

Two additional native qualifications passed against the same frozen adapter:
an unsolicited model tool-call response was refused with the exact safe
`unauthorized-tool-reply` category, one physical request, stable run identity,
`failed` and `stopped:true`; a model request held before response headers was
protectively stopped, then the controlled fixture was released. The retained
owner joined its handler and reported `cancelled` with `stopped:true`; two later
read-only inspections did not replay the model request. These tests establish
local process/handler settlement, not remote OpenAI cancellation or an OS sandbox.
