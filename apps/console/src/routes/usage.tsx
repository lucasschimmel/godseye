import { createFileRoute } from "@tanstack/react-router";
import { PageHeading } from "@/components/shared";
import { UsagePanel } from "@/components/usage-panel";
export const Route = createFileRoute("/usage")({ component: UsagePage });
function UsagePage() {
  return (
    <>
      <PageHeading
        eyebrow="COMPTABILITÉ LOCALE"
        title="Consommation et budgets"
        description="Usage constaté, estimations, obligations et factures importées restent distincts."
      />
      <UsagePanel />
    </>
  );
}
