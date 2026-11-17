import type { Outcome } from "../server/api";

/** Failure carried to React Query so the UI can branch on the code (e.g. CONFLICT). */
export class OutcomeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, string | number | null>,
  ) {
    super(message);
    this.name = "OutcomeError";
  }
}

export function unwrap<T>(result: Outcome<T>): T {
  if (result.ok) return result.value;
  throw new OutcomeError(result.code, result.message, result.details);
}
