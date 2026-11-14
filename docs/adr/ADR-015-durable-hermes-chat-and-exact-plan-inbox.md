# ADR-015: Durable Hermes chat and exact-plan owner inbox

Status: accepted for local implementation, 2026-11-13.

## Context

The owner requested advanced Hermes chat with streaming, artifacts and approval
requests after the local Agent Center task integration. The pinned API-only Hermes
host has genuine Runs text events and explicit conversation history, but no artifact
API. Its legacy approval API permits session/always and bulk choices; canonical
paused controls depend on authority infrastructure not enabled by this host.

## Decision

Keep the actual pinned `APIServerAdapter` and no-tools model boundary. Validate and
forward complete model SSE frames incrementally; publish only bounded text deltas
through acknowledged IPC after stable run correlation. Require complete validated
transport and actual stopped proof before final success. Reuse Foundation authority,
reservations and admission for each explicit owner turn, with bounded successful
history and an immutable context identity. Do not add a second task scheduler.

Persist conversation turns, partial text and a bounded cursor journal in the private
control database. SSE consumers reauthenticate and have finite connection/backpressure
limits. Replay/reset never resubmits a model request. Read cursor validation and its
retained suffix atomically to prevent pruning races. Preserve owner history after
profile changes while fencing new work under the old policy.

Extract strict first-party text artifact/proposal blocks only in proven successful
Foundation settlement. Store immutable digests and serve inert attachment downloads;
never browse model paths or URLs. Proposals can reference only existing same-scope
immutable approval-requiring plans. Derive their parameters/revision/hash from
the trusted plan. Set the pending proposal deadline in the trusted broker (one hour);
retain the separate effective Foundation approval expiry (at most five minutes locally). Resolve the inbox and actual Foundation decision atomically under
owner authority, current scope/source epoch and recent step-up for approval. Rejection
is protective. Never forward native session/always/bulk authority.

## Consequences

Streaming is genuinely incremental; provisional text remains distinguishable from a
completed result. Browser disconnect is independent of task cancellation. Every turn
retains one model attempt/reservation, and lost-response retries retain their original
body/key despite conversation CAS advancement. Artifacts and inbox decisions survive
controller reopen without becoming execution grants of their own.

Resolving the inbox does not enqueue new work, but actual Foundation approval can
resume an existing awaiting-approval operation. Existing executor/capacity/policy gates
remain mandatory. Native canonical paused controls, agent-created plans, general tools,
coding runners, operational skill bundles and deployed containment remain separate.
See [operator guide](../development/hermes-chat.md), [Agent Center decision](ADR-014-owner-bound-agent-center.md)
and [authority foundation](ADR-004-owner-authority-and-foundations.md).
