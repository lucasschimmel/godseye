import { createFileRoute, redirect } from "@tanstack/react-router";

/** Former address, kept so bookmarks and links keep working. */
export const Route = createFileRoute("/databases")({
  beforeLoad: () => {
    throw redirect({ to: "/platform/data", replace: true });
  },
});
