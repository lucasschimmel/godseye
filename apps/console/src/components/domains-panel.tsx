import type {
  OwnerSecurityView,
  ProjectDomainListView,
  ProjectDomainView,
  ProjectView,
} from "@godseye/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, resource, timestamp } from "@/lib/api";
import { environmentLabel, ordinaryEnvironment } from "@/lib/environment-labels";
import { EmptyState, Failure, Loading, SectionTitle } from "./shared";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const stateLabels: Record<ProjectDomainView["state"], string> = {
  pending_verification: "Vérification en attente",
  verified: "Vérifié, route non appliquée",
  active: "Actif",
  failed: "Échec de vérification",
  removed: "Retiré",
};
const post = (path: string, body: unknown) =>
  api<ProjectDomainView>(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "idempotency-key": crypto.randomUUID() },
  });

/** Custom domains per environment: DNS ownership is verified before anything is served. */
export function DomainsPanel({ project }: { project: ProjectView }) {
  const view = useQuery(
    resource<ProjectDomainListView>(`domains-${project.id}`, `/projects/${project.id}/domains`),
  );
  const security = useQuery(resource<OwnerSecurityView>("owner-security", "/owner/security"));
  const cache = useQueryClient();
  const [hostname, setHostname] = useState("");
  const [environmentId, setEnvironmentId] = useState(
    project.environments.find(ordinaryEnvironment)?.id ?? "",
  );
  const [method, setMethod] = useState<"dns" | "txt">("dns");
  const mutation = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => post(path, body),
    onSuccess: () => cache.invalidateQueries(),
  });
  if (view.isPending) return <Loading />;
  if (view.isError) return <Failure error={view.error} retry={() => void view.refetch()} />;
  const { domains, limit, target } = view.data;
  const fresh = security.data?.fresh === true;
  const base = `/projects/${project.id}/domains`;
  return (
    <section aria-label="Domaines personnalisés">
      <SectionTitle count={domains.length}>Domaines personnalisés</SectionTitle>
      <p className="muted">
        Un domaine s’ajoute à l’adresse de l’environnement. Il n’est servi qu’après vérification
        DNS, et le certificat n’est demandé qu’à ce moment-là. Limite : {limit} par projet.
      </p>
      {target ? (
        <p className="muted">
          Pointez le nom vers <span className="mono">{target.cname}</span> (CNAME) ou, pour un
          domaine racine, vers <span className="mono">{target.ipv4.join(", ")}</span> (A).
        </p>
      ) : (
        <p className="muted">
          Les domaines personnalisés ne sont pas configurés sur ce serveur : aucun ne peut être
          ajouté.
        </p>
      )}
      {mutation.isError && <Failure error={mutation.error} />}
      {domains.length === 0 ? (
        <EmptyState
          title="Aucun domaine personnalisé"
          description="Ajoutez un nom pour servir l’application sur votre propre domaine."
        />
      ) : (
        <ul aria-label="Domaines">
          {domains.map((domain) => (
            <li key={domain.id} className="panel">
              <strong className="mono">{domain.hostname}</strong>{" "}
              <Badge variant="outline">{stateLabels[domain.state]}</Badge>
              <div className="muted">
                {environmentLabel(
                  project.environments.find((item) => item.id === domain.environmentId) ?? {
                    kind: "development",
                    name: domain.environmentId,
                  },
                )}
                {domain.lastCheckedAt && ` · vérifié le ${timestamp(domain.lastCheckedAt)}`}
              </div>
              {domain.challenge && domain.state !== "active" && (
                <p className="muted">
                  Enregistrement TXT <span className="mono">{domain.challenge.name}</span> ={" "}
                  <span className="mono">{domain.challenge.value}</span>
                </p>
              )}
              {domain.failure && <p role="alert">{domain.failure.message}</p>}
              <div className="button-row">
                <Button
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() =>
                    mutation.mutate({
                      path: `${base}/${domain.id}/verify`,
                      body: { expectedRevision: domain.revision },
                    })
                  }
                >
                  Vérifier maintenant
                </Button>
                <Button
                  variant="outline"
                  disabled={mutation.isPending || !fresh}
                  onClick={() =>
                    mutation.mutate({
                      path: `${base}/${domain.id}/remove`,
                      body: { expectedRevision: domain.revision },
                    })
                  }
                >
                  Retirer
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="panel project-form"
        aria-label="Ajouter un domaine"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate(
            { path: base, body: { environmentId, hostname, method } },
            { onSuccess: () => setHostname("") },
          );
        }}
      >
        <label htmlFor="domain-hostname">
          Nom de domaine
          <Input
            id="domain-hostname"
            value={hostname}
            placeholder="app.exemple.fr"
            onChange={(event) => setHostname(event.target.value)}
            autoComplete="off"
          />
        </label>
        <label htmlFor="domain-environment">
          Environnement
          <select
            id="domain-environment"
            value={environmentId}
            onChange={(event) => setEnvironmentId(event.target.value)}
          >
            {project.environments.filter(ordinaryEnvironment).map((environment) => (
              <option key={environment.id} value={environment.id}>
                {environmentLabel(environment)}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="domain-method">
          Preuve de propriété
          <select
            id="domain-method"
            value={method}
            onChange={(event) => setMethod(event.target.value === "txt" ? "txt" : "dns")}
          >
            <option value="dns">Enregistrement CNAME ou A vers la plateforme</option>
            <option value="txt">Enregistrement TXT de défi</option>
          </select>
        </label>
        <Button
          type="submit"
          disabled={
            mutation.isPending ||
            !fresh ||
            !target ||
            hostname.trim() === "" ||
            domains.length >= limit
          }
        >
          Ajouter le domaine
        </Button>
        {!fresh && (
          <p className="muted">
            Une confirmation récente par clé d’accès est requise pour ajouter ou retirer un domaine.
          </p>
        )}
      </form>
    </section>
  );
}
