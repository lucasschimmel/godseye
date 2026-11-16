import { createHash, randomUUID } from "node:crypto";
import type { DatabaseAccess, Store } from "@godseye/store";
import { schema } from "@godseye/store";
import { desc, eq, sql } from "drizzle-orm";
import { DomainError } from "./errors.js";
import type { Actor } from "./policy.js";

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Serialize control writes in the database, including across API processes. */
export function write<T>(store: Store, work: (tx: DatabaseAccess) => Promise<T>): Promise<T> {
  return store.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM control_lock WHERE id = 1 FOR UPDATE`);
    return work(tx);
  });
}

export async function existingRequest(tx: DatabaseAccess, key: string, digest: string) {
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key)) {
    throw new DomainError("INVALID_IDEMPOTENCY_KEY", "A valid idempotency key is required", 400);
  }
  const [request] = await tx.select().from(schema.requests).where(eq(schema.requests.key, key));
  if (request && request.fingerprint !== digest) {
    throw new DomainError("IDEMPOTENCY_CONFLICT", "This key identifies a different request", 409);
  }
  return request;
}

export async function appendAudit(
  tx: DatabaseAccess,
  actor: Actor,
  projectId: string | null,
  action: string,
  summary: string,
): Promise<void> {
  const [last] = await tx.select().from(schema.audit).orderBy(desc(schema.audit.sequence)).limit(1);
  const entry = {
    id: randomUUID(),
    actorId: actor.id,
    projectId,
    action,
    summary,
    previousHash: last?.hash ?? "genesis",
    occurredAt: new Date(),
  };
  const hash = fingerprint({ ...entry, occurredAt: entry.occurredAt.toISOString() });
  await tx.insert(schema.audit).values({ ...entry, hash });
}

export async function verifyAudit(store: Store): Promise<boolean> {
  const rows = await store.db.select().from(schema.audit).orderBy(schema.audit.sequence);
  let previousHash = "genesis";
  for (const { sequence: _sequence, hash, ...entry } of rows) {
    if (
      entry.previousHash !== previousHash ||
      hash !==
        fingerprint({
          ...entry,
          occurredAt: entry.occurredAt.toISOString(),
        })
    )
      return false;
    previousHash = hash;
  }
  return true;
}
