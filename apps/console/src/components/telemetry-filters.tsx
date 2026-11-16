import type { ProjectDTO } from "@godseye/contracts";
import { Button } from "./ui/button";

function localDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function TelemetryFilters({
  projects,
  values,
  change,
  usage = false,
}: {
  projects: ProjectDTO[];
  values: Record<string, string>;
  change: (values: Record<string, string>) => void;
  usage?: boolean;
}) {
  return (
    <form
      className="telemetry-filters"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const result: Record<string, string> = {};
        for (const [key, value] of data.entries()) {
          const text = String(value);
          result[key] =
            text && (key === "since" || key === "until") ? new Date(text).toISOString() : text;
        }
        change(result);
      }}
    >
      <label>
        Projet
        <select name="projectId" defaultValue={values.projectId ?? ""}>
          <option value="">Tous les projets</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Environnement
        <select name="environmentId" defaultValue={values.environmentId ?? ""}>
          <option value="">Tous les environnements</option>
          {projects.flatMap((p) =>
            p.environments.map((e) => (
              <option key={e.id} value={e.id}>
                {p.name} · {e.name}
              </option>
            )),
          )}
        </select>
      </label>
      {usage ? (
        <>
          <label>
            Profil (identifiant)
            <input name="profileId" defaultValue={values.profileId} />
          </label>
          <label>
            Runner
            <select name="runner" defaultValue={values.runner ?? ""}>
              <option value="">Tous</option>
              <option value="codex">Codex</option>
              <option value="claude-code">Claude Code</option>
            </select>
          </label>
          <label>
            Début inclus
            <input name="since" type="datetime-local" defaultValue={localDate(values.since)} />
          </label>
          <label>
            Fin exclue
            <input name="until" type="datetime-local" defaultValue={localDate(values.until)} />
          </label>
          <label>
            Exécution (identifiant)
            <input name="runId" defaultValue={values.runId} />
          </label>
        </>
      ) : (
        <label>
          Source (identifiant)
          <input name="sourceId" defaultValue={values.sourceId} />
        </label>
      )}
      <Button type="submit">Appliquer les filtres</Button>
    </form>
  );
}
