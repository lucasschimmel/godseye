export type BoardErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "INVALID_INPUT"
  | "LIMIT_REACHED"
  | "UNAUTHENTICATED";

const STATUS: Record<BoardErrorCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  INVALID_INPUT: 422,
  LIMIT_REACHED: 429,
  UNAUTHENTICATED: 401,
};

/** Expected, user-facing failure. Anything else is an internal error and is never echoed. */
export class BoardError extends Error {
  readonly status: number;
  constructor(
    readonly code: BoardErrorCode,
    message: string,
    readonly details?: Record<string, string | number | null>,
  ) {
    super(message);
    this.name = "BoardError";
    this.status = STATUS[code];
  }
}
