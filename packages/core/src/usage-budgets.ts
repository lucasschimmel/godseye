import { randomUUID } from "node:crypto";
import type { PutUsageBudgetInput, UsageBudgetView } from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { DomainError } from "./errors.js";
export async function budgetView(
  tx: DatabaseAccess,
  row: typeof schema.usageBudgets.$inferSelect,
  now: Date,
): Promise<UsageBudgetView> {
  const all = await tx
    .select()
    .from(schema.usageReservations)
    .where(eq(schema.usageReservations.budgetId, row.id));
  const active = all.filter((r) => r.state === "reserved" || r.state === "unknown"),
    window = all.filter(
      (r) => r.createdAt.getTime() > now.getTime() - row.metadata.windowSeconds * 1000,
    );
  const reservedMicros = safeBudgetSum(active.map((r) => r.amount)),
    spentMicros = safeBudgetSum(window.map((r) => r.charged));
  const { expectedRevision: _revision, ...policy } = row.metadata;
  return {
    ...policy,
    id: row.id,
    revision: row.revision,
    reservedMicros,
    spentMicros,
    activeRuns: active.length,
    windowRuns: window.length,
    pressure:
      BigInt(reservedMicros) + BigInt(spentMicros) > BigInt(policy.limitMicros) ||
      active.length > policy.maxConcurrent
        ? "overcommitted"
        : BigInt(reservedMicros) + BigInt(spentMicros) >= BigInt(policy.limitMicros) ||
            active.length >= policy.maxConcurrent ||
            window.length >= policy.maxRuns
          ? "exhausted"
          : "available",
  };
}
export async function validateBudgetScope(tx: DatabaseAccess, input: PutUsageBudgetInput) {
  const [project] = await tx
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, input.projectId));
  if (!project) throw new DomainError("NOT_FOUND", "Budget project not found", 404);
  if (input.scope === "project" && input.scopeId !== input.projectId)
    throw new DomainError("FORBIDDEN", "Project budget scope differs", 403);
  if (input.scope === "runner" && !["codex", "claude-code"].includes(input.scopeId))
    throw new DomainError("INVALID_INPUT", "Unknown coding runner", 400);
  if (input.scope === "profile") {
    const [profile] = await tx
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, input.scopeId));
    if (profile?.projectId !== input.projectId)
      throw new DomainError("FORBIDDEN", "Profile budget scope differs", 403);
  }
}
async function matching(tx: DatabaseAccess, plan: typeof schema.executionPlans.$inferSelect) {
  const command = plan.command;
  let profileId: string | null = null,
    runner: string | null = null;
  if (command.kind === "agent.run") {
    const [task] = await tx
      .select()
      .from(schema.agentTasks)
      .where(eq(schema.agentTasks.id, command.inputRef));
    profileId = task?.profileId ?? null;
  }
  if (command.kind === "coding.run") {
    const [prep] = await tx
      .select()
      .from(schema.codingPreparations)
      .where(eq(schema.codingPreparations.id, command.preparationId));
    runner = prep?.metadata.runner ?? null;
  }
  const rows = await tx
    .select()
    .from(schema.usageBudgets)
    .where(eq(schema.usageBudgets.projectId, plan.projectId));
  return rows.filter(
    (r) =>
      r.metadata.scope === "project" ||
      (r.metadata.scope === "profile" && r.metadata.scopeId === profileId) ||
      (r.metadata.scope === "runner" && r.metadata.scopeId === runner),
  );
}
export async function reserveUsage(
  tx: DatabaseAccess,
  plan: typeof schema.executionPlans.$inferSelect,
  runId: string,
  now: Date,
) {
  if (plan.maxCostMicros === 0) return;
  for (const row of await matching(tx, plan)) {
    const view = await budgetView(tx, row, now);
    if (
      BigInt(view.reservedMicros) + BigInt(view.spentMicros) + BigInt(plan.maxCostMicros) >
        BigInt(view.limitMicros) ||
      view.activeRuns >= view.maxConcurrent ||
      view.windowRuns >= view.maxRuns
    )
      throw new DomainError(
        "USAGE_BUDGET_EXCEEDED",
        "Scoped budget, rate or concurrency capacity exhausted",
        409,
      );
    await tx.insert(schema.usageReservations).values({
      id: randomUUID(),
      budgetId: row.id,
      runId,
      amount: plan.maxCostMicros,
      charged: 0,
      state: "reserved",
      createdAt: now,
    });
  }
}
export async function usageClaimGate(
  tx: DatabaseAccess,
  plan: typeof schema.executionPlans.$inferSelect,
  runId: string,
  now: Date,
) {
  if (plan.maxCostMicros === 0) return true;
  for (const row of await matching(tx, plan)) {
    const view = await budgetView(tx, row, now),
      reservations = await tx
        .select()
        .from(schema.usageReservations)
        .where(eq(schema.usageReservations.runId, runId));
    const reservation = reservations.find((r) => r.budgetId === row.id);
    if (
      !reservation ||
      !["reserved", "unknown"].includes(reservation.state) ||
      view.pressure === "overcommitted"
    )
      return false;
  }
  return true;
}
export async function settleUsage(
  tx: DatabaseAccess,
  runId: string,
  status: string,
  chargedMicros?: number,
) {
  const [run] = await tx
    .select()
    .from(schema.executionRuns)
    .where(eq(schema.executionRuns.id, runId));
  if (!run) throw new DomainError("NOT_FOUND", "Usage run not found", 404);
  const rows = await tx
    .select()
    .from(schema.usageReservations)
    .where(eq(schema.usageReservations.runId, runId));
  // Physical terminal proof frees concurrency; missing token/price reports remain unknown
  // in the attempt ledger while the monotone conservative charge settles the money.
  for (const row of rows)
    await tx
      .update(schema.usageReservations)
      .set({
        state: status === "unknown" ? "unknown" : "settled",
        amount:
          status === "unknown"
            ? Math.max(row.amount, run.chargedMicros, chargedMicros ?? 0)
            : row.amount,
        charged:
          status === "unknown"
            ? row.charged
            : Math.max(row.charged, run.chargedMicros, chargedMicros ?? 0),
      })
      .where(eq(schema.usageReservations.id, row.id));
}
export async function releaseUsage(tx: DatabaseAccess, runId: string) {
  await tx
    .update(schema.usageReservations)
    .set({ state: "released" })
    .where(eq(schema.usageReservations.runId, runId));
}

function safeBudgetSum(values: number[]) {
  const total = values.reduce((n, v) => n + BigInt(v), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new DomainError("USAGE_OVERFLOW", "Budget obligations exceed safe integer capacity", 409);
  return Number(total);
}
