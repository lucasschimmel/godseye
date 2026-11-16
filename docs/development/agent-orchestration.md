# Approved local agent orchestration

Control API `1.14.0`, 2026-11-14. [ADR-018](../adr/ADR-018-approved-agent-orchestration.md)
records the authority boundary. The requested local orchestration software is
complete and locally verified; the [story table](../plan/v1-development.md#local-e07-orchestration--2026-11-14)
separates it from provider, host and complete V1 qualification.

## Owner flow

At `/agents`, compose a plan using current project/environment revisions, Hermes
profiles and separately prepared coding tasks. Review each frozen step, dependency,
profile/preparation hash, total maximum reservation, deadline and proposal source.
Preparation and model proposals create `pending` records only. Confirm a recent owner
passkey, then approve the exact displayed hash. Reject retains evidence without launching.
Service actors and agents cannot approve. Stale revisions, paused/changed profiles,
changed coding preparations, activation epoch changes and expiry fence authority.

The durable coordinator dispatches ready steps serially within each plan through
existing AgentEngine/CodingEngine and real Foundation admission. It uses a scoped
`orchestration-worker` service actor, never an owner session. Child identities and
intentions are durable before admission; restarts and lost responses reuse them.
Existing heavy capacity, reservations, grants, effect journal and adapter checks apply.
Plan approval does not install/configure providers or bypass their readiness gates.
Hermes orchestration children currently use model-only tasks without data-tool grants.
Repository code executes only through the separately qualified coding runner: the KVM microVM profile (`disposable-kvm`) or, on the server, the explicitly weaker and still unqualified work-VM profile (`disposable-vm-container`); see [coding runners](coding-runners.md).

## Contract and limits

A plan has one project and environment, 1–12 steps and at most 65,536 serialized UTF-8
bytes. Step IDs match `[a-z][a-z0-9-]{0,47}`. Dependencies must exist, be unique and
form an acyclic graph. Strict schemas reject unknown properties. Input, question and
answer strings are trimmed, nonempty, at most 8,192 characters and 8,192 UTF-8 bytes.
Title is at most 120 characters. Lifetime is 30–3,600 seconds; aggregate ceiling is
0–12,000,000 cost micros. Frozen child maximum costs must sum to at most that ceiling;
ordinary project budgets still apply. Retention is capped at 100 plans.

| Step kind | Exact fields beyond `id`, `dependsOn` | Behavior |
| --- | --- | --- |
| `hermes` | `profileId`, `expectedRevision`, `input`, optional `includeDependencyOutputs` | Freeze profile hash/limits; run model-only input |
| `coding` | `preparationId`, `expectedHash` | Freeze existing exact coding preparation/limits |
| `clarification` | `question`, optional `answer` | Pause for owner input, or retain an already answered inert question |

Dependency ordering alone passes no outputs. Set `includeDependencyOutputs: true`
on a Hermes step to append successful direct Hermes outputs or serialized coding
result metadata as quoted JSON labeled inert untrusted data. Combined input must
fit 8,192 UTF-8 bytes; overflow fails closed. This flag conveys context, never authority,
and does not load arbitrary files or patch bytes. Coding input remains its frozen preparation.

The authority window starts at preparation, not approval. Deadline bounds new admission,
active mutations and late logical success/publication; it is not renewed by recovery.
Read-only settlement and protective cleanup may continue after expiry. Cancellation
revokes parent authority before propagating stop to existing children. Physical
uncertainty stays visible and capacity remains governed by actual settlement.
A failed/unknown/cancelled child blocks successors. `reconcile` observes retained
Foundation effects; it cannot resubmit unknown work or resume an unknown plan.

## Clarification and proposals

Answering a waiting exact question creates a **new pending plan** with a new hash
and `supersedesId`. The original becomes `cancelled` with reason
`SUPERSEDED_BY_CLARIFICATION` and retains completed task identities/evidence.
The continuation contains only remaining effectful steps plus the answered question
as inert provenance; it never replays the completed prefix. Answer text is quoted
in remaining Hermes inputs. Explicitly requested completed dependency outputs can
be carried as bounded inert context. Existing bindings and the remaining original
lifetime are revalidated; an expired/too-short or oversized continuation is refused.
Review and freshly approve the new exact content before further effects.

A successful current Hermes task can emit a complete `PrepareOrchestration` JSON
object. The scheduler extracts it once as a deduplicated pending proposal; owner
import by task ID is also available. The entire output must parse as strict JSON:
no Markdown fence, prose envelope, unknown keys or executable tool payload. Source
success, profile, scope, Foundation settlement and epoch must remain current.
Malformed or stale output stays inert text. Extraction never approves/enqueues a child.

Illustrative whole model output (replace UUIDs/revisions with current records;
these UUIDs are safe placeholders):

```json
{
  "projectId": "11111111-1111-4111-8111-111111111111",
  "environmentId": "22222222-2222-4222-8222-222222222222",
  "expectedProjectRevision": 0,
  "expectedEnvironmentRevision": 0,
  "title": "Review then clarify",
  "maxCostMicros": 1000000,
  "lifetimeSeconds": 600,
  "steps": [
    {
      "id": "review",
      "dependsOn": [],
      "kind": "hermes",
      "profileId": "33333333-3333-4333-8333-333333333333",
      "expectedRevision": 0,
      "input": "Summarize the supplied requirements."
    },
    {
      "id": "scope",
      "dependsOn": ["review"],
      "kind": "clarification",
      "question": "Which requirement should be addressed first?"
    }
  ]
}
```

The illustrative ceiling must cover the actual selected profile maximum. A model
cannot mint a profile, coding preparation, revision or owner approval by naming it.

## Owner HTTP and typed client

Paths below are relative to `/api/v1`; all require the owner session. Mutations
require same-origin/CSRF protection and an `idempotency-key`; approval additionally
requires recent passkey authentication. These endpoints are unavailable to project
service identities and the application SDK.

| Method/path | Body | Result |
| --- | --- | --- |
| `GET /agents/orchestration` | — | Overview |
| `POST /agents/orchestration/plans` | `PrepareOrchestration` | 201 pending detail |
| `POST /agents/orchestration/proposals` | `{taskId}` | 201 deduplicated pending proposal |
| `GET /agents/orchestration/plans/:id` | — | Detail and child identities |
| `POST /agents/orchestration/plans/:id/approve` or `/reject` | `{expectedHash}` | Exact decision |
| `POST /agents/orchestration/plans/:id/answer` | `{expectedHash, stepId, answer}` | 201 new pending continuation |
| `POST /agents/orchestration/plans/:id/cancel` or `/reconcile` | `{}` | Protective stop / read-only observation |

```ts
import { createControlClient } from "@godseye/control-client";
import type { PrepareOrchestrationInput } from "@godseye/contracts";

// In an existing same-origin authenticated owner UI; input is current reviewed data.
async function prepare(input: PrepareOrchestrationInput) {
  const client = createControlClient();
  return client.prepareOrchestration(input, crypto.randomUUID());
}
// Separate explicit owner action after reviewing detail and recent passkey confirmation:
async function approve(planId: string, reviewedHash: string) {
  return createControlClient().approveOrchestration(planId, reviewedHash, crypto.randomUUID());
}
```

Preserve the same body/key across an uncertain retry. Other methods are
`orchestrationOverview()`, `orchestrationDetail(id)`, `proposeOrchestration(taskId, key)`,
`rejectOrchestration(id, expectedHash, key)`,
`answerOrchestration(id, { expectedHash, stepId, answer }, key)`,
`cancelOrchestration(id, key)` and `reconcileOrchestration(id, key)`.

## Startup and verification

Migration `0022_orchestration.sql` adds indexed durable plan metadata through normal
store startup migration. No manual database command or new private binding is needed.
The control API starts/stops its bounded coordinator with its existing lifecycle;
its default tick interval is 1,000 ms. Physical execution still needs the existing
separately configured Hermes/coding providers; default startup grants no model access.

Focused checks from the repository root, with the configured Bun/Node toolchain:

```sh
bun run test tests/orchestration-contracts.test.ts tests/orchestration-plans.test.ts tests/orchestration-runtime.test.ts tests/orchestration-http.test.ts tests/orchestration-composition.test.ts tests/orchestration-clarification.test.ts tests/orchestration-proposals.test.ts --maxWorkers=1
bun run test:e2e --config playwright.orchestration.config.ts
bun run contracts:check
bun run typecheck
```

These fixture-backed orchestration tests establish local composition and owner flows;
they do not add paid-provider/native-host qualification. Final checks passed: 60 new focused and 656 disjoint relevant regression cases,
two desktop/mobile browser journeys, three selected mutation kills, independent
security/source review, static/contracts checks and canonical build/smoke. These
are 716 related ordinary passes, not a full-repository suite. Exact final run
evidence and scanner limits belong to the [verification strategy](../../tests/STRATEGY.md#local-e07-orchestration--2026-11-14). Native broad/session
Hermes approvals and general Hermes shell are not exposed. Native vendor pause/resume
parity, paid entitlement/invoice accounting (E08), E09 operational bundles, deployed
provider/host/recovery qualification and connectors remain separately scoped.
Coding preview publication requires separately authorized E05 delivery. No plan step
commits, pushes, merges, deploys or publishes automatically.
