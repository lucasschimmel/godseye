import { MutationCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { RouteError, RoutePending } from "@/components/route-boundaries";
import { isStepUpRequired } from "@/lib/api";
import { requestStepUp } from "@/lib/step-up";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 10_000 } },
    mutationCache: new MutationCache({
      // A refused sensitive action opens the shell's passkey sheet; nothing ran server-side,
      // so the same mutation may be executed again once the owner has confirmed.
      onError: (error, variables, _context, mutation) => {
        if (!isStepUpRequired(error) || mutation.meta?.stepUp === "manual") return;
        requestStepUp({
          title: "Confirmer cette action",
          detail: "Cette action modifie votre infrastructure. Elle exige une confirmation récente.",
          retry: () => mutation.execute(variables),
        });
      },
    }),
  });
  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultErrorComponent: RouteError,
    defaultPendingComponent: RoutePending,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
