import type { EnvironmentView } from "@godseye/contracts";

export function environmentLabel(environment: Pick<EnvironmentView, "kind" | "name">) {
  if (environment.kind === "recovery") return `Restauration isolée : ${environment.name}`;
  if (environment.kind === "production") return "Production";
  if (environment.kind === "development") return "Développement";
  return `Aperçu : ${environment.name}`;
}

/** Recovery destinations cannot receive ordinary workload or service authority. */
export function ordinaryEnvironment(
  environment: Pick<EnvironmentView, "kind" | "recoveryHold" | "deliveryHold">,
) {
  return environment.kind !== "recovery" && !environment.recoveryHold && !environment.deliveryHold;
}
