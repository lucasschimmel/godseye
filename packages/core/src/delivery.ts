import { setTimeout as wait } from "node:timers/promises";
import type {
  AdmitDeliveryInput,
  CreateDeliveryPolicyInput,
  CreateExecutionPlanInput,
  ExecutionContext,
  PrepareDeliveryInput,
} from "@godseye/contracts";
import { DeliveryOverview, DeliveryPreview } from "@godseye/contracts";
import type { DatabaseAccess, Store } from "@godseye/store";
import { schema } from "@godseye/store";
import { admitDelivery, reserveDelivery } from "./delivery-admission.js";
import { deliveryDelegatedAuthority } from "./delivery-authority.js";
import { executeDelivery } from "./delivery-execution.js";
import { migrationBindingsByPreparation, rollbackMigrationBlocker } from "./delivery-migration.js";
import { createDeliveryPolicy, revokeDeliveryPolicy } from "./delivery-policy.js";
import { prepareDelivery } from "./delivery-preparation.js";
import type { DeliveryProvider, GithubSourceProvider } from "./delivery-provider.js";
import {
  cleanupExpiredDelivery,
  deliverySchedulerTick,
  synchronizeDelivery,
} from "./delivery-scheduler.js";
import { releaseQueuedDelivery, settleDelivery, uncertainDelivery } from "./delivery-settlement.js";
import {
  DELIVERY_ADAPTER_ID,
  type DeliveryState,
  deliveryPreparationView,
  deliveryRunView,
  policyView,
} from "./delivery-state.js";
import { deliveryLockView, deliveryUsageView } from "./delivery-usage.js";
import type { FoundationEngine } from "./foundations.js";
import { type Actor, assertOwner } from "./policy.js";

export * from "./delivery-github.js";
export * from "./delivery-managed-provider.js";
export * from "./delivery-provider.js";
export { DELIVERY_ADAPTER_ID, DELIVERY_DESTINATION } from "./delivery-state.js";
export interface DeliveryOptions {
  now: () => Date;
  provider?: DeliveryProvider;
  sourceProvider?: GithubSourceProvider;
}
/** Application delivery composes the existing queue, capacity and authority; never runs repository scripts on the controller. */
export class DeliveryEngine {
  private state!: DeliveryState;
  constructor(
    private readonly store: Store,
    private readonly options: DeliveryOptions,
  ) {}
  bind(foundation: FoundationEngine) {
    this.state = {
      store: this.store,
      now: this.options.now,
      foundation,
      provider: this.options.provider,
      sourceProvider: this.options.sourceProvider,
    };
  }
  get adapter() {
    const self = this;
    return {
      id: DELIVERY_ADAPTER_ID,
      get qualified() {
        return !!self.options.provider;
      },
      execute: (context: ExecutionContext) => executeDelivery(self.state, context),
      reconcile: (context: ExecutionContext) => executeDelivery(self.state, context, true),
    };
  }
  createPolicy(actor: Actor, input: CreateDeliveryPolicyInput, key: string) {
    return createDeliveryPolicy(this.state, actor, input, key);
  }
  revokePolicy(actor: Actor, id: string, expectedRevision: number, key: string) {
    return revokeDeliveryPolicy(this.state, actor, id, expectedRevision, key);
  }
  prepare(actor: Actor, input: PrepareDeliveryInput, key: string) {
    return prepareDelivery(this.state, actor, input, key);
  }
  admit(actor: Actor, input: AdmitDeliveryInput, key: string) {
    return admitDelivery(this.state, actor, input, key);
  }
  synchronize(actor: Actor, input: { policyId: string }, key: string) {
    return synchronizeDelivery(this.state, actor, input.policyId, key);
  }
  cleanupExpired(actor: Actor, key: string) {
    return cleanupExpiredDelivery(this.state, actor, key);
  }
  tick() {
    return deliverySchedulerTick(this.state);
  }
  reserve(
    tx: DatabaseAccess,
    plan: typeof schema.executionPlans.$inferSelect,
    runId: string,
    actor: Actor,
  ) {
    return reserveDelivery(this.state, tx, plan, runId, actor);
  }
  delegatedAuthority(
    tx: DatabaseAccess,
    plan: CreateExecutionPlanInput,
    phase: "create" | "enqueue" | "approval",
    actor?: Actor,
  ) {
    return deliveryDelegatedAuthority(this.state, tx, plan, phase, actor);
  }
  releaseQueued(tx: DatabaseAccess, runId: string) {
    return releaseQueuedDelivery(this.state, tx, runId);
  }
  settlement(tx: DatabaseAccess, runId: string, status: string) {
    return settleDelivery(this.state, tx, runId, status);
  }
  uncertainty(tx: DatabaseAccess, runId: string) {
    return uncertainDelivery(this.state, tx, runId);
  }
  async overview(actor: Actor) {
    assertOwner(actor);
    const [policies, preparations, artifacts, deployments, previews, usage, locks] =
      await Promise.all([
        this.store.db.select().from(schema.deliveryPolicies),
        this.store.db.select().from(schema.deliveryPreparations),
        this.store.db.select().from(schema.deliveryArtifacts),
        this.store.db.select().from(schema.deliveryRuns),
        this.store.db.select().from(schema.deliveryPreviews),
        this.store.db.select().from(schema.deliveryUsage),
        this.store.db.select().from(schema.deliveryMigrationLocks),
      ]);
    const bindings = await migrationBindingsByPreparation(this.store.db);
    return DeliveryOverview.parse({
      source: this.options.sourceProvider ? "configured" : "unconfigured",
      execution: this.options.provider ? "configured" : "unconfigured",
      remoteQualification: "unqualified",
      policies: policies.map(policyView),
      preparations: preparations.map(deliveryPreparationView),
      artifacts: artifacts.map((row) => row.metadata),
      deployments: deployments.map(deliveryRunView),
      previews: previews.map((row) =>
        DeliveryPreview.parse({
          ...row,
          url:
            row.state === "active" && row.expiresAt.getTime() > this.options.now().getTime()
              ? row.url
              : null,
          dataPolicy: "synthetic-only",
          expiresAt: row.expiresAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }),
      ),
      usage: usage.map(deliveryUsageView),
      migrationLocks: locks.map(deliveryLockView),
      rollbackBlocked: deployments
        .filter(
          (run) =>
            run.artifactId &&
            ["active", "retired"].includes(run.state) &&
            rollbackMigrationBlocker(deployments, (id) => bindings.get(id), run),
        )
        .map((run) => run.id),
    });
  }
}
export async function runDeliveryScheduler(
  engine: DeliveryEngine,
  options: { signal: AbortSignal; intervalMs?: number },
) {
  while (!options.signal.aborted) {
    await engine.tick();
    try {
      await wait(options.intervalMs ?? 1000, undefined, { signal: options.signal });
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "AbortError") throw error;
    }
  }
}
