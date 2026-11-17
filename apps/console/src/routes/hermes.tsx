import { createFileRoute } from "@tanstack/react-router";
import { AgentsPanel, HERMES_VIEWS, type HermesView } from "@/components/agents-panel";

export const Route = createFileRoute("/hermes")({
  validateSearch: (search: Record<string, unknown>): { vue?: HermesView } => ({
    vue:
      typeof search.vue === "string" && search.vue in HERMES_VIEWS
        ? (search.vue as HermesView)
        : undefined,
  }),
  component: Hermes,
});

function Hermes() {
  const { vue = "conversations" } = Route.useSearch();
  return <AgentsPanel view={vue} />;
}
