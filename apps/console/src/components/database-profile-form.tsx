import type { DatabaseProfileInput, PrepareDatabaseInput, ProjectDTO } from "@godseye/contracts";
import { useState } from "react";
import { environmentLabel, ordinaryEnvironment } from "@/lib/environment-labels";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const limits = [
  { key: "cpuMilliCores", label: "CPU PostgreSQL (millicœurs)", value: 500, min: 100, max: 16000 },
  { key: "memoryMiB", label: "Mémoire PostgreSQL (MiB)", value: 512, min: 128, max: 65536 },
  { key: "dataGiB", label: "Données PostgreSQL (GiB)", value: 2, min: 1, max: 1024 },
  { key: "walGiB", label: "Journaux WAL (GiB)", value: 1, min: 1, max: 128 },
  { key: "temporaryMiB", label: "Temporaire PostgreSQL (MiB)", value: 32, min: 16, max: 2048 },
  { key: "maxConnections", label: "Connexions PostgreSQL maximales", value: 32, min: 32, max: 256 },
] as const;
export function DatabaseProfileForm({
  projects,
  disabled,
  prepare,
}: {
  projects: ProjectDTO[];
  disabled: boolean;
  prepare: (input: PrepareDatabaseInput) => void;
}) {
  const [projectId, setProjectId] = useState(""),
    [environmentId, setEnvironmentId] = useState("");
  const project = projects.find((item) => item.id === projectId) ?? projects[0];
  const environments = project?.environments.filter(ordinaryEnvironment) ?? [];
  const environment = environments.find((item) => item.id === environmentId) ?? environments[0];
  return (
    <form
      className="panel project-form"
      aria-label="Préparer une base indépendante"
      onSubmit={(event) => {
        event.preventDefault();
        if (!project || !environment) return;
        const form = new FormData(event.currentTarget);
        const profile = {
          engine: "postgresql",
          majorVersion: 18,
          ...Object.fromEntries(limits.map(({ key }) => [key, Number(form.get(key))])),
        } as DatabaseProfileInput;
        prepare({
          projectId: project.id,
          environmentId: environment.id,
          expectedProjectRevision: project.revision,
          expectedEnvironmentRevision: environment.revision,
          profile,
        });
      }}
    >
      <h2>Profil PostgreSQL indépendant</h2>
      <p className="muted">
        PostgreSQL 18 · données et WAL séparés · accès propres à chaque service · TLS vérifié et
        SCRAM. Préparer ne réserve aucune capacité et ne démarre aucun serveur.
      </p>
      <label>
        Projet
        <select
          required
          value={project?.id ?? ""}
          onChange={(event) => {
            setProjectId(event.target.value);
            setEnvironmentId("");
          }}
        >
          <option value="" disabled>
            Choisir un projet
          </option>
          {projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Environnement
        <select
          required
          value={environment?.id ?? ""}
          onChange={(event) => setEnvironmentId(event.target.value)}
        >
          {!environment && <option value="">Aucun environnement ordinaire disponible</option>}
          {environments.map((item) => (
            <option key={item.id} value={item.id}>
              {environmentLabel(item)}
            </option>
          ))}
        </select>
      </label>
      <div className="infra-fields">
        {limits.map((limit) => (
          <label key={limit.key} htmlFor={`database-${limit.key}`}>
            {limit.label}
            <Input
              id={`database-${limit.key}`}
              name={limit.key}
              required
              type="number"
              min={limit.min}
              max={limit.max}
              defaultValue={limit.value}
            />
          </label>
        ))}
      </div>
      <Button type="submit" disabled={disabled || !project || !environment}>
        Préparer le profil PostgreSQL
      </Button>
    </form>
  );
}
