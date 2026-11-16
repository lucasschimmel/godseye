import type { BudgetResponse } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { z } from "zod";
import { resource } from "@/lib/api";
import { AGENT_REFRESH_MS, type AgentPost, agentMoney } from "./agents-labels";
import { Failure, Loading } from "./shared";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function AgentsBudget({
  projectId,
  disabled,
  post,
}: {
  projectId: string;
  disabled: boolean;
  post: AgentPost;
}) {
  const budget = useQuery({
    ...resource<z.infer<typeof BudgetResponse>>(
      `agent-budget-${projectId}`,
      `/foundation/budgets/${projectId}`,
    ),
    refetchInterval: AGENT_REFRESH_MS,
  });
  const [problem, setProblem] = useState("");
  if (!budget.data)
    return budget.isError ? (
      <Failure error={budget.error} retry={() => void budget.refetch()} />
    ) : (
      <Loading />
    );
  const data = budget.data;
  return (
    <section className="agents-budget" aria-label="Budget du projet sélectionné">
      <div>
        <h3>Budget du projet</h3>
        <p>
          Plafond : {agentMoney(data.limitMicros)} · Réservé : {agentMoney(data.reservedMicros)} ·
          Comptabilisé : {agentMoney(data.spentMicros)}
        </p>
      </div>
      <form
        key={`${projectId}:${data.revision}`}
        className="agents-budget-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const limit = Math.round(
            Number(new FormData(event.currentTarget).get("limit")) * 1_000_000,
          );
          if (!Number.isSafeInteger(limit) || limit < 0) {
            setProblem("Indiquez un montant valide.");
            return;
          }
          try {
            await post(
              `/foundation/budgets/${projectId}`,
              { expectedRevision: data.revision, limitMicros: limit },
              "PUT",
            );
            setProblem("");
          } catch {
            setProblem("Le budget n’a pas été confirmé. Vérifiez les réservations existantes.");
          }
        }}
      >
        <label htmlFor={`agent-budget-${projectId}`}>
          Plafond du projet (USD)
          <Input
            id={`agent-budget-${projectId}`}
            name="limit"
            type="number"
            min={0}
            step={0.01}
            required
            defaultValue={data.limitMicros / 1_000_000}
            disabled={disabled || budget.isError}
          />
        </label>
        <Button variant="outline" disabled={disabled || budget.isError}>
          Enregistrer le budget
        </Button>
      </form>
      {problem && (
        <p role="alert" className="agents-problem">
          {problem}
        </p>
      )}
      <p className="muted">
        Plafond partagé avec les autres opérations du projet. Aucun budget n’est augmenté
        automatiquement.
      </p>
    </section>
  );
}
