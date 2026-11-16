import {
  type ActionCommandInput,
  AdmissionControl,
  type AdmissionControlView,
  SetAdmission,
  type SetAdmissionInput,
} from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { DomainError, parseInput } from "./errors.js";
import { foundationState, recordRequest, requestFor } from "./foundation-data.js";
import { assertHeavyCapacity, type HeavyTaskPolicy } from "./infra-heavy.js";
import { immutableSnapshot } from "./infra-policy.js";
import { assertInfrastructureFresh, type InfrastructureState } from "./infra-state.js";
import { appendAudit, write } from "./journal.js";
import type { Actor } from "./policy.js";

/** Intents that stop, suspend, cancel or recover; pausing admission must never make unsafe state harder to leave. */
const PROTECTIVE_INTENTS: Record<string, readonly string[]> = {
  "cell.lifecycle": ["stop", "quarantine"],
  "project.lifecycle": ["suspend", "quarantine"],
  "database.lifecycle": ["suspend"],
  "delivery.lifecycle": ["cleanup", "rollback"],
  "database.recovery": ["restore", "check"],
  "job.operation": ["pause", "cancel"],
  "personal.lifecycle": ["stop"],
};
const PROTECTIVE_KINDS: readonly string[] = ["agent.cancel", "approval.resolve", "incident.update"];
export function isProtectiveCommand(command: ActionCommandInput) {
  if (PROTECTIVE_KINDS.includes(command.kind)) return true;
  const intents = PROTECTIVE_INTENTS[command.kind];
  return intents !== undefined && "intent" in command && intents.includes(command.intent);
}
export async function admissionControlFor(tx: DatabaseAccess): Promise<AdmissionControlView> {
  const [row] = await tx
    .select()
    .from(schema.infrastructureAdmission)
    .where(eq(schema.infrastructureAdmission.id, 1));
  if (!row) throw new DomainError("JOURNAL_INCONSISTENT", "Admission control row is missing", 500);
  return AdmissionControl.parse({
    state: row.state,
    revision: row.revision,
    reason: row.reason,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  });
}
/** Runs inside the one Foundation enqueue transaction, so no second queue or ledger exists. */
export async function gateAdmission(
  policy: HeavyTaskPolicy,
  tx: DatabaseAccess,
  command: ActionCommandInput,
  runId: string,
) {
  const control = await admissionControlFor(tx);
  if (control.state === "paused" && !isProtectiveCommand(command))
    throw new DomainError(
      "ADMISSION_PAUSED",
      `New admission is paused by the owner: ${control.reason ?? "no reason recorded"}`,
      409,
    );
  await assertHeavyCapacity(tx, policy, command, runId);
}
async function replay(tx: DatabaseAccess, key: string) {
  const [row] = await tx
    .select()
    .from(schema.infrastructureReceipts)
    .where(eq(schema.infrastructureReceipts.key, key));
  if (!row) throw new DomainError("JOURNAL_INCONSISTENT", "Admission receipt is missing", 500);
  return AdmissionControl.parse(row.response);
}
export async function setAdmission(
  state: InfrastructureState,
  actorInput: Actor,
  input: SetAdmissionInput,
  key: string,
) {
  const actor = immutableSnapshot(actorInput),
    data = parseInput(SetAdmission, input);
  assertInfrastructureFresh(state, actor);
  return write(state.store, async (tx) => {
    const request = await requestFor(tx, actor, key, "infrastructure.admission", data);
    if (request.existing) return replay(tx, key);
    assertInfrastructureFresh(state, actor);
    const current = await admissionControlFor(tx);
    if (current.revision !== data.expectedRevision)
      throw new DomainError("REVISION_CONFLICT", "Admission control has changed", 409);
    await tx
      .update(schema.infrastructureAdmission)
      .set({
        state: data.state,
        revision: current.revision + 1,
        reason: data.state === "paused" ? (data.reason ?? null) : null,
        updatedAt: state.now(),
      })
      .where(eq(schema.infrastructureAdmission.id, 1));
    await appendAudit(
      tx,
      actor,
      null,
      data.state === "paused"
        ? "infrastructure.admission_paused"
        : "infrastructure.admission_opened",
      data.state === "paused"
        ? "Paused new admission; reads, reconciliation and protective stops continue"
        : "Reopened new admission",
    );
    const response = await admissionControlFor(tx);
    await tx.insert(schema.infrastructureReceipts).values({ key, response });
    await recordRequest(
      tx,
      foundationState(state.store, { now: state.now }),
      key,
      request.digest,
      String(response.revision),
      "infrastructure.admission",
    );
    return response;
  });
}
