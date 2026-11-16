import type { ServerObservationView } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { resource } from "@/lib/api";
import { filesystemSummary, serverUnknownLabel } from "@/lib/server-labels";

const REFRESH_MS = 60_000;
type Tile = { label: string; value: string; note: string };

function tiles(data: ServerObservationView): Tile[] {
  const unknownNote = (value: { state: string; reason?: keyof typeof serverUnknownLabel }) =>
    value.state === "unknown" && value.reason ? serverUnknownLabel[value.reason] : "Mesuré";
  return [
    {
      label: "Charge CPU (5 min)",
      value:
        data.cpu.state === "observed"
          ? `${data.cpu.loadAverage5m} pour ${data.cpu.cores} cœurs`
          : "Inconnu",
      note: unknownNote(data.cpu),
    },
    {
      label: "Mémoire disponible",
      value:
        data.memory.state === "observed"
          ? `${Math.round(data.memory.availableMiB)} MiB`
          : "Inconnu",
      note: unknownNote(data.memory),
    },
    ...data.filesystems.map((fs) => ({
      label: fs.label,
      value: filesystemSummary(fs),
      note: unknownNote(fs),
    })),
    {
      label: "OpenBao",
      value:
        data.openbao.state === "observed"
          ? data.openbao.sealed
            ? "Scellé"
            : "Descellé"
          : "Inconnu",
      note: unknownNote(data.openbao),
    },
  ];
}

/** Overview tiles for the server the API runs on; each unknown value says why it is unknown. */
export function ServerTiles() {
  const query = useQuery({
    ...resource<ServerObservationView>("server-observation", "/infrastructure/server"),
    refetchInterval: REFRESH_MS,
  });
  if (!query.data)
    return (
      <p className="panel-note" role="status">
        {query.isError ? "Observations du serveur indisponibles." : "Lecture du serveur…"}
      </p>
    );
  return (
    <section aria-label="Serveur" data-testid="server-tiles">
      <div className="metric-grid">
        {tiles(query.data).map((tile) => (
          <article className="metric" key={tile.label}>
            <span>{tile.label}</span>
            <strong>{tile.value}</strong>
            <small>{tile.note}</small>
          </article>
        ))}
      </div>
      <p className="muted">
        <Link to="/infrastructure">Détail du serveur</Link>
      </p>
    </section>
  );
}
