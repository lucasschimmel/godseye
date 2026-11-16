import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { RouteError, RoutePending } from "@/components/route-boundaries";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } });
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
