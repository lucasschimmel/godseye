# ADR-018: Exact owner-approved bounded agent orchestration

Status: accepted for local implementation, 2026-11-14; requested local software complete and verified.

## Context

E07 needs agent-proposed work and platform approval/clarification without allowing a
model to approve itself, impersonate the owner, replay unknown effects or acquire
broad native Hermes session authority. Existing AgentEngine/CodingEngine and
Foundation already own execution, budgets, grants, epochs and recovery. Local coding
KVM qualification does not authorize deployment or paid model use.

## Decision

Persist immutable single-project/environment DAGs of at most twelve Hermes, coding
or clarification steps. Freeze target revisions, profile/preparation hashes and
limits, activation epoch, aggregate maximum reservation and finite deadline into an
exact plan hash. Owner preparation and strict whole-output successful-current-Hermes
proposal extraction produce pending records only. Require recent owner passkey
approval of the exact hash, with transactional final validation; reject stale content.

A durable coordinator uses scoped service delegation through real Foundation
admission and existing capacity. Serialize dispatch within each plan, persisting
deterministic child identity before admission. Revalidate parent authority at
admission, physical dispatch and final writes. Cancellation revokes authority before
protective child stop. Unknown effects block descendants and are observed read-only;
never resubmit or resume an unknown plan automatically.

Keep dependency ordering separate from data access. Only explicit
`includeDependencyOutputs` appends bounded successful direct results as quoted inert
untrusted context. Hermes children are model-only; arbitrary repository execution
uses the separate coding KVM path. No public host argv, shell, credentials or dynamic
capability expansion is introduced.

Answering clarification supersedes the original with a new pending remaining-effectful
suffix plus inert answered-question provenance. Retain completed prefix identities
on the original; never replay them. Re-freeze changed input/bindings within the
remaining deadline and require new exact approval. Do not synthesize owner sessions
or silently extend authority during recovery.

Expose owner HTTP/typed-client/console controls in API `1.14.0`, with automatic store
migration `0022_orchestration.sql`. Keep native broad/session approvals denied and
platform controls distinct from upstream paused-tool parity.

## Consequences

The requested local software can complete independently of deployed providers,
paid entitlement, E08 usage reconciliation, E09 operational skills and full V1
qualification. Default execution remains unavailable without existing qualified
operator bindings. Plans cannot deploy/publish: E05 delivery remains separately
authorized; preview evidence is not inferred from a coding result. Finite retention,
conservative aggregate limits and serialized dispatch favor reviewability over
unbounded autonomous scheduling.

See [agent orchestration operations](../development/agent-orchestration.md) for
schemas, owner flow, commands and precise qualification boundaries. Existing
accepted ADRs remain unchanged.
