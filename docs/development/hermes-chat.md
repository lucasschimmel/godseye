# Advanced local Hermes chat

The owner Agent Center at `/agents` supports persistent conversations, incremental
text, immutable draft artifacts and an approval inbox for existing Foundation plans.
This extends the [bounded task integration](agent-center.md). It uses the actual pinned
Hermes Runs API; no model key, paid qualification call or dedicated host is required
for the local tests. Private runtime activation still follows the existing guide.

## Start a conversation

Create or select a current project/environment-bound profile, confirm the owner
identity and choose **Créer une conversation**. The profile fixes the project,
environment, role, model and limits. Send a message with **Envoyer le message**.
Each response is a separate real Foundation task, with its own positive reservation,
lease/grant, heavy-task admission and original deadline. Without an explicit tool
grant it has one physical model attempt; the [tools continuation](hermes-tools.md)
permits a bounded finite loop under the same total reservation.
The initial inexpensive model remains `gpt-6-luna`.

The next response receives up to four previous successful user/assistant messages,
in complete pairs and at most 16 KiB. Older or unsuccessful exchanges stay in the
private transcript; the console shows how many turns were omitted from model context.
There is no hidden summarization call. One active or uncertain task still owns the
profile, even across separate conversations. Unknown outcomes require read-only
reconciliation before another model request can start.

After a lost send response, **Vérifier l’envoi** reuses the exact original message,
conversation revision and idempotency key. A history refresh cannot turn that retry
into another billable response. Drafts and outstanding send intentions are kept
separately for each conversation within the open page.

## Streaming and recovery

The native broker validates complete SSE frames before forwarding them. The actual
Hermes Runs `message.delta` events pass through acknowledged, bounded IPC and are
persisted under current task authority. Text is visible before the response finishes.
A provisional fragment is not a successful final result. Truncated streams, unsupported
tool replies or late revoked output cannot produce accepted artifacts or approval requests.

The owner stream replays a durable per-conversation cursor. Reconnecting performs
only reads, never another model submission. An expired or future cursor requests an
explicit snapshot reset. Full transcript/progress remains in the private control
journal across a controller reopen; an uncertain native run is not silently restarted.

Owner sessions are rechecked while the stream is open. Each API process admits at
most four streams, two per conversation, with a 60-second lifetime and a 5-second
unread-consumer bound. Closing an idle/expired/revoked stream releases its connection;
it does not cancel the model task. The console reconnects and refetches as needed.
Use **Demander l’arrêt** to request protective cancellation, then reconcile uncertainty.
Stop acknowledgement and model transport settlement remain distinct.

Pausing or reconfiguring a profile does not erase its old transcript, events or
artifacts. Authenticated owner history reads and protective rejection remain available.
New turns and approvals require the current exact profile, resource scope and authority.
Create a fresh conversation after a profile revision changes; old conversations are
not rebound to another policy or project.

## Artifacts

Ask Hermes for a draft, report, JSON document or patch. The model-only host is given
a first-party structured-output convention. Only strict complete blocks from an
actually successful, non-revoked Foundation settlement create artifacts. Streaming
fragments never create files or pending actions.

Artifacts are bounded UTF-8 text with a server-generated ID/name, exact byte count
and SHA-256 digest. They are retained in the private journal and displayed inertly.
Download verifies the retained content/digest and serves `text/plain`, attachment
only, with `nosniff`, sandbox CSP and private no-store caching. HTML-looking text
cannot become a live page. Model filenames/URLs are not paths to read or fetch.

Supported draft media labels are text, Markdown, JSON and patch. A response can
produce at most eight output blocks; each artifact is at most 16 KiB and the complete
response remains bounded by the existing 32 KiB output limit. Binary uploads, native
filesystem artifact browsing and live HTML previews are absent. Explicit trusted
scratch/artifact tools and their actual file snapshots follow the
[tools guide](hermes-tools.md); each turn needs a new grant within its profile ceiling.

## Approval requests

Hermes may reference an EXISTING same-project/environment Foundation execution plan
that requires approval. Supply its plan ID and exact hash in the conversation when
requesting a review. The controller looks up that immutable plan and derives the
resource, command parameters, revision and scope. The trusted broker sets a separate
one-hour deadline for the pending proposal. The model cannot create a plan, invent
authority or approve itself through its response.

The owner inbox shows the exact command, target, revision, hash and deadline. Review
these before choosing **Approuver le plan**. Approval requires a recent passkey owner
session and rechecks source task/epoch, current profile/scope, plan/hash/revision and
expiry inside the same transaction as the actual Foundation approval. A stale or
expired proposal cannot be promoted. Repeating the same decision is idempotent.
The effective Foundation approval has its own expiry, at most five minutes under the
current local policy. An approved inbox entry is a retained decision, not a perpetual
grant; replaying that entry does not renew the Foundation approval.
**Refuser** remains an authenticated protective action without a fresh step-up.

No new plan is enqueued by resolving this inbox. The existing Foundation approval
mechanism CAN resume an already-admitted operation waiting for that approval, with
its normal capacity and executor gates. Approval is therefore an effective authority
decision, not a cosmetic card. Inspect any waiting operation before approving.

This is GODSEYE's exact-plan approval inbox. The upstream Hermes legacy choices
`session`, `always` and bulk approval are never exposed. Native canonical paused
clarification/approval tools, agent-created privileged plans, general tools, external
publication connectors and coding runners remain separate E07/E09 work.

## Local boundaries and evidence

Retention is bounded to 64 conversations and 100 turns per conversation, with 256 recent
stream events per conversation. The existing global 500-task cap still applies.
Artifact and proposal content is private owner data; audit records contain references,
not prompts, answers or draft bytes. Missing token usage remains unknown; conservative
reservations do not claim to reproduce a provider invoice.

The current targeted qualification includes 31 ordinary cases, three new native cases
(actual delayed stream/two-turn context, truncated completion refusal and unsupported
tool refusal), three browser journeys and four selected copy-only mutations. The
browser task/artifact/proposal contract fixtures are labeled separately from actual
native execution. An existing native hanging cancellation and reply-parser case also
pass separately. See the [test strategy](../../tests/STRATEGY.md) for final aggregate
gates, retained failures and explicit coverage limits.

All work remains local. Socket guards, private homes and these conversation protocols
are not a hostile-code OS sandbox, paid OpenAI entitlement or deployed-host recovery
qualification. The default no-tools boundary is extended only by the explicit trusted data catalog;
no arbitrary-code or model-provider fallback is enabled.

The later [trusted data-tool continuation](hermes-tools.md#measured-local-evidence)
passed its local acceptance and final regression/review/build gates on 2026-11-14.
Its counts are separate from the historical chat checkpoint above. Tool-enabled
turns still need explicit grants and current operator runtime availability.
