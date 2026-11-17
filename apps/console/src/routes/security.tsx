import { createFileRoute, redirect } from "@tanstack/react-router";

/** Former address, kept so bookmarks and links keep working. */
export const Route = createFileRoute("/security")({
  beforeLoad: () => {
    throw redirect({ to: "/settings", search: { section: "proprietaire" }, replace: true });
  },
});
