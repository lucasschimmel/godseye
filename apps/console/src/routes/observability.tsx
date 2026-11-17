import { createFileRoute, redirect } from "@tanstack/react-router";

/** Former address, kept so bookmarks and links keep working. */
export const Route = createFileRoute("/observability")({
  beforeLoad: () => {
    throw redirect({ to: "/journal", search: { vue: "observabilite" }, replace: true });
  },
});
