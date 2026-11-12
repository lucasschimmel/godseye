import type { PrepareInfrastructureInput, ProjectDTO } from "@godseye/contracts";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { environmentLabel, ordinaryEnvironment } from "@/lib/environment-labels";

const limits = [
  { key: "cpuMilliCores", label: "CPU application (millicœurs)", value: 500 },
  { key: "memoryMiB", label: "Mémoire application (MiB)", value: 256 },
  { key: "pids", label: "PID application", value: 64 },
  { key: "temporaryMiB", label: "Temporaire (MiB)", value: 32 },
  { key: "dataGiB", label: "Données persistantes (GiB)", value: 1 },
] as const;
export function InfrastructureWorkloadForm({
  projects,
  disabled,
  prepare,
}: {
  projects: ProjectDTO[];
  disabled: boolean;
  prepare: (input: PrepareInfrastructureInput) => Promise<void>;
}) {
  const [projectId, setProjectId] = useState(""),
    [environmentId, setEnvironmentId] = useState("");
  const [image, setImage] = useState("");
  const [resources, setResources] = useState({
    cpuMilliCores: 500,
    memoryMiB: 256,
    pids: 64,
    temporaryMiB: 32,
    dataGiB: 1,
  });
  const project = projects.find((item) => item.id === projectId) ?? projects[0];
  const environments = project?.environments.filter(ordinaryEnvironment) ?? [];
  const environment = environments.find((item) => item.id === environmentId) ?? environments[0];
  return (
    <form
      className="infra-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (project && environment)
          void prepare({
            projectId: project.id,
            environmentId: environment.id,
            expectedProjectRevision: project.revision,
            workload: { image, artifactDigest: image.split("@")[1] ?? "", ...resources },
          });
      }}
    >
      <p className="muted">
        Préparer compile un profil immuable et ne démarre aucune application. L’admission nécessite
        ensuite les mesures, quotas persistants et filtres IPv4/IPv6 qualifiés.
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
      <label htmlFor="infra-image">
        Image OCI immuable
        <Input
          id="infra-image"
          required
          placeholder="registry.example/app@sha256:…"
          value={image}
          onChange={(event) => setImage(event.target.value)}
        />
      </label>
      <div className="infra-fields">
        {limits.map((limit) => (
          <label key={limit.key} htmlFor={`infra-${limit.key}`}>
            {limit.label}
            <Input
              id={`infra-${limit.key}`}
              type="number"
              min="1"
              required
              value={resources[limit.key]}
              onChange={(event) =>
                setResources({ ...resources, [limit.key]: Number(event.target.value) })
              }
            />
          </label>
        ))}
      </div>
      <p className="muted">
        runsc · systrap · UID 65532 · racine en lecture seule · aucune capacité · aucune publication
        de port · refus réseau par défaut
      </p>
      <Button type="submit" disabled={disabled || !project || !environment}>
        Préparer l’environnement
      </Button>
    </form>
  );
}
