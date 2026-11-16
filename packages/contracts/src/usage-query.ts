import { z } from "zod";

/** All filters are evaluated by the owner API; dates use an inclusive start and exclusive end. */
export const UsageQuery = z
  .object({
    projectId: z.string().uuid().optional(),
    environmentId: z.string().uuid().optional(),
    profileId: z.string().uuid().optional(),
    runner: z.enum(["codex", "claude-code"]).optional(),
    runId: z.string().uuid().optional(),
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    cursor: z
      .string()
      .min(1)
      .max(768)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .strict()
  .refine(
    (v) => !v.since || !v.until || Date.parse(v.since) < Date.parse(v.until),
    "Usage window must be increasing",
  );
export type UsageQueryInput = z.input<typeof UsageQuery>;
export type UsageQueryView = z.output<typeof UsageQuery>;

export const UsagePage = z
  .object({
    nextCursor: z.string().max(768).nullable(),
    total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    snapshotAt: z.string().datetime(),
    retainedSince: z.string().datetime().nullable(),
    historyTruncated: z.boolean(),
  })
  .strict();
