import type { ServerObservationView } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { Server } from "lucide-react";
import { Failure, Loading, SectionTitle } from "@/components/shared";
import { resource, timestamp } from "@/lib/api";
import { hostStatusLabel, serverAvailability, serverUnknownLabel } from "@/lib/server-labels";
import { TableScroll } from "./table-scroll";

const REFRESH_MS = 60_000;
type Section =
  | { state: "observed" }
  | { state: "unknown"; reason: keyof typeof serverUnknownLabel };

function Unknown({ value }: { value: Extract<Section, { state: "unknown" }> }) {
  return (
    <span className="muted" title={serverUnknownLabel[value.reason]}>
      Inconnu · {serverUnknownLabel[value.reason]}
    </span>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
const duration = (seconds: number) => {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  return days > 0 ? `${days} j ${hours} h` : `${hours} h ${Math.floor((seconds % 3_600) / 60)} min`;
};
const age = (hours: number | null) => (hours === null ? "Inconnu" : `${hours} h`);

/** Server-side observations of the machine the control API runs on; unknown values stay unknown. */
export function ServerPanel() {
  const query = useQuery({
    ...resource<ServerObservationView>("server-observation", "/infrastructure/server"),
    refetchInterval: REFRESH_MS,
  });
  const data = query.data;
  return (
    <section className="panel" aria-labelledby="server-title" data-testid="server-panel">
      <div className="panel-heading">
        <SectionTitle>
          <span id="server-title">Serveur</span>
        </SectionTitle>
        <Server size={18} />
      </div>
      <p className="panel-note">
        Observations lues depuis la VM professionnelle où tourne l’API. Une valeur illisible ou
        périmée est affichée « Inconnu », jamais estimée.
      </p>
      {query.isPending ? (
        <Loading />
      ) : query.isError || !data ? (
        <Failure
          error={query.error ?? new Error("Observation indisponible.")}
          retry={() => void query.refetch()}
        />
      ) : (
        <div className="panel-body">
          <p className="panel-caption">Relevé du {timestamp(data.observedAt)}</p>
          <dl className="infra-metrics metric-tiles">
            <Row label="Charge CPU (1 / 5 / 15 min)">
              {data.cpu.state === "observed" ? (
                `${data.cpu.loadAverage1m} / ${data.cpu.loadAverage5m} / ${data.cpu.loadAverage15m} · ${data.cpu.cores} cœurs`
              ) : (
                <Unknown value={data.cpu} />
              )}
            </Row>
            <Row label="Mémoire disponible">
              {data.memory.state === "observed" ? (
                `${data.memory.availableMiB} MiB sur ${data.memory.totalMiB} MiB`
              ) : (
                <Unknown value={data.memory} />
              )}
            </Row>
            <Row label="Disponibilité">
              {data.uptime.state === "observed" ? (
                duration(data.uptime.seconds)
              ) : (
                <Unknown value={data.uptime} />
              )}
            </Row>
            {data.filesystems.map((fs) => (
              <Row key={fs.id} label={fs.label}>
                {fs.state === "observed" ? (
                  `${fs.usedPercent} % utilisé · ${fs.availableGiB} GiB libres sur ${fs.totalGiB} GiB`
                ) : (
                  <Unknown value={fs} />
                )}
              </Row>
            ))}
            <Row label="OpenBao">
              {data.openbao.state === "observed" ? (
                data.openbao.sealed ? (
                  <strong className="danger-text">Scellé : à desceller par le propriétaire</strong>
                ) : (
                  "Descellé"
                )
              ) : (
                <Unknown value={data.openbao} />
              )}
            </Row>
          </dl>
          <h3 className="panel-subheading">Sauvegardes PostgreSQL des cellules</h3>
          {data.pgBackup.state === "unknown" ? (
            <p className="panel-caption">
              <Unknown value={data.pgBackup} />
            </p>
          ) : data.pgBackup.cells.length === 0 ? (
            <p className="panel-caption">
              Aucune cellule n’a encore écrit de statut de sauvegarde.
            </p>
          ) : (
            <TableScroll label="Tableau défilant : sauvegardes par cellule">
              <table className="headroom-table">
                <caption className="sr-only">Âge des sauvegardes par cellule</caption>
                <thead>
                  <tr>
                    <th scope="col">Cellule</th>
                    <th scope="col">Complète</th>
                    <th scope="col">Différentielle</th>
                    <th scope="col">Archivage WAL</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pgBackup.cells.map((cell) => (
                    <tr key={cell.allocationId}>
                      <th scope="row">{cell.allocationId.slice(0, 8)}</th>
                      <td>{age(cell.fullAgeHours)}</td>
                      <td>{age(cell.differentialAgeHours)}</td>
                      <td>
                        {age(cell.archiveCheckAgeHours)}
                        {cell.archiveCheckOk ? "" : " · dernier contrôle en échec"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
          <h3 className="panel-subheading">Hôte Proxmox</h3>
          {data.host.state === "unknown" ? (
            <p className="panel-caption">
              Inconnu · {serverUnknownLabel[data.host.reason]}. {serverAvailability.host}
            </p>
          ) : (
            <>
              <p className="panel-caption">
                {hostStatusLabel[data.host.health.status]} · rapport du{" "}
                {timestamp(data.host.reportedAt)}
                {data.host.health.poolHealth
                  ? ` · pool ${data.host.health.poolHealth}${
                      data.host.health.poolCapacityPercent === null
                        ? ""
                        : ` à ${data.host.health.poolCapacityPercent} %`
                    }`
                  : ""}
                {data.host.health.weakestVmBackupAgeHours === null
                  ? ""
                  : ` · sauvegarde VM la plus ancienne : ${data.host.health.weakestVmBackupAgeHours} h`}
              </p>
              {data.host.health.alerts.length > 0 && (
                <ul>
                  {data.host.health.alerts.map((alert) => (
                    <li key={`${alert.severity}:${alert.message}`}>
                      {alert.severity === "critical" ? "Critique" : "Avertissement"} :{" "}
                      {alert.message}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
