import { createFileRoute } from "@tanstack/react-router";
import { getRuntime } from "../../../server/runtime";

/** Better Auth's HTTP surface (sign-up, sign-in, sign-out, session) under /api/auth. */
async function handle({ request }: { request: Request }) {
  const { auth } = await getRuntime();
  return auth.handler(request);
}

export const Route = createFileRoute("/api/auth/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
