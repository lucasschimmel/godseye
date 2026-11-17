import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as service from "../apps/boards/src/server/boards-service";
import { type BoardsStore, openBoardsStore } from "../apps/boards/src/server/db";
import { BoardError } from "../apps/boards/src/server/errors";
import { BOARD_LIMITS } from "../apps/boards/src/server/limits";
import { boardFiles, user } from "../apps/boards/src/server/schema";

let store: BoardsStore;
const now = new Date();
const people = {
  alice: { id: "u-alice", email: "alice@example.test" },
  bob: { id: "u-bob", email: "bob@example.test" },
  carol: { id: "u-carol", email: "carol@example.test" },
};

const rectangle = (id: string) => ({ id, type: "rectangle", version: 1, isDeleted: false });
const scene = (...ids: string[]) => ({ elements: ids.map(rectangle), appState: {} });
const PIXEL = "data:image/png;base64,iVBORw0KGgo=";

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    if (error instanceof BoardError) return error.code;
    throw error;
  }
  return "OK";
}

beforeAll(async () => {
  store = await openBoardsStore({ dataDir: "memory://" });
  for (const person of Object.values(people))
    await store.db.insert(user).values({
      id: person.id,
      name: person.id,
      email: person.email,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    });
});
afterAll(async () => {
  await store.close();
});

describe("boards: ownership and visibility", () => {
  it("lists only the boards a user is a member of", async () => {
    const mine = await service.createBoard(store.db, people.alice.id, "Alice only");
    expect((await service.listBoards(store.db, people.alice.id)).map((b) => b.id)).toContain(
      mine.id,
    );
    expect((await service.listBoards(store.db, people.bob.id)).map((b) => b.id)).not.toContain(
      mine.id,
    );
  });

  it("answers NOT_FOUND, not FORBIDDEN, to a non-member so existence is not leaked", async () => {
    const board = await service.createBoard(store.db, people.alice.id, "Hidden");
    expect(await codeOf(service.getBoard(store.db, people.bob.id, board.id))).toBe("NOT_FOUND");
    expect(
      await codeOf(
        service.saveScene(store.db, people.bob.id, {
          boardId: board.id,
          expectedRevision: 0,
          scene: scene("a"),
          files: [],
        }),
      ),
    ).toBe("NOT_FOUND");
  });

  it("enforces the per-owner board limit", async () => {
    const limited = "u-limited";
    await store.db.insert(user).values({
      id: limited,
      name: limited,
      email: "limited@example.test",
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    });
    for (let index = 0; index < BOARD_LIMITS.boardsPerOwner; index++)
      await service.createBoard(store.db, limited, `b${index}`);
    expect(await codeOf(service.createBoard(store.db, limited, "one too many"))).toBe(
      "LIMIT_REACHED",
    );
  });
});

describe("boards: scene saves", () => {
  it("increments the revision and persists the scene", async () => {
    const board = await service.createBoard(store.db, people.alice.id, "Draft");
    const saved = await service.saveScene(store.db, people.alice.id, {
      boardId: board.id,
      expectedRevision: 0,
      scene: scene("a", "b"),
      files: [],
    });
    expect(saved.revision).toBe(1);
    const loaded = await service.getBoard(store.db, people.alice.id, board.id);
    expect(loaded.revision).toBe(1);
    expect(loaded.scene.elements.map((element) => element.id)).toEqual(["a", "b"]);
  });

  it("rejects a stale base revision with CONFLICT and keeps the newer content", async () => {
    const board = await service.createBoard(store.db, people.alice.id, "Race");
    await service.saveScene(store.db, people.alice.id, {
      boardId: board.id,
      expectedRevision: 0,
      scene: scene("winner"),
      files: [],
    });
    let conflict: BoardError | undefined;
    try {
      await service.saveScene(store.db, people.alice.id, {
        boardId: board.id,
        expectedRevision: 0,
        scene: scene("loser"),
        files: [],
      });
    } catch (error) {
      if (error instanceof BoardError) conflict = error;
    }
    expect(conflict?.code).toBe("CONFLICT");
    expect(conflict?.details?.currentRevision).toBe(1);
    const loaded = await service.getBoard(store.db, people.alice.id, board.id);
    expect(loaded.scene.elements.map((element) => element.id)).toEqual(["winner"]);
  });

  it("lets only one of two concurrent saves from the same revision win", async () => {
    const board = await service.createBoard(store.db, people.alice.id, "Concurrent");
    const attempt = (id: string) =>
      codeOf(
        service.saveScene(store.db, people.alice.id, {
          boardId: board.id,
          expectedRevision: 0,
          scene: scene(id),
          files: [],
        }),
      );
    const results = await Promise.all([attempt("one"), attempt("two")]);
    expect(results.sort()).toEqual(["CONFLICT", "OK"]);
  });

  it("rejects a malformed scene instead of storing it", async () => {
    const board = await service.createBoard(store.db, people.alice.id, "Invalid");
    await expect(
      service.saveScene(store.db, people.alice.id, {
        boardId: board.id,
        expectedRevision: 0,
        // Deliberately violates the contract: an element without an id.
        scene: { elements: [{ noId: true }], appState: {} },
        files: [],
      }),
    ).rejects.toThrow();
    expect((await service.getBoard(store.db, people.alice.id, board.id)).revision).toBe(0);
  });

  it("stores each image once and enforces the per-board image limit", async () => {
    const board = await service.createBoard(store.db, people.alice.id, "Images");
    const file = { fileId: "f1", mimeType: "image/png", dataUrl: PIXEL } as const;
    await service.saveScene(store.db, people.alice.id, {
      boardId: board.id,
      expectedRevision: 0,
      scene: scene("img"),
      files: [file],
    });
    await service.saveScene(store.db, people.alice.id, {
      boardId: board.id,
      expectedRevision: 1,
      scene: scene("img"),
      files: [file],
    });
    const rows = await store.db.select().from(boardFiles);
    expect(rows.filter((row) => row.boardId === board.id)).toHaveLength(1);
    expect((await service.getBoard(store.db, people.alice.id, board.id)).files).toHaveLength(1);
  });
});

describe("boards: sharing and roles", () => {
  it("lets an editor save but not rename, delete or share; a viewer cannot save", async () => {
    const board = await service.createBoard(store.db, people.alice.id, "Shared");
    await service.addMember(store.db, people.alice.id, {
      boardId: board.id,
      email: people.bob.email,
      role: "editor",
    });
    await service.addMember(store.db, people.alice.id, {
      boardId: board.id,
      email: people.carol.email,
      role: "viewer",
    });
    await service.saveScene(store.db, people.bob.id, {
      boardId: board.id,
      expectedRevision: 0,
      scene: scene("by-bob"),
      files: [],
    });
    expect(
      await codeOf(
        service.saveScene(store.db, people.carol.id, {
          boardId: board.id,
          expectedRevision: 1,
          scene: scene("by-carol"),
          files: [],
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(await codeOf(service.renameBoard(store.db, people.bob.id, board.id, "x"))).toBe(
      "FORBIDDEN",
    );
    expect(await codeOf(service.deleteBoard(store.db, people.bob.id, board.id))).toBe("FORBIDDEN");
    expect(
      await codeOf(
        service.addMember(store.db, people.bob.id, {
          boardId: board.id,
          email: people.carol.email,
          role: "editor",
        }),
      ),
    ).toBe("FORBIDDEN");
    // A shared board shows up for the invited users.
    expect((await service.listBoards(store.db, people.carol.id)).map((b) => b.id)).toContain(
      board.id,
    );
  });

  it("reports an unknown email as NOT_FOUND and updates the role on re-share", async () => {
    const board = await service.createBoard(store.db, people.alice.id, "Roles");
    expect(
      await codeOf(
        service.addMember(store.db, people.alice.id, {
          boardId: board.id,
          email: "nobody@example.test",
          role: "viewer",
        }),
      ),
    ).toBe("NOT_FOUND");
    await service.addMember(store.db, people.alice.id, {
      boardId: board.id,
      email: people.bob.email,
      role: "viewer",
    });
    await service.addMember(store.db, people.alice.id, {
      boardId: board.id,
      email: people.bob.email,
      role: "editor",
    });
    const members = await service.listMembers(store.db, people.alice.id, board.id);
    expect(members.find((member) => member.userId === people.bob.id)?.role).toBe("editor");
  });

  it("never lets the owner row be demoted, re-shared over, or removed", async () => {
    const board = await service.createBoard(store.db, people.alice.id, "Owner safe");
    expect(
      await codeOf(
        service.setMemberRole(store.db, people.alice.id, {
          boardId: board.id,
          userId: people.alice.id,
          role: "viewer",
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await codeOf(
        service.removeMember(store.db, people.alice.id, {
          boardId: board.id,
          userId: people.alice.id,
        }),
      ),
    ).toBe("FORBIDDEN");
    await service.addMember(store.db, people.alice.id, {
      boardId: board.id,
      email: people.alice.email,
      role: "viewer",
    });
    const members = await service.listMembers(store.db, people.alice.id, board.id);
    expect(members.find((member) => member.userId === people.alice.id)?.role).toBe("owner");
  });

  it("lets a member leave on their own and loses access afterwards", async () => {
    const board = await service.createBoard(store.db, people.alice.id, "Leave");
    await service.addMember(store.db, people.alice.id, {
      boardId: board.id,
      email: people.bob.email,
      role: "editor",
    });
    await service.removeMember(store.db, people.bob.id, {
      boardId: board.id,
      userId: people.bob.id,
    });
    expect(await codeOf(service.getBoard(store.db, people.bob.id, board.id))).toBe("NOT_FOUND");
    // But a non-owner cannot remove somebody else.
    await service.addMember(store.db, people.alice.id, {
      boardId: board.id,
      email: people.bob.email,
      role: "editor",
    });
    await service.addMember(store.db, people.alice.id, {
      boardId: board.id,
      email: people.carol.email,
      role: "editor",
    });
    expect(
      await codeOf(
        service.removeMember(store.db, people.bob.id, {
          boardId: board.id,
          userId: people.carol.id,
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("deletes the board together with its members and images", async () => {
    const board = await service.createBoard(store.db, people.alice.id, "To delete");
    await service.saveScene(store.db, people.alice.id, {
      boardId: board.id,
      expectedRevision: 0,
      scene: scene("img"),
      files: [{ fileId: "gone", mimeType: "image/png", dataUrl: PIXEL }],
    });
    await service.deleteBoard(store.db, people.alice.id, board.id);
    expect(await codeOf(service.getBoard(store.db, people.alice.id, board.id))).toBe("NOT_FOUND");
    const rows = await store.db.select().from(boardFiles);
    expect(rows.some((row) => row.boardId === board.id)).toBe(false);
  });
});
