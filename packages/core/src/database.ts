import type {
  AdmitDatabaseInput,
  ExecutionContext,
  PrepareDatabaseInput,
  ProtectionStateView,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { databaseExecutionGate, executeDatabase, reconcileDatabase } from "./database-execution.js";
import { admitDatabase, prepareDatabase, reserveDatabase } from "./database-preparation.js";
import type { DatabaseProvider } from "./database-provider.js";
import {
  DATABASE_ADAPTER_ID,
  type DatabaseState,
  databaseAllocationView,
  databasePreparationView,
} from "./database-state.js";
import { DomainError } from "./errors.js";
import { contextFor } from "./foundation-queue.js";
import type { FoundationEngine } from "./foundations.js";
import { type Actor, assertOwner } from "./policy.js";

export * from "./database-material.js";
export * from "./database-policy.js";
export * from "./database-postgres.js";
export * from "./database-provider.js";
export * from "./database-rotation.js";
export * from "./database-sql.js";
export { DATABASE_ADAPTER_ID, DATABASE_DESTINATION } from "./database-state.js";

/** Composes into the infrastructure engine's one FoundationEngine; never owns a second queue. */
export class DatabaseEngine {
  private state!: DatabaseState;
  constructor(
    private readonly store: Store,
    private readonly options: { now: () => Date; provider?: DatabaseProvider },
  ) {}
  private protection?: () => Promise<{
    backup: ProtectionStateView;
    restore: ProtectionStateView;
    rotation: ProtectionStateView;
  }>;
  /** Derived backup/restore/rotation flags; without a source they are honestly `unconfigured`. */
  bindProtection(source: NonNullable<DatabaseEngine["protection"]>) {
    this.protection = source;
  }
  bind(foundation: FoundationEngine) {
    this.state = {
      store: this.store,
      now: this.options.now,
      provider: this.options.provider,
      foundation,
    };
  }
  get adapter() {
    const self = this;
    return {
      id: DATABASE_ADAPTER_ID,
      get qualified() {
        return !!self.options.provider;
      },
      execute: (context: ExecutionContext) => executeDatabase(self.state, context),
      reconcile: (context: ExecutionContext) => reconcileDatabase(self.state, context),
      onFenced: async (_context: ExecutionContext) => {
        /* Durable uncertainty retains the exact physical reservation. */
      },
    };
  }
  prepare(actor: Actor, input: PrepareDatabaseInput, key: string) {
    return prepareDatabase(this.state, actor, input, key);
  }
  admit(actor: Actor, input: AdmitDatabaseInput, key: string) {
    return admitDatabase(this.state, actor, input, key);
  }
  async overview(actor: Actor) {
    assertOwner(actor);
    let execution: "qualified" | "unconfigured" = "unconfigured";
    try {
      const { qualifyDatabase } = await import("./database-state.js");
      await qualifyDatabase(this.state);
      execution = "qualified";
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
    }
    const preparations = await this.store.db.select().from(schema.databasePreparations);
    const allocations = await this.store.db.select().from(schema.databaseAllocations);
    const flags = (await this.protection?.()) ?? {
      backup: "unconfigured" as const,
      restore: "unconfigured" as const,
      rotation: "unconfigured" as const,
    };
    return {
      execution,
      ...flags,
      preparations: preparations.map(databasePreparationView),
      allocations: allocations.map(databaseAllocationView),
    };
  }
  reserve(
    tx: DatabaseAccess,
    plan: typeof schema.executionPlans.$inferSelect,
    runId: string,
    actor: Actor,
  ) {
    return reserveDatabase(this.state, tx, plan, runId, actor);
  }
  async releaseQueued(tx: DatabaseAccess, runId: string) {
    const [row] = await tx
      .select()
      .from(schema.databaseAllocations)
      .where(eq(schema.databaseAllocations.runId, runId));
    if (!row) return;
    const steps = await tx
      .select()
      .from(schema.databaseSteps)
      .where(eq(schema.databaseSteps.runId, runId));
    if (steps.length)
      throw new DomainError(
        "JOURNAL_INCONSISTENT",
        "Queued database operation has physical intentions",
        500,
      );
    await tx
      .update(schema.databaseAllocations)
      .set({
        state: row.systemIdentifier
          ? row.requestedState === "suspended"
            ? "ready"
            : "suspended"
          : "released",
        reason: "Queued operation ended before dispatch",
        updatedAt: this.state.now(),
      })
      .where(eq(schema.databaseAllocations.id, row.id));
  }
  async uncertainty(tx: DatabaseAccess, runId: string) {
    const [row] = await tx
      .select()
      .from(schema.databaseAllocations)
      .where(eq(schema.databaseAllocations.runId, runId));
    if (row && row.state !== "quarantined")
      await tx
        .update(schema.databaseAllocations)
        .set({
          state: "unknown",
          reason: "PROVIDER_OUTCOME_UNCERTAIN",
          updatedAt: this.state.now(),
        })
        .where(eq(schema.databaseAllocations.id, row.id));
  }
  async settlement(tx: DatabaseAccess, runId: string, status: string) {
    const [row] = await tx
      .select()
      .from(schema.databaseAllocations)
      .where(eq(schema.databaseAllocations.runId, runId));
    if (!row || status !== "succeeded") return;
    const context = await contextFor(tx, runId);
    const { runFor } = await import("./foundation-data.js");
    const { operation } = await runFor(tx, runId);
    await databaseExecutionGate(this.state, tx, context, operation.status === "reconciling", true);
    if (operation.status === "reconciling") {
      const [preparation] = await tx
        .select()
        .from(schema.databasePreparations)
        .where(eq(schema.databasePreparations.id, row.preparationId));
      const [project] = await tx
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, row.projectId));
      const [environment] = await tx
        .select()
        .from(schema.environments)
        .where(eq(schema.environments.id, row.environmentId));
      if (
        !preparation ||
        project?.revision !== preparation.expectedProjectRevision ||
        environment?.revision !== preparation.expectedEnvironmentRevision ||
        (row.requestedState === "ready" &&
          environment.expiresAt &&
          environment.expiresAt.getTime() <= this.state.now().getTime())
      )
        throw new DomainError(
          "FENCED",
          "Historical database observation cannot promote stale project authority",
          409,
        );
    }
    const [step] = await tx
      .select()
      .from(schema.databaseSteps)
      .where(eq(schema.databaseSteps.runId, runId));
    if (step?.state !== "inspected" || !step.evidence || !row.systemIdentifier || !row.providerRef)
      throw new DomainError("FENCED", "Independent database inspection evidence is missing", 409);
    await tx
      .update(schema.databaseAllocations)
      .set({ state: row.requestedState, reason: null, updatedAt: this.state.now() })
      .where(eq(schema.databaseAllocations.id, row.id));
  }
}
