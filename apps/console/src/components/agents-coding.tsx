import {
  CODING_DEFAULTS,
  CODING_RUNNER_DEFAULT_COST_MICROS,
  type CodingOverviewView,
  type CodingTaskDetailView,
  type ProjectDTO,
} from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { resource } from "@/lib/api";
import { type AgentPost, agentMoney, agentStateLabels } from "./agents-labels";
import { Failure, Loading } from "./shared";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const dispositionLabels = {
  planned: "prévu",
  active: "actif",
  retained: "conservé",
  released: "libéré",
  quarantined: "en quarantaine",
} as const;
const cleanupLabels = {
  "not-started": "non commencé",
  pending: "en attente",
  revoked: "droits révoqués",
  stopped: "arrêt confirmé",
  quarantined: "en quarantaine",
} as const;
const accountingLabels = {
  measured: "mesurée",
  "reserved-conservatively": "plafond réservé par prudence",
  unknown: "inconnue",
} as const;
const testLabels = { "not-run": "non exécutée", passed: "réussite", failed: "échec" } as const;

function downloadEvidence(content: string, name: "coding-patch.txt" | "coding-test-log.txt") {
  // Inert UTF-8 bytes, fixed filename and MIME; no runner-supplied navigation or execution.
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function AgentsCoding({
  projects,
  post,
  disabled,
  fresh,
}: {
  projects: ProjectDTO[];
  post: AgentPost;
  disabled: boolean;
  fresh: boolean;
}) {
  const overview = useQuery({
    ...resource<CodingOverviewView>("coding", "/agents/coding"),
    refetchInterval: 5000,
  });
  const [projectId, setProjectId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [runner, setRunner] = useState<"codex" | "claude-code">("codex");
  const [commitSha, setCommitSha] = useState("");
  const [input, setInput] = useState("");
  const [testProfile, setTestProfile] = useState<"none" | "typecheck" | "test">("none");
  const [budgetMicros, setBudgetMicros] = useState<number>(CODING_RUNNER_DEFAULT_COST_MICROS.codex);
  const [budgetEdited, setBudgetEdited] = useState(false);
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(CODING_DEFAULTS.timeoutSeconds);
  const [selected, setSelected] = useState("");
  const detail = useQuery({
    ...resource<CodingTaskDetailView>(
      `coding-task-${selected}`,
      `/agents/coding/tasks/${selected}`,
    ),
    enabled: Boolean(selected),
    refetchInterval: selected ? 5000 : false,
  });
  const project = projects.find((p) => p.id === projectId);
  const environment = project?.environments.find((e) => e.id === environmentId);
  if (!overview.data)
    return overview.isError ? (
      <Failure error={overview.error} retry={() => void overview.refetch()} />
    ) : (
      <Loading />
    );
  const data = overview.data;
  const blocked = disabled || overview.isError;
  return (
    <section className="panel agents-runtime agents-coding" aria-label="Tâches de code isolées">
      <div className="agents-runtime-heading">
        <div>
          <p className="eyebrow">DÉPÔTS · ESPACES DE TRAVAIL</p>
          <h2>Codex et Claude Code</h2>
        </div>
      </div>
      <p>
        Préparez une tâche sur un commit précis du dépôt lié. Chaque exécution nécessite un invité
        KVM jetable, un accès fournisseur limité et un budget réservé.
      </p>
      {data.capabilities.map((capability) => (
        <p key={capability.runner}>
          <strong>{capability.runner}</strong> ·{" "}
          {capability.available ? "Disponible" : "Indisponible"} ·{" "}
          {capability.reason === "Disposable KVM and bounded vendor API broker are not qualified"
            ? "L’invité KVM et l’accès fournisseur avec plafond de dépenses restent à qualifier."
            : capability.reason === "Coding resource pool including VMM overhead is not configured"
              ? "Les ressources réservées à l’invité et à son hyperviseur restent à configurer."
              : capability.reason}
        </p>
      ))}
      <p className="muted">
        Les abonnements personnels et leur facturation ne donnent aucun droit implicite. Aucun
        lancement sur le système hôte. Les aperçus demandés restent indisponibles tant qu’une
        livraison distincte n’est pas autorisée.
      </p>
      {overview.isError && <Failure error={overview.error} retry={() => void overview.refetch()} />}
      <form
        className="agents-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!project || !environment) return;
          void post("/agents/coding/preparations", {
            projectId,
            environmentId,
            expectedProjectRevision: project.revision,
            expectedEnvironmentRevision: environment.revision,
            runner,
            commitSha,
            input,
            testProfile,
            previewRequested: false,
            limits: {
              timeoutSeconds,
              maxCostMicros: budgetMicros,
              maxPatchBytes: CODING_DEFAULTS.maxPatchBytes,
              maxOutputBytes: CODING_DEFAULTS.maxOutputBytes,
            },
          }).catch(() => undefined);
        }}
      >
        <label>
          Projet
          <select
            aria-label="Projet de code"
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setEnvironmentId("");
            }}
          >
            <option value="">Choisir un projet</option>
            {projects
              .filter((p) => p.repository)
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name} · {p.repository?.fullName}
                </option>
              ))}
          </select>
        </label>
        <label>
          Environnement
          <select
            aria-label="Environnement de code"
            value={environmentId}
            onChange={(event) => setEnvironmentId(event.target.value)}
          >
            <option value="">Choisir un environnement</option>
            {project?.environments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Runner
          <select
            value={runner}
            onChange={(event) => {
              const selectedRunner = event.target.value as typeof runner;
              setRunner(selectedRunner);
              if (!budgetEdited) setBudgetMicros(CODING_RUNNER_DEFAULT_COST_MICROS[selectedRunner]);
            }}
          >
            <option value="codex">Codex</option>
            <option value="claude-code">Claude Code</option>
          </select>
        </label>
        <label htmlFor="coding-commit">
          Commit exact
          <Input
            id="coding-commit"
            value={commitSha}
            onChange={(event) => setCommitSha(event.target.value)}
            pattern="[a-f0-9]{40}"
            maxLength={40}
            required
          />
        </label>
        <label>
          Demande
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            maxLength={CODING_DEFAULTS.maxInputBytes}
            required
          />
        </label>
        <label>
          Vérification dans l’invité
          <select
            value={testProfile}
            onChange={(event) => setTestProfile(event.target.value as typeof testProfile)}
          >
            <option value="none">Aucune</option>
            <option value="typecheck">Script typecheck</option>
            <option value="test">Script test</option>
          </select>
        </label>
        <label htmlFor="coding-budget">
          Budget maximal réservé (USD)
          <Input
            id="coding-budget"
            type="number"
            min={0.001}
            max={1}
            step={0.001}
            value={budgetMicros / 1_000_000}
            onChange={(event) => {
              setBudgetEdited(true);
              setBudgetMicros(Math.round(Number(event.target.value) * 1_000_000));
            }}
            required
          />
        </label>
        <label htmlFor="coding-timeout">
          Durée maximale (secondes)
          <Input
            id="coding-timeout"
            type="number"
            min={5}
            max={900}
            step={1}
            value={timeoutSeconds}
            onChange={(event) => setTimeoutSeconds(Number(event.target.value))}
            required
          />
        </label>
        <p className="muted">
          Plafond proposé selon le runner ; réservation prudente, facture non mesurée. Ce plafond
          reste modifiable et peut être entièrement débité par prudence.
        </p>
        <Button type="submit" disabled={blocked || !environment || !project?.repository}>
          Préparer la tâche
        </Button>
      </form>
      <h3>Préparations immuables</h3>
      {!data.preparations.length && <p>Aucune préparation.</p>}
      {data.preparations.map((p) => (
        <article key={p.id} className="agents-notice">
          <p>
            {p.runner} · {p.repository.fullName} · <code>{p.commitSha}</code>
          </p>
          <p>{p.input}</p>
          <p>
            Plafond réservé : {agentMoney(p.limits.maxCostMicros)} · {p.limits.timeoutSeconds} s
          </p>
          <Button
            disabled={
              blocked ||
              !fresh ||
              !data.capabilities.find((c) => c.runner === p.runner)?.available ||
              data.tasks.some((t) => t.preparationId === p.id)
            }
            onClick={() =>
              void post("/agents/coding/tasks", {
                preparationId: p.id,
                expectedHash: p.hash,
              }).catch(() => undefined)
            }
          >
            Lancer cette préparation
          </Button>
        </article>
      ))}
      <h3>Worktrees et résultats</h3>
      {data.tasks.map((task) => (
        <article key={task.id}>
          <Button variant="outline" onClick={() => setSelected(task.id)}>
            {task.runner} · {agentStateLabels[task.state]}
          </Button>
          <p>
            Worktree {task.worktree.id} · {dispositionLabels[task.worktree.disposition]} · Nettoyage
            : {cleanupLabels[task.cleanupState]}
          </p>
          {!["succeeded", "failed", "cancelled"].includes(task.state) && (
            <Button
              disabled={blocked}
              onClick={() =>
                void post(`/agents/coding/tasks/${task.id}/cancel`, {}).catch(() => undefined)
              }
            >
              Arrêter
            </Button>
          )}
          {["unknown", "reconciling", "cancel_requested"].includes(task.state) && (
            <Button
              disabled={blocked}
              onClick={() =>
                void post(`/agents/coding/tasks/${task.id}/reconcile`, {}).catch(() => undefined)
              }
            >
              Réconcilier sans relancer
            </Button>
          )}
        </article>
      ))}
      {detail.isError && <Failure error={detail.error} />}
      {detail.data?.result && (
        <article>
          <h3>Preuves retenues</h3>
          <p>{detail.data.result.summary}</p>
          <p>
            Facturation : {accountingLabels[detail.data.result.usage.accounting]} · Aperçu :{" "}
            {detail.data.result.preview.state === "unavailable" ? "indisponible" : "non demandé"}
          </p>
          {detail.data.result.tests.map((test) => (
            <div key={test.profile}>
              <p>
                {test.profile} : {testLabels[test.status]} · sortie{" "}
                {test.exitCode ?? "non exécutée"}
              </p>
              {test.log && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => downloadEvidence(test.log?.content ?? "", "coding-test-log.txt")}
                >
                  Télécharger le journal texte
                </Button>
              )}
            </div>
          ))}
          {detail.data.result.patch && (
            <details>
              <summary>
                Patch · {detail.data.result.patch.bytes} octets · {detail.data.result.patch.sha256}
              </summary>
              <pre>{detail.data.result.patch.content}</pre>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  downloadEvidence(detail.data?.result?.patch?.content ?? "", "coding-patch.txt")
                }
              >
                Télécharger le patch texte
              </Button>
            </details>
          )}
        </article>
      )}
    </section>
  );
}
