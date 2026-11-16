import {
  type AgentProfileView,
  type CodingPreparationView,
  ORCHESTRATION_DEFAULTS,
  OrchestrationDetail,
  PrepareOrchestration,
  type ProjectDTO,
} from "@godseye/contracts";
import { useRef, useState } from "react";
import { type AgentPost, agentEnvironments, agentMoney } from "./agents-labels";
import { AgentsPlansStep, type DraftStep } from "./agents-plans-step";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

function resolveStep(
  draft: DraftStep,
  profiles: AgentProfileView[],
  preparations: CodingPreparationView[],
): import("@godseye/contracts").OrchestrationStepInput {
  const base = { id: draft.id, dependsOn: draft.dependsOn };
  if (draft.kind === "clarification") return { ...base, kind: draft.kind, question: draft.input };
  if (draft.kind === "hermes") {
    const profile = profiles.find((row) => row.id === draft.reference);
    if (!profile) throw new Error(`Choisissez un profil actuel pour ${draft.id}.`);
    return {
      ...base,
      kind: draft.kind,
      profileId: profile.id,
      expectedRevision: profile.revision,
      input: draft.input,
      includeDependencyOutputs: draft.includeDependencyOutputs,
    };
  }
  const preparation = preparations.find((row) => row.id === draft.reference);
  if (!preparation) throw new Error(`Choisissez une préparation disponible pour ${draft.id}.`);
  return {
    ...base,
    kind: draft.kind,
    preparationId: preparation.id,
    expectedHash: preparation.hash,
  };
}

// A bounded structured editor keeps authority-bearing references separate from inert task text.
export function AgentsPlansComposer({
  projects,
  profiles,
  preparations,
  disabled,
  post,
  select,
}: {
  projects: ProjectDTO[];
  profiles: AgentProfileView[];
  preparations: CodingPreparationView[];
  disabled: boolean;
  post: AgentPost;
  select: (id: string) => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [title, setTitle] = useState("");
  const [budget, setBudget] = useState("1");
  const [lifetime, setLifetime] = useState("900");
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [problem, setProblem] = useState("");
  const nextId = useRef(1);
  const project = projects.find((row) => row.id === projectId);
  const environment = project && agentEnvironments(project).find((row) => row.id === environmentId);
  const scopedProfiles = profiles.filter(
    (row) =>
      row.projectId === projectId &&
      row.environmentId === environmentId &&
      row.projectRevision === project?.revision &&
      row.environmentRevision === environment?.revision &&
      !row.paused,
  );
  const scopedPreparations = preparations.filter(
    (row) =>
      row.projectId === projectId &&
      row.environmentId === environmentId &&
      row.expectedProjectRevision === project?.revision &&
      row.expectedEnvironmentRevision === environment?.revision,
  );
  const estimate = steps.reduce(
    (total, step) =>
      total +
      (step.kind === "hermes"
        ? (scopedProfiles.find((row) => row.id === step.reference)?.limits.maxCostMicros ?? 0)
        : step.kind === "coding"
          ? (scopedPreparations.find((row) => row.id === step.reference)?.limits.maxCostMicros ?? 0)
          : 0),
    0,
  );
  const update = (id: string, patch: Partial<DraftStep>) =>
    setSteps((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const prepare = async () => {
    setProblem("");
    if (!project || !environment) return;
    try {
      const parsed = PrepareOrchestration.safeParse({
        projectId,
        environmentId,
        expectedProjectRevision: project.revision,
        expectedEnvironmentRevision: environment.revision,
        title,
        maxCostMicros: Number(budget) * 1_000_000,
        lifetimeSeconds: Number(lifetime),
        steps: steps.map((step) => resolveStep(step, scopedProfiles, scopedPreparations)),
      });
      if (!parsed.success || budget.trim() === "" || lifetime.trim() === "")
        throw new Error(
          "Vérifiez le titre, les étapes, le budget (0–12 USD), la durée (30–3 600 s) et les textes (8 192 octets maximum).",
        );
      if (parsed.data.maxCostMicros < estimate)
        throw new Error(
          "Le budget du plan est inférieur à la somme des plafonds des étapes. Modifiez-le explicitement.",
        );
      const detail = OrchestrationDetail.parse(
        await post("/agents/orchestration/plans", parsed.data),
      );
      select(detail.plan.id);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "La préparation n’a pas été confirmée.");
    }
  };
  return (
    <details className="agents-plans-compose">
      <summary>Composer un plan borné</summary>
      <form
        className="agents-form"
        onSubmit={(event) => {
          event.preventDefault();
          void prepare();
        }}
      >
        <p className="muted">
          Un seul projet et environnement, jusqu’à {ORCHESTRATION_DEFAULTS.maxSteps} étapes.
          Préparer crée une demande en attente ; l’approbation porte ensuite sur son contenu exact.
        </p>
        <fieldset disabled={disabled} className="agents-plans-fields">
          <div className="agents-fields">
            <label>
              Projet du plan
              <select
                required
                value={projectId}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  setEnvironmentId("");
                }}
              >
                <option value="">Choisir un projet</option>
                {projects.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Environnement du plan
              <select
                required
                value={environmentId}
                onChange={(event) => setEnvironmentId(event.target.value)}
              >
                <option value="">Choisir un environnement</option>
                {project &&
                  agentEnvironments(project).map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <label htmlFor="orchestration-title">
            Titre du plan
            <Input
              id="orchestration-title"
              required
              maxLength={120}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <div className="agents-fields">
            <label htmlFor="orchestration-budget">
              Budget total maximal (USD)
              <Input
                id="orchestration-budget"
                required
                type="number"
                min="0"
                max="12"
                step="0.000001"
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
              />
            </label>
            <label htmlFor="orchestration-lifetime">
              Délai depuis la préparation (secondes)
              <Input
                id="orchestration-lifetime"
                required
                type="number"
                min="30"
                max={ORCHESTRATION_DEFAULTS.maxLifetimeSeconds}
                step="1"
                value={lifetime}
                onChange={(event) => setLifetime(event.target.value)}
              />
            </label>
          </div>
          <p className="muted">
            Somme des plafonds sélectionnés : {agentMoney(estimate)}. Le budget saisi reste sous
            votre contrôle. Le délai limite les nouvelles admissions.
          </p>
          {steps.map((step, index) => (
            <AgentsPlansStep
              key={step.id}
              step={step}
              previous={steps.slice(0, index)}
              profiles={scopedProfiles}
              preparations={scopedPreparations}
              update={(patch) => update(step.id, patch)}
              removable={!steps.some((row) => row.dependsOn.includes(step.id))}
              remove={() => setSteps((rows) => rows.filter((row) => row.id !== step.id))}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={!environment || steps.length >= ORCHESTRATION_DEFAULTS.maxSteps}
            onClick={() => {
              const id = `step-${nextId.current++}`;
              setSteps((rows) => [
                ...rows,
                {
                  id,
                  kind: "hermes",
                  reference: "",
                  input: "",
                  dependsOn: [],
                  includeDependencyOutputs: false,
                },
              ]);
            }}
          >
            Ajouter une étape
          </Button>
          <Button type="submit" disabled={!environment || steps.length === 0}>
            Préparer le plan pour relecture
          </Button>
        </fieldset>
        {problem && (
          <p className="agents-problem" role="alert">
            {problem}
          </p>
        )}
      </form>
    </details>
  );
}
