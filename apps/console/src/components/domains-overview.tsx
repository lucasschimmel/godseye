import type { DomainOverviewView, ProjectDomainView } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Globe } from "lucide-react";
import { DomainTlsCell } from "@/components/domain-tls-cell";
import { Failure, Loading, SectionTitle } from "@/components/shared";
import { resource, timestamp } from "@/lib/api";
import { environmentLabel } from "@/lib/environment-labels";
import { TableScroll } from "./table-scroll";

const stateLabels: Record<ProjectDomainView["state"], string> = {
  pending_verification: "Vérification en attente",
  verified: "Vérifié, route non appliquée",
  active: "Actif",
  failed: "Échec de vérification",
  removed: "Retiré",
};

/** Cross-project list of custom domains with the certificate expiry observed through the edge. */
export function DomainsOverview() {
  const nowMs = Date.now();
  const query = useQuery(resource<DomainOverviewView>("domain-overview", "/domains"));
  return (
    <section className="panel" aria-labelledby="domains-overview-title">
      <div className="panel-heading">
        <SectionTitle count={query.data?.domains.length}>
          <span id="domains-overview-title">Domaines personnalisés</span>
        </SectionTitle>
        <Globe size={18} />
      </div>
      <p className="panel-note">
        Tous les domaines liés aux projets. L’expiration du certificat est lue par un contrôle TLS
        en lecture seule ; quand il est impossible, la date reste inconnue et la raison est
        indiquée.
      </p>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <Failure error={query.error} retry={() => void query.refetch()} />
      ) : query.data.domains.length === 0 ? (
        <p className="quiet-empty">
          Aucun domaine personnalisé. Ajoutez-en depuis la page d’un projet.
        </p>
      ) : (
        <div className="panel-body">
          <TableScroll label="Tableau défilant : domaines personnalisés">
            <table className="headroom-table">
              <caption className="sr-only">Domaines personnalisés de tous les projets</caption>
              <thead>
                <tr>
                  <th scope="col">Domaine</th>
                  <th scope="col">Projet</th>
                  <th scope="col">Environnement</th>
                  <th scope="col">État</th>
                  <th scope="col">Dernière vérification</th>
                  <th scope="col">Certificat TLS</th>
                </tr>
              </thead>
              <tbody>
                {query.data.domains.map((domain) => (
                  <tr key={domain.id}>
                    <th scope="row" className="mono">
                      {domain.hostname}
                    </th>
                    <td>
                      <Link to="/projects/$projectId" params={{ projectId: domain.projectId }}>
                        {domain.projectName}
                      </Link>
                    </td>
                    <td>
                      {environmentLabel({
                        kind: domain.environmentKind,
                        name: domain.environmentName,
                      })}
                    </td>
                    <td title={domain.failure?.message}>
                      {stateLabels[domain.state]}
                      {domain.failure ? ` · ${domain.failure.message}` : ""}
                    </td>
                    <td>{domain.lastCheckedAt ? timestamp(domain.lastCheckedAt) : "Jamais"}</td>
                    <td>
                      <DomainTlsCell tls={domain.tls} nowMs={nowMs} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}
    </section>
  );
}
