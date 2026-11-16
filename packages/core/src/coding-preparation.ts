import { randomUUID } from "node:crypto";
import {
  AdmitCodingTask,
  CODING_DEFAULTS,
  type CodingTaskView,
  PrepareCodingTask,
} from "@godseye/contracts";
import { schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import {
  CODING_ADAPTER_ID,
  CODING_DESTINATION,
  CODING_TOOL,
  type CodingState,
  codingScope,
  codingTaskFor,
  preparationFor,
  validateCodingQualification,
} from "./coding-state.js";
import { DomainError, parseInput } from "./errors.js";
import { recordRequest, requestFor } from "./foundation-data.js";
import { appendAudit, fingerprint, write } from "./journal.js";
import type { DelegatedTask } from "./orchestration-delegation.js";
import { type Actor, assertOwner } from "./policy.js";

export async function prepareCoding(state: CodingState, actor: Actor, raw: unknown, key: string) {
  assertOwner(actor);
  const input = parseInput(PrepareCodingTask, raw);
  if (Buffer.byteLength(input.input, "utf8") > CODING_DEFAULTS.maxInputBytes)
    throw new DomainError("INVALID_INPUT", "Coding input exceeds its byte limit", 422);
  return write(state.store, async (tx) => {
    const receipt = await requestFor(tx, actor, key, "coding.prepare", input);
    if (receipt.existing) return preparationFor(tx, receipt.existing.resourceId);
    const repository = await codingScope(state, tx, actor, input);
    const rows = await tx
      .select({ id: schema.codingPreparations.id })
      .from(schema.codingPreparations)
      .limit(CODING_DEFAULTS.maxPreparations);
    if (rows.length >= CODING_DEFAULTS.maxPreparations)
      throw new DomainError("CODING_RETENTION_FULL", "Coding preparation retention is full", 409);
    const body = {
      ...input,
      id: randomUUID(),
      repository,
      repositoryHash: fingerprint(repository),
      createdAt: state.now().toISOString(),
    };
    const preparation = { ...body, hash: fingerprint(body) };
    await tx.insert(schema.codingPreparations).values({
      id: body.id,
      projectId: body.projectId,
      metadata: preparation,
      createdAt: state.now(),
    });
    await recordRequest(tx, state.request, key, receipt.digest, body.id, "coding.prepare");
    await appendAudit(
      tx,
      actor,
      body.projectId,
      "coding.prepared",
      `Prepared immutable coding task ${body.id}`,
    );
    return preparation;
  });
}

/** Source verification and pure qualification precede queue admission; no guest is allocated here. */
export async function admitCoding(
  state: CodingState,
  actor: Actor,
  raw: unknown,
  key: string,
  delegated?: DelegatedTask,
) {
  if (!delegated) assertOwner(actor);
  const input = parseInput(AdmitCodingTask, raw);
  const replay = await write(state.store, async (tx) => {
    await delegated?.authorize(tx);
    const receipt = await requestFor(tx, actor, key, "coding.admit", input);
    return receipt.existing ? codingTaskFor(tx, receipt.existing.resourceId) : null;
  });
  if (replay?.task.runId) return replay.task;
  if (!delegated) state.foundation.assertFreshOwner(actor);
  const preparation = await preparationFor(state.store.db, input.preparationId);
  if (preparation.hash !== input.expectedHash)
    throw new DomainError("REVISION_CONFLICT", "Coding preparation hash changed", 409);
  const provider = state.provider;
  if (!provider?.qualified)
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "Disposable KVM coding runner is unavailable",
      503,
    );
  const qualification = validateCodingQualification(
    state,
    preparation,
    await provider.preflight(preparation, AbortSignal.timeout(10000)),
  );
  const source = await provider.verifySource(preparation, AbortSignal.timeout(10000));
  if (
    source.repositoryHash !== preparation.repositoryHash ||
    source.commitSha !== preparation.commitSha
  )
    throw new DomainError(
      "SOURCE_MISMATCH",
      "Coding source could not be independently verified",
      409,
    );
  const task = await write(state.store, async (tx) => {
    await delegated?.authorize(tx);
    const receipt = await requestFor(tx, actor, key, "coding.admit", input);
    if (receipt.existing) return (await codingTaskFor(tx, receipt.existing.resourceId)).task;
    validateCodingQualification(state, preparation, qualification);
    await codingScope(state, tx, actor, preparation, preparation.repositoryHash);
    const [existing] = await tx
      .select()
      .from(schema.codingTasks)
      .where(eq(schema.codingTasks.preparationId, preparation.id));
    if (existing)
      throw new DomainError(
        "CODING_ALREADY_ADMITTED",
        "Preparation already has a retained coding task",
        409,
      );
    const retained = await tx
      .select({ id: schema.codingTasks.id })
      .from(schema.codingTasks)
      .limit(CODING_DEFAULTS.maxTasks);
    if (retained.length >= CODING_DEFAULTS.maxTasks)
      throw new DomainError("CODING_RETENTION_FULL", "Coding task retention is full", 409);
    const moment = state.now().toISOString();
    const row: CodingTaskView = {
      id: delegated?.taskId ?? randomUUID(),
      preparationId: preparation.id,
      projectId: preparation.projectId,
      environmentId: preparation.environmentId,
      runId: null,
      runner: preparation.runner,
      state: "queued",
      correlationId: randomUUID(),
      submissionIntended: false,
      cleanupState: "not-started",
      worktree: { id: randomUUID(), baseSha: preparation.commitSha, disposition: "planned" },
      reason: null,
      createdAt: moment,
      updatedAt: moment,
      finishedAt: null,
    };
    await tx.insert(schema.codingTasks).values({
      id: row.id,
      preparationId: row.preparationId,
      projectId: row.projectId,
      runId: null,
      metadata: row,
      result: null,
      createdAt: state.now(),
    });
    await recordRequest(tx, state.request, key, receipt.digest, row.id, "coding.admit", false);
    await appendAudit(
      tx,
      actor,
      row.projectId,
      "coding.intended",
      `Intended coding task ${row.id}`,
    );
    return row;
  });
  if (task.runId || task.state !== "queued") return task;
  const plan = await state.foundation.createPlan(
    actor,
    {
      projectId: task.projectId,
      environmentId: task.environmentId,
      targetId: task.environmentId,
      expectedRevision: preparation.expectedProjectRevision,
      adapterId: CODING_ADAPTER_ID,
      command: {
        kind: "coding.run",
        taskId: task.id,
        preparationId: preparation.id,
        preparationHash: preparation.hash,
      },
      maxCostMicros: preparation.limits.maxCostMicros,
      tools: [CODING_TOOL],
      destinations: [CODING_DESTINATION],
    },
    `coding-plan:${task.id}`,
  );
  await state.foundation.enqueue(actor, plan.id, `coding-enqueue:${task.id}`);
  return (await codingTaskFor(state.store.db, task.id)).task;
}
