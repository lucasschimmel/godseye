import { randomUUID } from "node:crypto";
import {
  AttemptIntent,
  type AttemptIntentInput,
  AttemptOutcome,
  type AttemptOutcomeInput,
  type ExecutionContext,
  type UsageAttemptReporter,
  type UsageAttemptView,
} from "@godseye/contracts";
import { type Store, schema } from "@godseye/store";
import { and, eq } from "drizzle-orm";
import { DomainError } from "./errors.js";
import { fingerprint, write } from "./journal.js";
import { estimateUsage } from "./usage-pricing.js";

const conflict = () =>
  new DomainError("USAGE_CONFLICT", "Attempt evidence differs from its immutable journal", 409);
/** Trusted broker-only binding; HTTP and guest aggregate reports never receive this capability. */
export function attemptReporter(
  store: Store,
  runId: string,
  now: () => Date,
  context?: ExecutionContext,
): UsageAttemptReporter {
  return {
    intent: async (raw: AttemptIntentInput) => {
      const input = AttemptIntent.parse(raw);
      await write(store, async (tx) => {
        const [run] = await tx
          .select()
          .from(schema.executionRuns)
          .where(eq(schema.executionRuns.id, runId));
        if (!run) throw new DomainError("NOT_FOUND", "Execution run not found", 404);
        const [existing] = await tx
          .select()
          .from(schema.usageAttempts)
          .where(
            and(
              eq(schema.usageAttempts.runId, runId),
              eq(schema.usageAttempts.sequence, input.sequence),
            ),
          );
        if (existing) {
          const v = existing.metadata;
          if (
            fingerprint({
              sequence: v.sequence,
              requestHash: v.requestHash,
              provider: v.provider,
              model: v.model,
              parentSequence: v.parentSequence,
              relation: v.relation,
            }) !== fingerprint(input)
          )
            throw conflict();
          return;
        }
        const [operation] = await tx
          .select()
          .from(schema.operations)
          .where(eq(schema.operations.id, runId));
        if (
          !["running"].includes(operation?.status ?? "") ||
          !run.leaseExpiresAt ||
          run.leaseExpiresAt <= now() ||
          (context &&
            (context.fence !== run.fence ||
              context.workerId !== run.workerId ||
              context.epoch !== run.epoch))
        )
          throw new DomainError(
            "FENCED",
            "Attempt dispatch requires the current execution lease",
            409,
          );
        const [epoch] = await tx
          .select()
          .from(schema.activationEpochs)
          .where(eq(schema.activationEpochs.environmentId, run.environmentId));
        const [grant] = run.grantId
          ? await tx.select().from(schema.taskGrants).where(eq(schema.taskGrants.id, run.grantId))
          : [];
        if (
          (epoch?.epoch ?? 1) !== run.epoch ||
          !grant ||
          grant.revokedAt ||
          grant.expiresAt <= now()
        )
          throw new DomainError("FENCED", "Attempt authority has been revoked", 409);
        const [agent] = await tx
          .select()
          .from(schema.agentTasks)
          .where(eq(schema.agentTasks.runId, runId));
        const [coding] = await tx
          .select()
          .from(schema.codingTasks)
          .where(eq(schema.codingTasks.runId, runId));
        const prep = coding
          ? (
              await tx
                .select()
                .from(schema.codingPreparations)
                .where(eq(schema.codingPreparations.id, coding.preparationId))
            )[0]?.metadata
          : null;
        if (!agent && !prep)
          throw new DomainError(
            "FORBIDDEN",
            "Only bound agent or coding tasks report model attempts",
            403,
          );
        const expectedModel =
          agent?.profileSnapshot.model ??
          (prep?.runner === "codex" ? "gpt-5.4-mini" : "claude-haiku-5-5");
        const provider = agent || prep?.runner === "codex" ? "openai" : "anthropic";
        if (input.model !== expectedModel || input.provider !== provider) throw conflict();
        if (input.sequence > 1) {
          const [parent] = await tx
            .select()
            .from(schema.usageAttempts)
            .where(
              and(
                eq(schema.usageAttempts.runId, runId),
                eq(schema.usageAttempts.sequence, input.parentSequence ?? 0),
              ),
            );
          if (!parent || (input.parentSequence ?? input.sequence) >= input.sequence)
            throw conflict();
        } else if (input.parentSequence !== null || input.relation !== "initial") throw conflict();
        const prices = await tx.select().from(schema.usagePrices);
        const selectedPrice = prices
          .map((p) => p.metadata)
          .filter(
            (p) =>
              p.price.provider === input.provider &&
              p.price.model === input.model &&
              Date.parse(p.price.reviewedAt) <= now().getTime() &&
              Date.parse(p.price.expiresAt) > now().getTime(),
          )
          .sort((a, b) => b.price.reviewedAt.localeCompare(a.price.reviewedAt))[0];
        const metadata: UsageAttemptView = {
          ...input,
          id: randomUUID(),
          runId,
          projectId: run.projectId,
          environmentId: run.environmentId,
          taskId: agent?.id ?? coding?.id ?? null,
          profileId: agent?.profileId ?? null,
          runner: prep?.runner ?? null,
          skillId: agent?.profileSnapshot.skill.id ?? null,
          intentAt: now().toISOString(),
          outcome: null,
          outcomeAt: null,
          estimatedMicros: null,
          priceId: selectedPrice?.id ?? null,
          evidence: "trusted-broker",
          completeness: "pending",
        };
        if (!run.leaseExpiresAt || run.leaseExpiresAt <= now() || grant.expiresAt <= now())
          throw new DomainError("FENCED", "Attempt lease expired before acknowledgement", 409);
        await tx.insert(schema.usageAttempts).values({
          id: metadata.id,
          runId,
          sequence: input.sequence,
          projectId: run.projectId,
          metadata,
          createdAt: now(),
        });
      });
    },
    outcome: async (raw: AttemptOutcomeInput) => {
      const input = AttemptOutcome.parse(raw);
      await write(store, async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.usageAttempts)
          .where(
            and(
              eq(schema.usageAttempts.runId, runId),
              eq(schema.usageAttempts.sequence, input.sequence),
            ),
          );
        if (!row || row.metadata.requestHash !== input.requestHash) throw conflict();
        if (row.metadata.outcome) {
          if (fingerprint(row.metadata.outcome) !== fingerprint(input)) throw conflict();
          return;
        }
        const [priceRow] = row.metadata.priceId
          ? await tx
              .select()
              .from(schema.usagePrices)
              .where(eq(schema.usagePrices.id, row.metadata.priceId))
          : [];
        const price = priceRow?.metadata;
        const ttlAmbiguous =
          (input.categories.cacheWrite ?? 0) > 0 &&
          ((input.cacheWriteTtl !== "5m" && input.cacheWriteTtl !== "1h") ||
            !price?.price.cacheWriteTtl ||
            price.price.cacheWriteTtl !== input.cacheWriteTtl);
        const estimate =
          price && !ttlAmbiguous && input.state !== "unknown"
            ? estimateUsage(input.categories, price.price.ratesMicrosPerMillion)
            : null;
        await tx
          .update(schema.usageAttempts)
          .set({
            metadata: {
              ...row.metadata,
              outcome: input,
              outcomeAt: now().toISOString(),
              estimatedMicros: estimate,
              priceId: row.metadata.priceId,
              completeness:
                input.state === "unknown"
                  ? "unknown"
                  : Object.values(input.categories).some((v) => v === null)
                    ? "partial"
                    : "complete",
            },
          })
          .where(eq(schema.usageAttempts.id, row.id));
      });
    },
  };
}
