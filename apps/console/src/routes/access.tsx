import { createFileRoute, redirect } from "@tanstack/react-router";

/** Former address, kept so bookmarks and links keep working. */
export const Route = createFileRoute("/access")({
  beforeLoad: () => {
    throw redirect({ to: "/settings", search: { section: "services" }, replace: true });
  },
});
