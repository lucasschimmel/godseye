import { z } from "zod";
export const UsageResource = z
  .object({
    id: z.string().uuid(),
    runId: z.string().uuid(),
    projectId: z.string().uuid(),
    environmentId: z.string().uuid(),
    kind: z.enum(["delivery", "tool"]),
    name: z.string().max(80),
    state: z.string().max(80),
    occurredAt: z.string().datetime(),
    measurements: z
      .array(
        z
          .object({
            unit: z.enum(["cpu-millisecond", "MiB-peak", "MiB-disk", "millisecond", "call"]),
            value: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          })
          .strict(),
      )
      .max(5),
    source: z.enum(["delivery-provider-observation", "typed-tool-call-journal"]),
    completeness: z.enum(["measured", "partial", "unknown"]),
  })
  .strict();
export type UsageResourceView = z.infer<typeof UsageResource>;
export const UsageResources = z
  .object({
    records: z.array(UsageResource).max(500),
    truncated: z.boolean(),
    allocationCeilingsAreMeasurements: z.literal(false),
  })
  .strict();
export type UsageResourcesView = z.infer<typeof UsageResources>;
