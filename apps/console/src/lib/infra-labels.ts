function labelMap(values: Record<string, string>): Readonly<Record<string, string>> {
  return Object.freeze(Object.assign(Object.create(null) as Record<string, string>, values));
}
export const infrastructureStates = labelMap({
  reserved: "Réservé",
  provisioning: "Provisionnement",
  verified: "Vérifié",
  unknown: "Résultat inconnu",
  quarantined: "En quarantaine",
  released: "Réservation libérée",
});

const capabilities = labelMap({
  runtime: "Le moteur d’isolation reste à qualifier.",
  systrap: "Le mode d’isolation systrap reste à vérifier.",
  limits: "Les plafonds CPU, mémoire et PID restent à vérifier.",
  persistentQuota: "Les quotas des données persistantes restent à qualifier.",
  firewallIpv4: "Le filtrage IPv4 vers l’hôte et les autres réseaux reste à vérifier.",
  firewallIpv6: "Le filtrage IPv6 vers l’hôte et les autres réseaux reste à vérifier.",
  artifactVerification: "La provenance de l’image immuable reste à vérifier.",
});
const reasons = labelMap({
  "No trusted professional-VM observation is available":
    "Aucune mesure fiable de la VM professionnelle n’est disponible.",
  "Trusted observation is stale or has an invalid freshness window":
    "Les mesures sont périmées ou leur validité ne peut pas être confirmée.",
  "Local development PC is not the professional VM or physical host":
    "Ce PC de développement ne mesure pas le serveur dédié ni sa VM professionnelle.",
  "Declare the physical host, guest commitments and professional pool first":
    "Déclarez d’abord l’hôte, les VM et le pool professionnel.",
  "New admission is paused by the owner; reads, reconciliation and protective stops continue":
    "Les nouvelles admissions sont suspendues par le propriétaire. Les lectures, la réconciliation et les arrêts de protection continuent.",
  "No independently qualified local infrastructure provider is registered":
    "Aucun service de provisionnement n’est qualifié.",
});
export function infrastructureReason(reason: string): string {
  if (reason.startsWith("Unqualified capability: "))
    return (
      capabilities[reason.slice("Unqualified capability: ".length)] ??
      "Une capacité d’isolation reste à qualifier."
    );
  if (reason.startsWith("Development controller metadata only;"))
    return "Ces mesures concernent uniquement le PC local. Elles ne qualifient ni le serveur dédié, ni Docker, ni les quotas ou le filtrage réseau.";
  return reasons[reason] ?? "Une vérification supplémentaire est requise avant l’admission.";
}
export function infrastructureFilesystem(label: string): string {
  return label === "Controller working-directory filesystem"
    ? "Système de fichiers du contrôleur"
    : "Système de fichiers observé";
}
