import {
  ImportUsageInvoice,
  type ProjectDTO,
  PutUsageBudget,
  PutUsagePrice,
  USAGE_CATEGORIES,
  type UsageBudgetView,
} from "@godseye/contracts";
import { useState } from "react";
import type { AgentPost } from "./agents-labels";
import { Failure } from "./shared";
import { Field, micros } from "./telemetry-shared";
import { Button } from "./ui/button";

type FormProps = { post: AgentPost; disabled: boolean };
function ProjectSelect({ projects, value }: { projects: ProjectDTO[]; value?: string }) {
  return (
    <label>
      Projet
      <select name="projectId" required defaultValue={value ?? ""}>
        <option value="" disabled>
          Choisir un projet
        </option>
        {projects.map((p) => (
          <option value={p.id} key={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
function useFormAction(post: AgentPost) {
  const [problem, setProblem] = useState<Error | null>(null);
  const [success, setSuccess] = useState(false);
  return {
    problem,
    success,
    run: async (action: () => Promise<unknown>) => {
      setProblem(null);
      setSuccess(false);
      try {
        await action();
        setSuccess(true);
      } catch (error) {
        setProblem(error instanceof Error ? error : new Error("La demande n’a pas été confirmée."));
      }
    },
    post,
  };
}
function FormFeedback({ action }: { action: ReturnType<typeof useFormAction> }) {
  return (
    <>
      {action.problem && <Failure error={action.problem} />}
      {action.success && <p role="status">Enregistrement confirmé.</p>}
    </>
  );
}

export function BudgetForm({
  projects,
  budgets,
  post,
  disabled,
  fresh,
}: FormProps & { projects: ProjectDTO[]; budgets: UsageBudgetView[]; fresh: boolean }) {
  const [selected, select] = useState("");
  const budget = budgets.find((b) => b.id === selected);
  const action = useFormAction(post);
  return (
    <section className="panel telemetry-section">
      <h2>Limites de consommation</h2>
      <p>
        Les montants sont des micro-dollars entiers. Réduction ou extension conserve les obligations
        existantes. Une extension exige une identité propriétaire récente.
      </p>
      <p className="muted">
        Si une autre session modifie ce budget, les champs sont réinitialisés à la nouvelle
        révision. Vérifiez ces valeurs avant d’enregistrer à nouveau.
      </p>
      <label>
        Budget à modifier
        <select value={selected} onChange={(e) => select(e.target.value)}>
          <option value="">Nouveau budget</option>
          {budgets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.scope} · {b.scopeId} · révision {b.revision}
            </option>
          ))}
        </select>
      </label>
      <form
        key={`${selected || "new"}:${budget?.revision ?? 0}`}
        className="telemetry-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void action.run(async () => {
            const projectId = String(f.get("projectId"));
            const scope = String(f.get("scope"));
            const parsed = PutUsageBudget.safeParse({
              projectId,
              scope,
              scopeId: scope === "project" ? projectId : String(f.get("scopeId")),
              expectedRevision: Number(f.get("expectedRevision")),
              limitMicros: Number(f.get("limitMicros")),
              windowSeconds: Number(f.get("windowSeconds")),
              maxRuns: Number(f.get("maxRuns")),
              maxConcurrent: Number(f.get("maxConcurrent")),
            });
            if (!parsed.success)
              throw new Error(
                "Vérifiez le périmètre, les limites entières et la fenêtre (60 à 2678400 secondes).",
              );
            const expansion =
              !budget ||
              parsed.data.limitMicros > budget.limitMicros ||
              parsed.data.maxRuns > budget.maxRuns ||
              parsed.data.maxConcurrent > budget.maxConcurrent ||
              parsed.data.windowSeconds < budget.windowSeconds;
            if (expansion && !fresh)
              throw new Error("Confirmez votre identité avant d’étendre le budget.");
            await post("/usage/budgets", parsed.data, "PUT");
          });
        }}
      >
        <input type="hidden" name="expectedRevision" defaultValue={budget?.revision ?? 0} />
        <ProjectSelect projects={projects} value={budget?.projectId} />
        <label>
          Périmètre
          <select name="scope" defaultValue={budget?.scope ?? "project"}>
            <option value="project">Projet</option>
            <option value="profile">Profil</option>
            <option value="runner">Runner</option>
          </select>
        </label>
        <Field
          name="scopeId"
          label="Profil ou runner (codex / claude-code)"
          value={budget?.scopeId}
          required={false}
        />
        <Field
          name="limitMicros"
          label="Plafond (µUSD)"
          type="number"
          value={budget?.limitMicros}
        />
        <Field
          name="windowSeconds"
          label="Fenêtre (secondes)"
          type="number"
          value={budget?.windowSeconds}
        />
        <Field
          name="maxRuns"
          label="Exécutions par fenêtre"
          type="number"
          value={budget?.maxRuns}
        />
        <Field
          name="maxConcurrent"
          label="Exécutions simultanées"
          type="number"
          value={budget?.maxConcurrent}
        />
        <p>
          Révision attendue : {budget?.revision ?? 0}.{" "}
          {budget &&
            `Dépensé ${micros(budget.spentMicros)}, réservé ${micros(budget.reservedMicros)}.`}
        </p>
        <Button disabled={disabled}>Enregistrer les limites</Button>
      </form>
      <FormFeedback action={action} />
    </section>
  );
}

export function PriceForm({ post, disabled }: FormProps) {
  const action = useFormAction(post);
  return (
    <details className="panel telemetry-section">
      <summary>Ajouter une révision tarifaire</summary>
      <p>
        Catalogue revu par le propriétaire, sans prix fournisseur automatique. Une catégorie vide
        reste inconnue ; zéro signifie gratuit. Aucun modèle par défaut n’est modifié.
      </p>
      <form
        className="telemetry-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void action.run(async () => {
            const rates = Object.fromEntries(
              USAGE_CATEGORIES.map((k) => [k, f.get(k) === "" ? null : Number(f.get(k))]),
            );
            const ttl = String(f.get("cacheWriteTtl"));
            const result = PutUsagePrice.safeParse({
              provider: f.get("provider"),
              model: f.get("model"),
              currency: "USD",
              revision: f.get("revision"),
              source: f.get("source"),
              reviewedAt: new Date(String(f.get("reviewedAt"))).toISOString(),
              expiresAt: new Date(String(f.get("expiresAt"))).toISOString(),
              ratesMicrosPerMillion: rates,
              ...(ttl ? { cacheWriteTtl: ttl } : {}),
            });
            if (!result.success)
              throw new Error(
                "Vérifiez les tarifs entiers, la source et une expiration postérieure à la revue.",
              );
            await post("/usage/prices", result.data);
          });
        }}
      >
        <label>
          Fournisseur
          <select name="provider">
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </label>
        <Field name="model" label="Modèle exact" />
        <Field name="revision" label="Révision" />
        <Field name="source" label="Source du tarif" />
        <Field name="reviewedAt" label="Revu le" type="datetime-local" />
        <Field name="expiresAt" label="Expire le" type="datetime-local" />
        {USAGE_CATEGORIES.map((k) => (
          <Field key={k} name={k} label={`${k} · µUSD / million`} type="number" required={false} />
        ))}
        <label>
          TTL écriture cache
          <select name="cacheWriteTtl">
            <option value="">Non renseigné</option>
            <option value="5m">5 minutes</option>
            <option value="1h">1 heure</option>
          </select>
        </label>
        <Button disabled={disabled}>Ajouter le tarif</Button>
      </form>
      <FormFeedback action={action} />
    </details>
  );
}

export function InvoiceForm({ projects, post, disabled }: FormProps & { projects: ProjectDTO[] }) {
  const action = useFormAction(post);
  const [rows, setRows] = useState(["initial-line"]);
  return (
    <details className="panel telemetry-section">
      <summary>Importer une facture</summary>
      <p>
        Import local déclaré par l’opérateur ou fixture : aucune vérification du compte fournisseur.
        La réconciliation ne rembourse pas les charges conservatrices.
      </p>
      <form
        className="telemetry-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void action.run(async () => {
            const result = ImportUsageInvoice.safeParse({
              projectId: f.get("projectId"),
              provider: f.get("provider"),
              currency: "USD",
              invoiceId: f.get("invoiceId"),
              source: f.get("source"),
              periodStart: new Date(String(f.get("periodStart"))).toISOString(),
              periodEnd: new Date(String(f.get("periodEnd"))).toISOString(),
              lines: rows.map((id) => ({
                lineId: f.get(`line-${id}`),
                attemptId: f.get(`attempt-${id}`) || null,
                amountMicros: Number(f.get(`amount-${id}`)),
              })),
            });
            if (!result.success)
              throw new Error("Vérifiez le projet, les dates et chaque ligne de facture.");
            await post("/usage/invoices", result.data);
          });
        }}
      >
        <ProjectSelect projects={projects} />
        <label>
          Fournisseur
          <select name="provider">
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </label>
        <Field name="invoiceId" label="Identifiant facture" />
        <label>
          Origine
          <select name="source">
            <option value="operator-import">Import opérateur</option>
            <option value="fixture">Fixture locale</option>
          </select>
        </label>
        <Field name="periodStart" label="Début de période" type="datetime-local" />
        <Field name="periodEnd" label="Fin de période" type="datetime-local" />
        {rows.map((id, i) => (
          <fieldset key={id}>
            <legend>Ligne {i + 1}</legend>
            <Field name={`line-${id}`} label="Identifiant de ligne" />
            <Field name={`attempt-${id}`} label="Tentative liée (facultatif)" required={false} />
            <Field name={`amount-${id}`} label="Montant (µUSD)" type="number" />
            <Button
              type="button"
              variant="outline"
              disabled={rows.length === 1}
              onClick={() => setRows(rows.filter((r) => r !== id))}
            >
              Retirer cette ligne
            </Button>
          </fieldset>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={rows.length >= 500}
          onClick={() => setRows([...rows, crypto.randomUUID()])}
        >
          Ajouter une ligne
        </Button>
        <Button disabled={disabled}>Importer la facture</Button>
      </form>
      <FormFeedback action={action} />
    </details>
  );
}
