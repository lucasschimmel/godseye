import { EffectOutcome, type EffectOutcomeInput } from "@godseye/contracts";

/** Malformed provider evidence cannot close uncertainty; valid observed usage is still charged. */
export function normalizeOutcome(input: unknown): EffectOutcomeInput {
  const parsed = EffectOutcome.safeParse(input);
  if (parsed.success) return parsed.data;
  const amount = input && typeof input === "object" && "costMicros" in input ? input.costMicros : 0;
  const costMicros =
    typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0 ? amount : 0;
  return { status: "unknown", costMicros };
}
