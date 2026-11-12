import { and, asc, eq, gt } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { type ApplicationAuth, requireApplicationSession } from "./auth.js";
import { APP_BASE, ApplicationError, InitiateFile } from "./contracts.js";
import { createDownloadGrant, downloadFile, revokeDownloadGrant } from "./file-read.js";
import { fileView, ownedFile } from "./file-state.js";
import { appendFile, completeFile, deleteFile, initiateFile } from "./file-write.js";
import { boundedBody } from "./runtime.js";
import { files, grants } from "./schema.js";
import type { ApplicationState } from "./state.js";
import { guardApplication } from "./state.js";

async function jsonInput<T>(request: Request, schema: z.ZodType<T>) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new ApplicationError("INVALID_CONTENT_TYPE", "JSON content type required", 415);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(await boundedBody(request, 16384)));
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError("INVALID_JSON", "Malformed JSON body", 400);
  }
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApplicationError("INVALID_INPUT", "Application input differs from contract", 422);
  return result.data;
}
const Revision = z.object({ expectedRevision: z.number().int().nonnegative() }).strict();
export function registerFileRoutes(app: Hono, state: ApplicationState, auth: ApplicationAuth) {
  app.get(`${APP_BASE}/files`, async (c) => {
    const epoch = await guardApplication(state);
    const identity = await requireApplicationSession(state, auth, c.req.raw.headers);
    const after = c.req.query("after");
    if (after && !z.uuid().safeParse(after).success)
      throw new ApplicationError("INVALID_CURSOR", "File cursor is malformed", 422);
    const rows = await state.store.db
      .select()
      .from(files)
      .where(
        and(
          eq(files.userId, identity.user.id),
          eq(files.status, "committed"),
          after ? gt(files.id, after) : undefined,
        ),
      )
      .orderBy(asc(files.id))
      .limit(101);
    await requireApplicationSession(state, auth, c.req.raw.headers);
    await guardApplication(state, epoch);
    return c.json({
      files: rows.slice(0, 100).map(fileView),
      nextCursor: rows.length > 100 ? rows[99]?.id : null,
    });
  });
  app.get(`${APP_BASE}/files/:id`, async (c) => {
    const epoch = await guardApplication(state);
    const identity = await requireApplicationSession(state, auth, c.req.raw.headers);
    const row = await ownedFile(state.store.db, identity.user.id, c.req.param("id"));
    await requireApplicationSession(state, auth, c.req.raw.headers);
    await guardApplication(state, epoch);
    return c.json(fileView(row));
  });
  app.post(`${APP_BASE}/files`, (c) =>
    state.store.exclusive(async () => {
      const identity = await requireApplicationSession(state, auth, c.req.raw.headers);
      return c.json(
        await initiateFile(
          state,
          identity.user.id,
          await jsonInput(c.req.raw, InitiateFile),
          c.req.header("Idempotency-Key"),
        ),
        201,
      );
    }),
  );
  app.put(`${APP_BASE}/files/:id/content`, (c) =>
    state.store.exclusive(async () => {
      const identity = await requireApplicationSession(state, auth, c.req.raw.headers);
      if (c.req.header("content-type")?.split(";")[0] !== "application/octet-stream")
        throw new ApplicationError("INVALID_CONTENT_TYPE", "Binary chunk required", 415);
      const offset = c.req.header("Upload-Offset"),
        revision = c.req.header("If-Match");
      if (!offset || !revision || !/^\d+$/.test(offset) || !/^\d+$/.test(revision))
        throw new ApplicationError("INVALID_INPUT", "Offset and revision required", 422);
      return c.json(
        await appendFile(
          state,
          identity.user.id,
          c.req.param("id"),
          Number(offset),
          Number(revision),
          await boundedBody(c.req.raw, state.limits.chunkBytes),
        ),
      );
    }),
  );
  app.post(`${APP_BASE}/files/:id/complete`, (c) =>
    state.store.exclusive(async () => {
      const identity = await requireApplicationSession(state, auth, c.req.raw.headers);
      const input = await jsonInput(c.req.raw, Revision);
      return c.json(
        await completeFile(
          state,
          identity.user.id,
          c.req.param("id"),
          input.expectedRevision,
          c.req.header("Idempotency-Key"),
        ),
      );
    }),
  );
  app.delete(`${APP_BASE}/files/:id`, (c) =>
    state.store.exclusive(async () => {
      const identity = await requireApplicationSession(state, auth, c.req.raw.headers);
      const input = await jsonInput(c.req.raw, Revision);
      return c.json(
        await deleteFile(
          state,
          identity.user.id,
          c.req.param("id"),
          input.expectedRevision,
          c.req.header("Idempotency-Key"),
        ),
      );
    }),
  );
  app.get(`${APP_BASE}/files/:id/download`, async (c) => {
    const identity = await requireApplicationSession(state, auth, c.req.raw.headers);
    return downloadFile(
      state,
      auth,
      c.req.raw.headers,
      identity.user.id,
      c.req.param("id"),
      undefined,
      c.req.raw.signal,
    );
  });
  app.post(`${APP_BASE}/files/:id/grants`, (c) =>
    state.store.exclusive(async () => {
      const identity = await requireApplicationSession(state, auth, c.req.raw.headers);
      const input = await jsonInput(
        c.req.raw,
        Revision.extend({ expiresInMs: z.number().int().positive().optional() }),
      );
      return c.json(
        await createDownloadGrant(
          state,
          identity.user.id,
          c.req.param("id"),
          input.expectedRevision,
          input.expiresInMs,
          c.req.header("Idempotency-Key"),
        ),
        201,
      );
    }),
  );
  app.delete(`${APP_BASE}/files/:id/grants/:grantId`, (c) =>
    state.store.exclusive(async () => {
      const identity = await requireApplicationSession(state, auth, c.req.raw.headers);
      await jsonInput(c.req.raw, z.object({}).strict());
      return c.json(
        await revokeDownloadGrant(
          state,
          identity.user.id,
          c.req.param("id"),
          c.req.param("grantId"),
          c.req.header("Idempotency-Key"),
        ),
      );
    }),
  );
  app.get(`${APP_BASE}/downloads/:grantId`, async (c) => {
    const identity = await requireApplicationSession(state, auth, c.req.raw.headers);
    const [grant] = await state.store.db
      .select()
      .from(grants)
      .where(and(eq(grants.id, c.req.param("grantId")), eq(grants.userId, identity.user.id)));
    if (!grant) throw new ApplicationError("NOT_FOUND", "Download grant unavailable", 404);
    return downloadFile(
      state,
      auth,
      c.req.raw.headers,
      identity.user.id,
      grant.fileId,
      grant.id,
      c.req.raw.signal,
    );
  });
}
