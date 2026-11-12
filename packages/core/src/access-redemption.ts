import { ActionCommand, type ExecutionContext } from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { validateRecoveryInspectionMaterial } from "./access-recovery-inspection.js";
import {
  type AccessState,
  liveIdentity,
  readyProvider,
  safeProviderRead,
  scopeFor,
  slotFor,
  verifiedVersion,
} from "./access-state.js";
import { DomainError } from "./errors.js";
import { validateLease } from "./foundation-data.js";
import { appendAudit, write } from "./journal.js";

export interface AccessTaskUse {
  tool: string;
  destination: string;
  costMicros: number;
}
const Id = z.string().uuid();
const TaskSnapshot = z
  .object({
    inspection: z.literal(true).optional(),
    context: z
      .object({
        runId: Id,
        planId: Id,
        projectId: Id,
        environmentId: Id,
        epoch: z.number().int().positive(),
        fence: z.number().int().positive(),
        effectKey: z.string().min(1).max(256),
        command: ActionCommand,
        grantId: Id,
        workerId: z.string().min(1).max(128),
      })
      .strict(),
    use: z
      .object({
        tool: z.string().min(1).max(64),
        destination: z.string().min(1).max(253),
        costMicros: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      })
      .strict(),
  })
  .strict();
/** A synchronous in-memory handoff only; no network/disk work or retained async callback in this gate. */
export type PrivateMaterialHandoff = (material: string) => void;
async function authorizedSlot(state: AccessState, proof: string, slotId: string) {
  const identity = await liveIdentity(state, state.store.db, proof);
  const target = await slotFor(state.store.db, slotId);
  if (target.identity.id !== identity.id || !target.slot.activeVersion)
    throw new DomainError(
      "FORBIDDEN",
      "Material is outside the authenticated identity or is not active",
      403,
    );
  const [uncertain] = await state.store.db
    .select()
    .from(schema.accessOperations)
    .where(
      and(
        eq(schema.accessOperations.slotId, slotId),
        eq(schema.accessOperations.kind, "activate"),
        inArray(schema.accessOperations.state, ["pending", "unknown"]),
      ),
    );
  if (uncertain)
    throw new DomainError(
      "RECONCILIATION_REQUIRED",
      "Target transition or old-access revocation is uncertain",
      409,
    );
  return { ...target, identity };
}
function purposeAllows(purpose: string, context: ExecutionContext) {
  const command = context.command;
  return (
    (purpose === "migration" &&
      ((command.kind === "database.operation" && command.intent === "migrate") ||
        (command.kind === "database.lifecycle" && command.intent === "provision"))) ||
    (purpose === "backup" &&
      ((command.kind === "database.operation" && ["backup", "export"].includes(command.intent)) ||
        (command.kind === "database.recovery" &&
          ["full", "diff", "restore", "check"].includes(command.intent)))) ||
    (purpose === "deploy" && command.kind === "deployment.release")
  );
}
/** All provider I/O is outside database transactions. The final sync handoff linearizes with revoke/cancel. */
export async function consume(
  state: AccessState,
  proof: string,
  slotId: string,
  deliver: PrivateMaterialHandoff,
  taskInput?: { context: ExecutionContext; use: AccessTaskUse; inspection?: true },
) {
  // Bind every charge and check to one detached command/use before any caller can mutate it.
  let task: { context: ExecutionContext; use: AccessTaskUse; inspection?: true } | undefined;
  try {
    task = taskInput ? TaskSnapshot.parse(structuredClone(taskInput)) : undefined;
  } catch {
    throw new DomainError("INVALID_INPUT", "Invalid private task context or usage", 422);
  }
  const target = await authorizedSlot(state, proof, slotId);
  if (task) {
    const { context, use } = task;
    if (
      target.identity.workerId !== context.workerId ||
      target.identity.projectId !== context.projectId ||
      target.identity.environmentId !== context.environmentId ||
      !purposeAllows(target.identity.purpose, context)
    )
      throw new DomainError(
        "FORBIDDEN",
        "The authenticated identity does not own this task scope",
        403,
      );
    if (task.inspection)
      await write(state.store, (tx) => validateRecoveryInspectionMaterial(state, tx, context, use));
    else
      await state.foundation.authorizeGrant(context, { ...use, actorId: target.identity.workerId });
  } else if (target.identity.purpose !== "runtime") {
    throw new DomainError("FORBIDDEN", "Non-runtime access requires a live task grant", 403);
  }
  const provider = await readyProvider(state);
  const material = await verifiedVersion(
    state,
    slotId,
    await safeProviderRead(
      provider,
      scopeFor(target.identity, slotId),
      target.slot.activeVersion ?? undefined,
    ),
  );
  if (!material || material.version !== target.slot.activeVersion)
    throw new DomainError("PROVIDER_UNAVAILABLE", "Active material is unavailable", 503);
  if (task?.inspection)
    await write(state.store, (tx) =>
      validateRecoveryInspectionMaterial(state, tx, task.context, task.use),
    );
  else if (task)
    await state.foundation.authorizeGrant(task.context, {
      ...task.use,
      costMicros: 0,
      actorId: task.context.workerId,
    });
  const validateHandoff = async (tx: DatabaseAccess) => {
    const current = await liveIdentity(state, tx, proof);
    const latest = await slotFor(tx, slotId);
    if (
      current.id !== target.identity.id ||
      current.revision !== target.identity.revision ||
      latest.slot.revision !== target.slot.revision ||
      latest.slot.activeVersion !== material.version
    )
      throw new DomainError("FENCED", "Material authority changed before handoff", 409);
    if (task) {
      if (task.inspection)
        await validateRecoveryInspectionMaterial(state, tx, task.context, task.use);
      else {
        await validateLease(state.foundationState, tx, task.context);
        const [grant] = await tx
          .select()
          .from(schema.taskGrants)
          .where(eq(schema.taskGrants.id, task.context.grantId));
        if (
          !grant ||
          grant.revokedAt ||
          grant.expiresAt <= state.now() ||
          grant.actorId !== current.workerId ||
          !grant.tools.includes(task.use.tool) ||
          !grant.destinations.includes(task.use.destination)
        )
          throw new DomainError("FORBIDDEN", "Task authority was revoked before handoff", 403);
      }
    }
    const [uncertain] = await tx
      .select()
      .from(schema.accessOperations)
      .where(
        and(
          eq(schema.accessOperations.slotId, slotId),
          eq(schema.accessOperations.kind, "activate"),
          inArray(schema.accessOperations.state, ["pending", "unknown"]),
        ),
      );
    if (uncertain) throw new DomainError("FENCED", "Target transition started before handoff", 409);
  };
  const attemptId = randomUUID();
  const auditActor = {
    id: target.identity.id,
    kind: "service" as const,
    projectIds: [target.identity.projectId],
  };
  const summary = `Private slot ${slotId}; attempt ${attemptId}`;
  // This committed intention survives a callback throw or later transaction-commit failure.
  try {
    await write(state.store, async (tx) => {
      await validateHandoff(tx);
      await appendAudit(
        tx,
        auditActor,
        target.identity.projectId,
        "access.material.handoff_attempted",
        summary,
      );
    });
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(
      "HANDOFF_AUDIT_UNAVAILABLE",
      "Private access attempt could not be recorded",
      503,
    );
  }
  let callbackStarted = false;
  try {
    return await write(state.store, async (tx) => {
      await validateHandoff(tx);
      callbackStarted = true;
      try {
        const result: unknown = deliver(material.value);
        if (result && typeof result === "object" && "then" in result) {
          // Handle rejected async consumers without printing their private exception text.
          void Promise.resolve(result).catch(() => undefined);
          throw new Error("Asynchronous handoff is not admitted");
        }
      } catch {
        throw new DomainError("PRIVATE_HANDOFF_FAILED", "Private material handoff failed", 503);
      }
      await appendAudit(
        tx,
        auditActor,
        target.identity.projectId,
        "access.material.delivered",
        summary,
      );
    });
  } catch (error) {
    try {
      await write(state.store, (tx) =>
        appendAudit(
          tx,
          auditActor,
          target.identity.projectId,
          callbackStarted ? "access.material.handoff_unknown" : "access.material.handoff_denied",
          summary,
        ),
      );
    } catch {
      throw new DomainError(
        "HANDOFF_AUDIT_UNAVAILABLE",
        "Private access attempt remains unresolved",
        503,
      );
    }
    if (error instanceof DomainError) throw error;
    throw new DomainError(
      "PRIVATE_HANDOFF_FAILED",
      "Private material handoff outcome is uncertain",
      503,
    );
  }
}

import { randomUUID } from "node:crypto";
