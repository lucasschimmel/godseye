import type { IncidentOverviewView, IncidentView } from "@godseye/contracts";

type Delivery = IncidentView["delivery"]["state"];
export interface ChannelStatus {
  state: "not-configured" | "configured";
  title: string;
  detail: string;
  /** Latest recorded delivery attempt over all incidents; null when none was ever recorded. */
  lastAttemptAt: string | null;
  counts: Record<Delivery, number>;
  /** Next step for the owner, only present when no channel is configured. */
  ownerAction: string | null;
}

const EMPTY: Record<Delivery, number> = {
  unconfigured: 0,
  pending: 0,
  notified: 0,
  failed: 0,
  delivering: 0,
  unknown: 0,
};

/** Derives the one real external channel (the controller notifier) from the incident overview. */
export function channelStatus(overview: IncidentOverviewView): ChannelStatus {
  const counts = { ...EMPTY };
  let lastAttemptAt: string | null = null;
  for (const incident of overview.incidents) {
    counts[incident.delivery.state] += 1;
    const at = incident.delivery.lastAttemptAt;
    if (at && (!lastAttemptAt || at > lastAttemptAt)) lastAttemptAt = at;
  }
  if (overview.notifier === "unconfigured")
    return {
      state: "not-configured",
      title: "Aucun canal configuré",
      detail:
        "Les incidents sont enregistrés ici ; personne n’est prévenu automatiquement et aucun envoi n’a eu lieu.",
      lastAttemptAt,
      counts,
      ownerAction:
        "Ouvrez cette page régulièrement. Pour être prévenu, ajoutez un canal webhook ci-dessous (clé d’accès récente requise) puis lancez un test d’arrivée : seul un test confirmé prouve que le récepteur répond.",
    };
  return {
    state: "configured",
    title: "Canal externe configuré",
    detail:
      "Seul l’état « Notification externe confirmée » d’un incident prouve un envoi ; un canal configuré n’est pas un canal vérifié.",
    lastAttemptAt,
    counts,
    ownerAction: null,
  };
}
