import { randomUUID } from "node:crypto";
import {
  DATABASE_ROLES,
  type ProtectionStateView,
  RotateDatabaseRole,
  type RotateDatabaseRoleInput,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import type { DatabaseProviderScope } from "./database-provider.js";
import type {
  DatabaseRotationProvider,
  DatabaseRotationTarget,
} from "./database-rotation-provider.js";
import { rotationOverview, rotationQualified, rotationView } from "./database-rotation-view.js";
import { compiledDatabase, databasePreparationFor } from "./database-state.js";
import { DomainError, parseInput } from "./errors.js";
import {
  assertFresh,
  environmentFor,
  foundationState,
  recordRequest,
  requestFor,
} from "./foundation-data.js";
import { immutableSnapshot } from "./infra-policy.js";
import { appendAudit, write } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";

export * from "./database-rotation-provider.js";

type Row = typeof schema.databaseRotations.$inferSelect;
const ACTIVE = ["intended", "applying", "unknown"];

interface Source {
  scope: DatabaseProviderScope;
  target: DatabaseRotationTarget;
}
/**
 * Durable-intent role rotation. It runs beside, not through, the Foundation queue: the intent row,
 * single-active-rotation index, idempotency receipt and audit entry are the journal. No secret value
 * is ever stored or returned; only public verifier fingerprints are.
 */
export class DatabaseRotationEngine {
  constructor(
    private readonly store: Store,
    private readonly options: { now: () => Date; provider?: DatabaseRotationProvider },
  ) {}
  private get fresh() {
    return foundationState(this.store, { now: this.options.now });
  }
  async overview(actor: Actor) {
    assertOwner(actor);
    return rotationOverview(this.store, this.options);
  }
  async protection(): Promise<ProtectionStateView> {
    const view = await rotationOverview(this.store, this.options);
    if (view.execution === "unconfigured") return "unconfigured";
    const latest = new Map<string, string>();
    for (const item of view.rotations) latest.set(`${item.allocationId}:${item.role}`, item.state);
    if (view.execution === "unavailable") return "unavailable";
    if (!latest.size) return "none";
    return [...latest.values()].some((state) => ["failed", "unknown"].includes(state))
      ? "degraded"
      : "healthy";
  }
  async rotate(actorInput: Actor, input: RotateDatabaseRoleInput, key: string) {
    const actor = immutableSnapshot(actorInput),
      data = parseInput(RotateDatabaseRole, input);
    assertFresh(actor, this.fresh);
    const provider = await this.provider();
    const intent = await write(this.store, async (tx) => {
      const request = await requestFor(tx, actor, key, "database.rotate", data);
      if (request.existing) return { row: await this.row(tx, request.existing.resourceId) };
      const source = await this.source(tx, actor, data, true);
      const busy = (
        await tx
          .select()
          .from(schema.databaseRotations)
          .where(eq(schema.databaseRotations.allocationId, data.allocationId))
      ).some((item) => item.role === data.role && ACTIVE.includes(item.state));
      if (busy)
        throw new DomainError(
          "ROTATION_IN_PROGRESS",
          "A rotation for this role is unresolved",
          409,
        );
      const now = this.options.now();
      const row: Row = {
        id: randomUUID(),
        projectId: data.projectId,
        environmentId: data.environmentId,
        allocationId: data.allocationId,
        role: data.role,
        slotId: data.slotId,
        state: "intended",
        reason: null,
        generation: data.expectedGeneration,
        attempts: 0,
        previousVerifier: null,
        nextVerifier: null,
        createdAt: now,
        updatedAt: now,
        settledAt: null,
      };
      await tx.insert(schema.databaseRotations).values(row);
      await recordRequest(tx, this.fresh, key, request.digest, row.id, "database.rotate", false);
      await appendAudit(
        tx,
        actor,
        row.projectId,
        "database.rotation.intended",
        `Rotation ${row.id}`,
      );
      return { row, source };
    });
    if (!("source" in intent) || !intent.source) return rotationView(intent.row);
    return this.execute(provider, intent.row, intent.source);
  }
  async reconcile(actorInput: Actor, id: string, key: string) {
    const actor = immutableSnapshot(actorInput);
    assertFresh(actor, this.fresh);
    const provider = await this.provider();
    const row = await write(this.store, async (tx) => {
      const request = await requestFor(tx, actor, key, "database.rotation.reconcile", { id });
      const current = await this.row(tx, id);
      if (request.existing || !ACTIVE.includes(current.state)) return { row: current, run: false };
      await recordRequest(tx, this.fresh, key, request.digest, id, "database.rotation.reconcile");
      return { row: current, run: true };
    });
    if (!row.run) return rotationView(row.row);
    const source = await write(this.store, (tx) =>
      this.source(
        tx,
        actor,
        {
          ...row.row,
          role: row.row.role as RotateDatabaseRoleInput["role"],
          expectedGeneration: row.row.generation,
        },
        false,
      ),
    );
    return this.resolve(provider, row.row, source);
  }
  private async execute(provider: DatabaseRotationProvider, row: Row, source: Source) {
    const applying = await this.transition(row.id, "applying", null, {
      attempts: row.attempts + 1,
    });
    let before: Awaited<ReturnType<DatabaseRotationProvider["inspect"]>>;
    try {
      before = await provider.inspect(source.scope, source.target, row.id);
    } catch {
      before = { outcome: "unknown" as const, verifier: null };
    }
    if (before.outcome !== "prior")
      return rotationView(await this.transition(row.id, "failed", "PRECHECK_UNAVAILABLE", {}));
    await this.transition(row.id, "applying", null, { previousVerifier: before.verifier });
    const dispatch = () => this.assertDispatch(row.id, row.allocationId, row.generation);
    try {
      await provider.rotate(source.scope, source.target, row.id, dispatch);
    } catch {
      // Provider text is discarded; the outcome is established only by independent inspection.
    }
    return this.resolve(provider, applying, source);
  }
  private async resolve(provider: DatabaseRotationProvider, row: Row, source: Source) {
    let inspection: { outcome: "rotated" | "prior" | "unknown"; verifier: string | null };
    try {
      inspection = await provider.inspect(source.scope, source.target, row.id);
    } catch {
      inspection = { outcome: "unknown", verifier: null };
    }
    const current = await write(this.store, (tx) => this.row(tx, row.id));
    if (inspection.outcome === "unknown")
      return rotationView(
        await this.transition(row.id, "unknown", "PROVIDER_OUTCOME_UNCERTAIN", {}),
      );
    if (inspection.outcome === "prior") {
      await provider
        .settle(source.scope, source.target, row.id, "discarded")
        .catch(() => undefined);
      return rotationView(await this.transition(row.id, "failed", "ROTATION_NOT_APPLIED", {}));
    }
    if (current.previousVerifier && inspection.verifier === current.previousVerifier)
      return rotationView(await this.transition(row.id, "unknown", "VERIFIER_UNCHANGED", {}));
    try {
      await provider.settle(source.scope, source.target, row.id, "committed");
    } catch {
      return rotationView(
        await this.transition(row.id, "unknown", "MATERIAL_HANDOFF_UNCERTAIN", {
          nextVerifier: inspection.verifier,
        }),
      );
    }
    return rotationView(
      await this.transition(row.id, "succeeded", null, { nextVerifier: inspection.verifier }),
    );
  }
  private transition(
    id: string,
    state: Row["state"],
    reason: string | null,
    patch: Partial<Pick<Row, "attempts" | "previousVerifier" | "nextVerifier">>,
  ) {
    return write(this.store, async (tx) => {
      const now = this.options.now();
      const terminal = state === "succeeded" || state === "failed";
      await tx
        .update(schema.databaseRotations)
        .set({ ...patch, state, reason, updatedAt: now, settledAt: terminal ? now : null })
        .where(eq(schema.databaseRotations.id, id));
      const row = await this.row(tx, id);
      await appendAudit(
        tx,
        { id: "rotation", kind: "service", projectIds: [row.projectId] },
        row.projectId,
        `database.rotation.${state}`,
        `Rotation ${id}`,
      );
      return row;
    });
  }
  private async assertDispatch(id: string, allocationId: string, generation: number) {
    const [row] = await this.store.db
      .select()
      .from(schema.databaseRotations)
      .where(eq(schema.databaseRotations.id, id));
    const [allocation] = await this.store.db
      .select()
      .from(schema.databaseAllocations)
      .where(eq(schema.databaseAllocations.id, allocationId));
    if (
      row?.state !== "applying" ||
      allocation?.state !== "ready" ||
      allocation.generation !== generation
    )
      throw new DomainError("FENCED", "Rotation authority changed before dispatch", 409);
  }
  private async provider() {
    const provider = this.options.provider;
    if (!provider || !(await rotationQualified(provider, this.options.now())))
      throw new DomainError(
        "CAPABILITY_UNAVAILABLE",
        "A fresh qualified database rotation provider is required",
        503,
      );
    return provider;
  }
  private async row(tx: DatabaseAccess, id: string) {
    const [row] = await tx
      .select()
      .from(schema.databaseRotations)
      .where(eq(schema.databaseRotations.id, id));
    if (!row) throw new DomainError("NOT_FOUND", "Rotation not found", 404);
    return row;
  }
  private async source(
    tx: DatabaseAccess,
    actor: Actor,
    data: Pick<
      RotateDatabaseRoleInput,
      "projectId" | "environmentId" | "allocationId" | "role" | "slotId" | "expectedGeneration"
    >,
    requireReady: boolean,
  ): Promise<Source> {
    await environmentFor(tx, actor, data.projectId, data.environmentId);
    const [allocation] = await tx
      .select()
      .from(schema.databaseAllocations)
      .where(eq(schema.databaseAllocations.id, data.allocationId));
    const scope = allocation?.verifiedScope as unknown as DatabaseProviderScope | null;
    if (
      !allocation ||
      allocation.projectId !== data.projectId ||
      allocation.environmentId !== data.environmentId ||
      !scope ||
      scope.allocationId !== allocation.id ||
      (requireReady && allocation.state !== "ready")
    )
      throw new DomainError(
        "SOURCE_UNAVAILABLE",
        "Exact verified database allocation is required",
        409,
      );
    if (requireReady && allocation.generation !== data.expectedGeneration)
      throw new DomainError("REVISION_CONFLICT", "Database allocation generation changed", 409);
    if (data.slotId) await this.assertSlot(tx, data);
    const profile = compiledDatabase(await databasePreparationFor(tx, allocation.preparationId));
    if (!DATABASE_ROLES.includes(data.role))
      throw new DomainError("INVALID_INPUT", "Unknown database role", 422);
    return { scope, target: { role: data.role, roleName: profile.roles[data.role].name } };
  }
  private async assertSlot(
    tx: DatabaseAccess,
    data: { projectId: string; environmentId: string; slotId: string | null },
  ) {
    if (!data.slotId) return;
    const [slot] = await tx
      .select()
      .from(schema.accessSlots)
      .where(eq(schema.accessSlots.id, data.slotId));
    const [identity] = slot
      ? await tx
          .select()
          .from(schema.serviceIdentities)
          .where(eq(schema.serviceIdentities.id, slot.identityId))
      : [];
    if (identity?.projectId !== data.projectId || identity.environmentId !== data.environmentId)
      throw new DomainError(
        "FORBIDDEN",
        "Access slot is outside the exact project environment",
        403,
      );
  }
}
