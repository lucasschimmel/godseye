import type { BackupOverviewView, ProjectDTO } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { resource, timestamp } from "@/lib/api";
import { ProtectionBadge, reasonLabels, scopeName } from "./protection-labels";
import { EmptyState, Failure, Loading, SectionTitle } from "./shared";

const providerText: Record<BackupOverviewView["provider"], string> = {
  unconfigured:
    "Aucun fournisseur de sauvegarde n’est connecté. Aucun état n’est présenté comme sain.",
  unavailable:
    "Le fournisseur est dégradé ou non qualifié. Les dernières preuves restent lisibles mais l’état est inconnu.",
  qualified: "Le fournisseur a été qualifié pour chaque environnement ci-dessous.",
};
/** Read-only view: it renders from retained evidence even when the provider is degraded. */
export function BackupStatus({ projects }: { projects: ProjectDTO[] }) {
  const backups = useQuery(resource<BackupOverviewView>("database-backups", "/databases/backups"));
  if (backups.isPending) return <Loading />;
  if (backups.isError)
    return <Failure error={backups.error} retry={() => void backups.refetch()} />;
  const { provider, environments } = backups.data;
  return (
    <section aria-label="État des sauvegardes par environnement">
      <SectionTitle count={environments.length}>
        État des sauvegardes par environnement
      </SectionTitle>
      <p className="muted">{providerText[provider]}</p>
      {environments.length === 0 ? (
        <EmptyState
          title="Aucune sauvegarde conservée"
          description="Préparez et admettez une sauvegarde physique pour obtenir un état d’archive."
        />
      ) : (
        <div className="environment-grid">
          {environments.map((item) => (
            <section
              className="panel environment-card"
              key={item.allocationId}
              aria-label={`Sauvegardes ${scopeName(projects, item.projectId, item.environmentId)}`}
            >
              <h3>{scopeName(projects, item.projectId, item.environmentId)}</h3>
              <ProtectionBadge value={item.status} />
              <dl>
                <div>
                  <dt>Dernière sauvegarde de base</dt>
                  <dd>
                    {item.lastBaseBackup
                      ? `${item.lastBaseBackup.kind === "full" ? "Complète" : "Différentielle"}, ${timestamp(item.lastBaseBackup.completedAt)}`
                      : "Aucune"}
                  </dd>
                </div>
                <div>
                  <dt>Retard d’archive</dt>
                  <dd>
                    {item.archive.state === "unknown"
                      ? "Inconnu"
                      : `${item.archive.lagSeconds ?? 0} s sur ${item.archive.maxAgeSeconds} s`}
                  </dd>
                </div>
                <div>
                  <dt>Fenêtre de récupération</dt>
                  <dd>
                    {item.recoveryWindow
                      ? `${timestamp(item.recoveryWindow.from)} → ${timestamp(item.recoveryWindow.to)}`
                      : "Non annoncée"}
                  </dd>
                </div>
                <div>
                  <dt>Marge WAL et archive</dt>
                  <dd>
                    {item.headroom.state === "unknown"
                      ? "Inconnue"
                      : `${item.headroom.archiveFreeGiB} GiB libres, ${item.headroom.requiredGiB} GiB requis`}
                  </dd>
                </div>
              </dl>
              {item.reasons.map((reason) => (
                <p key={reason} role="status">
                  {reasonLabels[reason] ?? reason}
                </p>
              ))}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
