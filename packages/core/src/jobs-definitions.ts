import { randomUUID } from "node:crypto";
import {
  type JobDefinitionView,
  RegisterJobDefinition,
  type RegisterJobDefinitionInput,
} from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { and, eq, notInArray } from "drizzle-orm";
import { DomainError, parseInput } from "./errors.js";
import { assertFresh, recordRequest, requestFor } from "./foundation-data.js";
import { nextCronFire, parseCron } from "./jobs-cron.js";
import {
  activeCell,
  definitionFor,
  definitionView,
  JOB_TERMINAL_STATES,
  type JobState,
} from "./jobs-state.js";
import { appendAudit, fingerprint, write } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";

function fireFor(state: JobState, trigger: RegisterJobDefinitionInput["trigger"], paused: boolean) {
  if (trigger.kind !== "cron" || paused) return null;
  return nextCronFire(trigger.cron, state.now());
}
const definitionHash = (data: RegisterJobDefinitionInput) =>
  fingerprint({
    projectId: data.projectId,
    environmentId: data.environmentId,
    name: data.name,
    handler: data.handler,
    trigger: data.trigger,
    effectPolicy: data.effectPolicy,
    limits: data.limits,
  });
async function replay(tx: DatabaseAccess, actor: Actor, id: string) {
  return definitionView(await definitionFor(tx, actor, id));
}

/** Registration is a standing authority for scheduled work, so it needs a recent owner session. */
export async function registerJobDefinition(
  state: JobState,
  actor: Actor,
  input: RegisterJobDefinitionInput,
  key: string,
): Promise<JobDefinitionView> {
  assertFresh(actor, state.request);
  const data = parseInput(RegisterJobDefinition, input);
  if (data.trigger.kind === "cron") parseCron(data.trigger.cron);
  return write(state.store, async (tx) => {
    const receipt = await requestFor(tx, actor, key, "job.register", data);
    if (receipt.existing) return replay(tx, actor, receipt.existing.resourceId);
    const { environment } = await activeCell(state, tx, actor, data.projectId, data.environmentId);
    if (environment.revision !== data.expectedEnvironmentRevision)
      throw new DomainError("REVISION_CONFLICT", "Environment changed before registration", 409);
    const [current] = await tx
      .select()
      .from(schema.jobDefinitions)
      .where(
        and(
          eq(schema.jobDefinitions.environmentId, data.environmentId),
          eq(schema.jobDefinitions.name, data.name),
        ),
      );
    const hash = definitionHash(data);
    const now = state.now();
    const id = current?.id ?? randomUUID();
    if (current && current.hash !== hash) {
      const [live] = await tx
        .select({ id: schema.jobRuns.id })
        .from(schema.jobRuns)
        .where(
          and(
            eq(schema.jobRuns.definitionId, current.id),
            notInArray(schema.jobRuns.state, [...JOB_TERMINAL_STATES]),
          ),
        )
        .limit(1);
      if (live)
        throw new DomainError(
          "JOB_DEFINITION_BUSY",
          "Resolve every active or uncertain run before changing its job definition",
          409,
        );
      await tx
        .update(schema.jobDefinitions)
        .set({
          handler: data.handler,
          trigger: data.trigger,
          effectPolicy: data.effectPolicy,
          limits: data.limits,
          revision: current.revision + 1,
          hash,
          nextFireAt: fireFor(state, data.trigger, current.paused),
          updatedAt: now,
        })
        .where(eq(schema.jobDefinitions.id, current.id));
    } else if (!current) {
      await tx.insert(schema.jobDefinitions).values({
        id,
        projectId: data.projectId,
        environmentId: data.environmentId,
        name: data.name,
        handler: data.handler,
        trigger: data.trigger,
        effectPolicy: data.effectPolicy,
        limits: data.limits,
        revision: 0,
        hash,
        paused: false,
        nextFireAt: fireFor(state, data.trigger, false),
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(schema.resources).values({
        id,
        projectId: data.projectId,
        environmentId: data.environmentId,
        kind: "job-definition",
        name: `Job ${data.name}`,
        createdAt: now,
      });
    }
    await recordRequest(tx, state.request, key, receipt.digest, id, "job.register");
    await appendAudit(
      tx,
      actor,
      data.projectId,
      current ? "job.definition_changed" : "job.definition_registered",
      `Registered ${data.effectPolicy} job ${data.name}; no scheduling authority outside this cell`,
    );
    return replay(tx, actor, id);
  });
}
export async function changeJobPause(
  state: JobState,
  actor: Actor,
  id: string,
  expectedRevision: number,
  pause: boolean,
  key: string,
): Promise<JobDefinitionView> {
  assertOwner(actor);
  const kind = pause ? "job.pause" : "job.resume";
  return write(state.store, async (tx) => {
    const receipt = await requestFor(tx, actor, key, kind, { id, expectedRevision });
    if (receipt.existing) return replay(tx, actor, receipt.existing.resourceId);
    const row = await definitionFor(tx, actor, id);
    if (row.revision !== expectedRevision)
      throw new DomainError("REVISION_CONFLICT", "Job definition changed", 409);
    // Pausing stays available inside a held cell; resuming never bypasses the hold.
    if (!pause) await activeCell(state, tx, actor, row.projectId, row.environmentId);
    if (row.paused !== pause) {
      await tx
        .update(schema.jobDefinitions)
        .set({
          paused: pause,
          revision: row.revision + 1,
          nextFireAt: fireFor(state, row.trigger, pause),
          updatedAt: state.now(),
        })
        .where(eq(schema.jobDefinitions.id, id));
      await appendAudit(
        tx,
        actor,
        row.projectId,
        pause ? "job.paused" : "job.resumed",
        `${pause ? "Paused" : "Resumed"} job ${row.name}; missed fires are not backfilled`,
      );
    }
    await recordRequest(tx, state.request, key, receipt.digest, id, kind);
    return replay(tx, actor, id);
  });
}
