import type {
  DeliveryArtifactView,
  DeliveryOverviewView,
  DeliveryPreparationView,
  DeliveryUsageView,
} from "@godseye/contracts";
import { useState } from "react";
import { timestamp } from "@/lib/api";
import { EmptyState, SectionTitle } from "./shared";
import { Button } from "./ui/button";

export const migrationLabels: Record<string, string> = {
  none: "Aucune migration",
  compatible: "Migration compatible (l’image précédente reste utilisable)",
  reversible: "Migration réversible (retour d’image non automatique)",
  destructive: "Migration destructive ou incompatible (approbation exacte requise)",
};
const lockLabels: Record<string, string> = {
  held: "Verrou tenu par une livraison en cours",
  uncertain: "Verrou incertain : réconciliation requise avant toute autre migration",
  released: "Verrou libéré",
};
const number = new Intl.NumberFormat("fr-FR");

export function ScanNote({ artifact }: { artifact: DeliveryArtifactView }) {
  const scanner = artifact.scanner;
  if (!scanner) return <small className="block muted">Analyse : preuve structurée absente.</small>;
  const { critical, high, medium, low, unknown } = scanner.findings;
  return (
    <small className="block muted">
      Analyse {scanner.scannerId} {scanner.version} · base {scanner.databaseDigest.slice(0, 19)} ·
      critiques {critical}, élevées {high}, moyennes {medium}, faibles {low}, non classées {unknown}
    </small>
  );
}
export function usageLine(usage: DeliveryUsageView) {
  return `CPU ${number.format(usage.cpuMilliSeconds / 1000)} s · mémoire maximale ${number.format(usage.peakMemoryMiB)} MiB · disque ${number.format(usage.diskMiB)} MiB · durée ${number.format(usage.durationMs)} ms · coût 0 (non facturé en local)`;
}
export function UsageNote({ usage }: { usage?: DeliveryUsageView }) {
  return usage ? <small className="block muted">{usageLine(usage)}</small> : null;
}
export function MigrationNote({ preparation }: { preparation: DeliveryPreparationView }) {
  if (!preparation.migration || preparation.intent !== "release") return null;
  return (
    <small className="block muted">
      {migrationLabels[preparation.migration.class]} · empreinte{" "}
      <span className="mono">{preparation.migration.hash.slice(0, 12)}</span>
    </small>
  );
}
/** A destructive migration is only admitted with explicit approval of its exact hash by a fresh owner. */
export function AdmitControl({
  preparation,
  disabled,
  post,
}: {
  preparation: DeliveryPreparationView;
  disabled: boolean;
  post: (path: string, body: unknown) => void;
}) {
  const [approved, setApproved] = useState(false);
  const destructive =
    preparation.intent === "release" && preparation.migration?.class === "destructive";
  return (
    <>
      {destructive && (
        <label className="delivery-approval">
          <input
            type="checkbox"
            checked={approved}
            onChange={(event) => setApproved(event.target.checked)}
          />{" "}
          J’approuve cette migration destructive (empreinte{" "}
          {preparation.migration?.hash.slice(0, 12)})
        </label>
      )}
      <Button
        disabled={disabled || (destructive && !approved)}
        onClick={() =>
          post("/delivery/admissions", {
            preparationId: preparation.id,
            expectedHash: preparation.hash,
            ...(destructive && approved
              ? { approveMigrationHash: preparation.migration?.hash }
              : {}),
          })
        }
      >
        Exécuter cette livraison
      </Button>
    </>
  );
}
export function DeliveryResources({ overview }: { overview: DeliveryOverviewView }) {
  return (
    <section className="panel delivery-history" aria-label="Migrations et ressources">
      <SectionTitle count={overview.migrationLocks.length}>Verrous de migration</SectionTitle>
      {!overview.migrationLocks.length && (
        <EmptyState
          title="Aucun verrou de migration"
          description="Une livraison qui déclare une migration prend un verrou unique par environnement ; il reste visible tant que son issue est incertaine."
        />
      )}
      {overview.migrationLocks.map((lock) => (
        <div className="operation-row" key={lock.environmentId}>
          <div>
            <strong>{lockLabels[lock.state]}</strong>
            <p>
              {migrationLabels[lock.migration.class]} · barrière {lock.fence}
            </p>
            <small>Mis à jour : {timestamp(lock.updatedAt)}</small>
          </div>
        </div>
      ))}
      <SectionTitle count={overview.usage.length}>Ressources utilisées</SectionTitle>
      {!overview.usage.length && (
        <EmptyState
          title="Aucune mesure de ressources"
          description="Le fournisseur local déclare le CPU, la mémoire, le disque et la durée de chaque exécution. Aucun coût n’est facturé en local."
        />
      )}
      {overview.usage.map((usage) => (
        <div className="operation-row" key={usage.runId}>
          <div>
            <strong>
              {usage.intent === "build" ? "Construction" : "Exécution de la livraison"}
            </strong>
            <p>{usageLine(usage)}</p>
            <small>Enregistré : {timestamp(usage.recordedAt)}</small>
          </div>
        </div>
      ))}
    </section>
  );
}
