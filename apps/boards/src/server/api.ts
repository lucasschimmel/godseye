import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import {
  AddMemberInput,
  BoardIdInput,
  CreateBoardInput,
  RemoveMemberInput,
  RenameBoardInput,
  SaveSceneInput,
  SetMemberRoleInput,
} from "../lib/contracts";
import * as service from "./boards-service";
import { BoardError } from "./errors";
import { getRuntime } from "./runtime";

/** Server functions: the only way the UI reaches the data. Each one re-checks the session. */
async function authenticated() {
  const runtime = await getRuntime();
  const session = await runtime.auth.api.getSession({ headers: getRequest().headers });
  if (!session) throw new BoardError("UNAUTHENTICATED", "Sign in to continue");
  return { db: runtime.db, userId: session.user.id, user: session.user };
}

/**
 * Failures cross the wire as a typed result: expected BoardError values are returned, anything
 * else is logged server-side and replaced by a generic message.
 */
export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string; details?: Record<string, string | number | null> };
async function outcome<T>(work: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof BoardError)
      return { ok: false, code: error.code, message: error.message, details: error.details };
    console.error("boards: unexpected server error", error);
    return { ok: false, code: "INTERNAL", message: "Something went wrong" };
  }
}

export const currentUser = createServerFn({ method: "GET" }).handler(async () => {
  const runtime = await getRuntime();
  const session = await runtime.auth.api.getSession({ headers: getRequest().headers });
  return session
    ? { id: session.user.id, name: session.user.name, email: session.user.email }
    : null;
});

export const listBoardsFn = createServerFn({ method: "GET" }).handler(() =>
  outcome(async () => {
    const { db, userId } = await authenticated();
    return service.listBoards(db, userId);
  }),
);
export const createBoardFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => CreateBoardInput.parse(input))
  .handler(({ data }) =>
    outcome(async () => {
      const { db, userId } = await authenticated();
      return service.createBoard(db, userId, data.name);
    }),
  );
export const getBoardFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => BoardIdInput.parse(input))
  .handler(({ data }) =>
    outcome(async () => {
      const { db, userId } = await authenticated();
      return service.getBoard(db, userId, data.boardId);
    }),
  );
export const saveSceneFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => SaveSceneInput.parse(input))
  .handler(({ data }) =>
    outcome(async () => {
      const { db, userId } = await authenticated();
      return service.saveScene(db, userId, data);
    }),
  );
export const renameBoardFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => RenameBoardInput.parse(input))
  .handler(({ data }) =>
    outcome(async () => {
      const { db, userId } = await authenticated();
      await service.renameBoard(db, userId, data.boardId, data.name);
    }),
  );
export const deleteBoardFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => BoardIdInput.parse(input))
  .handler(({ data }) =>
    outcome(async () => {
      const { db, userId } = await authenticated();
      await service.deleteBoard(db, userId, data.boardId);
    }),
  );
export const listMembersFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => BoardIdInput.parse(input))
  .handler(({ data }) =>
    outcome(async () => {
      const { db, userId } = await authenticated();
      return service.listMembers(db, userId, data.boardId);
    }),
  );
export const addMemberFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => AddMemberInput.parse(input))
  .handler(({ data }) =>
    outcome(async () => {
      const { db, userId } = await authenticated();
      await service.addMember(db, userId, data);
    }),
  );
export const setMemberRoleFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => SetMemberRoleInput.parse(input))
  .handler(({ data }) =>
    outcome(async () => {
      const { db, userId } = await authenticated();
      await service.setMemberRole(db, userId, data);
    }),
  );
export const removeMemberFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => RemoveMemberInput.parse(input))
  .handler(({ data }) =>
    outcome(async () => {
      const { db, userId } = await authenticated();
      await service.removeMember(db, userId, data);
    }),
  );
