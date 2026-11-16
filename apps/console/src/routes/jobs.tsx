import { createFileRoute } from "@tanstack/react-router";
import { JobsPanel } from "@/components/jobs-panel";
import { PageHeading } from "@/components/shared";

export const Route = createFileRoute("/jobs")({ component: Jobs });
function Jobs() {
  return (
    <>
      <PageHeading
        eyebrow="TRAVAUX DURABLES"
        title="Jobs"
        description="Tâches planifiées ou manuelles, exécutions et effets sortants, avec un état toujours exact et jamais relancé à l’aveugle."
      />
      <JobsPanel />
    </>
  );
}
