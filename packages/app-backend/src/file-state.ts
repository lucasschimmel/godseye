import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ApplicationError, type ApplicationFileView } from "./contracts.js";
import { appScope, files, receipts } from "./schema.js";
import type { ApplicationState } from "./state.js";
import { guardApplication } from "./state.js";
import type { ApplicationAccess } from "./store.js";

export type FileRow = typeof files.$inferSelect;
export const fileView = (row: FileRow): ApplicationFileView => ({
  id: row.id,
  name: row.name,
  contentType: row.contentType,
  size: row.size,
  offset: row.offset,
  status: row.status,
  sha256: row.sha256,
  revision: row.revision,
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
});
export async function ownedFile(tx: ApplicationAccess, userId: string, id: string) {
  const [row] = await tx
    .select()
    .from(files)
    .where(and(eq(files.id, id), eq(files.userId, userId)));
  if (!row || row.status === "deleted")
    throw new ApplicationError("NOT_FOUND", "Application file not found", 404);
  return row;
}
export function expectFileRevision(row: FileRow, revision: number) {
  if (row.revision !== revision)
    throw new ApplicationError("STALE_REVISION", "Application file revision changed", 409);
}
export async function fileMutation<T>(
  state: ApplicationState,
  userId: string,
  key: string | undefined,
  input: unknown,
  work: (tx: ApplicationAccess, epoch: number) => Promise<T>,
): Promise<T> {
  if (!key || !/^[A-Za-z0-9:_-]{8,128}$/.test(key))
    throw new ApplicationError(
      "INVALID_IDEMPOTENCY_KEY",
      "A bounded idempotency key is required",
      422,
    );
  const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return state.store.transaction(async (tx) => {
    await tx.select().from(appScope).where(eq(appScope.id, 1)).for("update");
    const epoch = await guardApplication(state);
    const scopedKey = createHash("sha256").update(`${userId}:${key}`).digest("hex");
    const [receipt] = await tx.select().from(receipts).where(eq(receipts.key, scopedKey));
    if (receipt) {
      if (receipt.digest !== digest)
        throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Idempotency key input changed", 409);
      return receipt.result as T;
    }
    const result = await work(tx, epoch);
    await guardApplication(state, epoch);
    await tx.insert(receipts).values({ key: scopedKey, digest, result });
    return result;
  });
}
