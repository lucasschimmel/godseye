import { randomUUID } from "node:crypto";
import {
  ACTIVATION_ACKNOWLEDGEMENTS,
  ActivateRestore,
  type ActivateRestoreInput,
  type ActivationAssessmentView,
  RestoreActivation,
} from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { DomainError, parseInput } from "./errors.js";
import {
  currentEpoch,
  environmentFor,
  foundationState,
  recordRequest,
  requestFor,
} from "./foundation-data.js";
import { fenceEnvironment } from "./foundation-effects.js";
import { immutableSnapshot } from "./infra-policy.js";
import { appendAudit, fingerprint, write } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";
import { OPEN_OUTBOX, OPEN_RUNS } from "./project-lifecycle-view.js";
import {
  assertRecoveryPromotion,
  canPromote,
  type RecoveryProvider,
  type RecoveryScope,
} from "./recovery-provider.js";
import {
  qualifyRecovery,
  type RecoveryPreparationRow,
  type RecoveryState,
  recoveryFresh,
  recoveryPreparationFor,
  recoveryScope,
} from "./recovery-state.js";

type ActivationRow = typeof schema.recoveryActivations.$inferSelect;
type EnvironmentRow = typeof schema.environments.$inferSelect;
type BlockerCode = ActivationAssessmentView["reasons"][number];

export const activationView = (row: ActivationRow) =>
  RestoreActivation.parse({
    id: row.id,
    projectId: row.projectId,
    environmentId: row.environmentId,
    sourceEnvironmentId: row.sourceEnvironmentId,
    state: row.state,
    epoch: row.epoch,
    acknowledged: row.acknowledged,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
  });

async function activationRowFor(tx: DatabaseAccess, environmentId: string) {
  const [row] = await tx
    .select()
    .from(schema.recoveryActivations)
    .where(eq(schema.recoveryActivations.environmentId, environmentId));
  return row;
}

/** Work and unresolved effects on the source environment that the owner has to settle before fencing it. */
async function sourceBlockers(tx: DatabaseAccess, sourceId: string) {
  const reasons: BlockerCode[] = [];
  const runs = await tx
    .select({ id: schema.executionRuns.id })
    .from(schema.executionRuns)
    .where(
      and(
        eq(schema.executionRuns.environmentId, sourceId),
        isNull(schema.executionRuns.terminalAt),
      ),
    );
  const jobRuns = await tx
    .select({ id: schema.jobRuns.id })
    .from(schema.jobRuns)
    .where(
      and(eq(schema.jobRuns.environmentId, sourceId), inArray(schema.jobRuns.state, OPEN_RUNS)),
    );
  const outbox = await tx
    .select({ id: schema.jobOutbox.id })
    .from(schema.jobOutbox)
    .where(
      and(
        eq(schema.jobOutbox.environmentId, sourceId),
        inArray(schema.jobOutbox.state, OPEN_OUTBOX),
      ),
    );
  if (runs.length + jobRuns.length + outbox.length > 0) reasons.push("SOURCE_WORK_IN_FLIGHT");
  const effects = await tx
    .select({ id: schema.effects.id })
    .from(schema.effects)
    .innerJoin(schema.executionRuns, eq(schema.effects.runId, schema.executionRuns.id))
    .where(
      and(
        eq(schema.executionRuns.environmentId, sourceId),
        inArray(schema.effects.status, ["intent", "unknown"]),
      ),
    );
  if (effects.length > 0) reasons.push("UNRECONCILED_EFFECTS");
  return reasons;
}

async function retainedDefinitions(tx: DatabaseAccess, sourceId: string | null) {
  if (!sourceId) return { jobs: 0, backend: 0, domains: 0 };
  const jobs = await tx
    .select({ id: schema.jobDefinitions.id })
    .from(schema.jobDefinitions)
    .where(eq(schema.jobDefinitions.environmentId, sourceId));
  const backend = await tx
    .select({ id: schema.backendConfigurations.environmentId })
    .from(schema.backendConfigurations)
    .where(eq(schema.backendConfigurations.environmentId, sourceId));
  const domains = await tx
    .select({ id: schema.projectDomains.id })
    .from(schema.projectDomains)
    .where(
      and(
        eq(schema.projectDomains.environmentId, sourceId),
        ne(schema.projectDomains.state, "removed"),
      ),
    );
  return { jobs: jobs.length, backend: backend.length, domains: domains.length };
}

/** Everything the gate decides, derived from stored state; nothing here trusts a caller-supplied claim. */
export async function assessRestoreActivation(
  state: RecoveryState,
  tx: DatabaseAccess,
  actor: Actor,
  environmentId: string,
) {
  assertOwner(actor);
  const [env] = await tx
    .select()
    .from(schema.environments)
    .where(eq(schema.environments.id, environmentId));
  if (!env) throw new DomainError("NOT_FOUND", "Recovery environment not found", 404);
  await environmentFor(tx, actor, env.projectId, env.id, true);
  if (!env.recoveryHold || env.kind !== "recovery")
    throw new DomainError("RECOVERY_HOLD", "Environment is not held for recovery", 409);
  const [preparation] = await tx
    .select()
    .from(schema.recoveryPreparations)
    .where(
      and(
        eq(schema.recoveryPreparations.environmentId, env.id),
        eq(schema.recoveryPreparations.kind, "restore"),
      ),
    );
  const [run] = preparation
    ? await tx
        .select()
        .from(schema.recoveryRuns)
        .where(eq(schema.recoveryRuns.preparationId, preparation.id))
    : [];
  const activation = await activationRowFor(tx, env.id);
  const reasons: BlockerCode[] = [];
  if (!preparation || run?.state !== "restore-verified") reasons.push("RESTORE_NOT_VERIFIED");
  const [lifecycle] = await tx
    .select({ phase: schema.projectLifecycles.phase })
    .from(schema.projectLifecycles)
    .where(eq(schema.projectLifecycles.projectId, env.projectId));
  if (lifecycle) reasons.push("PROJECT_NOT_ACTIVE");
  const sourceId = preparation?.sourceEnvironmentId ?? null;
  const [source] = sourceId
    ? await tx.select().from(schema.environments).where(eq(schema.environments.id, sourceId))
    : [];
  // A started activation already fenced the source; its remaining work is proving promotion, not re-gating.
  if (!activation) {
    if (!source || source.recoveryHold || source.kind === "recovery")
      reasons.push("SOURCE_NOT_ACTIVE");
    else reasons.push(...(await sourceBlockers(tx, source.id)));
  }
  if (!canPromote(state.provider)) reasons.push("PROMOTION_UNAVAILABLE");
  const view: ActivationAssessmentView = {
    environmentId: env.id,
    sourceEnvironmentId: sourceId,
    recoveryHold: true,
    activation: reasons.length === 0 ? "ready" : "blocked",
    reasons,
    requiredAcknowledgements: [...ACTIVATION_ACKNOWLEDGEMENTS],
    pending: activation && activation.state !== "activated" ? activation.state : null,
    retainedDefinitions: await retainedDefinitions(tx, sourceId),
  };
  return { view, env, source, preparation, activation };
}

function assertConfirmation(
  data: ActivateRestoreInput,
  env: EnvironmentRow,
  project: typeof schema.projects.$inferSelect | undefined,
) {
  if (
    project?.revision !== data.expectedProjectRevision ||
    env.revision !== data.expectedEnvironmentRevision
  )
    throw new DomainError("REVISION_CONFLICT", "Project or restored environment changed", 409);
  if (data.confirmName !== env.name)
    throw new DomainError(
      "CONFIRMATION_MISMATCH",
      "Typed name does not match the environment",
      422,
    );
  const given = [...new Set(data.acknowledged)].sort();
  const required = [...ACTIVATION_ACKNOWLEDGEMENTS].sort();
  if (given.length !== data.acknowledged.length || fingerprint(given) !== fingerprint(required))
    throw new DomainError(
      "ACKNOWLEDGEMENT_REQUIRED",
      "Every missing coverage item must be acknowledged exactly once",
      422,
    );
}

interface Started {
  activation: ActivationRow;
  preparation: RecoveryPreparationRow;
  scope: RecoveryScope;
}
/** Phase one: gate, fence the source and record the durable intent in one control transaction. */
async function begin(
  state: RecoveryState,
  actor: Actor,
  environmentId: string,
  data: ActivateRestoreInput,
  key: string,
): Promise<{ replay: ActivationRow } | Started> {
  return write(state.store, async (tx) => {
    const request = await requestFor(tx, actor, key, "recovery.activate", { environmentId, data });
    if (request.existing) {
      const replay = await tx
        .select()
        .from(schema.recoveryActivations)
        .where(eq(schema.recoveryActivations.id, request.existing.resourceId));
      if (!replay[0]) throw new DomainError("NOT_FOUND", "Activation not found", 404);
      return { replay: replay[0] };
    }
    const assessed = await assessRestoreActivation(state, tx, actor, environmentId);
    const { env, source, preparation, activation } = assessed;
    const [project] = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, env.projectId));
    assertConfirmation(data, env, project);
    if (assessed.view.reasons.length > 0 || !preparation || !source || !project)
      throw new DomainError(
        "ACTIVATION_BLOCKED",
        `Activation is blocked: ${assessed.view.reasons.join(", ")}`,
        409,
      );
    const fresh = foundationState(state.store, { now: state.now });
    const now = state.now();
    let row = activation;
    if (row) {
      if (fingerprint([...row.acknowledged].sort()) !== fingerprint([...data.acknowledged].sort()))
        throw new DomainError(
          "ACKNOWLEDGEMENT_REQUIRED",
          "A started activation keeps its original acknowledgements",
          409,
        );
      await appendAudit(
        tx,
        actor,
        env.projectId,
        "recovery.activation_resumed",
        `Resumed activation of ${env.name}; source stays fenced until promotion is proven`,
      );
    } else {
      // Fence first: the source stops being usable before the restored copy can ever be promoted.
      await tx
        .update(schema.environments)
        .set({ recoveryHold: true, revision: source.revision + 1 })
        .where(eq(schema.environments.id, source.id));
      const epoch = await fenceEnvironment(tx, fresh, source.id);
      await tx
        .insert(schema.activationEpochs)
        .values({ environmentId: env.id, epoch })
        .onConflictDoUpdate({ target: schema.activationEpochs.environmentId, set: { epoch } });
      await tx
        .update(schema.projects)
        .set({ revision: project.revision + 1, updatedAt: now })
        .where(eq(schema.projects.id, project.id));
      row = {
        id: randomUUID(),
        projectId: env.projectId,
        environmentId: env.id,
        sourceEnvironmentId: source.id,
        preparationId: preparation.id,
        state: "fenced",
        epoch,
        acknowledged: [...data.acknowledged],
        reason: null,
        evidence: null,
        createdAt: now,
        updatedAt: now,
        activatedAt: null,
      };
      await tx.insert(schema.recoveryActivations).values(row);
      await appendAudit(
        tx,
        actor,
        env.projectId,
        "recovery.activation_fenced",
        `Fenced source ${source.name} at epoch ${epoch}; ${env.name} is not active until promotion is proven`,
      );
    }
    await recordRequest(tx, fresh, key, request.digest, row.id, "recovery.activate");
    const prepared = await recoveryPreparationFor(tx, preparation.id);
    return {
      activation: row,
      preparation: prepared,
      scope: await recoveryScope(tx, prepared, row.epoch, true),
    };
  });
}

async function markUncertain(state: RecoveryState, id: string, reason: string) {
  return write(state.store, async (tx) => {
    const [row] = await tx
      .update(schema.recoveryActivations)
      .set({ state: "unknown", reason, updatedAt: state.now() })
      .where(
        and(
          eq(schema.recoveryActivations.id, id),
          ne(schema.recoveryActivations.state, "activated"),
        ),
      )
      .returning();
    if (!row) throw new DomainError("FENCED", "Activation authority changed", 409);
    return row;
  });
}

/** The activation may continue only while it is unfinished and the source epoch is the one it recorded. */
async function activationGate(tx: DatabaseAccess, activation: ActivationRow) {
  const [row] = await tx
    .select()
    .from(schema.recoveryActivations)
    .where(eq(schema.recoveryActivations.id, activation.id));
  const [env] = await tx
    .select()
    .from(schema.environments)
    .where(eq(schema.environments.id, activation.environmentId));
  const [source] = await tx
    .select()
    .from(schema.environments)
    .where(eq(schema.environments.id, activation.sourceEnvironmentId));
  if (
    !row ||
    row.state === "activated" ||
    row.epoch !== activation.epoch ||
    !env?.recoveryHold ||
    env.kind !== "recovery" ||
    !source?.recoveryHold ||
    source.kind === "recovery" ||
    (await currentEpoch(tx, source.id)) !== activation.epoch
  )
    throw new DomainError("FENCED", "Activation authority changed", 409);
  return { env, source };
}

async function proveOrNull(provider: RecoveryProvider, scope: RecoveryScope) {
  try {
    const result = await provider.inspectPromotion?.(scope);
    return assertRecoveryPromotion(scope, result ?? null);
  } catch {
    return null;
  }
}

/** Phase three: designate the proven restore as the project's active environment and keep the source held. */
async function finish(
  state: RecoveryState,
  actor: Actor,
  activation: ActivationRow,
  evidence: string,
) {
  return write(state.store, async (tx) => {
    const { env, source } = await activationGate(tx, activation);
    const [project] = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, activation.projectId));
    if (!project) throw new DomainError("NOT_FOUND", "Project not found", 404);
    const now = state.now();
    // The unique (project, kind) index covers development/production, so the source leaves first.
    await tx
      .update(schema.environments)
      .set({ kind: "recovery", revision: source.revision + 1 })
      .where(eq(schema.environments.id, source.id));
    await tx
      .update(schema.environments)
      .set({ kind: source.kind, recoveryHold: false, revision: env.revision + 1 })
      .where(eq(schema.environments.id, env.id));
    await tx
      .update(schema.projects)
      .set({ revision: project.revision + 1, updatedAt: now })
      .where(eq(schema.projects.id, project.id));
    const [row] = await tx
      .update(schema.recoveryActivations)
      .set({ state: "activated", reason: null, evidence, updatedAt: now, activatedAt: now })
      .where(eq(schema.recoveryActivations.id, activation.id))
      .returning();
    await appendAudit(
      tx,
      actor,
      activation.projectId,
      "recovery.activated",
      `Activated restored environment ${env.name} as ${source.kind}; ${source.name} stays held as recovery evidence`,
    );
    if (!row) throw new DomainError("FENCED", "Activation authority changed", 409);
    return row;
  });
}

/**
 * Owner-confirmed restore activation (D08). Order matters and is durable: the source is fenced and the
 * intent recorded first, the provider promotes second, and the restored environment is designated active
 * only after an independent physical proof. Any doubt leaves both environments held.
 */
export async function activateRestore(
  state: RecoveryState,
  actorInput: Actor,
  environmentId: string,
  input: ActivateRestoreInput,
  key: string,
) {
  const actor = immutableSnapshot(actorInput);
  recoveryFresh(state, actor);
  const data = parseInput(ActivateRestore, input);
  const started = await begin(state, actor, environmentId, data, key);
  if ("replay" in started) return activationView(started.replay);
  const provider = state.provider;
  if (!canPromote(provider) || !provider)
    return activationView(
      await markUncertain(state, started.activation.id, "PROMOTION_UNAVAILABLE"),
    );
  const { activation, scope } = started;
  const gate = async () => {
    await qualifyRecovery(state, scope);
    await write(state.store, (tx) => activationGate(tx, activation));
  };
  try {
    await gate();
    let proof = await proveOrNull(provider, scope);
    if (!proof) {
      try {
        await provider.promote?.(scope, gate);
      } catch {
        // An acknowledgment can be lost after the physical change; the independent inspection decides.
      }
      proof = await proveOrNull(provider, scope);
    }
    if (!proof)
      return activationView(await markUncertain(state, activation.id, "PROMOTION_UNPROVEN"));
    await gate();
    return activationView(await finish(state, actor, activation, fingerprint(proof)));
  } catch (error) {
    const code = error instanceof DomainError ? error.code : "PROMOTION_UNPROVEN";
    return activationView(await markUncertain(state, activation.id, code.slice(0, 100)));
  }
}
