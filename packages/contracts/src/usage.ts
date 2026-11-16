import { z } from "zod";
import { UsagePage } from "./usage-query.js";

const Id = z.string().uuid();
const Count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Label = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:/-]+$/);
export const USAGE_CATEGORIES = [
  "input",
  "output",
  "cacheRead",
  "cacheWrite",
  "reasoning",
] as const;
/** Exclusive billable categories: input excludes cache, output excludes reasoning. Unknown categories remain null. */
export const UsageCategories = z
  .object({
    input: Count.nullable(),
    output: Count.nullable(),
    cacheRead: Count.nullable(),
    cacheWrite: Count.nullable(),
    reasoning: Count.nullable(),
  })
  .strict();
export type UsageCategoriesView = z.infer<typeof UsageCategories>;
export const AttemptIntent = z
  .object({
    sequence: z.number().int().min(1).max(64),
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    provider: z.enum(["openai", "anthropic"]),
    model: Label,
    parentSequence: z.number().int().min(1).max(64).nullable(),
    relation: z.enum(["initial", "continuation", "retry", "fallback"]),
  })
  .strict();
export type AttemptIntentInput = z.infer<typeof AttemptIntent>;
export const AttemptOutcome = z
  .object({
    cacheWriteTtl: z.enum(["5m", "1h", "mixed", "unknown", "not-applicable"]).optional(),
    reportedTotals: z
      .object({ input: Count.nullable(), output: Count.nullable() })
      .strict()
      .optional(),
    sequence: z.number().int().min(1).max(64),
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum(["succeeded", "failed", "unknown"]),
    categories: UsageCategories,
    providerRequestId: Label.nullable(),
    streamed: z.boolean(),
    providerReportedMicros: Count.nullable(),
  })
  .strict();
export type AttemptOutcomeInput = z.infer<typeof AttemptOutcome>;
export interface UsageAttemptReporter {
  intent(input: AttemptIntentInput): Promise<void>;
  outcome(input: AttemptOutcomeInput): Promise<void>;
}
export const UsageAttempt = AttemptIntent.extend({
  id: Id,
  runId: Id,
  projectId: Id,
  environmentId: Id,
  taskId: Id.nullable(),
  profileId: Id.nullable(),
  runner: z.enum(["codex", "claude-code"]).nullable(),
  skillId: Label.nullable(),
  intentAt: z.string().datetime(),
  outcome: AttemptOutcome.nullable(),
  outcomeAt: z.string().datetime().nullable(),
  estimatedMicros: Count.nullable(),
  priceId: Id.nullable(),
  evidence: z.literal("trusted-broker"),
  completeness: z.enum(["pending", "complete", "partial", "unknown"]),
}).strict();
export type UsageAttemptView = z.infer<typeof UsageAttempt>;
export const PutUsagePrice = z
  .object({
    cacheWriteTtl: z.enum(["5m", "1h"]).optional(),
    provider: z.enum(["openai", "anthropic"]),
    model: Label,
    currency: z.literal("USD"),
    revision: Label,
    source: z.string().min(1).max(512),
    reviewedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    ratesMicrosPerMillion: UsageCategories,
  })
  .strict()
  .refine(
    (v) => Date.parse(v.expiresAt) > Date.parse(v.reviewedAt),
    "Price expiry must follow review",
  );
export type PutUsagePriceInput = z.infer<typeof PutUsagePrice>;
export const UsagePrice = z
  .object({ id: Id, price: PutUsagePrice, createdAt: z.string().datetime() })
  .strict();
export type UsagePriceView = z.infer<typeof UsagePrice>;
export const PutUsageBudget = z
  .object({
    projectId: Id,
    scope: z.enum(["project", "profile", "runner"]),
    scopeId: z.string().min(1).max(128),
    expectedRevision: Count,
    limitMicros: Count,
    windowSeconds: z.number().int().min(60).max(2678400),
    maxRuns: z.number().int().min(1).max(10000),
    maxConcurrent: z.number().int().min(1).max(1000),
  })
  .strict();
export type PutUsageBudgetInput = z.infer<typeof PutUsageBudget>;
export const UsageBudget = PutUsageBudget.omit({ expectedRevision: true })
  .extend({
    id: Id,
    revision: Count,
    reservedMicros: Count,
    spentMicros: Count,
    activeRuns: Count,
    windowRuns: Count,
    pressure: z.enum(["available", "exhausted", "overcommitted"]),
  })
  .strict();
export type UsageBudgetView = z.infer<typeof UsageBudget>;
export const ImportUsageInvoice = z
  .object({
    projectId: Id,
    provider: z.enum(["openai", "anthropic"]),
    currency: z.literal("USD"),
    invoiceId: Label,
    source: z.enum(["operator-import", "fixture"]),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    lines: z
      .array(z.object({ lineId: Label, attemptId: Id.nullable(), amountMicros: Count }).strict())
      .min(1)
      .max(500),
  })
  .strict();
export type ImportUsageInvoiceInput = z.infer<typeof ImportUsageInvoice>;
export const UsageInvoice = z
  .object({
    id: Id,
    invoice: ImportUsageInvoice,
    importedAt: z.string().datetime(),
    reconciliations: z
      .array(
        z
          .object({
            at: z.string().datetime(),
            matched: Count,
            unmatched: Count,
            discrepancyMicros: z
              .number()
              .int()
              .min(-Number.MAX_SAFE_INTEGER)
              .max(Number.MAX_SAFE_INTEGER)
              .nullable(),
            unknown: Count,
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type UsageInvoiceView = z.infer<typeof UsageInvoice>;
export const UsageSummary = z
  .object({
    attemptCount: Count,
    pendingCount: Count,
    unknownCount: Count,
    estimatedMicros: Count.nullable(),
    providerReportedMicros: Count.nullable(),
    invoiceMicros: Count.nullable(),
    conservativeChargedMicros: Count.nullable(),
    reservedMicros: Count.nullable(),
    legacyRunCount: Count,
    completeness: z.enum(["complete", "partial", "unknown"]),
    adminBilling: z.literal("unconfigured"),
  })
  .strict();
export type UsageSummaryView = z.infer<typeof UsageSummary>;
export const UsageOverview = z
  .object({
    summary: UsageSummary,
    page: UsagePage,
    attempts: z.array(UsageAttempt).max(1000),
    budgets: z.array(UsageBudget).max(500),
    prices: z.array(UsagePrice).max(500),
    invoices: z.array(UsageInvoice).max(100),
    truncated: z.boolean(),
  })
  .strict();
export type UsageOverviewView = z.infer<typeof UsageOverview>;
