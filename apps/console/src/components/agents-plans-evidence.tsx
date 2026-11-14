import type { AgentTaskDetailView, CodingTaskDetailView } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { resource } from "@/lib/api";
import { AGENT_REFRESH_MS, agentStateLabels } from "./agents-labels";
import { Failure, Loading } from "./shared";
import { Button } from "./ui/button";

export function AgentsPlansEvidence({
  kind,
  taskId,
  selectTask,
}: {
  kind: "hermes" | "coding" | "clarification";
  taskId: string;
  selectTask: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="agents-plans-evidence"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Tâche enfant et preuves · {taskId}</summary>
      {open &&
        (kind === "hermes" ? (
          <HermesEvidence id={taskId} selectTask={selectTask} />
        ) : kind === "coding" ? (
          <CodingEvidence id={taskId} />
        ) : (
          <p>Étape de clarification sans exécution.</p>
        ))}
    </details>
  );
}

function HermesEvidence({ id, selectTask }: { id: string; selectTask: (id: string) => void }) {
  const query = useQuery({
    ...resource<AgentTaskDetailView>(`agent-task-${id}`, `/agents/tasks/${id}`),
    refetchInterval: AGENT_REFRESH_MS,
  });
  if (!query.data)
    return query.isError ? (
      <Failure error={query.error} retry={() => void query.refetch()} />
    ) : (
      <Loading />
    );
  const { task } = query.data;
  return (
    <div className="agents-plans-proof">
      {query.isError && <Failure error={query.error} retry={() => void query.refetch()} />}
      <p>
        {agentStateLabels[task.state]} · profil {task.profileId} · révision {task.profileRevision}
      </p>
      <h5>Demande effective</h5>
      <p className="agents-text">{task.input}</p>
      <h5>Résultat retenu</h5>
      <p className="agents-text">{task.output ?? "Aucun résultat confirmé."}</p>
      {task.reason && <p className="agents-notice">{task.reason}</p>}
      <Button variant="outline" onClick={() => selectTask(id)}>
        Voir l’historique de cette tâche Hermès
      </Button>
    </div>
  );
}

function CodingEvidence({ id }: { id: string }) {
  const query = useQuery({
    ...resource<CodingTaskDetailView>(`coding-task-${id}`, `/agents/coding/tasks/${id}`),
    refetchInterval: AGENT_REFRESH_MS,
  });
  if (!query.data)
    return query.isError ? (
      <Failure error={query.error} retry={() => void query.refetch()} />
    ) : (
      <Loading />
    );
  const { task, preparation, result } = query.data;
  return (
    <div className="agents-plans-proof">
      {query.isError && <Failure error={query.error} retry={() => void query.refetch()} />}
      <p>
        {agentStateLabels[task.state]} · {task.runner} · commit <code>{preparation.commitSha}</code>
      </p>
      <p>
        Worktree : <code>{task.worktree.id}</code> · conservation : {task.worktree.disposition} ·
        nettoyage : {task.cleanupState}
      </p>
      {task.reason && <p className="agents-notice">{task.reason}</p>}
      {result ? (
        <>
          <p className="agents-text">{result.summary}</p>
          <p>
            Empreinte de préparation : <code>{result.preparationHash}</code>
          </p>
          <p>
            Coût mesuré :{" "}
            {result.usage.costMicros === null ? "inconnu" : `${result.usage.costMicros} micro-USD`}{" "}
            · comptabilité : {result.usage.accounting}
          </p>
          {result.patch && (
            <details>
              <summary>
                Patch texte · {result.patch.bytes} octets · {result.patch.sha256}
              </summary>
              <pre>{result.patch.content}</pre>
            </details>
          )}
          {result.tests.map((test) => (
            <details key={test.profile}>
              <summary>
                Vérification {test.profile} · {test.status} · sortie {test.exitCode ?? "inconnue"}
              </summary>
              <pre>{test.log?.content ?? "Aucun journal retenu."}</pre>
            </details>
          ))}
        </>
      ) : (
        <p>Aucune preuve de résultat disponible.</p>
      )}
    </div>
  );
}
