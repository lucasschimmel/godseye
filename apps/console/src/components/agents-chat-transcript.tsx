import type { AgentConversationDetailView } from "@godseye/contracts";
import { type AgentPost, agentStateLabels } from "./agents-labels";
import { AgentsToolsHistory } from "./agents-tools-history";
import { Button } from "./ui/button";

export function AgentsChatTranscript({
  detail,
  disabled,
  post,
}: {
  detail: AgentConversationDetailView;
  disabled: boolean;
  post: AgentPost;
}) {
  return (
    <div
      className="chat-transcript"
      role="log"
      aria-label="Messages de la conversation"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {!detail.turns.length && (
        <div className="chat-empty">
          <h3>Une conversation, un périmètre.</h3>
          <p>
            Décrivez votre besoin. Hermès garde un contexte récent de cette conversation et produit
            des réponses et brouillons pour cet environnement.
          </p>
        </div>
      )}
      {detail.turns.map((turn) => {
        const task = turn.task;
        const live = !["succeeded", "failed", "cancelled"].includes(task.state);
        const uncertain = ["unknown", "cancel_requested", "reconciling"].includes(task.state);
        const text = task.state === "succeeded" ? task.output : turn.partialText;
        return (
          <div className="chat-turn" key={turn.id}>
            <article className="chat-message chat-owner">
              <p className="eyebrow">VOUS</p>
              <div>{task.input}</div>
            </article>
            <article className="chat-message chat-assistant">
              <div className="chat-message-meta">
                <p className="eyebrow">HERMÈS</p>
                <span className="agents-badge">{agentStateLabels[task.state]}</span>
              </div>
              {turn.omittedTurns > 0 && (
                <p className="muted">
                  Contexte récent : {turn.omittedTurns} échange(s) plus ancien(s) conservé(s) dans
                  l’historique uniquement.
                </p>
              )}
              {text ? (
                <div className="chat-text">{text}</div>
              ) : (
                <p className="muted">
                  {live ? "Préparation de la réponse…" : "Aucun résultat validé pour ce message."}
                </p>
              )}
              {task.state !== "succeeded" && turn.partialText && (
                <p className="muted">Texte provisoire · le résultat final reste à confirmer.</p>
              )}
              {task.toolGrant && <AgentsToolsHistory taskId={task.id} />}
              {live && (
                <div className="agents-actions">
                  <Button
                    variant="outline"
                    disabled={disabled}
                    onClick={() =>
                      void post(`/agents/tasks/${task.id}/cancel`, {}).catch(() => undefined)
                    }
                  >
                    Demander l’arrêt
                  </Button>
                  {uncertain && (
                    <Button
                      variant="outline"
                      disabled={disabled}
                      onClick={() =>
                        void post(`/agents/tasks/${task.id}/reconcile`, {}).catch(() => undefined)
                      }
                    >
                      Vérifier le résultat
                    </Button>
                  )}
                </div>
              )}
            </article>
          </div>
        );
      })}
    </div>
  );
}
