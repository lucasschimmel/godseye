import { createFileRoute } from "@tanstack/react-router";
import { JobsPanel } from "@/components/jobs-panel";
import { PageHeading } from "@/components/shared";

export const Route = createFileRoute("/platform/jobs")({ component: Jobs });
function Jobs() {
  return (
    <>
      <PageHeading
        eyebrow="Plateforme"
        title="Jobs"
        description="Tâches planifiées ou manuelles. Un résultat inconnu n’est jamais relancé à l’aveugle."
      />
      <JobsPanel />
    </>
  );
}
