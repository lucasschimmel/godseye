import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { ApplicationAuth } from "./auth.js";
import { requireApplicationSession } from "./auth.js";
import { APP_BASE, ApplicationError } from "./contracts.js";
import { expectFileRevision, fileMutation, ownedFile } from "./file-state.js";
import { openApplicationFile } from "./private-files.js";
import { grants } from "./schema.js";
import { type ApplicationState, guardApplication } from "./state.js";

export function createDownloadGrant(
  state: ApplicationState,
  userId: string,
  id: string,
  revision: number,
  expiresInMs: number | undefined,
  key?: string,
) {
  const duration = expiresInMs ?? state.limits.downloadTtlMs;
  if (!Number.isSafeInteger(duration) || duration <= 0 || duration > state.limits.downloadTtlMs)
    throw new ApplicationError("INVALID_EXPIRY", "Download expiry exceeds policy", 422);
  return fileMutation(
    state,
    userId,
    key,
    { action: "grant", id, revision, duration },
    async (tx) => {
      const row = await ownedFile(tx, userId, id);
      expectFileRevision(row, revision);
      if (row.status !== "committed")
        throw new ApplicationError("NOT_FOUND", "Committed file required", 404);
      const grant = {
        id: randomBytes(32).toString("base64url"),
        userId,
        fileId: id,
        expiresAt: new Date(state.now().getTime() + duration),
        revoked: false,
      };
      await tx.insert(grants).values(grant);
      return {
        id: grant.id,
        url: `${state.baseUrl}${APP_BASE}/downloads/${grant.id}`,
        expiresAt: grant.expiresAt.toISOString(),
      };
    },
  );
}
export function revokeDownloadGrant(
  state: ApplicationState,
  userId: string,
  fileId: string,
  id: string,
  key?: string,
) {
  return fileMutation(state, userId, key, { action: "revoke-grant", fileId, id }, async (tx) => {
    await ownedFile(tx, userId, fileId);
    const [grant] = await tx
      .select()
      .from(grants)
      .where(and(eq(grants.id, id), eq(grants.userId, userId), eq(grants.fileId, fileId)));
    if (!grant) throw new ApplicationError("NOT_FOUND", "Download grant not found", 404);
    await tx.update(grants).set({ revoked: true }).where(eq(grants.id, id));
    return { revoked: true };
  });
}
export async function downloadFile(
  state: ApplicationState,
  auth: ApplicationAuth,
  headers: Headers,
  userId: string,
  id: string,
  grantId?: string,
  signal?: AbortSignal,
) {
  const epoch = await guardApplication(state);
  const validate = async () => {
    await guardApplication(state, epoch);
    const identity = await requireApplicationSession(state, auth, headers);
    if (identity.user.id !== userId)
      throw new ApplicationError("UNAUTHENTICATED", "Application session changed", 401);
    if (grantId) {
      const [grant] = await state.store.db
        .select()
        .from(grants)
        .where(and(eq(grants.id, grantId), eq(grants.userId, userId)));
      if (!grant || grant.revoked || grant.expiresAt <= state.now() || grant.fileId !== id)
        throw new ApplicationError("NOT_FOUND", "Download grant unavailable", 404);
    }
    const row = await ownedFile(state.store.db, userId, id);
    if (row.status !== "committed")
      throw new ApplicationError("NOT_FOUND", "Committed file required", 404);
    return row;
  };
  const row = await validate();
  let start = 0,
    end = row.size - 1;
  const range = headers.get("range");
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match)
      throw new ApplicationError("INVALID_RANGE", "One explicit byte range is supported", 416);
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : row.size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end >= row.size ||
      start > end
    )
      throw new ApplicationError("INVALID_RANGE", "Byte range exceeds object", 416);
  }
  if (state.downloads.size >= state.limits.streamConnections)
    throw new ApplicationError("DOWNLOAD_LIMIT", "Application download capacity is exhausted", 429);
  const abort = new AbortController();
  state.downloads.add(abort);
  let handle: Awaited<ReturnType<typeof openApplicationFile>>;
  try {
    handle = await openApplicationFile(state, id);
  } catch (error) {
    state.downloads.delete(abort);
    throw error;
  }
  try {
    if ((await handle.stat()).size !== row.size)
      throw new ApplicationError("FILE_INTEGRITY", "File bytes differ from metadata", 409);
  } catch (error) {
    await handle.close();
    state.downloads.delete(abort);
    throw error;
  }
  let position = start,
    closed = false;
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      closed = true;
      clearTimeout(lifetime);
      clearInterval(poll);
      signal?.removeEventListener("abort", onAbort);
      abort.signal.removeEventListener("abort", onAbort);
      await handle.close();
      state.downloads.delete(abort);
      state.downloadClosers.delete(abort);
    })();
    return closing;
  };
  const onAbort = () => {
    void close();
  };
  state.downloadClosers.set(abort, close);
  const lifetime = setTimeout(onAbort, state.limits.streamLifetimeMs);
  let checking = false;
  const poll = setInterval(() => {
    if (checking || closed) return;
    checking = true;
    void validate().then(
      () => {
        checking = false;
      },
      () => {
        checking = false;
        void close();
      },
    );
  }, state.limits.streamPollMs);
  signal?.addEventListener("abort", onAbort, { once: true });
  abort.signal.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) await close();
  const content = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          if (closed) {
            controller.close();
            return;
          }
          await validate();
          if (position > end) {
            await close();
            controller.close();
            return;
          }
          const buffer = new Uint8Array(Math.min(65536, end - position + 1));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
          if (!bytesRead)
            throw new ApplicationError("FILE_INTEGRITY", "File ended unexpectedly", 409);
          await validate();
          position += bytesRead;
          controller.enqueue(buffer.subarray(0, bytesRead));
        } catch (error) {
          await close();
          controller.error(error);
        }
      },
      cancel: close,
    },
    { highWaterMark: 0 },
  );
  const responseHeaders = new Headers({
    "Content-Type": "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    "Content-Length": String(Math.max(0, end - start + 1)),
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    ETag: `"${row.sha256}"`,
  });
  if (range) responseHeaders.set("Content-Range", `bytes ${start}-${end}/${row.size}`);
  return new Response(content, { status: range ? 206 : 200, headers: responseHeaders });
}
