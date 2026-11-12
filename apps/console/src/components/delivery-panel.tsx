import type {
  CiRunView,
  DeliveryOverviewView,
  OwnerSecurityView,
  ProjectDTO,
} from "@godseye/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { api, resource } from "@/lib/api";
import { ownerAuth } from "@/lib/owner";
import { DeliveryHistory } from "./delivery-history";
import { DeliveryPolicyForm } from "./delivery-policy-form";
import { Failure, Loading, SectionTitle } from "./shared";
import { Button } from "./ui/button";

export function DeliveryPanel() {
  const overview = useQuery({
    ...resource<DeliveryOverviewView>("delivery", "/delivery"),
    refetchInterval: 5000,
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const future =
      overview.data?.previews
        .map((preview) => Date.parse(preview.expiresAt))
        .filter((expiry) => expiry > now) ?? [];
    if (!future.length) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(1, Math.min(86400000, Math.min(...future) - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [overview.data, now]);
  const projects = useQuery(resource<ProjectDTO[]>("projects", "/projects"));
  const ciRuns = useQuery({
    ...resource<CiRunView[]>("ci-runs", "/ci/runs"),
    refetchInterval: 5000,
  });
  const security = useQuery({
    ...resource<OwnerSecurityView>("owner-security", "/owner/security"),
    refetchInterval: 5000,
  });
  const cache = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) =>
      api(path, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    onSuccess: () => cache.invalidateQueries(),
  });
  const confirmation = useMutation({
    mutationFn: async () => {
      const result = await ownerAuth.signIn.passkey();
      if (result.error) throw new Error("La confirmation a échoué.");
    },
    onSuccess: () => cache.invalidateQueries(),
  });
  if (overview.isPending || projects.isPending) return <Loading />;
  if (overview.isError)
    return <Failure error={overview.error} retry={() => void overview.refetch()} />;
  if (projects.isError)
    return <Failure error={projects.error} retry={() => void projects.refetch()} />;
  const fresh = security.data?.fresh === true;
  const disabled = mutation.isPending || !fresh;
  const post = (path: string, body: unknown) => mutation.mutate({ path, body });
  return (
    <>
      <section className="panel delivery-assurance">
        <div className="panel-heading">
          <SectionTitle>Déploiements des sites et back-ends</SectionTitle>
          <div className="delivery-assurance-actions">
            <Button
              variant="outline"
              disabled={overview.isFetching || ciRuns.isFetching || security.isFetching}
              onClick={() =>
                void Promise.all([
                  overview.refetch(),
                  ciRuns.refetch(),
                  security.refetch(),
                  projects.refetch(),
                ])
              }
            >
              <RefreshCw size={15} />
              Actualiser les livraisons
            </Button>
            <Button
              variant="outline"
              disabled={confirmation.isPending}
              onClick={() => confirmation.mutate()}
            >
              <Fingerprint size={15} />
              Confirmer mon identité
            </Button>
          </div>
        </div>
        <h2>
          {overview.data.execution === "unconfigured"
            ? "Exécution des déploiements indisponible"
            : "Fournisseur configuré, contrôles d’admission requis"}
        </h2>
        <p>
          {overview.data.source === "unconfigured"
            ? "La GitHub App n’est pas connectée. Les associations et politiques restent locales ; aucune branche n’est présentée comme vérifiée."
            : "Chaque construction et promotion revérifie l’installation, le dépôt et la tête actuelle de branche ou de pull request."}
        </p>
        <p>
          Jenkins, les agents isolés, Coolify, les quotas, le réseau et les domaines du serveur
          restent à qualifier. Aucun code de dépôt n’est exécuté directement sur cet ordinateur par
          le dashboard.
        </p>
        <p>
          {fresh
            ? "Identité propriétaire confirmée récemment."
            : "Confirmez votre identité pour modifier une politique ou préparer une livraison."}
        </p>
      </section>
      {(mutation.isError || confirmation.isError) && (
        <Failure error={mutation.error ?? confirmation.error ?? new Error("L’action a échoué.")} />
      )}
      {mutation.isSuccess && (
        <p className="success-message" role="status">
          Demande enregistrée. Consultez les preuves et l’état physique ci-dessous.
        </p>
      )}
      <DeliveryPolicyForm
        projects={projects.data}
        disabled={disabled}
        submit={(body) => post("/delivery/policies", body)}
      />
      <DeliveryHistory
        overview={overview.data}
        projects={projects.data}
        ciRuns={ciRuns.data ?? []}
        now={now}
        disabled={disabled}
        sourceAvailable={overview.data.source === "configured"}
        executionAvailable={overview.data.execution === "configured"}
        post={post}
      />
    </>
  );
}
