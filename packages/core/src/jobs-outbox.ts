import { randomUUID } from "node:crypto";
import {
  type OutboxIntentView,
  ReconcileOutbox,
  type ReconcileOutboxInput,
} from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { and, asc, eq, inArray, lte, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { DomainError, parseInput } from "./errors.js";
import { assertFresh, recordRequest, requestFor } from "./foundation-data.js";
import {
  activeCell,
  heldEnvironmentIds,
  type JobState,
  type OutboxIntentInput,
  type OutboxSender,
  type OutboxSendResult,
  outboxFor,
  outboxView,
} from "./jobs-state.js";
import { appendAudit, fingerprint, write } from "./journal.js";
import type { Actor } from "./policy.js";

const MAX_PAYLOAD_BYTES = 65_536;
const BATCH = 50;
const Intent = z
  .object({
    projectId: z.string().uuid(),
    environmentId: z.string().uuid(),
    jobRunId: z.string().uuid().nullish(),
    effectKey: z.string().min(8).max(128),
    destination: z.string().regex(/^[a-z][a-z0-9.-]{0,63}$/),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type OutboxWrite = OutboxIntentInput & {
  projectId: string;
  environmentId: string;
  jobRunId?: string | null;
};
export interface OutboxTickResult {
  held: number;
  recovered: number;
  inspected: number;
  dispatched: number;
}

/** Joins the caller's transaction: the intent commits with the business change or not at all. */
export async function enqueueOutbox(state: JobState, tx: DatabaseAccess, input: OutboxWrite) {
  const data = Intent.safeParse(input);
  if (!data.success || JSON.stringify(data.data.payload).length > MAX_PAYLOAD_BYTES)
    throw new DomainError("INVALID_INPUT", "Outbox intent does not match its contract", 422);
  const intent = data.data;
  const [environment] = await tx
    .select()
    .from(schema.environments)
    .where(eq(schema.environments.id, intent.environmentId));
  if (!environment || environment.projectId !== intent.projectId)
    throw new DomainError("FORBIDDEN", "Environment does not belong to the project", 403);
  if (intent.jobRunId) {
    const [run] = await tx
      .select()
      .from(schema.jobRuns)
      .where(eq(schema.jobRuns.id, intent.jobRunId));
    if (!run || run.projectId !== intent.projectId || run.environmentId !== intent.environmentId)
      throw new DomainError("FORBIDDEN", "Job run belongs to another cell", 403);
  }
  const payloadHash = fingerprint({ destination: intent.destination, payload: intent.payload });
  const inserted = await tx
    .insert(schema.jobOutbox)
    .values({
      id: randomUUID(),
      projectId: intent.projectId,
      environmentId: intent.environmentId,
      jobRunId: intent.jobRunId ?? null,
      effectKey: intent.effectKey,
      destination: intent.destination,
      state: "pending",
      attempts: 0,
      payload: intent.payload,
      payloadHash,
      createdAt: state.now(),
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  const [existing] = await tx
    .select()
    .from(schema.jobOutbox)
    .where(
      and(
        eq(schema.jobOutbox.environmentId, intent.environmentId),
        eq(schema.jobOutbox.effectKey, intent.effectKey),
      ),
    );
  if (!existing || existing.payloadHash !== payloadHash)
    throw new DomainError(
      "IDEMPOTENCY_CONFLICT",
      "This effect key identifies a different intent",
      409,
    );
  return existing;
}
const delivery = (row: typeof schema.jobOutbox.$inferSelect) => ({
  effectKey: row.effectKey,
  destination: row.destination,
  projectId: row.projectId,
  environmentId: row.environmentId,
  payload: row.payload,
  attempt: row.attempts,
});
/** Held cells never dispatch; pending intent is parked, not dropped or executed. */
async function parkHeld(state: JobState, held: string[]) {
  if (held.length === 0) return 0;
  const parked = await write(state.store, (tx) =>
    tx
      .update(schema.jobOutbox)
      .set({ state: "held", lastError: "CELL_HELD" })
      .where(
        and(eq(schema.jobOutbox.state, "pending"), inArray(schema.jobOutbox.environmentId, held)),
      )
      .returning(),
  );
  return parked.length;
}
/** An abandoned claim is only redelivered when the receiver deduplicates by effect key. */
async function recoverStale(state: JobState) {
  const cutoff = new Date(state.now().getTime() - state.dispatchTimeoutMs);
  return write(state.store, async (tx) => {
    const stale = await tx
      .select()
      .from(schema.jobOutbox)
      .where(
        and(eq(schema.jobOutbox.state, "dispatching"), lte(schema.jobOutbox.claimedAt, cutoff)),
      );
    for (const row of stale) {
      const safe = state.senders?.get(row.destination)?.dedupesByEffectKey === true;
      await tx
        .update(schema.jobOutbox)
        .set({
          state: safe ? "pending" : "unknown",
          claimedAt: null,
          lastError: safe ? "DISPATCH_ABANDONED_REDELIVER" : "DISPATCH_ABANDONED_UNKNOWN",
        })
        .where(and(eq(schema.jobOutbox.id, row.id), eq(schema.jobOutbox.state, "dispatching")));
    }
    return stale.length;
  });
}
async function inspectUnknown(state: JobState) {
  const rows = await state.store.db
    .select()
    .from(schema.jobOutbox)
    .where(eq(schema.jobOutbox.state, "unknown"))
    .orderBy(asc(schema.jobOutbox.createdAt))
    .limit(BATCH);
  let count = 0;
  for (const row of rows) {
    const sender = state.senders?.get(row.destination);
    if (!sender?.inspect) continue;
    const seen = await sender.inspect(delivery(row)).catch(() => "unknown" as const);
    const delivered = seen === "delivered";
    count++;
    await write(state.store, async (tx) => {
      await tx
        .update(schema.jobOutbox)
        .set(
          delivered
            ? { state: "delivered", settledAt: state.now(), evidenceRef: "inspected:delivered" }
            : { state: "reconciling", lastError: "OWNER_RECONCILIATION_REQUIRED" },
        )
        .where(and(eq(schema.jobOutbox.id, row.id), eq(schema.jobOutbox.state, "unknown")));
    });
  }
  return count;
}
async function settle(
  state: JobState,
  row: typeof schema.jobOutbox.$inferSelect,
  result: OutboxSendResult,
) {
  const base = { claimedAt: null };
  const change =
    result.status === "delivered"
      ? {
          ...base,
          state: "delivered" as const,
          settledAt: state.now(),
          lastError: null,
          evidenceRef: result.evidenceRef ?? null,
        }
      : result.status === "rejected"
        ? row.attempts < state.maxOutboxAttempts
          ? { ...base, state: "pending" as const, lastError: result.reason.slice(0, 200) }
          : {
              ...base,
              state: "failed" as const,
              settledAt: state.now(),
              lastError: result.reason.slice(0, 200),
            }
        : { ...base, state: "unknown" as const, lastError: "SEND_UNKNOWN" };
  await write(state.store, async (tx) => {
    await tx
      .update(schema.jobOutbox)
      .set(change)
      .where(
        and(
          eq(schema.jobOutbox.id, row.id),
          eq(schema.jobOutbox.state, "dispatching"),
          eq(schema.jobOutbox.attempts, row.attempts),
        ),
      );
  });
}
const KNOWN = new Set(["delivered", "rejected", "unknown"]);
async function sendClaimed(
  state: JobState,
  sender: OutboxSender,
  row: typeof schema.jobOutbox.$inferSelect,
) {
  let result: OutboxSendResult;
  try {
    const sent = await sender.send(delivery(row));
    result = KNOWN.has(sent?.status) ? sent : { status: "unknown" };
  } catch {
    result = { status: "unknown" };
  }
  await settle(state, row, result);
}
async function claimOne(state: JobState, id: string) {
  return write(state.store, async (tx) => {
    const [row] = await tx
      .update(schema.jobOutbox)
      .set({
        state: "dispatching",
        attempts: sql`${schema.jobOutbox.attempts} + 1`,
        claimedAt: state.now(),
      })
      .where(and(eq(schema.jobOutbox.id, id), eq(schema.jobOutbox.state, "pending")))
      .returning();
    return row ?? null;
  });
}
/** Claims durable intent before sending; a crash after the claim leaves a recoverable, never silent, state. */
export async function claimOutboxBatch(state: JobState, held: string[]) {
  const destinations = [...(state.senders?.keys() ?? [])];
  if (destinations.length === 0) return [];
  const candidates = await state.store.db
    .select()
    .from(schema.jobOutbox)
    .where(
      and(
        eq(schema.jobOutbox.state, "pending"),
        inArray(schema.jobOutbox.destination, destinations),
        held.length > 0 ? notInArray(schema.jobOutbox.environmentId, held) : undefined,
      ),
    )
    .orderBy(asc(schema.jobOutbox.createdAt))
    .limit(BATCH);
  const claimed = [];
  for (const candidate of candidates) {
    const row = await claimOne(state, candidate.id);
    if (row) claimed.push(row);
  }
  return claimed;
}
export async function dispatchOutbox(state: JobState): Promise<OutboxTickResult> {
  const held = await heldEnvironmentIds(state.store.db, state.now());
  const result = { held: await parkHeld(state, held), recovered: 0, inspected: 0, dispatched: 0 };
  result.recovered = await recoverStale(state);
  result.inspected = await inspectUnknown(state);
  for (const row of await claimOutboxBatch(state, held)) {
    const sender = state.senders?.get(row.destination);
    if (!sender) continue;
    await sendClaimed(state, sender, row);
    result.dispatched++;
  }
  return result;
}
/** Owner resolution is the only path out of unknown; observed absence permits one explicit retry. */
export async function reconcileOutbox(
  state: JobState,
  actor: Actor,
  id: string,
  input: ReconcileOutboxInput,
  key: string,
): Promise<OutboxIntentView> {
  assertFresh(actor, state.request);
  const data = parseInput(ReconcileOutbox, input);
  return write(state.store, async (tx) => {
    const receipt = await requestFor(tx, actor, key, "outbox.reconcile", { id, ...data });
    const row = await outboxFor(tx, actor, id);
    if (receipt.existing) return outboxView(row);
    if (row.state !== data.expectedState)
      throw new DomainError("REVISION_CONFLICT", "Outbox intent is not in the expected state", 409);
    const now = state.now();
    if (data.resolution === "observed_absent_retry")
      await activeCell(state, tx, actor, row.projectId, row.environmentId);
    const change =
      data.resolution === "observed_delivered"
        ? { state: "delivered" as const, settledAt: now, lastError: null }
        : data.resolution === "abandon"
          ? { state: "failed" as const, settledAt: now, lastError: "ABANDONED_BY_OWNER" }
          : { state: "pending" as const, settledAt: null, lastError: null, claimedAt: null };
    const [updated] = await tx
      .update(schema.jobOutbox)
      .set({ ...change, evidenceRef: data.evidenceRef })
      .where(and(eq(schema.jobOutbox.id, id), eq(schema.jobOutbox.state, row.state)))
      .returning();
    if (!updated) throw new DomainError("REVISION_CONFLICT", "Outbox intent changed", 409);
    await recordRequest(tx, state.request, key, receipt.digest, id, "outbox.reconcile");
    await appendAudit(
      tx,
      actor,
      row.projectId,
      "job.outbox_reconciled",
      `Owner resolved uncertain intent ${row.effectKey} as ${data.resolution}`,
    );
    return outboxView(updated);
  });
}
