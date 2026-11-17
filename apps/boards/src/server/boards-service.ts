import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  type BoardDetail,
  type BoardFileData,
  type BoardSummary,
  EMPTY_SCENE,
  type MemberView,
  type SaveResult,
  SaveSceneInput,
  type SaveSceneInput as SaveSceneInputType,
  Scene,
} from "../lib/contracts";
import type { BoardsDatabase } from "./db";
import { BoardError } from "./errors";
import { BOARD_LIMITS } from "./limits";
import { type BoardRole, boardFiles, boardMembers, boards, user } from "./schema";

const WRITE_ROLES: readonly BoardRole[] = ["owner", "editor"];

/** Returns the caller's role, or a 404 so that board existence is never leaked to non-members. */
async function roleOf(db: BoardsDatabase, userId: string, boardId: string): Promise<BoardRole> {
  const [member] = await db
    .select({ role: boardMembers.role })
    .from(boardMembers)
    .where(and(eq(boardMembers.boardId, boardId), eq(boardMembers.userId, userId)));
  if (!member) throw new BoardError("NOT_FOUND", "Board not found");
  return member.role;
}
function requireRole(role: BoardRole, allowed: readonly BoardRole[], action: string) {
  if (!allowed.includes(role))
    throw new BoardError("FORBIDDEN", `Your role does not allow you to ${action}`);
}

export async function listBoards(db: BoardsDatabase, userId: string): Promise<BoardSummary[]> {
  const rows = await db
    .select({
      id: boards.id,
      name: boards.name,
      role: boardMembers.role,
      revision: boards.revision,
      updatedAt: boards.updatedAt,
    })
    .from(boardMembers)
    .innerJoin(boards, eq(boards.id, boardMembers.boardId))
    .where(eq(boardMembers.userId, userId))
    .orderBy(desc(boards.updatedAt));
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
}

export async function createBoard(
  db: BoardsDatabase,
  userId: string,
  name: string,
): Promise<BoardSummary> {
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({ total: count() })
      .from(boards)
      .where(eq(boards.ownerId, userId));
    if ((owned?.total ?? 0) >= BOARD_LIMITS.boardsPerOwner)
      throw new BoardError("LIMIT_REACHED", "Board limit reached for this account");
    const now = new Date();
    const id = randomUUID();
    await tx.insert(boards).values({
      id,
      name,
      ownerId: userId,
      scene: EMPTY_SCENE,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(boardMembers).values({ boardId: id, userId, role: "owner", createdAt: now });
    return { id, name, role: "owner", revision: 0, updatedAt: now.toISOString() };
  });
}

export async function getBoard(
  db: BoardsDatabase,
  userId: string,
  boardId: string,
): Promise<BoardDetail> {
  const role = await roleOf(db, userId, boardId);
  const [board] = await db.select().from(boards).where(eq(boards.id, boardId));
  if (!board) throw new BoardError("NOT_FOUND", "Board not found");
  const scene = Scene.safeParse(board.scene);
  const files = await db
    .select({
      fileId: boardFiles.fileId,
      mimeType: boardFiles.mimeType,
      dataUrl: boardFiles.dataUrl,
    })
    .from(boardFiles)
    .where(eq(boardFiles.boardId, boardId));
  return {
    id: board.id,
    name: board.name,
    role,
    revision: board.revision,
    updatedAt: board.updatedAt.toISOString(),
    // A stored scene that no longer satisfies the contract opens empty rather than breaking the page.
    scene: scene.success ? scene.data : EMPTY_SCENE,
    files: files as BoardFileData[],
  };
}

/**
 * Saves a scene with optimistic concurrency: the write only succeeds when the client's base
 * revision is still the current one. A stale client gets CONFLICT and must reload.
 */
export async function saveScene(
  db: BoardsDatabase,
  userId: string,
  rawInput: SaveSceneInputType,
): Promise<SaveResult> {
  const input = SaveSceneInput.parse(rawInput);
  const role = await roleOf(db, userId, input.boardId);
  requireRole(role, WRITE_ROLES, "edit this board");
  if (JSON.stringify(input.scene).length > BOARD_LIMITS.sceneBytes)
    throw new BoardError("LIMIT_REACHED", "Scene is too large");
  for (const file of input.files)
    if (file.dataUrl.length > BOARD_LIMITS.fileBytes * 1.4)
      throw new BoardError("LIMIT_REACHED", "Image is too large");
  return db.transaction(async (tx) => {
    if (input.files.length) {
      const [existing] = await tx
        .select({ total: count() })
        .from(boardFiles)
        .where(eq(boardFiles.boardId, input.boardId));
      if ((existing?.total ?? 0) + input.files.length > BOARD_LIMITS.filesPerBoard)
        throw new BoardError("LIMIT_REACHED", "Image limit reached for this board");
    }
    const now = new Date();
    const updated = await tx
      .update(boards)
      .set({ scene: input.scene, revision: sql`${boards.revision} + 1`, updatedAt: now })
      .where(and(eq(boards.id, input.boardId), eq(boards.revision, input.expectedRevision)))
      .returning({ revision: boards.revision });
    const [row] = updated;
    if (!row) {
      const [current] = await tx
        .select({ revision: boards.revision })
        .from(boards)
        .where(eq(boards.id, input.boardId));
      throw new BoardError("CONFLICT", "Board was modified elsewhere", {
        currentRevision: current?.revision ?? null,
      });
    }
    // Excalidraw file ids are content hashes, so an existing id never needs rewriting.
    for (const file of input.files)
      await tx
        .insert(boardFiles)
        .values({
          boardId: input.boardId,
          fileId: file.fileId,
          mimeType: file.mimeType,
          dataUrl: file.dataUrl,
          size: file.dataUrl.length,
          createdAt: now,
        })
        .onConflictDoNothing();
    return { revision: row.revision, updatedAt: now.toISOString() };
  });
}

export async function renameBoard(
  db: BoardsDatabase,
  userId: string,
  boardId: string,
  name: string,
): Promise<void> {
  requireRole(await roleOf(db, userId, boardId), ["owner"], "rename this board");
  await db.update(boards).set({ name, updatedAt: new Date() }).where(eq(boards.id, boardId));
}

export async function deleteBoard(
  db: BoardsDatabase,
  userId: string,
  boardId: string,
): Promise<void> {
  requireRole(await roleOf(db, userId, boardId), ["owner"], "delete this board");
  await db.delete(boards).where(eq(boards.id, boardId));
}

export async function listMembers(
  db: BoardsDatabase,
  userId: string,
  boardId: string,
): Promise<MemberView[]> {
  await roleOf(db, userId, boardId);
  return db
    .select({ userId: user.id, name: user.name, email: user.email, role: boardMembers.role })
    .from(boardMembers)
    .innerJoin(user, eq(user.id, boardMembers.userId))
    .where(eq(boardMembers.boardId, boardId))
    .orderBy(asc(boardMembers.createdAt));
}

export async function addMember(
  db: BoardsDatabase,
  userId: string,
  input: { boardId: string; email: string; role: "editor" | "viewer" },
): Promise<void> {
  requireRole(await roleOf(db, userId, input.boardId), ["owner"], "share this board");
  const [target] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, input.email.toLowerCase()));
  // The same answer for an unknown address: sharing must not become an account-existence oracle.
  if (!target) throw new BoardError("NOT_FOUND", "No account matches this email address");
  await db.transaction(async (tx) => {
    const [members] = await tx
      .select({ total: count() })
      .from(boardMembers)
      .where(eq(boardMembers.boardId, input.boardId));
    if ((members?.total ?? 0) >= BOARD_LIMITS.membersPerBoard)
      throw new BoardError("LIMIT_REACHED", "Member limit reached for this board");
    await tx
      .insert(boardMembers)
      .values({
        boardId: input.boardId,
        userId: target.id,
        role: input.role,
        createdAt: new Date(),
      })
      // Re-sharing updates the role, but never demotes the owner row.
      .onConflictDoUpdate({
        target: [boardMembers.boardId, boardMembers.userId],
        set: { role: input.role },
        setWhere: inArray(boardMembers.role, ["editor", "viewer"]),
      });
  });
}

async function assertNotOwner(db: BoardsDatabase, boardId: string, targetId: string) {
  const [board] = await db
    .select({ ownerId: boards.ownerId })
    .from(boards)
    .where(eq(boards.id, boardId));
  if (board?.ownerId === targetId)
    throw new BoardError("FORBIDDEN", "The owner cannot be changed or removed");
}

export async function setMemberRole(
  db: BoardsDatabase,
  userId: string,
  input: { boardId: string; userId: string; role: "editor" | "viewer" },
): Promise<void> {
  requireRole(await roleOf(db, userId, input.boardId), ["owner"], "change roles");
  await assertNotOwner(db, input.boardId, input.userId);
  await db
    .update(boardMembers)
    .set({ role: input.role })
    .where(and(eq(boardMembers.boardId, input.boardId), eq(boardMembers.userId, input.userId)));
}

/** The owner removes anyone else; any other member may leave on their own. */
export async function removeMember(
  db: BoardsDatabase,
  userId: string,
  input: { boardId: string; userId: string },
): Promise<void> {
  const role = await roleOf(db, userId, input.boardId);
  if (input.userId !== userId) requireRole(role, ["owner"], "remove members");
  await assertNotOwner(db, input.boardId, input.userId);
  await db
    .delete(boardMembers)
    .where(and(eq(boardMembers.boardId, input.boardId), eq(boardMembers.userId, input.userId)));
}
