import { AnswerOrchestration, OrchestrationDetail } from "@godseye/contracts";
import { useState } from "react";
import type { AgentPost } from "./agents-labels";
import { Button } from "./ui/button";

export function AgentsPlansAnswer({
  planId,
  hash,
  stepId,
  disabled,
  post,
  select,
}: {
  planId: string;
  hash: string;
  stepId: string;
  disabled: boolean;
  post: AgentPost;
  select: (id: string) => void;
}) {
  const [answer, setAnswer] = useState("");
  const [problem, setProblem] = useState("");
  return (
    <form
      className="agents-form agents-plans-answer"
      onSubmit={async (event) => {
        event.preventDefault();
        setProblem("");
        const parsed = AnswerOrchestration.safeParse({ expectedHash: hash, stepId, answer });
        if (!parsed.success) {
          setProblem("La réponse doit contenir entre 1 et 8 192 octets de texte.");
          return;
        }
        try {
          const next = OrchestrationDetail.parse(
            await post(`/agents/orchestration/plans/${planId}/answer`, parsed.data),
          );
          select(next.plan.id);
        } catch (error) {
          setProblem(error instanceof Error ? error.message : "La réponse n’a pas été confirmée.");
        }
      }}
    >
      <label>
        Réponse au plan
        <textarea
          required
          maxLength={8192}
          rows={3}
          disabled={disabled}
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
        />
      </label>
      <p className="muted">
        La réponse crée une nouvelle continuation en attente d’approbation, avec les seules étapes
        restantes. Les tâches déjà exécutées restent dans le plan d’origine et ne sont pas rejouées.
      </p>
      <Button type="submit" disabled={disabled}>
        Préparer la continuation avec ma réponse
      </Button>
      {problem && (
        <p className="agents-problem" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}
