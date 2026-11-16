import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { z } from "zod";
import { type ApplicationAuth, requireApplicationSession } from "./auth.js";
import { ApplicationError, type ApplicationEventView } from "./contracts.js";
import { enqueueApplicationJobEvent } from "./jobs-bridge.js";
import { appScope, events, receipts, user } from "./schema.js";
import { type ApplicationState, guardApplication } from "./state.js";

const Publish = z
  .object({
    userId: z.string().min(1).max(100),
    type: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
    payload: z.json(),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9:_-]{8,128}$/),
  })
  .strict();
export type PublishApplicationEvent = Omit<z.infer<typeof Publish>, "payload"> & {
  payload: unknown;
};
function eventView(row: typeof events.$inferSelect): ApplicationEventView {
  return {
    id: String(row.id),
    type: row.type,
    payload: row.payload,
    occurredAt: row.occurredAt.toISOString(),
  };
}
function cursor(state: ApplicationState, userId: string, id: number) {
  const signature = createHmac("sha256", state.authMaterial)
    .update(`cursor:${JSON.stringify(state.scope)}:${userId}:${id}`)
    .digest("base64url");
  return `v1.${id}.${signature}`;
}
function readCursor(state: ApplicationState, userId: string, value: string | null) {
  if (!value) return 0;
  const match = /^v1\.(\d{1,16})\.([A-Za-z0-9_-]{43})$/.exec(value);
  const id = Number(match?.[1]);
  const expected = cursor(state, userId, id);
  if (
    !match ||
    !Number.isSafeInteger(id) ||
    Buffer.byteLength(value) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(value), Buffer.from(expected))
  )
    throw new ApplicationError(
      "INVALID_CURSOR",
      "Event cursor belongs to another stream or is malformed",
      409,
    );
  return id;
}
export function publishApplicationEvent(state: ApplicationState, raw: PublishApplicationEvent) {
  const input = JSON.parse(JSON.stringify(Publish.parse(raw))) as PublishApplicationEvent;
  if (Buffer.byteLength(JSON.stringify(input.payload), "utf8") > state.limits.eventBytes)
    throw new ApplicationError("EVENT_TOO_LARGE", "Application event exceeds its byte limit", 413);
  return state.store.exclusive(() =>
    state.store.transaction(async (tx) => {
      await tx.select().from(appScope).where(eq(appScope.id, 1)).for("update");
      const epoch = await guardApplication(state);
      const [recipient] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, input.userId));
      if (!recipient)
        throw new ApplicationError("NOT_FOUND", "Application event recipient not found", 404);
      const key = createHash("sha256")
        .update(`event:${input.userId}:${input.idempotencyKey}`)
        .digest("hex");
      const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const [previous] = await tx.select().from(receipts).where(eq(receipts.key, key));
      if (previous) {
        if (previous.digest !== digest)
          throw new ApplicationError(
            "IDEMPOTENCY_CONFLICT",
            "Application event key input changed",
            409,
          );
        return previous.result as ApplicationEventView;
      }
      const [inserted] = await tx
        .insert(events)
        .values({
          userId: input.userId,
          type: input.type,
          payload: input.payload,
          eventKey: key,
          digest,
          occurredAt: state.now(),
        })
        .returning();
      if (!inserted)
        throw new ApplicationError("INTERNAL_ERROR", "Application event was not persisted", 500);
      const result = eventView(inserted);
      await tx.insert(receipts).values({ key, digest, result });
      await enqueueApplicationJobEvent(
        state,
        tx,
        { key, userId: input.userId, type: input.type, payload: input.payload },
        epoch,
      );
      const retained = await tx
        .select({ id: events.id })
        .from(events)
        .orderBy(desc(events.id))
        .offset(state.limits.eventRetention - 1)
        .limit(1);
      if (retained[0]) await tx.delete(events).where(lt(events.id, retained[0].id));
      await guardApplication(state, epoch);
      return result;
    }),
  );
}
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    if (signal.aborted) finish();
    else signal.addEventListener("abort", finish, { once: true });
  });
}
export async function applicationEventStream(
  state: ApplicationState,
  auth: ApplicationAuth,
  request: Request,
) {
  const identity = await requireApplicationSession(state, auth, request.headers);
  const epoch = await guardApplication(state);
  let after = readCursor(state, identity.user.id, request.headers.get("Last-Event-ID"));
  if (state.streams.size >= state.limits.streamConnections)
    throw new ApplicationError("STREAM_LIMIT", "Application stream capacity is exhausted", 429);
  const abort = new AbortController();
  state.streams.add(abort);
  let done = false;
  const finish = () => {
    if (!done) {
      done = true;
      state.streams.delete(abort);
      abort.abort();
      clearTimeout(lifetime);
      request.signal.removeEventListener("abort", onAbort);
      abort.signal.removeEventListener("abort", onAbort);
    }
  };
  const onAbort = () => finish();
  request.signal.addEventListener("abort", onAbort, { once: true });
  abort.signal.addEventListener("abort", onAbort, { once: true });
  const lifetime = setTimeout(onAbort, state.limits.streamLifetimeMs);
  const encode = new TextEncoder();
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          while (!abort.signal.aborted) {
            await guardApplication(state, epoch);
            const current = await requireApplicationSession(state, auth, request.headers);
            if (current.session.id !== identity.session.id)
              throw new ApplicationError(
                "UNAUTHENTICATED",
                "Application stream session changed",
                401,
              );
            const [floor] = await state.store.db
              .select({ id: events.id })
              .from(events)
              .orderBy(asc(events.id))
              .limit(1);
            if (after > 0 && floor && after < floor.id - 1) {
              controller.enqueue(
                encode.encode('event: refetch\ndata: {"reason":"cursor_gap"}\n\n'),
              );
              finish();
              controller.close();
              return;
            }
            const [row] = await state.store.db
              .select()
              .from(events)
              .where(and(eq(events.userId, identity.user.id), gt(events.id, after)))
              .orderBy(asc(events.id))
              .limit(1);
            await guardApplication(state, epoch);
            const latest = await requireApplicationSession(state, auth, request.headers);
            if (latest.session.id !== identity.session.id)
              throw new ApplicationError(
                "UNAUTHENTICATED",
                "Application stream session was revoked",
                401,
              );
            if (row) {
              after = row.id;
              controller.enqueue(
                encode.encode(
                  `id: ${cursor(state, identity.user.id, row.id)}\nevent: domain\ndata: ${JSON.stringify(eventView(row))}\n\n`,
                ),
              );
              return;
            }
            await wait(state.limits.streamPollMs, abort.signal);
            if (!abort.signal.aborted) {
              controller.enqueue(encode.encode(": heartbeat\n\n"));
              return;
            }
          }
          finish();
          controller.close();
        } catch {
          finish();
          controller.enqueue(
            encode.encode('event: revoked\ndata: {"reason":"authorization_changed"}\n\n'),
          );
          controller.close();
        }
      },
      cancel: finish,
    },
    { highWaterMark: 0 },
  );
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
