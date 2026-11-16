import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { OwnerGate } from "@/components/owner-gate";
import { Shell } from "@/components/shell";
import styles from "../styles.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "G.O.D.S.E.Y.E — Centre de contrôle" },
    ],
    links: [{ rel: "stylesheet", href: styles }],
  }),
  component: Root,
  notFoundComponent: () => (
    <div className="empty-state">
      <h1>Page introuvable</h1>
      <a href="/">Revenir au centre de contrôle</a>
    </div>
  ),
  errorComponent: () => (
    <div className="empty-state">
      <h1>Le panneau n’a pas pu être chargé.</h1>
      <a href="/">Réessayer</a>
    </div>
  ),
});

function Root() {
  const { queryClient } = Route.useRouteContext();
  return (
    <html lang="fr">
      <head>
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <OwnerGate>
            <Shell>
              <Outlet />
            </Shell>
          </OwnerGate>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
