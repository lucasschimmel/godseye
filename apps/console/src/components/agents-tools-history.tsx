import { AgentTaskToolsDetail } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { toolLabels } from "./agents-tools-fields";
import { Button } from "./ui/button";

export function AgentsToolsHistory({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  const detail = useQuery({
    queryKey: ["agent-task-tools", taskId],
    enabled: open,
    queryFn: async () => AgentTaskToolsDetail.parse(await api(`/agents/tasks/${taskId}/tools`)),
    refetchInterval: open ? 5000 : false,
  });
  const data = detail.data;
  const states = {
    disabled: "Aucun outil autorisé",
    intended: "Préparation en attente",
    available: "Espace isolé actif",
    stopped: "Arrêt et nettoyage confirmés",
    unknown: "Nettoyage non confirmé",
  };
  const callStates = {
    intended: "Intention enregistrée",
    running: "En cours",
    succeeded: "Terminé",
    failed: "Échec confirmé",
    unknown: "Résultat incertain",
    cancelled: "Annulé",
  };
  return (
    <details
      className="agents-tools-history"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Appels d’outils et nettoyage</summary>
      {detail.isError && (
        <p className="agents-problem" role="alert">
          Le journal des outils n’a pas pu être actualisé.
        </p>
      )}
      {!data ? (
        <p className="muted">Chargement du journal…</p>
      ) : (
        <>
          <p className={data.state === "unknown" ? "agents-notice" : "muted"}>
            {states[data.state]}
          </p>
          {data.toolGrant && (
            <p className="muted">
              Appels : {data.usage.calls}/{data.toolGrant.policy.maxCalls} · Lecture :{" "}
              {data.usage.readBytes}/{data.toolGrant.policy.maxReadBytes} octets · Écriture :{" "}
              {data.usage.writeBytes}/{data.toolGrant.policy.maxWriteBytes} octets · Résultats :{" "}
              {data.usage.outputBytes}/{data.toolGrant.policy.maxOutputBytes} octets
            </p>
          )}
          {data.state === "unknown" && (
            <p className="agents-notice">
              Le profil et le budget restent réservés jusqu’à preuve de l’arrêt. Vérifiez le
              résultat de la tâche.
            </p>
          )}
          {!data.calls.length && <p className="muted">Aucun appel d’outil enregistré.</p>}
          <ol className="agents-timeline">
            {data.calls.map((call) => (
              <li key={call.id}>
                <strong>{toolLabels[call.name]}</strong> · {callStates[call.state]}
                {call.result !== null && <pre className="agents-text">{call.result}</pre>}
              </li>
            ))}
          </ol>
          {data.artifacts.map((artifact, index) => (
            <div key={artifact.path}>
              <p className="mono">
                {artifact.path} · {artifact.bytes} octets
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([artifact.contentUtf8], { type: "text/plain;charset=utf-8" }),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `tool-${taskId}-${index + 1}.txt`;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 0);
                }}
              >
                Télécharger le fichier texte
              </Button>
            </div>
          ))}
        </>
      )}
    </details>
  );
}
