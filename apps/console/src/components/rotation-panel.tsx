import type {
  DatabaseOverviewView,
  ProjectDTO,
  RotationOverviewView,
  RotationRoleView,
} from "@godseye/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, resource, timestamp } from "@/lib/api";
import { rotationExplanations, rotationHeadings } from "@/lib/secrets-bindings";
import { ProtectionBadge, roleLabels, scopeName } from "./protection-labels";
import { EmptyState, Failure, Loading, SectionTitle } from "./shared";
import { Button } from "./ui/button";

const post = (path: string, body: unknown) =>
  api(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "idempotency-key": crypto.randomUUID() },
  });
/** Roles x allocations, joined with rotation journal and linked access slots. No secret is displayed. */
export function RotationPanel({
  projects,
  databases,
  fresh,
}: {
  projects: ProjectDTO[];
  databases: DatabaseOverviewView;
  fresh: boolean;
}) {
  const overview = useQuery(
    resource<RotationOverviewView>("database-rotations", "/databases/rotations"),
  );
  const cache = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({ path, body }: { path: string; body: unknown }) => {
      await post(path, body);
      await post("/incidents/evaluations", {});
    },
    onSuccess: () => cache.invalidateQueries(),
  });
  if (overview.isPending) return <Loading />;
  if (overview.isError)
    return <Failure error={overview.error} retry={() => void overview.refetch()} />;
  const { execution, roles } = overview.data;
  const groups = databases.allocations
    .filter((allocation) => allocation.state !== "released")
    .map((allocation) => ({
      allocation,
      roles: roles.filter((role) => role.allocationId === allocation.id),
    }));
  function act(role: RotationRoleView, generation: number) {
    if (role.state === "unknown" || role.state === "in-progress") {
      if (role.lastRotationId)
        mutation.mutate({
          path: `/databases/rotations/${role.lastRotationId}/reconcile`,
          body: {},
        });
      return;
    }
    mutation.mutate({
      path: "/databases/rotations",
      body: {
        projectId: role.projectId,
        environmentId: role.environmentId,
        allocationId: role.allocationId,
        role: role.role,
        slotId: role.slot?.id ?? null,
        expectedGeneration: generation,
      },
    });
  }
  return (
    <section aria-label="Rotation des rôles de base">
      <SectionTitle count={groups.length}>{rotationHeadings[execution]}</SectionTitle>
      <p className="muted">{rotationExplanations[execution]}</p>
      {mutation.isError && <Failure error={mutation.error} />}
      {groups.length === 0 ? (
        <EmptyState
          title="Aucune base à pivoter"
          description="Les rôles apparaissent dès qu’une base est allouée."
        />
      ) : (
        <div className="environment-grid">
          {groups.map(({ allocation, roles: rows }) => (
            <section
              className="panel environment-card"
              key={allocation.id}
              aria-label={`Rotation ${scopeName(projects, allocation.projectId, allocation.environmentId)}`}
            >
              <h3>{scopeName(projects, allocation.projectId, allocation.environmentId)}</h3>
              <ul className="rotation-roles">
                {rows.map((role) => {
                  const unresolved = role.state === "unknown" || role.state === "in-progress";
                  const label = roleLabels[role.role] ?? role.role;
                  const disabled =
                    mutation.isPending ||
                    !fresh ||
                    execution !== "qualified" ||
                    (allocation.state !== "ready" && !unresolved);
                  return (
                    <li key={role.role}>
                      <strong>{label}</strong> <ProtectionBadge value={role.state} />
                      <span className="muted">
                        {role.lastRotatedAt
                          ? ` Dernière rotation : ${timestamp(role.lastRotatedAt)}.`
                          : " Jamais pivoté."}
                        {role.slot ? ` Accès lié : ${role.slot.name} (${role.slot.state}).` : ""}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        onClick={() => act(role, allocation.generation)}
                      >
                        {unresolved ? `Réconcilier ${label}` : `Pivoter ${label}`}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
