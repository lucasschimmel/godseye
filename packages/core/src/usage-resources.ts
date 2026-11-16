import type { UsageResourceView } from "@godseye/contracts";
import { type Store, schema } from "@godseye/store";
import { desc, eq } from "drizzle-orm";
import { type Actor, assertOwner } from "./policy.js";
/** Existing trusted delivery and typed tool records only: allocation maxima are not measurements. */
export async function usageResources(store: Store, actor: Actor) {
  assertOwner(actor);
  const [delivery, tools] = await Promise.all([
    store.db
      .select()
      .from(schema.deliveryUsage)
      .orderBy(desc(schema.deliveryUsage.recordedAt))
      .limit(501),
    store.db
      .select({ call: schema.agentToolCalls, task: schema.agentTasks })
      .from(schema.agentToolCalls)
      .innerJoin(schema.agentTasks, eq(schema.agentToolCalls.taskId, schema.agentTasks.id))
      .orderBy(desc(schema.agentToolCalls.createdAt))
      .limit(501),
  ]);
  const records: UsageResourceView[] = [
    ...delivery.slice(0, 250).map((r) => ({
      id: r.runId,
      runId: r.runId,
      projectId: r.projectId,
      environmentId: r.environmentId,
      kind: "delivery" as const,
      name: r.intent,
      state: "observed",
      occurredAt: r.recordedAt.toISOString(),
      measurements: [
        { unit: "cpu-millisecond" as const, value: r.cpuMilliSeconds },
        { unit: "MiB-peak" as const, value: r.peakMemoryMiB },
        { unit: "MiB-disk" as const, value: r.diskMiB },
        { unit: "millisecond" as const, value: r.durationMs },
      ],
      source: "delivery-provider-observation" as const,
      completeness: "measured" as const,
    })),
    ...tools.slice(0, 250).map(({ call: c, task: t }) => ({
      id: c.id,
      runId: c.runId,
      projectId: t.projectId,
      environmentId: t.environmentId,
      kind: "tool" as const,
      name: c.name,
      state: c.state,
      occurredAt: c.createdAt.toISOString(),
      measurements: c.observation ? [{ unit: "call" as const, value: 1 }] : [],
      source: "typed-tool-call-journal" as const,
      completeness: c.observation ? ("partial" as const) : ("unknown" as const),
    })),
  ];
  return {
    records,
    truncated: delivery.length > 250 || tools.length > 250,
    allocationCeilingsAreMeasurements: false as const,
  };
}
