# Hermes advanced chat: pinned protocol and narrow implementation seam

Date: 2026-11-13. SCOUT --docs for CRAFTS. Pin: Hermes 0.23.1,
commit `3b421578588243f920886e6fe79a6faa87ea026e`, CPython 3.14.9.
Coverage: source/doc inspection; no model call, server launch, private journal/key
read, installation or git mutation. Source was located read-only with
`scripts/install-hermes.py:29 resolve_root(workspace, False)` and inspected only
under its `source` directory. Sequential source extraction; official site and API
guide browsed. Existing bus research reused as cache. This file is the requested
repo context-bus dossier; no additional vault publication was requested.

## Verdict

Real native incremental text already exists as Runs `message.delta`. The local
egress broker currently buffers the entire upstream SSE response and must instead
validate each complete bounded frame before releasing text. Keep all generic
tools denied. Implement conversation history and typed text artifacts/proposals
as controller-owned data, with action proposals inert until separately approved.

The current dedicated `APIServerAdapter` has **no session authority**. Canonical
approval/clarification schemas described in earlier research are not the actual
host's available authority. Do not widen the bootstrap to `GatewayRunner` merely
to obtain those controls: that imports unrelated execution surfaces.

## Exact Runs stream

References below are source file/line numbers at the pin; URL root:
https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/

- `gateway/platforms/api_server_runs.py:1256-1346`: authenticated
  `GET /v1/runs/{run_id}/events`; ownership required before opening. Same private
  bearer identity as admission. Another scope receives not-found, not another
  run's events (`1212-1246`). Auth uses constant-time byte comparison
  (`api_server.py:1413-1435`).
- SSE is `id: <seq>\ndata: <JSON>\n\n`; JSON is
  `{event,run_id,timestamp,...,seq}`. SSE event-name is not required: dispatch by
  JSON `event` (`api_server.py:195-205`, Runs `224-226`, `1294-1297`).
- `message.delta` adds `{delta:string}` (`1073-1077`),
  `message.interim` adds `{text,already_streamed:boolean}` (`1079-1087`). Do not
  append interim text a second time when `already_streamed` is true.
- Terminal `run.completed` includes `{output,usage,runtime,...}`; failure/cancel
  use `run.failed`, `run.cancelled`; shutdown can yield `run.interrupted`.
  Exact terminal outcome comes from run status/result, never stream EOF or text
  presence (`1089-1100`, `1150-1185`). Native executor text callback is supplied
  to actual agent construction (`1140-1147`).
- Other native events: `tool.started {tool,preview,tool_call_id?}`;
  `tool.completed {tool,duration,error,tool_call_id?,preview}`;
  `reasoning.available {text}`; subagent lifecycle. Tool preview redaction is
  upstream best-effort. Do not expose raw arbitrary vendor events or reasoning
  to the owner stream (`140-157`, `368-400`). Under this policy any tool event
  is a refusal/diagnostic, not a new permission.
- Sequence begins at 0; every queued entry increments it, including the terminal
  sentinel (`164-202`). `Last-Event-ID` takes precedence over query `last_seq`;
  replay emits entries strictly greater than cursor. Native invalid cursor falls
  back to -1; controller should reject malformed cursors instead (`1277-1282`).
- Backlog 1000; subscriber queue 256 plus replay headroom; slow-write timeout
  5 seconds; overflow disconnects only that subscriber. No model replay follows
  a reconnect (`160-202`, `1285-1292`, `1332-1345`).
- First frame `: open`; idle `: keepalive` (10 seconds); terminal
  `: stream closed`. Comments carry no data and are not terminal proof.
  `replay.truncated` has `{oldest_retained_seq,requested_seq?}` and no numeric
  event id/seq; refetch authoritative persisted state rather than concatenate an
  incomplete stream (`1303-1337`). Native retention is transport-only; use the
  controller's durable events/cursor for browser replay.

## Conversations and history

- `POST /v1/runs` accepts `conversation_history:[{role,content}]` in addition to
  string `input`. Upstream coerces role/content to strings and does not enforce
  our intended role allowlist (`api_server_runs.py:493-530`): strict controller
  validation is essential.
- Nonempty supplied history wins over response chains and persisted session
  history. Session precedence is body session_id > response-chain session >
  declared `X-Hermes-Session-Key` conversation > newly generated run ID.
  Explicit/chain session never rebinds a different header (`801-875`).
- Current helper constructs a fresh private home per task and passes unique
  `session_id=request.correlationId` (`scripts/hermes_gateway.py:160-169`). Thus
  UI conversation IDs alone cannot recover native earlier-turn context. Narrow
  solution: controller assembles bounded previous user/assistant text and passes
  it as `conversation_history` on this real Runs admission. Each turn remains one
  separately reserved, scoped task with no hidden extra paid call.
- Bind digest of the entire admitted history into native immutable request
  identity; current `scripts/hermes_gateway_state.py:50-55` hashes only input.
  Do not let inspect/retry mutate the conversation payload. Current broker
  `MAX_MESSAGES=8` and raw byte/conservative reservation checks must remain
  effective (`scripts/hermes_gateway_broker.py:55-80`). Choose a documented
  bounded history window and surface truncation rather than silently drop it.
- Native session message list exists at `GET /api/sessions/{id}/messages`,
  max500 entries, offset/order pagination and resolved compression lineage
  (`api_server.py:2730-2763`). It is not needed as an authority for these private
  per-task homes; do not expose an unrestricted session browser to the owner UI.

## Native approvals and clarification: important mode distinction

- Actual bootstrap hosts only adapter (`scripts/hermes_agent_boot.py:176-192`)
  and hard-denies native tool execution (`98-107`, `148-151`). No native clarify
  tool or approval-producing operation can run under this configuration.
- Legacy approval callback sets `waiting_for_approval` and emits
  `approval.request` (`api_server_runs.py:1002-1013`). Event copies native prompt
  data and adds redacted `command`/`description`, envelope and choice array
  (`api_server.py:84-102`); prompt shape is not a trusted typed business action.
- Legacy `POST /v1/runs/{id}/approval` accepts
  `{choice,request_id?,all?,resolve_all?}`; bearer callers can choose
  `once|session|always|deny` (aliases also accepted). Only room grants enforce
  once/deny, exact request_id and no bulk (`1361-1413`). **Do not forward this
  endpoint or its choices as GODSEYE approval.**
- Canonical authority mode accepts exactly
  `{request_id,execution_generation,choice}` or
  `{request_id,execution_generation,answer}`; generation must match a currently
  started admission and prompt kind/ID must be pending. Response is
  `{run_id,status:'resolved'|'already_resolved',prompt_id}`
  (`api_server_authority_runs.py:114-136`,
  `gateway/session_pending_controls.py:66-101`). Choice must be among prompt
  choices; canonical bearer mode itself does not universally restrict choices
  to once/deny.
- Canonical pending prompt projection: approval has
  `{kind:'approval',prompt_id,execution_generation,command,description,choices,timeout_s?,edit?}`;
  clarify has `{kind:'clarify',prompt_id,execution_generation,question,choices,multi_select,timeout_s?}`
  (`session_pending_controls.py:18-51`). `clarify.request` and settled events are
  canonical observations, not mechanisms for creating questions externally.
- Current `/clarify` delegates directly to canonical `respond_run`
  (`api_server_runs.py:1426-1434`); without authority no owned canonical
  admission exists, so it refuses. `send_clarify` explicitly returns no canonical
  session (`api_server_authority_runs.py:101-111`). Static advertised flags are
  insufficient evidence; `run_unknown_resolution` is mode-aware, other control
  flags can exist even when this host cannot produce their prompts
  (`api_server.py:2353-2377`).

## Artifacts and safe structured output

No `artifact` API route/event occurs in pinned `gateway/platforms/api_server*.py`.
Do not invent `/artifacts`, fetch model-generated file paths, read native home
files, resolve URLs or grant filesystem tools to make an artifact card.

Use a versioned first-party fenced JSON block embedded in the assistant's final
text (for example `godseye-output-v1`), with a strict discriminated union for
bounded text artifact, clarification request and action proposal. This is an
implementation recommendation, **not a native Hermes wire protocol**. Parse only
after successful terminal completion; streamed fragments remain untrusted text.
Reject unknown keys, duplicate/oversized entries, executable HTML, arbitrary
paths/URLs and unsupported action kinds. Artifact content is inert UTF-8 text,
with a server-generated ID, media-type allowlist, filename display only and safe
attachment response; the UI may render safe Markdown without raw HTML.

Clarification can be a controller-owned pending question answered by an explicit
new owner turn, retaining prior messages. State clearly that this is not a paused
native clarify tool invocation or same-run resume.

Action proposals should reference only an EXISTING immutable Foundation plan via
`planId` and `expectedHash`. Controller derives project/environment/resource,
command, target revision, hash and expiry from that exact plan and stores an inert
pending proposal. Owner recent-passkey approval uses existing Foundation.approve
and binds exact proposal ID/scope/revisions/hash/expiry; denial/expiry/stale states
remain tracked. No automatic enqueue, model-created plan or new tool authority.
Existing executors retain all action gates. Never translate approval into native
once/session/always, shell, publication or arbitrary URL/path authority.

## Recommended implementation seam

1. Replace whole-response buffering in `scripts/hermes_gateway_reply.py:25-46`
   with a bounded incremental SSE parser. Accumulate incomplete UTF-8/frame bytes;
   accept only complete JSON frames and `[DONE]`; recursively reject tool calls,
   function calls, tool finish reasons before publishing that frame. Stronger
   allowlist for text-only chat chunk shapes is preferable to forwarding unknown
   vendor fields. Bound total bytes, frame bytes/count/depth, output text, index0,
   one completion, exact model, deadline and stop. Reject truncated JSON/SSE,
   missing terminal sentinel/finish state and late tool-bearing frames. Earlier
   published text is provisional; late invalid content fails the task and never
   becomes a successful artifact/proposal.
2. In `hermes_gateway_broker.py:182-194`, emit response headers then validated
   frames with flush; omit whole-body Content-Length for streamed response (close
   connection framing, no redirect/retry). Keep physical attempt increment before
   I/O, `inflight` ownership and joined settlement on stop. After headers, refusal
   must close transport/fail, never append a second HTTP response or fake `[DONE]`.
3. Dedicated parent helper subscribes to exact native run SSE after retained
   admission, validates native envelope/run ID/cursor and forwards only safe
   incremental text to bounded JSON-line IPC. Keep status polling/terminal result
   authoritative; stream disconnect never stops/replays a model by itself. Stream
   reader lifetime must be joined before stopped proof.
4. Add typed provider `onEvent` callback carried through existing worker context;
   durable controller journal allocates browser cursor, deduplicates vendor seq
   and stores bounded deltas before broadcasting. Browser SSE reads this journal
   with owner auth, exact conversation/task scope and resumable controller cursor.
   It does not receive provider bearer material, ports, paths or raw vendor IDs.
5. Pass bounded strict conversation_history in native request; update complete
   request identity digest and size checks. Preserve current task admission,
   cancellation, restart unknown and accounting semantics. History is a real
   model input, not UI-only decoration.

Qualification needed: deliberately split UTF-8/JSON frames; first delta visible
before fixture release; late hostile tool frame refuses final success; incomplete
stream; oversize; reconnect duplicate/gap handling; durable browser cursor; exact
history present in physical fixture request; stop during streamed request and
reader join. No paid external call needed for these tests.

## Sources and freshness

Primary independence group: NousResearch official docs and pinned source, inspected
2026-11-13. [Official site](https://hermes-agent.nousresearch.com/) and
[API guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server)
were browsed. Pin governs where current docs describe richer canonical behavior.
The local source ranges above provide exact reproducible protocol evidence.
No comparative market claim or independent research assertion is made; this is a
version-pinned documentation digest. Recheck on Hermes/bootstrap version change.
