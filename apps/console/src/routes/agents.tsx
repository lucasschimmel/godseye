import { createFileRoute } from "@tanstack/react-router";
import { Bot, ChartNoAxesCombined, Code, ScanLine, ShieldCheck } from "lucide-react";
import { PageHeading, SectionTitle, Status } from "@/components/shared";

export const Route = createFileRoute("/agents")({ component: Agents });
function Agents() {
  return (
    <>
      <PageHeading
        eyebrow="INTELLIGENCE OPÉRATIONNELLE"
        title="Hermes CORE"
        description="Des compétences au service de vos projets, avec un périmètre et un budget explicites."
      />
      <section className="panel agent-introduction">
        <span className="agent-mark">
          <Bot size={36} strokeWidth={1.2} />
        </span>
        <div>
          <Status value="unconfigured" />
          <h2>Votre opérateur, côté serveur</h2>
          <p>
            Hermes exécutera les tâches récurrentes au plus près des services. Chaque mission sera
            rattachée à un projet, une identité, des outils autorisés et une limite de dépense.
          </p>
        </div>
      </section>
      <div className="section-title">
        <h2>Compétences prévues</h2>
        <span className="muted">Activation après qualification</span>
      </div>
      <div className="skill-grid">
        {[
          {
            title: "Sécurité récurrente",
            description:
              "Vérifications ciblées sur vos applications, suivi des dépendances et rapports exploitables.",
            icon: ShieldCheck,
          },
          {
            title: "Analyse des logs",
            description:
              "Repérage des erreurs, regroupement des incidents et suggestions de remédiation.",
            icon: ScanLine,
          },
          {
            title: "Veille & marketing",
            description:
              "Veille concurrentielle, recherche et préparation de contenus à relire avant publication.",
            icon: ChartNoAxesCombined,
          },
          {
            title: "Travaux de développement",
            description:
              "Tâches de code dans un environnement de travail isolé, puis tests et revue.",
            icon: Code,
          },
        ].map(({ title, description, icon: Icon }) => (
          <section className="panel skill-card" key={title}>
            <Icon size={24} strokeWidth={1.4} />
            <h3>{title}</h3>
            <p>{description}</p>
            <Status value="planned" />
          </section>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <SectionTitle>Consommation des modèles</SectionTitle>
          <Status value="unconfigured" />
        </div>
        <div className="metering-empty">
          <strong>—</strong>
          <div>
            <h3>Aucune consommation collectée</h3>
            <p>
              Tokens, coût et durée seront suivis par projet, mission, étape et fournisseur. Laya
              pourra effectuer les décisions simples après qualification de son modèle local.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
