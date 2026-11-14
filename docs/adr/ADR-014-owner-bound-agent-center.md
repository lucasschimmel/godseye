# ADR-014: Owner-bound Agent Center on Foundation and pinned Hermes Runs

Status: accepted for local implementation, 2026-11-13.

## Context

The owner requested real project/environment profile binding and task launch/tracking
after the local Hermes setup checkpoint. OpenAI remains the provider; an inexpensive
model was delegated to implementation. Existing Foundation grants, budgets and
uncertainty rules must remain authoritative.

## Decision

Persist revision-bound profiles and task snapshots in the private control journal.
Reuse Foundation plans, queue/worker, grants, reservations, heavy-task admission,
epoch/lease fencing and audit. Run only bounded no-tools conversation tasks using
the pinned actual Hermes Runs API. Keep default provider state unconfigured until
an exact private local material binding exists.

Use `gpt-6-luna` as the initial model allowlist, with a fixed one-request/one-turn
policy and bounded output, duration, input and conservative monetary reservation.
Because upstream Runs admission ignores arbitrary output-cap fields, enforce
construction limits and a first-party physical egress broker. No premium fallback,
automatic second attempt, tool authority or uncontrolled endpoint is accepted.

Materialize a private mutable per-task home; preserve immutable setup snapshots.
Install the minimal locked HTTP dependency family in a separate sealed environment,
retaining the earlier core provenance. Native qualification uses an explicit local
model fixture rather than provider credits.

Host the pinned `APIServerAdapter` directly under the first-party owned process
lifetime. Its actual authenticated durable Runs API is retained; the general
messaging gateway, session-authority runner and unrelated watchers are outside
this bounded conversation task. Explicitly inject the exact trusted skill prompt
and verify constructor/output policy before any model request.

Persist intent and correlation before external submission. Retain uncertain results,
occupied profile/capacity and budget until actual completion/stop can be reconciled.
Read-only recovery never replays a model call or restores revoked logical authority.
An epoch fence or generic Foundation cancellation is also an agent logical stop.

## Consequences

Agent Center is functional locally without claiming full E07 completion. Initial
tracking uses authenticated bounded polling/refetch rather than vendor SSE as a
sole source of history. Full chat/approval/clarification, general tools/disposable
execution, coding runners, E08 invoice reconciliation, E09 skills and dedicated-host
qualification remain separate work. A socket guard is not OS containment.

See [operator guide](../development/agent-center.md),
[setup decision](ADR-013-local-hermes-setup.md) and
[authority foundation](ADR-004-owner-authority-and-foundations.md).
