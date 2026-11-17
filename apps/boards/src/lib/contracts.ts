import { z } from "zod";
import { BOARD_LIMITS } from "../server/limits";

export const BoardName = z.string().trim().min(1).max(BOARD_LIMITS.nameLength);
export const BoardId = z.uuid();
export const MemberRole = z.enum(["editor", "viewer"]);

/** The persisted subset of Excalidraw's app state. Everything else is per-viewer UI state. */
export const SceneAppState = z
  .object({
    viewBackgroundColor: z.string().max(40).optional(),
    gridSize: z.number().int().min(0).max(200).nullable().optional(),
  })
  .strict();
export const Scene = z
  .object({
    elements: z
      .array(
        z
          .record(z.string(), z.json())
          .refine((element) => typeof element.id === "string" && element.id.length <= 100),
      )
      .max(BOARD_LIMITS.sceneElements),
    appState: SceneAppState,
  })
  .strict();
export type SceneData = z.infer<typeof Scene>;
export const EMPTY_SCENE: SceneData = { elements: [], appState: {} };

export const BoardFile = z
  .object({
    fileId: z.string().min(1).max(100),
    mimeType: z.string().regex(/^image\/(png|jpeg|gif|webp|svg\+xml)$/),
    dataUrl: z.string().max(BOARD_LIMITS.fileBytes * 2),
  })
  .strict();
export type BoardFileData = z.infer<typeof BoardFile>;

export const SaveSceneInput = z
  .object({
    boardId: BoardId,
    expectedRevision: z.number().int().min(0),
    scene: Scene,
    files: z.array(BoardFile).max(BOARD_LIMITS.filesPerSave).default([]),
  })
  .strict();
export type SaveSceneInput = z.input<typeof SaveSceneInput>;

export const CreateBoardInput = z.object({ name: BoardName }).strict();
export const RenameBoardInput = z.object({ boardId: BoardId, name: BoardName }).strict();
export const BoardIdInput = z.object({ boardId: BoardId }).strict();
export const AddMemberInput = z
  .object({ boardId: BoardId, email: z.email().max(254), role: MemberRole })
  .strict();
export const SetMemberRoleInput = z
  .object({ boardId: BoardId, userId: z.string().min(1).max(100), role: MemberRole })
  .strict();
export const RemoveMemberInput = z
  .object({ boardId: BoardId, userId: z.string().min(1).max(100) })
  .strict();

export type BoardRoleName = "owner" | "editor" | "viewer";
export interface BoardSummary {
  id: string;
  name: string;
  role: BoardRoleName;
  revision: number;
  updatedAt: string;
}
export interface BoardDetail extends BoardSummary {
  scene: SceneData;
  files: BoardFileData[];
}
export interface MemberView {
  userId: string;
  name: string;
  email: string;
  role: BoardRoleName;
}
export interface SaveResult {
  revision: number;
  updatedAt: string;
}
