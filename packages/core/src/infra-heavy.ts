import { type ActionCommandInput, HEAVY_TASK_LIMITS } from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { and, eq, isNull, ne } from "drizzle-orm";
import { DomainError } from "./errors.js";

export interface HeavyTaskPolicy {
  maxConcurrent: number;
  maxQueued: number;
  /** Heavy work competes for the same CPU, memory and disk as the cells it runs beside. */
  classify: (command: ActionCommandInput) => boolean;
}
export const HEAVY_INTENTS = {
  "delivery.lifecycle": ["build"],
  "database.recovery": ["full", "diff", "restore"],
  "database.operation": ["backup", "restore", "export", "migrate"],
} as const;
export function isHeavyCommand(command: ActionCommandInput) {
  if (command.kind === "agent.run") return true;
  const intents: readonly string[] | undefined =
    HEAVY_INTENTS[command.kind as keyof typeof HEAVY_INTENTS];
  return intents !== undefined && "intent" in command && intents.includes(command.intent);
}
export const defaultHeavyPolicy = (): HeavyTaskPolicy => ({
  ...HEAVY_TASK_LIMITS,
  classify: isHeavyCommand,
});
export interface HeavyCounts {
  running: number;
  queued: number;
}
/** Runs that already hold a slot: everything non-terminal that is not merely waiting in the queue. */
export async function heavyCounts(
  tx: DatabaseAccess,
  policy: HeavyTaskPolicy,
  excludeRunId?: string,
): Promise<HeavyCounts> {
  const rows = await tx
    .select({
      id: schema.executionRuns.id,
      status: schema.operations.status,
      command: schema.executionPlans.command,
    })
    .from(schema.executionRuns)
    .innerJoin(schema.operations, eq(schema.executionRuns.id, schema.operations.id))
    .innerJoin(schema.executionPlans, eq(schema.executionRuns.planId, schema.executionPlans.id))
    .where(
      and(
        isNull(schema.executionRuns.terminalAt),
        excludeRunId ? ne(schema.executionRuns.id, excludeRunId) : undefined,
      ),
    );
  const counts = { running: 0, queued: 0 };
  for (const row of rows) {
    if (!policy.classify(row.command) || row.status === "awaiting_approval") continue;
    if (row.status === "queued") counts.queued += 1;
    else counts.running += 1;
  }
  return counts;
}
export function heavyFull(policy: HeavyTaskPolicy, counts: HeavyCounts) {
  return counts.running + counts.queued >= policy.maxConcurrent + policy.maxQueued;
}
/** Runs inside the enqueue transaction; the refusal leaves no run, reservation or budget hold behind. */
export async function assertHeavyCapacity(
  tx: DatabaseAccess,
  policy: HeavyTaskPolicy,
  command: ActionCommandInput,
  runId: string,
) {
  if (!policy.classify(command)) return;
  const counts = await heavyCounts(tx, policy, runId);
  if (heavyFull(policy, counts))
    throw new DomainError(
      "HEAVY_QUEUE_FULL",
      `Heavy-task queue is full: ${counts.running} running and ${counts.queued} waiting (limits ${policy.maxConcurrent} concurrent, ${policy.maxQueued} waiting)`,
      429,
    );
}
/** The worker claim leaves a heavy run queued while every heavy slot is taken. */
export async function heavySlotFree(
  tx: DatabaseAccess,
  policy: HeavyTaskPolicy,
  command: ActionCommandInput,
  runId: string,
) {
  if (!policy.classify(command)) return true;
  return (await heavyCounts(tx, policy, runId)).running < policy.maxConcurrent;
}
