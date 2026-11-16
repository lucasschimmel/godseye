import { type ProjectView, RepositoryConfiguration } from "@godseye/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GitBranch } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { useDeployment } from "@/lib/use-deployment";
import { Failure } from "./shared";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function RepositoryForm({ project }: { project: ProjectView }) {
  const current = project.repository;
  const deployment = useDeployment();
  const [validation, setValidation] = useState("");
  const cache = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: string) =>
      api<ProjectView>(`/projects/${project.id}/repository`, {
        method: "PUT",
        body,
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    onSuccess: () => cache.invalidateQueries(),
  });
  return (
    <form
      key={project.revision}
      className="repository-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const result = RepositoryConfiguration.safeParse({
          fullName: data.get("fullName"),
          repositoryId: Number(data.get("repositoryId")),
          installationId: Number(data.get("installationId")),
          branch: data.get("branch"),
          autoDeploy: data.has("autoDeploy"),
        });
        if (!result.success) {
          setValidation(
            "Vérifiez le dépôt (organisation/nom), les identifiants numériques et la branche.",
          );
          return;
        }
        setValidation("");
        mutation.mutate(
          JSON.stringify({ repository: result.data, expectedRevision: project.revision }),
        );
      }}
    >
      <div className="form-section">
        <GitBranch size={20} />
        <h2>Source GitHub</h2>
        <p>
          Associez un dépôt et une branche. L’installation de la GitHub App sera vérifiée lors du
          raccordement.
        </p>
      </div>
      <div className="field">
        <label htmlFor="repository-name">Dépôt</label>
        <Input
          id="repository-name"
          placeholder="organisation/mon-projet"
          name="fullName"
          defaultValue={current?.fullName ?? ""}
          required
        />
      </div>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="repository-id">ID du dépôt</label>
          <Input
            id="repository-id"
            inputMode="numeric"
            pattern="[0-9]+"
            name="repositoryId"
            defaultValue={current?.repositoryId ?? ""}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="installation-id">ID de l’installation GitHub App</label>
          <Input
            id="installation-id"
            inputMode="numeric"
            pattern="[0-9]+"
            name="installationId"
            defaultValue={current?.installationId ?? ""}
            required
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="repository-branch">Branche suivie</label>
        <Input
          id="repository-branch"
          name="branch"
          defaultValue={current?.branch ?? "main"}
          required
        />
      </div>
      <label className="checkbox-field">
        <input type="checkbox" name="autoDeploy" defaultChecked={current?.autoDeploy ?? false} />
        <span>
          Mémoriser une préférence de livraison automatique
          <small>
            Cette préférence n’autorise aucun déploiement. Créez une politique bornée dans CI / CD
            après une confirmation propriétaire récente ; les services doivent aussi être connectés
            et qualifiés.
          </small>
        </span>
      </label>
      {validation && (
        <p className="error-message" role="alert">
          {validation}
        </p>
      )}
      {mutation.isError && <Failure error={mutation.error} />}
      {mutation.isSuccess && (
        <p className="success-message" role="status">
          {deployment.isLocal ? "Association enregistrée localement." : "Association enregistrée."}
        </p>
      )}
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Enregistrement…" : "Enregistrer l’association"}
      </Button>
    </form>
  );
}
