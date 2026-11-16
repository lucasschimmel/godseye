import { randomUUID } from "node:crypto";
import { type Store, schema } from "@godseye/store";
import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { type IncidentNotifier, incidentView, MAX_DELIVERY_ATTEMPTS } from "./incidents-state.js";
import { fingerprint, write } from "./journal.js";

const CLAIM_TIMEOUT_MS = 60000;
const busy = new WeakSet<IncidentNotifier>();
const physical = new WeakSet<IncidentNotifier>();
/** A claim commits before invoking any external adapter. Expired/ambiguous claims never blindly replay. */
export async function deliverIncidents(store: Store, now: () => Date, notifier?: IncidentNotifier) {
  if (!notifier) return;
  if (busy.has(notifier)) return;
  busy.add(notifier);
  try {
    await deliverBatch(store, now, notifier);
  } finally {
    if (!physical.has(notifier)) busy.delete(notifier);
  }
}
async function deliverBatch(store: Store, now: () => Date, notifier: IncidentNotifier) {
  await write(store, async (tx) => {
    const legacy = await tx
      .select()
      .from(schema.incidents)
      .where(
        and(
          eq(schema.incidents.state, "open"),
          inArray(schema.incidents.deliveryState, ["pending", "unconfigured", "failed"]),
          sql`${schema.incidents.id} NOT IN (SELECT incident_id FROM incident_outbox)`,
        ),
      )
      .limit(100);
    for (const row of legacy)
      await tx.insert(schema.incidentOutbox).values({
        id: randomUUID(),
        incidentId: row.id,
        payloadKey: `incident:${row.id}`,
        state: row.deliveryAttempts > 0 ? "unknown" : "pending",
        attempts: row.deliveryAttempts,
        claimId: null,
        claimedAt: null,
        updatedAt: now(),
        receipt: null,
      });
    const stale = await tx
      .select()
      .from(schema.incidentOutbox)
      .where(
        and(
          eq(schema.incidentOutbox.state, "delivering"),
          lte(schema.incidentOutbox.claimedAt, new Date(now().getTime() - CLAIM_TIMEOUT_MS)),
        ),
      )
      .limit(100);
    for (const row of stale) {
      await tx
        .update(schema.incidentOutbox)
        .set({ state: "unknown", updatedAt: now() })
        .where(eq(schema.incidentOutbox.id, row.id));
      await tx
        .update(schema.incidents)
        .set({ deliveryState: "unknown" })
        .where(eq(schema.incidents.id, row.incidentId));
    }
  });
  const rows = await store.db
    .select()
    .from(schema.incidentOutbox)
    .where(
      and(
        inArray(schema.incidentOutbox.state, ["pending", "failed"]),
        lt(schema.incidentOutbox.attempts, MAX_DELIVERY_ATTEMPTS),
        sql`EXISTS (SELECT 1 FROM incidents i WHERE i.id=${schema.incidentOutbox.incidentId} AND i.state='open' AND (i.muted_until IS NULL OR i.muted_until<=${now()}))`,
      ),
    )
    .orderBy(asc(schema.incidentOutbox.updatedAt), asc(schema.incidentOutbox.id))
    .limit(1);
  for (const candidate of rows) {
    const claim = await write(store, async (tx) => {
      const [out] = await tx
        .select()
        .from(schema.incidentOutbox)
        .where(eq(schema.incidentOutbox.id, candidate.id));
      if (
        !out ||
        !["pending", "failed"].includes(out.state) ||
        out.attempts >= MAX_DELIVERY_ATTEMPTS
      )
        return null;
      const [incident] = await tx
        .select()
        .from(schema.incidents)
        .where(eq(schema.incidents.id, out.incidentId));
      if (incident?.state !== "open" || incidentView(incident, now()).muted) return null;
      const claimId = randomUUID();
      await tx
        .update(schema.incidentOutbox)
        .set({
          state: "delivering",
          claimId,
          claimedAt: now(),
          attempts: out.attempts + 1,
          updatedAt: now(),
        })
        .where(eq(schema.incidentOutbox.id, out.id));
      await tx
        .update(schema.incidents)
        .set({
          deliveryState: "delivering",
          deliveryAttempts: out.attempts + 1,
          deliveryAttemptedAt: now(),
        })
        .where(eq(schema.incidents.id, incident.id));
      return { out, claimId, incident };
    });
    if (!claim) continue;
    // Recheck mutable owner controls immediately before crossing the notification boundary.
    const [latest] = await store.db
      .select()
      .from(schema.incidents)
      .where(eq(schema.incidents.id, claim.incident.id));
    let state: "notified" | "failed" | "unknown" | "suppressed" | "pending" = "unknown",
      receipt: string | null = null;
    if (latest?.state !== "open") state = "suppressed";
    else if (incidentView(latest, now()).muted) state = "pending";
    else
      try {
        physical.add(notifier);
        const operation = Promise.resolve().then(() =>
          notifier.notify(incidentView(latest, now()), { idempotencyKey: claim.out.payloadKey }),
        );
        const release = () => {
          physical.delete(notifier);
          busy.delete(notifier);
        };
        operation.then(release, release);
        let timer: ReturnType<typeof setTimeout> | undefined;
        let result: Awaited<ReturnType<IncidentNotifier["notify"]>>;
        try {
          result = await Promise.race([
            operation,
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(
                () => reject(new Error("Notification acknowledgement timed out")),
                10000,
              );
              timer.unref?.();
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
        state =
          result?.state === "failed"
            ? "failed"
            : result?.state === "unknown"
              ? "unknown"
              : "notified";
        receipt =
          result && "receipt" in result && result.receipt ? fingerprint(result.receipt) : null;
      } catch {
        state = "unknown";
      }
    await write(store, async (tx) => {
      const [out] = await tx
        .select()
        .from(schema.incidentOutbox)
        .where(eq(schema.incidentOutbox.id, claim.out.id));
      if (!out || out.claimId !== claim.claimId || out.state !== "delivering") return;
      await tx
        .update(schema.incidentOutbox)
        .set({
          state,
          receipt,
          attempts: state === "pending" ? claim.out.attempts : out.attempts,
          updatedAt: now(),
        })
        .where(eq(schema.incidentOutbox.id, out.id));
      await tx
        .update(schema.incidents)
        .set({
          deliveryState: state === "suppressed" ? "pending" : state,
          ...(state === "pending" ? { deliveryAttempts: claim.out.attempts } : {}),
        })
        .where(eq(schema.incidents.id, claim.incident.id));
    });
  }
}
