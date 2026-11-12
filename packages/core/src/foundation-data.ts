import { randomUUID } from "node:crypto";
import {
  type CreateExecutionPlanInput,
  type ExecutionAdapter,
  type ExecutionContext,
  FOUNDATION_DEFAULTS,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { DomainError } from "./errors.js";
import { fingerprint } from "./journal.js";
import { type Actor, assertOwner, assertProjectAccess } from "./policy.js";

export interface FoundationOptions {
  /** Server-owned consumer partition, applied before validation or lease reconciliation. */
  consumer?: {
    adapterIds?: ReadonlySet<string>;
    excludedAdapterIds?: ReadonlySet<string>;
    environmentIds?: ReadonlySet<string>;
  };
  /** Server-owned delegation; HTTP actor fields cannot select or broaden this authority. */
  delegatedAuthority?: (
    tx: DatabaseAccess,
    plan: CreateExecutionPlanInput,
    phase: "create" | "enqueue" | "approval",
    actor?: Actor,
  ) => Promise<boolean>;
  /** Trusted server-side admission participates in the existing enqueue transaction. */
  admission?: (
    tx: DatabaseAccess,
    plan: typeof schema.executionPlans.$inferSelect,
    runId: string,
    actor: Actor,
  ) => Promise<void>;
  /** Rechecks queue admission without repeating the physical reservations of an existing run. */
  requeueAdmission?: (
    tx: DatabaseAccess,
    plan: typeof schema.executionPlans.$inferSelect,
    runId: string,
    actor: Actor,
  ) => Promise<void>;
  /** Trusted gate for the worker claim; returning false leaves the run queued (e.g. heavy-task concurrency). */
  claimGate?: (
    tx: DatabaseAccess,
    plan: typeof schema.executionPlans.$inferSelect,
    runId: string,
  ) => Promise<boolean>;
  approvalPolicy?: (input: CreateExecutionPlanInput) => boolean;
  releaseQueued?: (tx: DatabaseAccess, runId: string) => Promise<void>;
  settlement?: (tx: DatabaseAccess, runId: string, status: string) => Promise<void>;
  uncertainty?: (tx: DatabaseAccess, runId: string) => Promise<void>;
  adapters?: ExecutionAdapter[];
  now?: () => Date;
  leaseMs?: number;
  approvalMs?: number;
  restoreWindowMs?: number;
}
export interface FoundationState {
  consumer?: FoundationOptions["consumer"];
  delegatedAuthority?: FoundationOptions["delegatedAuthority"];
  admission?: FoundationOptions["admission"];
  requeueAdmission?: FoundationOptions["requeueAdmission"];
  approvalPolicy?: FoundationOptions["approvalPolicy"];
  claimGate?: FoundationOptions["claimGate"];
  releaseQueued?: FoundationOptions["releaseQueued"];
  settlement?: FoundationOptions["settlement"];
  uncertainty?: FoundationOptions["uncertainty"];
  store: Store;
  now: () => Date;
  leaseMs: number;
  approvalMs: number;
  restoreWindowMs: number;
  adapters: ReadonlyMap<string, ExecutionAdapter>;
}
export function foundationState(store: Store, options: FoundationOptions): FoundationState {
  const adapters = new Map<string, ExecutionAdapter>();
  for (const adapter of options.adapters ?? []) {
    if (adapters.has(adapter.id)) throw new Error("Duplicate execution adapter ID");
    adapters.set(adapter.id, adapter);
  }
  const state = {
    consumer: options.consumer,
    delegatedAuthority: options.delegatedAuthority,
    admission: options.admission,
    requeueAdmission: options.requeueAdmission,
    approvalPolicy: options.approvalPolicy,
    claimGate: options.claimGate,
    releaseQueued: options.releaseQueued,
    settlement: options.settlement,
    uncertainty: options.uncertainty,
    store,
    now: options.now ?? (() => new Date()),
    leaseMs: options.leaseMs ?? FOUNDATION_DEFAULTS.leaseMs,
    approvalMs: options.approvalMs ?? FOUNDATION_DEFAULTS.approvalMs,
    restoreWindowMs: options.restoreWindowMs ?? FOUNDATION_DEFAULTS.restoreWindowMs,
    adapters,
  };
  if (
    ![state.leaseMs, state.approvalMs, state.restoreWindowMs].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) ||
    state.approvalMs > FOUNDATION_DEFAULTS.approvalMs
  )
    throw new Error("Invalid foundation policy durations");
  return state;
}
export function adapterFor(state: FoundationState, id: string) {
  const adapter = state.adapters.get(id);
  if (!adapter?.qualified)
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "Execution adapter is not registered and qualified",
      503,
    );
  return adapter;
}
export function assertFresh(actor: Actor, state: FoundationState) {
  assertOwner(actor);
  const authenticated = actor.authenticatedAt ? Date.parse(actor.authenticatedAt) : Number.NaN;
  const age = state.now().getTime() - authenticated;
  if (!actor.sessionId || !Number.isFinite(age) || age < 0 || age > state.approvalMs)
    throw new DomainError(
      "STEP_UP_REQUIRED",
      "A recent verified owner passkey session is required",
      403,
    );
}
export async function environmentFor(
  tx: DatabaseAccess,
  actor: Actor,
  projectId: string,
  environmentId: string,
  allowRecoveryHold = false,
  allowDeliveryCleanup = false,
  now = new Date(),
) {
  assertProjectAccess(actor, projectId);
  const [environment] = await tx
    .select()
    .from(schema.environments)
    .where(eq(schema.environments.id, environmentId));
  if (!environment || environment.projectId !== projectId)
    throw new DomainError(
      "FORBIDDEN",
      "Environment does not belong to the authorized project",
      403,
    );
  if (environment.recoveryHold && !allowRecoveryHold)
    throw new DomainError(
      "RECOVERY_HOLD",
      "Recovery environment cannot receive ordinary authority",
      409,
    );
  const [preview] = await tx
    .select()
    .from(schema.deliveryPreviews)
    .where(eq(schema.deliveryPreviews.environmentId, environmentId));
  if (
    preview &&
    !allowRecoveryHold &&
    !allowDeliveryCleanup &&
    (["cleanup-required", "retired", "unknown"].includes(preview.state) ||
      preview.expiresAt.getTime() <= now.getTime())
  )
    throw new DomainError(
      "DELIVERY_HOLD",
      "Expired or closing delivery preview cannot receive ordinary authority",
      409,
    );
  return environment;
}
export async function planFor(tx: DatabaseAccess, actor: Actor, id: string) {
  const [plan] = await tx
    .select()
    .from(schema.executionPlans)
    .where(eq(schema.executionPlans.id, id));
  if (!plan) throw new DomainError("NOT_FOUND", "Execution plan not found", 404);
  assertProjectAccess(actor, plan.projectId);
  return plan;
}
export async function runFor(tx: DatabaseAccess, id: string) {
  const [row] = await tx
    .select({ run: schema.executionRuns, operation: schema.operations })
    .from(schema.executionRuns)
    .innerJoin(schema.operations, eq(schema.executionRuns.id, schema.operations.id))
    .where(eq(schema.executionRuns.id, id));
  if (!row) throw new DomainError("NOT_FOUND", "Execution run not found", 404);
  return row;
}
export async function currentEpoch(tx: DatabaseAccess, environmentId: string) {
  const [row] = await tx
    .select()
    .from(schema.activationEpochs)
    .where(eq(schema.activationEpochs.environmentId, environmentId));
  return row?.epoch ?? 1;
}
export async function validateLease(
  state: FoundationState,
  tx: DatabaseAccess,
  context: ExecutionContext,
  readOnlyReconciliation = false,
) {
  const row = await runFor(tx, context.runId);
  if (
    row.operation.status !== (readOnlyReconciliation ? "reconciling" : "running") ||
    row.run.workerId !== context.workerId ||
    row.run.fence !== context.fence ||
    row.run.epoch !== context.epoch ||
    row.run.planId !== context.planId ||
    row.run.grantId !== context.grantId ||
    row.run.projectId !== context.projectId ||
    row.run.environmentId !== context.environmentId ||
    !row.run.leaseExpiresAt ||
    row.run.leaseExpiresAt.getTime() <= state.now().getTime() ||
    (!readOnlyReconciliation && (await currentEpoch(tx, row.run.environmentId)) !== context.epoch)
  )
    throw new DomainError("FENCED", "Execution lease is expired or fenced", 409);
  const [effect] = await tx
    .select()
    .from(schema.effects)
    .where(eq(schema.effects.runId, context.runId));
  const plan = await planFor(
    tx,
    { id: "executor", kind: "service", projectIds: [row.run.projectId] },
    row.run.planId,
  );
  if (
    !effect ||
    effect.effectKey !== context.effectKey ||
    fingerprint(plan.command) !== fingerprint(context.command)
  )
    throw new DomainError(
      "FENCED",
      "Execution context does not match its recorded scope or command",
      409,
    );
  await environmentFor(
    tx,
    { id: "executor", kind: "service", projectIds: [row.run.projectId] },
    row.run.projectId,
    row.run.environmentId,
    false,
    plan.command.kind === "delivery.lifecycle" && plan.command.intent === "cleanup",
    state.now(),
  );
  return row;
}
export async function requestFor(
  tx: DatabaseAccess,
  actor: Actor,
  key: string,
  kind: string,
  input: unknown,
) {
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key))
    throw new DomainError("INVALID_IDEMPOTENCY_KEY", "A valid idempotency key is required", 400);
  const digest = fingerprint({ actorId: actor.id, kind, input });
  const [existing] = await tx
    .select()
    .from(schema.foundationRequests)
    .where(eq(schema.foundationRequests.key, key));
  if (existing && existing.fingerprint !== digest)
    throw new DomainError("IDEMPOTENCY_CONFLICT", "This key identifies a different request", 409);
  return { digest, existing };
}
export async function recordRequest(
  tx: DatabaseAccess,
  state: FoundationState,
  key: string,
  digest: string,
  resourceId: string,
  kind: string,
  terminal = true,
) {
  await tx.insert(schema.foundationRequests).values({
    key,
    fingerprint: digest,
    resourceId,
    kind,
    createdAt: state.now(),
    terminalAt: terminal ? state.now() : null,
  });
}
export function needsApproval(input: CreateExecutionPlanInput, production: boolean) {
  const command = input.command;
  if (
    command.kind === "settings.update" ||
    command.kind === "publication.publish" ||
    command.kind === "storage.configure"
  )
    return true;
  if (command.kind === "domain.configure") return production;
  if ("intent" in command && ["purge", "quarantine"].includes(command.intent)) return true;
  return (
    production &&
    ((command.kind === "deployment.release" && command.intent !== "restart") ||
      (command.kind === "database.operation" && ["migrate", "restore"].includes(command.intent)))
  );
}
export const newId = randomUUID;

export function consumesAdapter(state: FoundationState, adapterId: string, environmentId?: string) {
  return (
    (!state.consumer?.adapterIds || state.consumer.adapterIds.has(adapterId)) &&
    (!state.consumer?.environmentIds ||
      (!!environmentId && state.consumer.environmentIds.has(environmentId))) &&
    !state.consumer?.excludedAdapterIds?.has(adapterId)
  );
}
