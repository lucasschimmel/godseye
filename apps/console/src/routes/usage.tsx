import { createFileRoute, redirect } from "@tanstack/react-router";

/** Former address, kept so bookmarks and links keep working. */
export const Route = createFileRoute("/usage")({
  beforeLoad: () => {
    throw redirect({ to: "/costs", replace: true });
  },
});
