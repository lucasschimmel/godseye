import type {
  AgentProfileView,
  CodingPreparationView,
  OrchestrationStepInput,
} from "@godseye/contracts";
import { agentMoney, agentRoleLabels } from "./agents-labels";
import { Button } from "./ui/button";

export type DraftStep = {
  id: string;
  kind: OrchestrationStepInput["kind"];
  reference: string;
  input: string;
  dependsOn: string[];
  includeDependencyOutputs: boolean;
};

export function AgentsPlansStep({
  step,
  previous,
  profiles,
  preparations,
  update,
  removable,
  remove,
}: {
  step: DraftStep;
  previous: DraftStep[];
  profiles: AgentProfileView[];
  preparations: CodingPreparationView[];
  update: (patch: Partial<DraftStep>) => void;
  removable: boolean;
  remove: () => void;
}) {
  const profile = profiles.find((row) => row.id === step.reference);
  const preparation = preparations.find((row) => row.id === step.reference);
  return (
    <fieldset className="agents-plans-step">
      <legend>{step.id}</legend>
      <label>
        Type d’étape
        <select
          value={step.kind}
          onChange={(event) =>
            update({ kind: event.target.value as DraftStep["kind"], reference: "", input: "" })
          }
        >
          <option value="hermes">Tâche Hermès</option>
          <option value="coding">Préparation de code</option>
          <option value="clarification">Question au propriétaire</option>
        </select>
      </label>
      {step.kind === "hermes" && (
        <>
          <label>
            Profil Hermès
            <select
              required
              value={step.reference}
              onChange={(event) => update({ reference: event.target.value })}
            >
              <option value="">Choisir un profil actuel</option>
              {profiles.map((row) => (
                <option key={row.id} value={row.id}>
                  {agentRoleLabels[row.role]} · {row.model} · révision {row.revision}
                </option>
              ))}
            </select>
          </label>
          {profile && (
            <p className="muted">
              {agentMoney(profile.limits.maxCostMicros)} maximum · {profile.limits.timeoutSeconds} s
              · {profile.limits.maxOutputTokens} tokens en sortie
            </p>
          )}
          {!profiles.length && (
            <p className="agents-notice">Créez ou reconfigurez un profil dans ce périmètre.</p>
          )}
        </>
      )}
      {step.kind === "coding" && (
        <>
          <label>
            Préparation de code immuable
            <select
              required
              value={step.reference}
              onChange={(event) => update({ reference: event.target.value })}
            >
              <option value="">Choisir une préparation non utilisée</option>
              {preparations.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.runner} · {row.commitSha.slice(0, 12)} · {row.input.slice(0, 60)}
                </option>
              ))}
            </select>
          </label>
          {preparation && (
            <>
              <p className="agents-text">{preparation.input}</p>
              <p className="muted">
                {agentMoney(preparation.limits.maxCostMicros)} maximum ·{" "}
                {preparation.limits.timeoutSeconds} s · commit {preparation.commitSha}
              </p>
              <code>{preparation.hash}</code>
            </>
          )}
          {!preparations.length && (
            <p className="agents-notice">
              Préparez une tâche dans la section Codex et Claude Code, sans la lancer séparément.
            </p>
          )}
        </>
      )}
      {step.kind !== "coding" && (
        <label>
          {step.kind === "hermes" ? "Demande de l’étape" : "Question de clarification"}
          <textarea
            required
            maxLength={8192}
            rows={3}
            value={step.input}
            onChange={(event) => update({ input: event.target.value })}
          />
        </label>
      )}
      {step.kind === "hermes" && (
        <label className="agents-plans-handoff">
          <input
            type="checkbox"
            checked={step.includeDependencyOutputs}
            onChange={(event) => update({ includeDependencyOutputs: event.target.checked })}
          />
          Joindre les résultats des dépendances directes comme données citées
        </label>
      )}
      {step.kind === "hermes" && step.includeDependencyOutputs && (
        <p className="muted">
          Seuls les résultats réussis des dépendances directes sont joints. Ce texte ne donne aucun
          droit supplémentaire. L’entrée assemblée reste limitée à 8 192 octets ; un dépassement
          bloque la tâche.
        </p>
      )}
      {previous.length > 0 && (
        <fieldset className="agents-plans-dependencies">
          <legend>Attendre la réussite de</legend>
          {previous.map((row) => (
            <label key={row.id}>
              <input
                type="checkbox"
                checked={step.dependsOn.includes(row.id)}
                onChange={(event) =>
                  update({
                    dependsOn: event.target.checked
                      ? [...step.dependsOn, row.id]
                      : step.dependsOn.filter((id) => id !== row.id),
                  })
                }
              />
              {row.id}
            </label>
          ))}
        </fieldset>
      )}
      <p className="muted">
        {step.dependsOn.length
          ? `Dépendances : ${step.dependsOn.join(", ")}`
          : "Aucune dépendance."}
      </p>
      <Button type="button" variant="outline" disabled={!removable} onClick={remove}>
        Retirer {step.id}
      </Button>
      {!removable && <p className="muted">Retirez d’abord les dépendances vers cette étape.</p>}
    </fieldset>
  );
}
