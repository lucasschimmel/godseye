import geist from "@fontsource-variable/geist/index.css?url";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import styles from "../styles.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "color-scheme", content: "dark" },
      { title: "G.O.D.S.E.Y.E — Boards" },
    ],
    links: [
      { rel: "stylesheet", href: geist },
      { rel: "stylesheet", href: styles },
    ],
  }),
  component: Root,
  notFoundComponent: () => (
    <main className="page">
      <h1>Page introuvable</h1>
      <p>
        <a href="/">Revenir à mes boards</a>
      </p>
    </main>
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
          <Outlet />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
