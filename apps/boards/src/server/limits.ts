/** Finite bounds for everything a client can make the server store. */
export const BOARD_LIMITS = {
  boardsPerOwner: 100,
  membersPerBoard: 25,
  nameLength: 120,
  sceneBytes: 5 * 1024 * 1024,
  sceneElements: 10_000,
  filesPerBoard: 100,
  fileBytes: 4 * 1024 * 1024,
  filesPerSave: 20,
} as const;
