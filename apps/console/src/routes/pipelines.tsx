import type { CiRunView } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Box, GitBranch, Rocket, ShieldCheck } from "lucide-react";
import { DeliveryPanel } from "@/components/delivery-panel";
import {
  EmptyState,
  Failure,
  Loading,
  PageHeading,
  SectionTitle,
  Status,
  Step,
} from "@/components/shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { resource, timestamp } from "@/lib/api";

export const Route = createFileRoute("/pipelines")({ component: Pipelines });
function Pipelines() {
  const runs = useQuery(resource<CiRunView[]>("ci-runs", "/ci/runs"));
  return (
    <>
      <PageHeading
        eyebrow="INTÉGRATION & LIVRAISON"
        title="CI / CD"
        description="Du dépôt au déploiement, un parcours vérifiable pour chaque version."
      />
      <section className="panel pipeline-overview">
        <div className="panel-heading">
          <SectionTitle>Parcours cible</SectionTitle>
          <Status value="planned" />
        </div>
        <div className="pipeline-stages">
          {[
            { title: "GitHub", note: "Push signé · branche suivie", icon: GitBranch },
            { title: "Jenkins", note: "Tests · audit · build isolé", icon: ShieldCheck },
            { title: "Artefact", note: "Version immuable · digest", icon: Box },
            { title: "Déploiement", note: "Branche revérifiée · santé", icon: Rocket },
          ].map(({ title, note, icon: Icon }, index) => (
            <div className="pipeline-stage" key={title}>
              <span>
                <Icon size={21} />
              </span>
              <h3>{title}</h3>
              <p>{note}</p>
              {index < 3 && <ArrowRight className="stage-arrow" size={18} />}
            </div>
          ))}
        </div>
        <div className="panel-note">
          La réception des événements est disponible localement. L’exécution Jenkins et les
          déploiements attendent le raccordement des services.
        </div>
      </section>
      <DeliveryPanel />
      <section className="panel">
        <div className="panel-heading">
          <SectionTitle count={runs.data?.length ?? 0}>Exécutions</SectionTitle>
          <span className="muted">Historique local</span>
        </div>
        {runs.isError ? (
          <Failure error={runs.error} />
        ) : !runs.data ? (
          <Loading />
        ) : !runs.data.length ? (
          <EmptyState
            title="Aucune exécution reçue"
            description="Associez un dépôt à un projet, puis configurez la GitHub App pour recevoir les mises à jour de branche."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Projet</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>État</TableHead>
                <TableHead>Reçu le</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.data.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>{run.projectName}</TableCell>
                  <TableCell>
                    <span className="mono">{run.commitSha.slice(0, 10)}</span>
                    <small className="block muted">{run.branch}</small>
                  </TableCell>
                  <TableCell>
                    <Status value={run.status} />
                  </TableCell>
                  <TableCell>{timestamp(run.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <SectionTitle>Activation de la chaîne</SectionTitle>
        </div>
        <Step
          title="Enregistrer les associations GitHub"
          description="Un dépôt, une installation d’application et une branche explicites par projet."
          done
        />
        <Step
          title="Installer Jenkins et ses agents"
          description="Contrôleur privé sans exécuteur. Les builds utilisent des agents isolés."
        />
        <Step
          title="Vérifier la livraison automatique"
          description="Tests réussis, version immuable, protection contre une ancienne révision et contrôle de santé."
        />
      </section>
    </>
  );
}
