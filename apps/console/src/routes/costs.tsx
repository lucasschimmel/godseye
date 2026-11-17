import { createFileRoute } from "@tanstack/react-router";
import { PageHeading } from "@/components/shared";
import { UsagePanel } from "@/components/usage-panel";
export const Route = createFileRoute("/costs")({ component: UsagePage });
function UsagePage() {
  return (
    <>
      <PageHeading
        eyebrow="Suivi"
        title="Coûts"
        description="Usage constaté, estimations, budgets et factures restent distincts."
      />
      <UsagePanel />
    </>
  );
}
