import { createFileRoute, redirect } from "@tanstack/react-router";

/** Former address, kept so bookmarks and links keep working. */
export const Route = createFileRoute("/agents")({
  beforeLoad: () => {
    throw redirect({ to: "/hermes", replace: true });
  },
});
