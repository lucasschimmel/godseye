import type { UsageCategoriesView } from "@godseye/contracts";
import { DomainError } from "./errors.js";
/** Each category is exclusive; rounding happens once on the summed rational value. */
export function estimateUsage(
  counts: UsageCategoriesView,
  rates: UsageCategoriesView,
): number | null {
  let numerator = 0n;
  for (const category of ["input", "output", "cacheRead", "cacheWrite", "reasoning"] as const) {
    const count = counts[category],
      rate = rates[category];
    if (count === null || rate === null) return null;
    if (!Number.isSafeInteger(count) || !Number.isSafeInteger(rate) || count < 0 || rate < 0)
      throw new DomainError("INVALID_INPUT", "Invalid usage arithmetic", 400);
    numerator += BigInt(count) * BigInt(rate);
  }
  const total = (numerator + 999999n) / 1000000n;
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new DomainError("USAGE_OVERFLOW", "Usage estimate exceeds safe integer capacity", 409);
  return Number(total);
}
