import { createFileRoute } from "@tanstack/react-router";
import { AgentsPanel } from "@/components/agents-panel";
import { PageHeading } from "@/components/shared";
import "@/styles/agents-plans.css";
export const Route = createFileRoute("/agents")({ component: Agents });
function Agents() {
  return (
    <>
      <PageHeading
        eyebrow="INTELLIGENCE OPÉRATIONNELLE"
        title="Agent Center"
        description="Profils Hermès liés à vos environnements, tâches bornées et résultats suivis dans un historique privé."
      />
      <AgentsPanel />
    </>
  );
}
