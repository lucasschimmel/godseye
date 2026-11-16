import { CreateProject, type ProjectView } from "@godseye/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Box, Check, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { Failure, PageHeading } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useDeployment } from "@/lib/use-deployment";

export const Route = createFileRoute("/projects/new")({ component: NewProject });
function NewProject() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [kind, setKind] = useState<"web" | "api" | "worker">("web");
  const [description, setDescription] = useState("");
  const [validationError, setValidationError] = useState("");
  const key = useRef<string | null>(null);
  const submitted = useRef("");
  const navigate = useNavigate();
  const cache = useQueryClient();
  const deployment = useDeployment();
  const mutation = useMutation({
    mutationFn: (body: string) =>
      api<ProjectView>("/projects", {
        method: "POST",
        body,
        headers: { "idempotency-key": key.current ?? "" },
      }),
    onSuccess: async (project) => {
      await cache.invalidateQueries();
      await navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
    },
  });
  function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = CreateProject.safeParse({ name, slug, kind, description });
    if (!parsed.success) {
      setValidationError(
        "Le nom doit contenir au moins 2 caractères. L’identifiant doit commencer par une lettre et contenir 2 à 63 lettres minuscules, chiffres ou tirets.",
      );
      return;
    }
    setValidationError("");
    const body = JSON.stringify(parsed.data);
    if (!key.current || submitted.current !== body) {
      key.current = crypto.randomUUID();
      submitted.current = body;
    }
    mutation.mutate(body);
  }
  return (
    <>
      <Link to="/projects" className="back-link">
        <ArrowLeft size={14} /> Projets
      </Link>
      <PageHeading
        eyebrow="NOUVEAU PROJET"
        title="Un nouvel espace pour votre projet"
        description="Préparez sa configuration. Vous pourrez ensuite associer un dépôt GitHub."
      />
      <div className="form-layout">
        <form className="panel project-form" onSubmit={submit}>
          <div className="form-section">
            <h2>Informations du projet</h2>
            <p>Ces informations identifient votre projet dans le panneau.</p>
          </div>
          <div className="field">
            <label htmlFor="project-name">Nom du projet</label>
            <Input
              id="project-name"
              autoComplete="off"
              placeholder="Mon application"
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(event) => {
                const next = event.target.value;
                setName(next);
                if (
                  !slug ||
                  slug ===
                    name
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/-$/, "")
                )
                  setSlug(
                    next
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/-$/, ""),
                  );
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="project-slug">Identifiant</label>
            <Input
              id="project-slug"
              className="mono"
              autoComplete="off"
              placeholder="mon-application"
              required
              minLength={2}
              maxLength={63}
              pattern="[a-z][a-z0-9-]{1,62}"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
            />
            <small>Lettres minuscules, chiffres et tirets. Unique dans votre espace.</small>
          </div>
          <fieldset className="field">
            <legend>Type de service</legend>
            <div className="type-selector">
              {[
                { value: "web", title: "Site web", note: "Front-end & application" },
                { value: "api", title: "Back-end", note: "API & services" },
                { value: "worker", title: "Worker", note: "Tâches de fond" },
              ].map((type) => (
                <label
                  key={type.value}
                  className={kind === type.value ? "type-option selected" : "type-option"}
                >
                  <input
                    type="radio"
                    name="kind"
                    value={type.value}
                    checked={kind === type.value}
                    onChange={() => setKind(type.value as typeof kind)}
                  />
                  <Box size={18} />
                  <strong>{type.title}</strong>
                  <small>{type.note}</small>
                  {kind === type.value && <Check size={13} className="type-check" />}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="field">
            <label htmlFor="project-description">
              Description <span>(facultatif)</span>
            </label>
            <Textarea
              id="project-description"
              rows={3}
              maxLength={500}
              placeholder="À quoi sert ce projet ?"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {validationError && (
            <p className="error-message" role="alert">
              {validationError}
            </p>
          )}
          {mutation.isError && <Failure error={mutation.error} />}
          <div className="form-actions">
            <Button variant="ghost" asChild>
              <Link to="/projects">Annuler</Link>
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Enregistrement…" : "Enregistrer le projet"}
              <ArrowRight size={15} />
            </Button>
          </div>
        </form>
        <aside className="form-aside">
          <span className="aside-icon">
            <ShieldCheck size={26} strokeWidth={1.3} />
          </span>
          <h2>Un espace dédié à chaque projet</h2>
          <p>Deux environnements sont préparés : développement et production.</p>
          <ul>
            <li>Configurations séparées</li>
            <li>Base PostgreSQL prévue par environnement</li>
            <li>Réseaux et identités distincts</li>
            <li>Tâches Inngest propres au projet</li>
          </ul>
          <div className="soft-note">
            {deployment.isLocal
              ? "Le provisionnement et les garanties d’isolation seront activés après qualification sur le serveur."
              : "Le provisionnement et les garanties d’isolation suivent la qualification du serveur dédié ; le projet est d’abord enregistré dans le registre du contrôleur."}
          </div>
        </aside>
      </div>
    </>
  );
}
