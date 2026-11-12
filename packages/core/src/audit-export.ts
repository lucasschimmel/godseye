import { type AuditAnchor, type AuditExportPage, FOUNDATION_DEFAULTS } from "@godseye/contracts";
import { schema } from "@godseye/store";
import { asc, desc, gt } from "drizzle-orm";
import { DomainError } from "./errors.js";
import type { FoundationState } from "./foundation-data.js";
import { fingerprint, write } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";

export async function exportAudit(
  state: FoundationState,
  actor: Actor,
  cursor = 0,
  limit: number = FOUNDATION_DEFAULTS.auditPageSize,
): Promise<AuditExportPage> {
  assertOwner(actor);
  if (
    !Number.isSafeInteger(cursor) ||
    cursor < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000
  )
    throw new DomainError("INVALID_INPUT", "Audit cursor or page size is invalid", 422);
  // A single write-serialized snapshot binds entries and checkpoint; export itself adds no audit row.
  return write(state.store, async (tx) => {
    const [last] = await tx
      .select()
      .from(schema.audit)
      .orderBy(desc(schema.audit.sequence))
      .limit(1);
    const before = await tx.select().from(schema.audit).orderBy(asc(schema.audit.sequence));
    const predecessor = cursor === 0 ? null : before.find((row) => row.sequence === cursor);
    if (cursor !== 0 && !predecessor)
      throw new DomainError("AUDIT_GAP", "Audit cursor is missing from retained history", 409);
    const rows = await tx
      .select()
      .from(schema.audit)
      .where(gt(schema.audit.sequence, cursor))
      .orderBy(asc(schema.audit.sequence))
      .limit(limit);
    return {
      from: cursor,
      to: rows.at(-1)?.sequence ?? cursor,
      previousHash: predecessor?.hash ?? "genesis",
      entries: rows.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })),
      anchor: { sequence: last?.sequence ?? 0, hash: last?.hash ?? "genesis" },
    };
  });
}

/** The caller supplies an independently retained anchor; the export cannot authenticate its own tail. */
export function verifyAuditExport(pages: AuditExportPage[], trustedAnchor: AuditAnchor): boolean {
  let sequence = 0;
  let hash = "genesis";
  for (const page of pages) {
    if (page.from !== sequence || page.previousHash !== hash) return false;
    for (const { sequence: next, hash: expected, ...entry } of page.entries) {
      if (next <= sequence || entry.previousHash !== hash || fingerprint(entry) !== expected)
        return false;
      sequence = next;
      hash = expected;
    }
    if (page.to !== sequence || page.anchor.sequence < sequence) return false;
  }
  return sequence === trustedAnchor.sequence && hash === trustedAnchor.hash;
}
