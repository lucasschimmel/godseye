import { createFileRoute } from "@tanstack/react-router";
import { ObservabilityPanel } from "@/components/observability-panel";
import { PageHeading } from "@/components/shared";
export const Route = createFileRoute("/observability")({ component: ObservabilityPage });
function ObservabilityPage() {
  return (
    <>
      <PageHeading
        eyebrow="OBSERVATIONS ET ALERTES"
        title="Observabilité et incidents"
        description="Sources, mesures locales, événements structurés et chronologie corrélée."
      />
      <ObservabilityPanel />
    </>
  );
}
