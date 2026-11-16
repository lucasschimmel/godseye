import type { CreateDeliveryPolicyInput, ProjectDTO } from "@godseye/contracts";
import { useState } from "react";
import { EmptyState } from "./shared";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const numericFields = [
  { name: "cpuMilliCores", label: "CPU par étape (millicœurs)", value: 250, min: 10, max: 64000 },
  { name: "memoryMiB", label: "Mémoire par étape (MiB)", value: 256, min: 32, max: 262144 },
  { name: "storageGiB", label: "Stockage par étape (GiB)", value: 1, min: 1, max: 4096 },
  { name: "pids", label: "Processus maximum", value: 64, min: 8, max: 4096 },
  {
    name: "maxArtifactMiB",
    label: "Taille maximale d’artefact (MiB)",
    value: 128,
    min: 1,
    max: 4096,
  },
  {
    name: "maxConcurrentPreviews",
    label: "Previews simultanées maximum",
    value: 3,
    min: 0,
    max: 8,
  },
  { name: "previewTtlHours", label: "Durée d’une preview (heures)", value: 72, min: 1, max: 720 },
] as const;
function expiry() {
  const date = new Date(Date.now() + 7 * 86400000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function DeliveryPolicyForm({
  projects,
  disabled,
  submit,
}: {
  projects: ProjectDTO[];
  disabled: boolean;
  submit: (input: CreateDeliveryPolicyInput) => void;
}) {
  const [projectId, setProjectId] = useState(""),
    [environmentId, setEnvironmentId] = useState("");
  const bound = projects.filter((project) => project.repository && project.status !== "suspended");
  const eligible = bound.filter((project) =>
    project.environments.some(
      (env) =>
        ["development", "production"].includes(env.kind) && !env.recoveryHold && !env.deliveryHold,
    ),
  );
  const project = eligible.find((row) => row.id === projectId) ?? eligible[0];
  const environments =
    project?.environments.filter(
      (env) =>
        ["development", "production"].includes(env.kind) && !env.recoveryHold && !env.deliveryHold,
    ) ?? [];
  const environment = environments.find((row) => row.id === environmentId) ?? environments[0];
  if (!project || !environment)
    return (
      <EmptyState
        title={
          bound.length ? "Aucun environnement admissible" : "Associez un dépôt GitHub à un projet"
        }
        description={
          bound.length
            ? "Les environnements disponibles sont suspendus par une protection. Aucune politique ne peut contourner une attente de restauration ou d’arrêt."
            : "L’association du dépôt et de sa branche se fait dans la fiche du projet. Vous pourrez ensuite préparer une politique de livraison locale."
        }
      />
    );
  return (
    <section className="panel delivery-policy">
      <h2>Nouvelle politique de livraison</h2>
      <p className="muted">
        Autorité limitée au dépôt, à la branche, aux révisions et aux ressources ci-dessous. Aucun
        secret n’est demandé ici.
      </p>
      <div className="delivery-source-fields">
        <label htmlFor="delivery-project">
          Projet{" "}
          <select
            id="delivery-project"
            value={project.id}
            onChange={(event) => {
              setProjectId(event.target.value);
              setEnvironmentId("");
            }}
          >
            {eligible.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="delivery-environment">
          Environnement cible{" "}
          <select
            id="delivery-environment"
            value={environment.id}
            onChange={(event) => setEnvironmentId(event.target.value)}
          >
            {environments.map((row) => (
              <option key={row.id} value={row.id}>
                {row.kind === "production" ? "Production" : "Développement"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <form
        className="delivery-policy-fields"
        key={`${project.id}:${project.revision}:${environment.id}:${environment.revision}`}
        aria-label="Créer une politique de livraison"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          submit({
            projectId: project.id,
            environmentId: environment.id,
            expectedProjectRevision: project.revision,
            expectedEnvironmentRevision: environment.revision,
            recipe: {
              kind: data.get("recipe") === "node" ? "node" : "static",
              context: String(data.get("context")),
            },
            requiredChecks: String(data.get("checks"))
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
            maxArtifactMiB: Number(data.get("maxArtifactMiB")),
            maxConcurrentPreviews: Number(data.get("maxConcurrentPreviews")),
            previewTtlHours: Number(data.get("previewTtlHours")),
            limits: {
              cpuMilliCores: Number(data.get("cpuMilliCores")),
              memoryMiB: Number(data.get("memoryMiB")),
              storageGiB: Number(data.get("storageGiB")),
              pids: Number(data.get("pids")),
            },
            autoDeploy: data.get("autoDeploy") === "on",
            scanThreshold: String(data.get("scanThreshold")) as
              | "critical"
              | "high"
              | "medium"
              | "low",
            expiresAt: new Date(String(data.get("expiresAt"))).toISOString(),
          });
        }}
      >
        <p className="mono">
          {project.repository?.fullName} · {project.repository?.branch}
        </p>
        <label htmlFor="delivery-recipe">
          Type d’application{" "}
          <select
            id="delivery-recipe"
            name="recipe"
            defaultValue={project.kind === "api" ? "node" : "static"}
          >
            <option value="static">Site statique</option>
            <option value="node">Back-end Node.js</option>
          </select>
        </label>
        <label htmlFor="delivery-context">
          Dossier du projet{" "}
          <Input id="delivery-context" name="context" defaultValue="." maxLength={160} required />
        </label>
        <label className="delivery-wide" htmlFor="delivery-checks">
          Contrôles requis, séparés par des virgules{" "}
          <Input
            id="delivery-checks"
            name="checks"
            defaultValue="lint,test"
            required
            maxLength={512}
          />
        </label>
        <div className="delivery-resource-fields">
          {numericFields.map((field) => (
            <label key={field.name} htmlFor={`delivery-${field.name}`}>
              {field.label}
              <Input
                id={`delivery-${field.name}`}
                name={field.name}
                type="number"
                defaultValue={field.value}
                min={field.min}
                max={field.max}
                required
              />
            </label>
          ))}
        </div>
        <label htmlFor="delivery-scan">
          Seuil de gravité bloquant de l’analyse{" "}
          <select id="delivery-scan" name="scanThreshold" defaultValue="high">
            <option value="critical">Critique seulement</option>
            <option value="high">Élevée et au-dessus</option>
            <option value="medium">Moyenne et au-dessus</option>
            <option value="low">Toute vulnérabilité</option>
          </select>
        </label>
        <label htmlFor="delivery-expiry">
          Expiration de la politique{" "}
          <Input
            id="delivery-expiry"
            name="expiresAt"
            type="datetime-local"
            defaultValue={expiry()}
            required
          />
        </label>
        <label className="delivery-checkbox" htmlFor="delivery-auto">
          <input id="delivery-auto" name="autoDeploy" type="checkbox" /> Autoriser la livraison
          automatique compatible sous cette politique
        </label>
        <p className="muted">
          Les previews utilisent une cellule distincte et des données synthétiques. Une migration
          destructive exige une approbation exacte et récente ; restauration de données et purge
          définitive restent exclues.
        </p>
        <Button disabled={disabled} type="submit">
          Enregistrer la politique
        </Button>
      </form>
    </section>
  );
}
