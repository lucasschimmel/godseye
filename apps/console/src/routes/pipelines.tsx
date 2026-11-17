import { createFileRoute, redirect } from "@tanstack/react-router";

/** Former address, kept so bookmarks and links keep working. */
export const Route = createFileRoute("/pipelines")({
  beforeLoad: () => {
    throw redirect({ to: "/platform/delivery", replace: true });
  },
});
