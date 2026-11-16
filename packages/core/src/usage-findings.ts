import { type Store, schema } from "@godseye/store";
import { eq, ne } from "drizzle-orm";
import type { Finding } from "./incidents-state.js";
import { budgetView } from "./usage-budgets.js";
export async function usageFindings(store: Store, now: Date) {
  const findings: Finding[] = [];
  const coveredKeys: string[] = [];
  const runs = await store.db
    .select({ run: schema.executionRuns, operation: schema.operations })
    .from(schema.executionRuns)
    .innerJoin(schema.operations, eq(schema.executionRuns.id, schema.operations.id))
    .where(ne(schema.operations.status, "queued"));
  const attempts = await store.db.select().from(schema.usageAttempts);
  for (const { run, operation } of runs) {
    coveredKeys.push(`accounting-overrun:${run.id}`, `accounting-unknown:${run.id}`);
    if (run.chargedMicros > run.reservedMicros)
      findings.push({
        key: `accounting-overrun:${run.id}`,
        kind: "accounting",
        severity: "critical",
        projectId: run.projectId,
        environmentId: run.environmentId,
        allocationId: null,
        subject: run.id,
        reason: "CONSERVATIVE_CHARGE_OVERRUN",
        summary: "Conservative charge exceeds admitted reservation",
      });
    const evidence = attempts.filter((a) => a.runId === run.id);
    if (
      operation.status === "unknown" ||
      evidence.some(
        (a) =>
          a.metadata.completeness === "unknown" ||
          a.metadata.completeness === "partial" ||
          (!a.metadata.outcome && a.createdAt.getTime() < now.getTime() - 60000),
      )
    )
      findings.push({
        key: `accounting-unknown:${run.id}`,
        kind: "accounting",
        severity: "warning",
        projectId: run.projectId,
        environmentId: run.environmentId,
        allocationId: null,
        subject: run.id,
        reason: "MODEL_ACCOUNTING_UNKNOWN",
        summary: "Model attempt accounting contains unresolved or incomplete evidence",
      });
  }
  const budgets = await store.db.select().from(schema.usageBudgets);
  for (const budget of budgets) {
    const view = await budgetView(store.db, budget, now);
    coveredKeys.push(`budget:${budget.id}`);
    if (view.pressure !== "available")
      findings.push({
        key: `budget:${budget.id}`,
        kind: "budget",
        severity: view.pressure === "overcommitted" ? "critical" : "warning",
        projectId: budget.projectId,
        environmentId: null,
        allocationId: null,
        subject: budget.id,
        reason:
          view.pressure === "overcommitted"
            ? "SCOPED_BUDGET_OVERCOMMITTED"
            : "SCOPED_BUDGET_EXHAUSTED",
        summary: "Scoped execution budget or concurrency capacity is exhausted",
      });
  }
  return { findings, coveredKinds: [] as const, coveredKeys };
}
