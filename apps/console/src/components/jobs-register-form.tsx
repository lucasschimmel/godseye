import {
  JOB_EFFECT_POLICIES,
  JOB_TRIGGER_KINDS,
  type ProjectDTO,
  RegisterJobDefinition,
  type RegisterJobDefinitionInput,
} from "@godseye/contracts";
import { useState } from "react";
import { effectLabels, triggerLabels } from "./jobs-labels";
import { EmptyState } from "./shared";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const limitFields = [
  { name: "maxConcurrent", label: "Exécutions simultanées", value: 1, min: 1, max: 16 },
  { name: "maxAttempts", label: "Tentatives maximum", value: 3, min: 1, max: 10 },
  { name: "timeoutSeconds", label: "Délai maximal (secondes)", value: 300, min: 1, max: 86400 },
  { name: "retentionDays", label: "Rétention (jours)", value: 30, min: 1, max: 365 },
] as const;
const slugPattern = "[a-z][a-z0-9.\\-]{0,63}";

export function JobsRegisterForm({
  projects,
  heldEnvironmentIds,
  disabled,
  submit,
}: {
  projects: ProjectDTO[];
  heldEnvironmentIds: string[];
  disabled: boolean;
  submit: (input: RegisterJobDefinitionInput) => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [triggerKind, setTriggerKind] = useState<(typeof JOB_TRIGGER_KINDS)[number]>("manual");
  const [problem, setProblem] = useState<string | null>(null);
  const open = (project: ProjectDTO) =>
    project.status === "suspended"
      ? []
      : project.environments.filter(
          (env) => !env.recoveryHold && !env.deliveryHold && !heldEnvironmentIds.includes(env.id),
        );
  const candidates = projects.filter((row) => open(row).length > 0);
  const project = candidates.find((row) => row.id === projectId) ?? candidates[0];
  const environments = project ? open(project) : [];
  const environment = environments.find((row) => row.id === environmentId) ?? environments[0];
  if (!project || !environment)
    return (
      <EmptyState
        title="Aucun environnement admissible"
        description="Créez un projet, ou attendez la fin des protections de restauration ou d’arrêt : aucune définition ne peut être enregistrée sur un environnement suspendu."
      />
    );
  return (
    <section className="panel jobs-form">
      <h2>Nouvelle définition de job</h2>
      <p className="muted">
        Un job est lié à un projet et un environnement. Les identifiants sont en minuscules
        (lettres, chiffres, points, tirets). Aucun secret n’est demandé ici.
      </p>
      <div className="jobs-fields">
        <label htmlFor="jobs-project">
          Projet{" "}
          <select
            id="jobs-project"
            value={project.id}
            onChange={(event) => {
              setProjectId(event.target.value);
              setEnvironmentId("");
            }}
          >
            {candidates.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="jobs-environment">
          Environnement{" "}
          <select
            id="jobs-environment"
            value={environment.id}
            onChange={(event) => setEnvironmentId(event.target.value)}
          >
            {environments.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <form
        className="jobs-fields"
        key={`${project.id}:${environment.id}:${environment.revision}`}
        aria-label="Enregistrer une définition de job"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const trigger =
            triggerKind === "cron"
              ? { kind: "cron", cron: String(data.get("cron")).trim() }
              : triggerKind === "event"
                ? { kind: "event", eventType: String(data.get("eventType")).trim() }
                : { kind: "manual" };
          const parsed = RegisterJobDefinition.safeParse({
            projectId: project.id,
            environmentId: environment.id,
            expectedEnvironmentRevision: environment.revision,
            name: String(data.get("name")).trim(),
            handler: String(data.get("handler")).trim(),
            trigger,
            effectPolicy: String(data.get("effectPolicy")),
            limits: Object.fromEntries(limitFields.map((f) => [f.name, Number(data.get(f.name))])),
          });
          if (!parsed.success) {
            const paths = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
            setProblem(`Vérifiez : ${paths.join(", ")}.`);
            return;
          }
          setProblem(null);
          submit(parsed.data);
        }}
      >
        <label htmlFor="jobs-name">
          Nom du job
          <Input id="jobs-name" name="name" required maxLength={64} pattern={slugPattern} />
        </label>
        <label htmlFor="jobs-handler">
          Gestionnaire (handler)
          <Input id="jobs-handler" name="handler" required maxLength={64} pattern={slugPattern} />
        </label>
        <label htmlFor="jobs-trigger">
          Déclencheur
          <select
            id="jobs-trigger"
            value={triggerKind}
            onChange={(event) =>
              setTriggerKind(event.target.value as (typeof JOB_TRIGGER_KINDS)[number])
            }
          >
            {JOB_TRIGGER_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {triggerLabels[kind]}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="jobs-effect">
          Politique d’effet
          <select id="jobs-effect" name="effectPolicy" defaultValue="idempotent">
            {JOB_EFFECT_POLICIES.map((kind) => (
              <option key={kind} value={kind}>
                {effectLabels[kind]}
              </option>
            ))}
          </select>
        </label>
        {triggerKind === "cron" && (
          <label className="jobs-wide" htmlFor="jobs-cron">
            Expression cron UTC à cinq champs
            <Input
              id="jobs-cron"
              name="cron"
              required
              maxLength={64}
              defaultValue="0 * * * *"
              pattern="([0-9*/,\-]+\s+){4}[0-9*/,\-]+"
            />
          </label>
        )}
        {triggerKind === "event" && (
          <label className="jobs-wide" htmlFor="jobs-event">
            Type d’événement
            <Input id="jobs-event" name="eventType" required maxLength={64} pattern={slugPattern} />
          </label>
        )}
        <div className="jobs-limits">
          {limitFields.map((field) => (
            <label key={field.name} htmlFor={`jobs-${field.name}`}>
              {field.label}
              <Input
                id={`jobs-${field.name}`}
                name={field.name}
                type="number"
                step={1}
                defaultValue={field.value}
                min={field.min}
                max={field.max}
                required
              />
            </label>
          ))}
        </div>
        {problem && (
          <p className="jobs-problem jobs-wide" role="alert">
            {problem}
          </p>
        )}
        <Button className="jobs-submit" disabled={disabled} type="submit">
          Enregistrer la définition
        </Button>
      </form>
    </section>
  );
}
