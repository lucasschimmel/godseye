import type { EnvironmentView, ProjectView } from "@godseye/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { api } from "@/lib/api";
import { Failure } from "./shared";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

const budgets = [
  { key: "memoryMiB", label: "Mémoire (MiB)", value: 2048, min: 128, max: 65536 },
  { key: "cpuMilliCores", label: "CPU (millicœurs)", value: 1000, min: 100, max: 16000 },
  { key: "diskGiB", label: "Stockage (GiB)", value: 20, min: 1, max: 1024 },
] as const;
const localDateTime = (value: string | number) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const expiry = () => localDateTime(Date.now() + 7 * 86400000);
function formData(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return new FormData(event.currentTarget);
}
function limits(data: FormData) {
  return Object.fromEntries(budgets.map(({ key }) => [key, Number(data.get(key))]));
}
function useManagement(path: string, method: "POST" | "PUT") {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) =>
      api(path, {
        method,
        body: JSON.stringify(body),
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    onSuccess: () => cache.invalidateQueries(),
  });
}
export function ProjectMetadataForm({ project }: { project: ProjectView }) {
  const mutation = useManagement(`/projects/${project.id}`, "PUT");
  return (
    <form
      key={project.revision}
      className="panel project-form"
      aria-label="Modifier le projet"
      onSubmit={(event) => {
        const data = formData(event);
        mutation.mutate({
          expectedRevision: project.revision,
          name: data.get("name"),
          description: data.get("description"),
        });
      }}
    >
      <h2>Informations du projet</h2>
      <label htmlFor="project-metadata-name">
        Nom du projet
        <Input
          id="project-metadata-name"
          name="name"
          required
          minLength={2}
          maxLength={80}
          defaultValue={project.name}
        />
      </label>
      <label htmlFor="project-metadata-description">
        Description du projet
        <Textarea
          id="project-metadata-description"
          name="description"
          maxLength={500}
          defaultValue={project.description}
        />
      </label>
      {mutation.isError && <Failure error={mutation.error} />}
      {mutation.isSuccess && (
        <p role="status" className="success-message">
          Projet enregistré.
        </p>
      )}
      <Button type="submit" disabled={mutation.isPending}>
        Enregistrer le projet
      </Button>
    </form>
  );
}
export function PreviewEnvironmentForm({ project }: { project: ProjectView }) {
  const mutation = useManagement(`/projects/${project.id}/environments`, "POST");
  return (
    <form
      className="panel project-form"
      aria-label="Créer un aperçu persistant"
      onSubmit={(event) => {
        const data = formData(event);
        mutation.mutate({
          expectedProjectRevision: project.revision,
          kind: "preview",
          name: data.get("name"),
          expiresAt: new Date(String(data.get("expiry"))).toISOString(),
          ...limits(data),
        });
      }}
    >
      <h2>Aperçu persistant</h2>
      <p className="muted">
        Huit aperçus au maximum par projet. Chaque aperçu expire dans les trente jours et dispose de
        limites propres. Son expiration ne confirme pas un arrêt physique.
      </p>
      <label htmlFor="preview-name">
        Nom de l’aperçu
        <Input
          name="name"
          id="preview-name"
          required
          minLength={2}
          maxLength={40}
          pattern="[a-z][a-z0-9-]+"
          placeholder="recette-client"
        />
      </label>
      <label htmlFor="preview-expiry">
        Expiration de l’aperçu
        <Input
          id="preview-expiry"
          name="expiry"
          type="datetime-local"
          required
          defaultValue={expiry()}
        />
      </label>
      <EnvironmentBudgets />
      {mutation.isError && <Failure error={mutation.error} />}
      {mutation.isSuccess && (
        <p role="status" className="success-message">
          Aperçu enregistré, ressources non provisionnées.
        </p>
      )}
      <Button
        type="submit"
        disabled={
          mutation.isPending ||
          project.environments.filter((env) => env.kind === "preview").length >= 8
        }
      >
        Créer l’aperçu
      </Button>
    </form>
  );
}
function EnvironmentBudgets({ environment }: { environment?: EnvironmentView }) {
  return (
    <div className="infra-fields">
      {budgets.map((budget) => (
        <label key={budget.key} htmlFor={`${environment?.id ?? "preview"}-${budget.key}`}>
          {budget.label}
          <Input
            id={`${environment?.id ?? "preview"}-${budget.key}`}
            name={budget.key}
            type="number"
            required
            min={budget.min}
            max={budget.max}
            defaultValue={environment?.[budget.key] ?? budget.value}
          />
        </label>
      ))}
    </div>
  );
}
export function EnvironmentMetadataForm({
  project,
  environment,
}: {
  project: ProjectView;
  environment: EnvironmentView;
}) {
  const mutation = useManagement(`/projects/${project.id}/environments/${environment.id}`, "PUT");
  return (
    <details className="environment-edit">
      <summary>Modifier les limites et le nom</summary>
      <form
        key={`${environment.revision}-${project.revision}`}
        className="infra-form"
        aria-label={`Modifier ${environment.name}`}
        onSubmit={(event) => {
          const data = formData(event);
          mutation.mutate({
            expectedProjectRevision: project.revision,
            expectedRevision: environment.revision,
            name: data.get("name"),
            expiresAt:
              environment.kind === "preview"
                ? new Date(String(data.get("expiry"))).toISOString()
                : null,
            ...limits(data),
          });
        }}
      >
        <label htmlFor={`${environment.id}-name`}>
          Nom de l’environnement
          <Input
            name="name"
            id={`${environment.id}-name`}
            required
            minLength={2}
            maxLength={40}
            pattern="[a-z][a-z0-9-]+"
            defaultValue={environment.name}
          />
        </label>
        {environment.kind === "preview" && (
          <label htmlFor={`${environment.id}-expiry`}>
            Expiration de l’environnement
            <Input
              name="expiry"
              id={`${environment.id}-expiry`}
              type="datetime-local"
              required
              defaultValue={
                environment.expiresAt ? localDateTime(environment.expiresAt) : undefined
              }
            />
          </label>
        )}
        <EnvironmentBudgets environment={environment} />
        <p className="muted">
          Les limites enregistrées sont demandées. Une allocation existante conserve son profil
          vérifié.
        </p>
        {mutation.isError && <Failure error={mutation.error} />}
        {mutation.isSuccess && (
          <p role="status" className="success-message">
            Environnement enregistré.
          </p>
        )}
        <Button type="submit" disabled={mutation.isPending}>
          Enregistrer l’environnement
        </Button>
      </form>
    </details>
  );
}
