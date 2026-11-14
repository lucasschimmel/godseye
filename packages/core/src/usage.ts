import { randomUUID } from "node:crypto";
import {
  type ExecutionContext,
  ImportUsageInvoice,
  PutUsageBudget,
  PutUsagePrice,
  type UsageOverviewView,
  type UsageQueryInput,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { DomainError } from "./errors.js";
import { fingerprint, write } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";
import { attemptReporter } from "./usage-attempts.js";
import {
  budgetView,
  releaseUsage,
  reserveUsage,
  settleUsage,
  usageClaimGate,
  validateBudgetScope,
} from "./usage-budgets.js";
import { usageFindings } from "./usage-findings.js";
import { queryUsage, summarizeUsage } from "./usage-query.js";
import { usageResources } from "./usage-resources.js";
import { pruneUsage } from "./usage-retention.js";

export { estimateUsage } from "./usage-pricing.js";
export class UsageEngine {
  private readonly now: () => Date;
  constructor(
    private readonly store: Store,
    options: { now?: () => Date } = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }
  resources(actor: Actor) {
    return usageResources(this.store, actor);
  }
  systemFindings() {
    return usageFindings(this.store, this.now());
  }
  reporter(runId: string, context?: ExecutionContext) {
    return attemptReporter(this.store, runId, this.now, context);
  }
  reserve(tx: DatabaseAccess, plan: typeof schema.executionPlans.$inferSelect, runId: string) {
    return reserveUsage(tx, plan, runId, this.now());
  }
  claimGate(tx: DatabaseAccess, plan: typeof schema.executionPlans.$inferSelect, runId: string) {
    return usageClaimGate(tx, plan, runId, this.now());
  }
  settle(tx: DatabaseAccess, runId: string, status: string, chargedMicros?: number) {
    return settleUsage(tx, runId, status, chargedMicros);
  }
  releaseQueued(tx: DatabaseAccess, runId: string) {
    return releaseUsage(tx, runId);
  }
  private fresh(actor: Actor) {
    assertOwner(actor);
    const at = Date.parse(actor.authenticatedAt ?? "");
    if (
      !actor.sessionId ||
      !Number.isFinite(at) ||
      at > this.now().getTime() ||
      this.now().getTime() - at > 300000
    )
      throw new DomainError(
        "STEP_UP_REQUIRED",
        "A recent verified owner passkey session is required",
        403,
      );
  }
  private mutate<T>(
    actor: Actor,
    key: string,
    kind: string,
    input: unknown,
    work: (tx: DatabaseAccess) => Promise<T>,
  ): Promise<T> {
    assertOwner(actor);
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key))
      throw new DomainError("INVALID_IDEMPOTENCY_KEY", "A valid idempotency key is required", 400);
    return write(this.store, async (tx) => {
      const digest = fingerprint({ actor: actor.id, kind, input }),
        [receipt] = await tx
          .select()
          .from(schema.usageReceipts)
          .where(eq(schema.usageReceipts.key, key));
      if (receipt) {
        if (receipt.digest !== digest)
          throw new DomainError("IDEMPOTENCY_CONFLICT", "Request identity differs", 409);
        return receipt.result as T;
      }
      const result = await work(tx);
      await tx.insert(schema.usageReceipts).values({ key, digest, result });
      return result;
    });
  }
  putPrice(actor: Actor, raw: unknown, key: string) {
    const input = PutUsagePrice.parse(raw);
    return this.mutate(actor, key, "price", input, async (tx) => {
      this.fresh(actor);
      if (
        Date.parse(input.reviewedAt) > this.now().getTime() ||
        Date.parse(input.expiresAt) <= this.now().getTime()
      )
        throw new DomainError("INVALID_INPUT", "Price review must be current", 400);
      const identity = `${input.provider}:${input.model}:${input.revision}`,
        [existing] = await tx
          .select()
          .from(schema.usagePrices)
          .where(eq(schema.usagePrices.identity, identity));
      if (existing) {
        if (fingerprint(existing.metadata.price) !== fingerprint(input))
          throw new DomainError("USAGE_CONFLICT", "Immutable price revision differs", 409);
        return existing.metadata;
      }
      const metadata = { id: randomUUID(), price: input, createdAt: this.now().toISOString() };
      this.fresh(actor);
      await tx.insert(schema.usagePrices).values({ id: metadata.id, identity, metadata });
      return metadata;
    });
  }
  putBudget(actor: Actor, raw: unknown, key: string) {
    const input = PutUsageBudget.parse(raw);
    return this.mutate(actor, key, "budget", input, async (tx) => {
      await validateBudgetScope(tx, input);
      const identity = `${input.projectId}:${input.scope}:${input.scopeId}`,
        [existing] = await tx
          .select()
          .from(schema.usageBudgets)
          .where(eq(schema.usageBudgets.identity, identity));
      if ((existing?.revision ?? 0) !== input.expectedRevision)
        throw new DomainError("REVISION_CONFLICT", "Budget revision differs", 409);
      if (
        !existing ||
        input.limitMicros > existing.metadata.limitMicros ||
        input.maxConcurrent > existing.metadata.maxConcurrent ||
        input.maxRuns > existing.metadata.maxRuns ||
        input.windowSeconds !== existing.metadata.windowSeconds
      )
        this.fresh(actor);
      const row = {
        id: existing?.id ?? randomUUID(),
        projectId: input.projectId,
        identity,
        revision: (existing?.revision ?? 0) + 1,
        metadata: input,
      };
      if (
        !existing ||
        input.limitMicros > existing.metadata.limitMicros ||
        input.maxConcurrent > existing.metadata.maxConcurrent ||
        input.maxRuns > existing.metadata.maxRuns ||
        input.windowSeconds !== existing.metadata.windowSeconds
      )
        this.fresh(actor);
      if (existing)
        await tx.update(schema.usageBudgets).set(row).where(eq(schema.usageBudgets.id, row.id));
      else await tx.insert(schema.usageBudgets).values(row);
      return budgetView(tx, row, this.now());
    });
  }
  importInvoice(actor: Actor, raw: unknown, key: string) {
    const input = ImportUsageInvoice.parse(raw);
    return this.mutate(actor, key, "invoice", input, async (tx) => {
      this.fresh(actor);
      const [project] = await tx
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, input.projectId));
      if (!project) throw new DomainError("NOT_FOUND", "Invoice project not found", 404);
      if (
        Date.parse(input.periodEnd) <= Date.parse(input.periodStart) ||
        Date.parse(input.periodEnd) - Date.parse(input.periodStart) > 2678400000
      )
        throw new DomainError("INVALID_INPUT", "Invoice period is invalid", 400);
      if (
        new Set(input.lines.map((l) => l.attemptId).filter(Boolean)).size !==
        input.lines.filter((l) => l.attemptId).length
      )
        throw new DomainError("INVALID_INPUT", "Repeated invoice attempt identity", 400);
      if (new Set(input.lines.map((l) => l.lineId)).size !== input.lines.length)
        throw new DomainError("INVALID_INPUT", "Duplicate invoice line", 400);
      safeSum(input.lines.map((l) => l.amountMicros));
      const identity = `${input.provider}:${input.invoiceId}`,
        [existing] = await tx
          .select()
          .from(schema.usageInvoices)
          .where(eq(schema.usageInvoices.identity, identity));
      if (existing) {
        if (fingerprint(existing.metadata.invoice) !== fingerprint(input))
          throw new DomainError("USAGE_CONFLICT", "Immutable invoice identity differs", 409);
        return existing.metadata;
      }
      for (const line of input.lines) {
        if (!line.attemptId) continue;
        const [attempt] = await tx
          .select()
          .from(schema.usageAttempts)
          .where(eq(schema.usageAttempts.id, line.attemptId));
        if (
          attempt &&
          (attempt.projectId !== input.projectId ||
            attempt.metadata.provider !== input.provider ||
            Date.parse(attempt.metadata.intentAt) < Date.parse(input.periodStart) ||
            Date.parse(attempt.metadata.intentAt) >= Date.parse(input.periodEnd))
        )
          throw new DomainError("FORBIDDEN", "Invoice attempt scope differs", 403);
      }
      const metadata = {
        id: randomUUID(),
        invoice: input,
        importedAt: this.now().toISOString(),
        reconciliations: [],
      };
      this.fresh(actor);
      await tx
        .insert(schema.usageInvoices)
        .values({ id: metadata.id, projectId: input.projectId, identity, metadata });
      return metadata;
    });
  }
  reconcileInvoice(actor: Actor, id: string, key: string) {
    return this.mutate(actor, key, "invoice.reconcile", { id }, async (tx) => {
      this.fresh(actor);
      const [row] = await tx
        .select()
        .from(schema.usageInvoices)
        .where(eq(schema.usageInvoices.id, id));
      if (!row) throw new DomainError("NOT_FOUND", "Invoice not found", 404);
      if (row.metadata.reconciliations.length >= 100)
        throw new DomainError("CAPACITY_EXCEEDED", "Invoice reconciliation history full", 409);
      let matched = 0,
        unmatched = 0,
        unknown = 0;
      const deltas: number[] = [];
      for (const line of row.metadata.invoice.lines) {
        const [attempt] = line.attemptId
          ? await tx
              .select()
              .from(schema.usageAttempts)
              .where(eq(schema.usageAttempts.id, line.attemptId))
          : [];
        if (!attempt) {
          unmatched++;
          continue;
        }
        if (
          attempt.projectId !== row.projectId ||
          attempt.metadata.provider !== row.metadata.invoice.provider
        )
          throw new DomainError("FORBIDDEN", "Invoice scope differs", 403);
        matched++;
        const baseline =
          attempt.metadata.outcome?.providerReportedMicros ?? attempt.metadata.estimatedMicros;
        if (baseline === null) unknown++;
        else deltas.push(line.amountMicros - baseline);
      }
      const metadata = {
        ...row.metadata,
        reconciliations: [
          ...row.metadata.reconciliations,
          {
            at: this.now().toISOString(),
            matched,
            unmatched,
            discrepancyMicros: unknown ? null : safeSum(deltas),
            unknown,
          },
        ],
      };
      this.fresh(actor);
      await tx
        .update(schema.usageInvoices)
        .set({ metadata })
        .where(eq(schema.usageInvoices.id, id));
      return metadata;
    });
  }
  async overview(actor: Actor, query: UsageQueryInput = {}): Promise<UsageOverviewView> {
    assertOwner(actor);
    return queryUsage(this.store, query, this.now());
  }
  async summary(actor: Actor, query: UsageQueryInput = {}) {
    assertOwner(actor);
    return summarizeUsage(this.store, query, this.now());
  }
  summarySystem() {
    return summarizeUsage(this.store, {}, this.now());
  }
  prune(options: { days?: number; batch?: number } = {}) {
    return pruneUsage(this.store, this.now(), options);
  }
}
function safeSum(values: number[]): number {
  const n = values.reduce((n, v) => n + BigInt(v), 0n);
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(-Number.MAX_SAFE_INTEGER))
    throw new DomainError("USAGE_OVERFLOW", "Usage totals exceed integer capacity", 409);
  return Number(n);
}
