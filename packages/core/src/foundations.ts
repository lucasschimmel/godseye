import {
  type AuditAnchor,
  type CreateExecutionPlanInput,
  type EffectOutcomeInput,
  type ExecutionContext,
  FOUNDATION_DEFAULTS,
  type RegisterResourceInput,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { exportAudit } from "./audit-export.js";
import { DomainError } from "./errors.js";
import {
  adapterFor,
  type FoundationOptions,
  type FoundationState,
  foundationState,
  planFor,
  validateLease,
} from "./foundation-data.js";
import {
  advanceEpoch,
  cancel,
  finish,
  markUnknown,
  reconcile,
  reconcileExpired,
} from "./foundation-effects.js";
import { authorizeGrant, getGrant, heartbeat, validateGrant } from "./foundation-grants.js";
import { normalizeOutcome } from "./foundation-outcome.js";
import {
  approve,
  configureBudget,
  createPlan,
  getBudget,
  registerResource,
} from "./foundation-plans.js";
import { claim, enqueue, getRun, listRuns } from "./foundation-queue.js";
import { prune } from "./foundation-retention.js";
import { write } from "./journal.js";
import { type Actor, assertProjectAccess } from "./policy.js";

export type {
  AuditAnchor,
  AuditExportPage,
  CreateExecutionPlanInput,
  ExecutionAdapter,
  ExecutionContext,
} from "@godseye/contracts";
export type EffectOutcome = EffectOutcomeInput;
export type { EffectOutcomeInput } from "@godseye/contracts";
export { verifyAuditExport } from "./audit-export.js";
export type { FoundationOptions } from "./foundation-data.js";

/** Trusted broker boundary. No adapter is registered implicitly and identifiers never confer authority. */
export class FoundationEngine {
  private readonly state: FoundationState;
  constructor(store: Store, options: FoundationOptions = {}) {
    this.state = foundationState(store, options);
  }
  registerResource(actor: Actor, input: RegisterResourceInput, key: string) {
    return registerResource(this.state, actor, input, key);
  }
  configureBudget(
    actor: Actor,
    projectId: string,
    input: { limitMicros: number; expectedRevision: number },
    key: string,
  ) {
    return configureBudget(this.state, actor, projectId, input, key);
  }
  getBudget(actor: Actor, projectId: string) {
    return getBudget(this.state, actor, projectId);
  }
  createPlan(actor: Actor, input: CreateExecutionPlanInput, key: string) {
    return createPlan(this.state, actor, input, key);
  }
  getPlan(actor: Actor, id: string) {
    return planFor(this.state.store.db, actor, id);
  }
  approve(actor: Actor, planId: string, expectedHash: string, key: string) {
    return approve(this.state, actor, planId, expectedHash, key);
  }
  enqueue(actor: Actor, planId: string, key: string) {
    return enqueue(this.state, actor, planId, key);
  }
  getRun(actor: Actor, id: string) {
    return getRun(this.state, actor, id);
  }
  listRuns(actor: Actor) {
    return listRuns(this.state, actor);
  }
  claim(workerId: string) {
    return claim(this.state, workerId);
  }
  finish(context: ExecutionContext, outcome: EffectOutcomeInput) {
    return finish(this.state, context, outcome);
  }
  heartbeat(context: ExecutionContext) {
    return heartbeat(this.state, context);
  }
  authorizeGrant(
    context: ExecutionContext,
    input: { actorId: string; tool: string; destination: string; costMicros: number },
  ) {
    return authorizeGrant(this.state, context, input);
  }
  getGrant(actor: Actor, id: string) {
    return getGrant(this.state, actor, id);
  }
  assertDispatch(
    tx: DatabaseAccess,
    context: ExecutionContext,
    input: { actorId: string; tool: string; destination: string; costMicros: number },
  ) {
    return validateGrant(this.state, tx, context, input);
  }
  cancel(actor: Actor, id: string, key: string) {
    return cancel(this.state, actor, id, key);
  }
  advanceEpoch(actor: Actor, environmentId: string, key: string) {
    return advanceEpoch(this.state, actor, environmentId, key);
  }
  reconcileExpired() {
    return reconcileExpired(this.state);
  }
  reconcile(actor: Actor, id: string, key: string) {
    return reconcile(this.state, actor, id, key);
  }
  exportAudit(actor: Actor, cursor = 0, limit?: number) {
    return exportAudit(this.state, actor, cursor, limit);
  }
  prune(actor: Actor) {
    return prune(this.state, actor);
  }
  async auditAnchor(actor: Actor): Promise<AuditAnchor> {
    return (await this.exportAudit(actor, 0, 1)).anchor;
  }
  async getEffect(actor: Actor, runId: string) {
    const run = await this.getRun(actor, runId);
    assertProjectAccess(actor, run.projectId ?? "");
    const [effect] = await this.state.store.db
      .select()
      .from(schema.effects)
      .where(eq(schema.effects.runId, runId));
    return effect ?? null;
  }

  /** A real consumer loop iteration; failures after dispatch remain unknown rather than replayable. */
  async tick(workerId: string): Promise<boolean> {
    await this.reconcileExpired();
    const context = await this.claim(workerId);
    if (!context) return false;
    const actor: Actor = { id: workerId, kind: "service", projectIds: [context.projectId] };
    const plan = await this.getPlan(actor, context.planId);
    let heartbeatError: unknown = null;
    let pendingHeartbeat: Promise<void> | null = null;
    const timer = setInterval(
      () => {
        if (pendingHeartbeat || heartbeatError) return;
        pendingHeartbeat = this.heartbeat(context)
          .catch((error: unknown) => {
            heartbeatError = error;
            clearInterval(timer);
          })
          .finally(() => {
            pendingHeartbeat = null;
          });
      },
      Math.max(1, Math.min(FOUNDATION_DEFAULTS.heartbeatMs, Math.floor(this.state.leaseMs / 4))),
    );
    timer.unref();
    let outcome: EffectOutcomeInput;
    try {
      await write(this.state.store, (tx) => validateLease(this.state, tx, context));
      outcome = await adapterFor(this.state, plan.adapterId).execute(context);
    } catch {
      outcome = { status: "unknown", costMicros: 0 };
    } finally {
      clearInterval(timer);
    }
    if (pendingHeartbeat) await pendingHeartbeat;
    if (heartbeatError) outcome = { status: "unknown", costMicros: outcome.costMicros };
    outcome = normalizeOutcome(outcome);
    try {
      await this.finish(context, outcome);
    } catch (error) {
      if (
        !(error instanceof DomainError) ||
        !["FENCED", "RECOVERY_HOLD", "DELIVERY_HOLD"].includes(error.code)
      )
        throw error;
      await this.state.adapters.get(plan.adapterId)?.onFenced?.(context);
      await write(this.state.store, async (tx) => {
        const [operation] = await tx
          .select()
          .from(schema.operations)
          .where(eq(schema.operations.id, context.runId));
        if (operation?.status === "running")
          await markUnknown(tx, this.state, context.runId, "SETTLEMENT_FENCED");
      });
      await this.reconcileExpired();
    }
    return true;
  }
}

/** The runtime owns and awaits this pump; tests can drive individual deterministic ticks. */
export async function runFoundationWorker(
  engine: FoundationEngine,
  options: { workerId: string; signal: AbortSignal; idleMs?: number },
) {
  const idleMs = options.idleMs ?? FOUNDATION_DEFAULTS.reconcileMs;
  if (!Number.isSafeInteger(idleMs) || idleMs < 1) throw new Error("Invalid worker idle policy");
  while (!options.signal.aborted) {
    if (await engine.tick(options.workerId)) continue;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        options.signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, idleMs);
      options.signal.addEventListener("abort", done, { once: true });
      if (options.signal.aborted) done();
    });
  }
}
