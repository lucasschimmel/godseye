import type { AgentConversationDetailView } from "@godseye/contracts";
import { LOCAL_DEFAULTS } from "@godseye/contracts";
import { useState } from "react";
import type { AgentPost } from "./agents-labels";
import { Button } from "./ui/button";

const proposalStatus = {
  pending: "À examiner",
  approved: "Approuvé",
  rejected: "Refusé",
  expired: "Expiré",
  stale: "À préparer à nouveau",
};
export function AgentsChatOutputs({
  detail,
  post,
  disabled,
  fresh,
}: {
  detail: AgentConversationDetailView;
  post: AgentPost;
  disabled: boolean;
  fresh: boolean;
}) {
  const [failure, setFailure] = useState("");
  async function decide(id: string, expectedHash: string, decision: "approve" | "reject") {
    setFailure("");
    try {
      await post(`/agents/proposals/${id}/resolve`, { expectedHash, decision });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "La décision n’a pas abouti.");
    }
  }
  return (
    <aside className="chat-outputs" aria-label="Artefacts et approbations">
      <section>
        <p className="eyebrow">LIVRABLES</p>
        <h3>
          Artefacts <span className="agents-count">{detail.artifacts.length}</span>
        </h3>
        {!detail.artifacts.length && (
          <p className="muted">
            Les brouillons et fichiers produits apparaîtront ici après validation de la réponse.
          </p>
        )}
        {detail.artifacts.map((item) => (
          <details className="chat-artifact" key={item.id}>
            <summary>
              Brouillon ·{" "}
              {item.mediaType === "text/markdown"
                ? "Markdown"
                : item.mediaType === "application/json"
                  ? "JSON"
                  : item.mediaType === "text/x-patch"
                    ? "Patch"
                    : "Texte"}
            </summary>
            <p className="muted">
              {item.bytes.toLocaleString("fr-FR")} octets · SHA-256 {item.sha256.slice(0, 12)}
            </p>
            <pre>{item.content}</pre>
            <a
              className="chat-download"
              href={`${LOCAL_DEFAULTS.apiBase}/agents/artifacts/${item.id}/download`}
              download
            >
              Télécharger le brouillon
            </a>
          </details>
        ))}
      </section>
      <section>
        <p className="eyebrow">DÉCISIONS PROPRIÉTAIRE</p>
        <h3>Demandes d’approbation</h3>
        {!detail.proposals.length && (
          <p className="muted">
            Hermès peut soumettre un plan existant de ce projet à votre examen.
          </p>
        )}
        {failure && (
          <p className="agents-notice" role="alert">
            {failure}
          </p>
        )}
        {detail.proposals.map((proposal) => (
          <article className="chat-proposal" key={proposal.id}>
            <span className="agents-badge">{proposalStatus[proposal.status]}</span>
            <p>{proposal.reason}</p>
            <p className="muted">
              Échéance : {new Date(proposal.expiresAt).toLocaleString("fr-FR")}
            </p>
            <details>
              <summary>Paramètres exacts du plan</summary>
              <pre>{proposal.command}</pre>
              <p className="muted">
                Cible : {proposal.targetId}
                <br />
                Version : {proposal.expectedRevision}
                <br />
                Empreinte : {proposal.expectedHash}
              </p>
            </details>
            {proposal.status === "pending" && (
              <>
                <p className="muted">
                  L’approbation peut reprendre une opération déjà en attente. Confirmez votre
                  identité pour approuver.
                </p>
                <div className="agents-actions">
                  <Button
                    disabled={disabled || !fresh}
                    onClick={() => void decide(proposal.id, proposal.expectedHash, "approve")}
                  >
                    Approuver le plan
                  </Button>
                  <Button
                    variant="outline"
                    disabled={disabled}
                    onClick={() => void decide(proposal.id, proposal.expectedHash, "reject")}
                  >
                    Refuser
                  </Button>
                </div>
              </>
            )}
          </article>
        ))}
      </section>
    </aside>
  );
}
