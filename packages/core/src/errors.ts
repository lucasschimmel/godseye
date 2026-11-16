export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

import type { z } from "zod";

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new DomainError("INVALID_INPUT", "Input does not match the expected schema", 422);
  return result.data;
}
