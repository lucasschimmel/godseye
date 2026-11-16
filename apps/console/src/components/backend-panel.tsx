import type { BackendConfigurationDTO, OwnerSecurityView, ProjectView } from "@godseye/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint, RefreshCw } from "lucide-react";
import { useState } from "react";
import { api, resource } from "@/lib/api";
import { environmentLabel } from "@/lib/environment-labels";
import { ownerAuth } from "@/lib/owner";
import { Failure, Loading } from "./shared";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const labels = {
  unconfigured: "Non configuré",
  prepared: "Configuration préparée",
  disabled: "Désactivé",
  held: "Accès suspendu",
  stale: "Configuration à reconfirmer",
};
export function BackendPanel({ project }: { project: ProjectView }) {
  const [selected, setSelected] = useState("");
  const environment =
    project.environments.find((item) => item.id === selected) ?? project.environments[0];
  if (!environment) return null;
  return (
    <section className="panel backend-panel" aria-label="Backend applicatif">
      <div className="backend-heading">
        <div>
          <span className="eyebrow">AUTH · FICHIERS · ÉVÉNEMENTS</span>
          <h2>Backend applicatif</h2>
        </div>
        <label>
          Environnement du backend
          <select value={environment.id} onChange={(event) => setSelected(event.target.value)}>
            {project.environments.map((item) => (
              <option key={item.id} value={item.id}>
                {environmentLabel(item)} · {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p>
        Comptes utilisateurs, fichiers privés et événements de votre application. Chaque
        environnement conserve ses propres données et accès.
      </p>
      <BackendSettings key={environment.id} project={project} environmentId={environment.id} />
    </section>
  );
}
/** Keep query/mutation hooks and their revision-keyed form together to prevent stale submissions. */
function BackendSettings({
  project,
  environmentId,
}: {
  project: ProjectView;
  environmentId: string;
}) {
  const path = `/projects/${project.id}/environments/${environmentId}/backend`;
  const query = useQuery({
    ...resource<BackendConfigurationDTO>(`backend-${environmentId}`, path),
    refetchInterval: 5000,
  });
  const security = useQuery({
    ...resource<OwnerSecurityView>("owner-security", "/owner/security"),
    refetchInterval: 5000,
  });
  const cache = useQueryClient();
  const save = useMutation({
    mutationFn: (body: unknown) =>
      api(path, {
        method: "PUT",
        body: JSON.stringify(body),
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    onSuccess: () => cache.invalidateQueries(),
  });
  const confirm = useMutation({
    mutationFn: async () => {
      const result = await ownerAuth.signIn.passkey();
      if (result.error) throw new Error("La confirmation a échoué.");
    },
    onSuccess: () => cache.invalidateQueries(),
  });
  if (query.isError) return <Failure error={query.error} retry={() => void query.refetch()} />;
  if (!query.data) return <Loading />;
  const data = query.data;
  const environment = project.environments.find((item) => item.id === environmentId);
  const blocked = data.state === "held" || project.status === "suspended";
  const disabled = !security.data?.fresh || blocked || save.isPending;
  return (
    <>
      <div className="backend-status">
        <strong>{labels[data.state]}</strong>
        <span>Runtime hébergé non connecté</span>
        <span className="mono">Révision {data.revision}</span>
      </div>
      <p className="muted">
        Enregistrer ces paramètres prépare le backend. Le template local permet de le tester ; le
        déploiement sur le serveur sera raccordé ultérieurement.
      </p>
      <div className="backend-actions">
        <Button variant="outline" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
          <Fingerprint size={15} />
          Confirmer mon identité
        </Button>
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void Promise.all([query.refetch(), security.refetch()])}
        >
          <RefreshCw size={15} />
          Actualiser le backend
        </Button>
      </div>
      {blocked && (
        <p role="status">
          Cet environnement est suspendu, expiré ou maintenu pour récupération. Sa configuration ne
          peut pas réactiver les services.
        </p>
      )}
      {!security.data?.fresh && (
        <p className="muted">Confirmez votre identité pour modifier ces paramètres.</p>
      )}
      <form
        key={`${data.revision}:${project.revision}:${environment?.revision}`}
        className="backend-settings"
        aria-label="Configurer le backend applicatif"
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled || !environment) return;
          const values = new FormData(event.currentTarget);
          save.mutate({
            expectedRevision: data.revision,
            expectedProjectRevision: project.revision,
            expectedEnvironmentRevision: environment.revision,
            configuration: {
              enabled: values.get("enabled") === "on",
              registrationEnabled: values.get("registrationEnabled") === "on",
              allowedOrigins: String(values.get("allowedOrigins"))
                .split(/\r?\n/)
                .map((item) => item.trim())
                .filter(Boolean),
              maxFileMiB: Number(values.get("maxFileMiB")),
              storageMiB: Number(values.get("storageMiB")),
              maxFiles: Number(values.get("maxFiles")),
              eventRetention: Number(values.get("eventRetention")),
            },
          });
        }}
      >
        <label className="backend-wide">
          Origines autorisées, une par ligne
          <textarea
            name="allowedOrigins"
            required
            rows={3}
            maxLength={4104}
            placeholder="http://localhost:3000"
            defaultValue={data.configuration?.allowedOrigins.join("\n") ?? ""}
            disabled={disabled}
          />
        </label>
        <p className="muted backend-wide">
          Utilisez des origines exactes en HTTPS, ou HTTP sur localhost pour le développement. Aucun
          joker.
        </p>
        {[
          { name: "maxFileMiB", label: "Taille maximale d’un fichier (MiB)", value: 16, max: 1024 },
          { name: "storageMiB", label: "Quota total de fichiers (MiB)", value: 256, max: 1048576 },
          { name: "maxFiles", label: "Nombre maximal de fichiers", value: 1000, max: 100000 },
          {
            name: "eventRetention",
            label: "Événements conservés",
            value: 1000,
            min: 10,
            max: 10000,
          },
        ].map((field) => (
          <label key={field.name} htmlFor={`backend-${environmentId}-${field.name}`}>
            {field.label}
            <Input
              id={`backend-${environmentId}-${field.name}`}
              type="number"
              name={field.name}
              required
              min={field.min ?? 1}
              max={field.max}
              disabled={disabled}
              defaultValue={
                data.configuration?.[
                  field.name as "maxFileMiB" | "storageMiB" | "maxFiles" | "eventRetention"
                ] ?? field.value
              }
            />
          </label>
        ))}
        <label className="backend-check">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={data.configuration?.enabled ?? true}
            disabled={disabled}
          />
          Backend activable par son runtime local
        </label>
        <label className="backend-check">
          <input
            type="checkbox"
            name="registrationEnabled"
            defaultChecked={data.configuration?.registrationEnabled ?? false}
            disabled={disabled}
          />
          Autoriser les inscriptions utilisateurs
        </label>
        <div className="backend-wide">
          <Button type="submit" disabled={disabled}>
            {save.isPending ? "Enregistrement…" : "Enregistrer le backend"}
          </Button>
        </div>
      </form>
      {(save.isError || confirm.isError) && (
        <Failure error={save.error ?? confirm.error ?? new Error("L’action a échoué.")} />
      )}
      {save.isSuccess && (
        <p className="success-message" role="status">
          Configuration du backend enregistrée. Aucun service distant n’a été démarré.
        </p>
      )}
    </>
  );
}
