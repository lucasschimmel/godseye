import type { DeliveryOverviewView, DeliveryRunView, EnvironmentView } from "@godseye/contracts";

export interface RedeployContext {
  environment: Pick<EnvironmentView, "kind" | "recoveryHold" | "deliveryHold">;
  environmentId: string;
  /** The environment's current delivery run, as the journal proves it. */
  run: Pick<DeliveryRunView, "state" | "artifactId"> | null;
  delivery: Pick<DeliveryOverviewView, "execution" | "source" | "policies">;
  /** Whether the owner confirmed their passkey recently. */
  fresh: boolean;
  now: number;
}

/** Why a redeploy cannot be requested right now, or null when it can. Mirrors the server gates. */
export function redeployBlockReason(context: RedeployContext): string | null {
  const { environment, run, delivery } = context;
  if (environment.kind !== "development" && environment.kind !== "production")
    return "Seuls les environnements de développement et de production peuvent être redéployés.";
  if (environment.recoveryHold)
    return "Environnement en restauration : aucune livraison ordinaire n’est autorisée.";
  if (environment.deliveryHold)
    return "Livraison suspendue : cet environnement est expiré ou en cours d’arrêt.";
  if (!run || run.state !== "active" || !run.artifactId)
    return "Aucune version courante vérifiée à redéployer.";
  if (delivery.execution !== "configured")
    return "Exécution des déploiements non configurée ou non qualifiée.";
  if (delivery.source !== "configured")
    return "Source GitHub non connectée : la version courante ne peut pas être revérifiée.";
  const hasPolicy = delivery.policies.some(
    (item) =>
      item.environmentId === context.environmentId &&
      !item.revokedAt &&
      Date.parse(item.expiresAt) > context.now,
  );
  if (!hasPolicy) return "Aucune politique de livraison en cours pour cet environnement.";
  if (!context.fresh) return "Confirmez votre identité avec votre clé d’accès avant de redéployer.";
  return null;
}
