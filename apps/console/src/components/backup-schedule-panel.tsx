import type { RecoveryOverviewView, ServerObservationView } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { DatabaseBackup } from "lucide-react";
import { Failure, Loading, SectionTitle } from "@/components/shared";
import { resource, timestamp } from "@/lib/api";
import { serverUnknownLabel } from "@/lib/server-labels";
import { TableScroll } from "./table-scroll";

const age = (hours: number | null) => (hours === null ? "Inconnu" : `il y a ${hours} h`);
const offhostLabel: Record<string, string> = {
  ok: "Copie hors hôte à jour",
  not_configured: "Copie hors hôte non configurée",
};

function hostCopy(host: ServerObservationView["host"]): string {
  if (host.state === "unknown")
    return `Inconnu · ${serverUnknownLabel[host.reason]} (le rapport de l’hôte n’est pas lisible depuis la VM).`;
  const copy = host.health.offhostBackup;
  if (!copy) return "Le rapport de l’hôte ne mentionne pas la copie hors hôte.";
  const when = copy.recordedAt ? ` · enregistrée le ${timestamp(copy.recordedAt)}` : "";
  return `${offhostLabel[copy.state] ?? `État « ${copy.state} »`}${when}`;
}

/**
 * Real backup cadence and evidence: ages come from the status files the backup runner writes, the
 * off-host state from the host report, and restore tests only from verified platform recoveries.
 */
export function BackupSchedulePanel() {
  const server = useQuery({
    ...resource<ServerObservationView>("server-observation", "/infrastructure/server"),
    refetchInterval: 60_000,
  });
  const recovery = useQuery(resource<RecoveryOverviewView>("recovery", "/recovery"));
  const lastRestoreTest = recovery.data?.backups
    .map((backup) => backup.verifiedAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);
  return (
    <section className="panel" aria-labelledby="backup-schedule-title">
      <div className="panel-heading">
        <SectionTitle>
          <span id="backup-schedule-title">Cadence réelle des sauvegardes</span>
        </SectionTitle>
        <DatabaseBackup size={18} />
      </div>
      <p className="panel-note">
        Âges lus dans les fichiers d’état écrits par les sauvegardes pgBackRest de chaque cellule.
        Une valeur absente est affichée « Inconnu », jamais comme récente.
      </p>
      {server.isPending ? (
        <Loading />
      ) : server.isError ? (
        <Failure error={server.error} retry={() => void server.refetch()} />
      ) : server.data.pgBackup.state === "unknown" ? (
        <p className="muted">Inconnu · {serverUnknownLabel[server.data.pgBackup.reason]}.</p>
      ) : server.data.pgBackup.cells.length === 0 ? (
        <p className="muted">Aucune cellule n’a encore écrit de statut de sauvegarde.</p>
      ) : (
        <TableScroll label="Tableau défilant : sauvegardes par cellule">
          <table className="headroom-table">
            <caption className="sr-only">Âge des sauvegardes par cellule</caption>
            <thead>
              <tr>
                <th scope="col">Cellule</th>
                <th scope="col">Dernière complète</th>
                <th scope="col">Dernière différentielle</th>
                <th scope="col">Dernier contrôle WAL</th>
                <th scope="col">Dépôt pgBackRest</th>
              </tr>
            </thead>
            <tbody>
              {server.data.pgBackup.cells.map((cell) => (
                <tr key={cell.allocationId}>
                  <th scope="row">{cell.allocationId.slice(0, 8)}</th>
                  <td>{age(cell.fullAgeHours)}</td>
                  <td>{age(cell.differentialAgeHours)}</td>
                  <td>{age(cell.archiveCheckAgeHours)}</td>
                  <td>
                    {cell.archiveCheckOk ? "Contrôle réussi" : "Dernier contrôle en échec"}
                    {cell.lastFailureAt ? ` · échec le ${timestamp(cell.lastFailureAt)}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {server.data && (
        <p>
          <strong>Copie B2 de l’hôte :</strong> {hostCopy(server.data.host)}
        </p>
      )}
      <p>
        <strong>Dernier test de restauration enregistré :</strong>{" "}
        {recovery.isPending
          ? "chargement…"
          : lastRestoreTest
            ? timestamp(lastRestoreTest)
            : "aucun. La plateforme n’a vérifié aucune restauration ; les exercices de l’hôte ne sont pas enregistrés ici."}
      </p>
    </section>
  );
}
