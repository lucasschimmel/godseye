import { createHash, randomUUID } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { ApplicationError, InitiateFile, type InitiateFileInput } from "./contracts.js";
import { expectFileRevision, fileMutation, fileView, ownedFile } from "./file-state.js";
import { readAll, writeAll } from "./io.js";
import {
  applicationFilePath,
  assertApplicationRoot,
  isMissing,
  openApplicationFile,
} from "./private-files.js";
import { files, grants } from "./schema.js";
import { type ApplicationState, guardApplication } from "./state.js";

export async function initiateFile(
  state: ApplicationState,
  userId: string,
  value: InitiateFileInput,
  key?: string,
) {
  const input = InitiateFile.parse(value);
  const result = await fileMutation(
    state,
    userId,
    key,
    { action: "create", ...input },
    async (tx) => {
      if (input.size > state.limits.objectBytes)
        throw new ApplicationError("OBJECT_TOO_LARGE", "Object exceeds its byte limit", 413);
      const all = await tx.select().from(files);
      const reserved = all.filter((row) => row.status !== "deleted" || row.cleanupPending);
      if (
        reserved.length >= state.limits.maxFiles ||
        reserved.reduce((sum, row) => sum + row.size, 0) + input.size > state.limits.storageBytes
      )
        throw new ApplicationError("STORAGE_QUOTA", "Application storage quota is exhausted", 409);
      const row = {
        id: randomUUID(),
        userId,
        name: input.name,
        contentType: input.contentType,
        size: input.size,
        offset: 0,
        status: "uploading" as const,
        expectedHash: input.sha256 ?? null,
        sha256: null,
        revision: 0,
        pendingOffset: null,
        pendingHash: null,
        cleanupPending: false,
        createdAt: state.now(),
        expiresAt: new Date(state.now().getTime() + state.limits.uploadTtlMs),
      };
      await tx.insert(files).values(row);
      return fileView(row);
    },
  );
  // Reservation and exact identity are durable BEFORE creating bytes. Failures retain quota.
  const current = await ownedFile(state.store.db, userId, result.id);
  await guardApplication(state);
  if (current.status === "uploading" && current.offset === 0) {
    await assertApplicationRoot(state);
    try {
      const handle = await open(applicationFilePath(state, current.id), "wx", 0o600);
      await handle.close();
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
  }
  const handle = await openApplicationFile(state, current.id);
  await handle.close();
  await guardApplication(state);
  return fileView(current);
}
export async function appendFile(
  state: ApplicationState,
  userId: string,
  id: string,
  offset: number,
  revision: number,
  bytes: Uint8Array,
) {
  const chunkHash = createHash("sha256").update(bytes).digest("hex");
  const prepared = await state.store.transaction(async (tx) => {
    const { appScope } = await import("./schema.js");
    await tx.select().from(appScope).where(eq(appScope.id, 1)).for("update");
    const epoch = await guardApplication(state);
    const row = await ownedFile(tx, userId, id);
    expectFileRevision(row, revision);
    if (row.status !== "uploading" || row.expiresAt <= state.now())
      throw new ApplicationError("UPLOAD_UNAVAILABLE", "Upload is expired or committed", 409);
    if (!Number.isSafeInteger(offset) || offset !== row.offset)
      throw new ApplicationError("UPLOAD_OFFSET", "Upload offset differs", 409);
    if (
      !bytes.byteLength ||
      bytes.byteLength > state.limits.chunkBytes ||
      offset + bytes.byteLength > row.size
    )
      throw new ApplicationError("INVALID_CHUNK", "Chunk exceeds upload reservation", 413);
    if (
      row.pendingOffset !== null &&
      (row.pendingOffset !== offset + bytes.byteLength || row.pendingHash !== chunkHash)
    )
      throw new ApplicationError(
        "UPLOAD_UNCERTAIN",
        "Another upload chunk requires reconciliation",
        409,
      );
    await tx
      .update(files)
      .set({ pendingOffset: offset + bytes.byteLength, pendingHash: chunkHash })
      .where(eq(files.id, id));
    return { row, epoch };
  });
  const handle = await openApplicationFile(state, id, true);
  try {
    const size = (await handle.stat()).size;
    await guardApplication(state, prepared.epoch);
    if (size < offset || size > offset + bytes.byteLength)
      throw new ApplicationError("UPLOAD_UNCERTAIN", "Upload bytes require reconciliation", 409);
    const prefix = await readAll(handle, size - offset, offset);
    if (!Buffer.from(prefix).equals(Buffer.from(bytes.subarray(0, prefix.byteLength))))
      throw new ApplicationError("UPLOAD_UNCERTAIN", "Uncertain upload prefix differs", 409);
    await writeAll(handle, bytes.subarray(prefix.byteLength), size);
    await handle.sync();
    const actual = await readAll(handle, bytes.byteLength, offset);
    if (createHash("sha256").update(actual).digest("hex") !== chunkHash)
      throw new ApplicationError("UPLOAD_UNCERTAIN", "Uncertain upload bytes differ", 409);
  } finally {
    await handle.close();
  }
  return state.store.transaction(async (tx) => {
    const row = await ownedFile(tx, userId, id);
    expectFileRevision(row, revision);
    await guardApplication(state, prepared.epoch);
    if (row.pendingHash !== chunkHash || row.pendingOffset !== offset + bytes.byteLength)
      throw new ApplicationError("UPLOAD_UNCERTAIN", "Upload intent changed", 409);
    const changed = {
      offset: offset + bytes.byteLength,
      revision: revision + 1,
      pendingOffset: null,
      pendingHash: null,
    };
    await tx.update(files).set(changed).where(eq(files.id, id));
    return fileView({ ...row, ...changed });
  });
}
export function completeFile(
  state: ApplicationState,
  userId: string,
  id: string,
  revision: number,
  key?: string,
) {
  return fileMutation(
    state,
    userId,
    key,
    { action: "complete", id, revision },
    async (tx, epoch) => {
      const row = await ownedFile(tx, userId, id);
      expectFileRevision(row, revision);
      if (row.status !== "uploading" || row.offset !== row.size || row.expiresAt <= state.now())
        throw new ApplicationError(
          "INCOMPLETE_UPLOAD",
          "Complete live upload bytes are required",
          409,
        );
      const handle = await openApplicationFile(state, id);
      let sha256: string;
      try {
        if ((await handle.stat()).size !== row.size)
          throw new ApplicationError("UPLOAD_UNCERTAIN", "Upload bytes differ from metadata", 409);
        const hash = createHash("sha256");
        for await (const bytes of handle.createReadStream({ autoClose: false })) {
          hash.update(bytes);
          await guardApplication(state, epoch);
        }
        sha256 = hash.digest("hex");
      } finally {
        await handle.close();
      }
      if (row.expectedHash && row.expectedHash !== sha256)
        throw new ApplicationError("HASH_MISMATCH", "Upload digest differs", 409);
      const changed = { status: "committed" as const, sha256, revision: revision + 1 };
      await tx.update(files).set(changed).where(eq(files.id, id));
      return fileView({ ...row, ...changed });
    },
  );
}
export async function deleteFile(
  state: ApplicationState,
  userId: string,
  id: string,
  revision: number,
  key?: string,
) {
  const result = await fileMutation(
    state,
    userId,
    key,
    { action: "delete", id, revision },
    async (tx) => {
      const row = await ownedFile(tx, userId, id);
      expectFileRevision(row, revision);
      await tx.update(grants).set({ revoked: true }).where(eq(grants.fileId, id));
      const changed = { status: "deleted" as const, revision: revision + 1, cleanupPending: true };
      await tx.update(files).set(changed).where(eq(files.id, id));
      return fileView({ ...row, ...changed });
    },
  );
  const [row] = await state.store.db
    .select()
    .from(files)
    .where(and(eq(files.id, id), eq(files.userId, userId)));
  if (row?.status !== "deleted")
    throw new ApplicationError("NOT_FOUND", "Application tombstone not found", 404);
  if (row.cleanupPending) {
    await guardApplication(state);
    try {
      const handle = await openApplicationFile(state, id);
      await handle.close();
      await unlink(applicationFilePath(state, id));
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    await state.store.transaction(async (tx) => {
      await tx.update(files).set({ cleanupPending: false }).where(eq(files.id, id));
    });
  }
  return result;
}
