import type { AuditView, OperationView } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AuditIntegrityPanel } from "@/components/audit-integrity-panel";
import {
  EmptyState,
  Failure,
  Loading,
  PageHeading,
  SectionTitle,
  Status,
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

export const Route = createFileRoute("/operations")({ component: Operations });
function Operations() {
  const operations = useQuery(resource<OperationView[]>("operations", "/operations"));
  const audit = useQuery(resource<AuditView[]>("audit", "/audit"));
  return (
    <>
      <PageHeading
        eyebrow="TRAÇABILITÉ"
        title="Opérations"
        description="Les actions exécutées et les modifications apportées à votre espace."
      />
      <section className="panel">
        <div className="panel-heading">
          <SectionTitle count={operations.data?.length ?? 0}>Journal des opérations</SectionTitle>
        </div>
        {operations.isError ? (
          <Failure error={operations.error} />
        ) : !operations.data ? (
          <Loading />
        ) : !operations.data.length ? (
          <EmptyState
            title="Aucune opération pour le moment"
            description="Validez la configuration d’un projet pour enregistrer votre première opération locale."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>État</TableHead>
                <TableHead>Révision</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {operations.data.map((operation) => (
                <TableRow key={operation.id}>
                  <TableCell className="mono">{operation.action}</TableCell>
                  <TableCell>
                    <Status value={operation.status} />
                  </TableCell>
                  <TableCell>{operation.revision}</TableCell>
                  <TableCell>{timestamp(operation.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      <AuditIntegrityPanel />
      <section className="panel activity-panel">
        <div className="panel-heading">
          <SectionTitle>Activité de l’espace</SectionTitle>
          <span className="muted">100 derniers événements</span>
        </div>
        {audit.isError ? (
          <Failure error={audit.error} />
        ) : !audit.data ? (
          <Loading />
        ) : audit.data.length ? (
          <div className="activity-list">
            {audit.data.map((entry) => (
              <div key={entry.id}>
                <span className="activity-dot" />
                <div>
                  <strong>{entry.action}</strong>
                  <p>{entry.summary}</p>
                  <small className="mono muted">
                    {entry.actorId} · #{entry.sequence}
                  </small>
                </div>
                <time dateTime={entry.occurredAt}>{timestamp(entry.occurredAt)}</time>
              </div>
            ))}
          </div>
        ) : (
          <p className="quiet-empty">Les changements de configuration apparaîtront ici.</p>
        )}
      </section>
    </>
  );
}
