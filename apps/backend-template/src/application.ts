import { type LocalApplicationOptions, openLocalApplication } from "@godseye/app-backend";
import { z } from "zod";

/** Extend explicit authenticated domain routes, not arbitrary database tables. */
export function createTemplateApplication(options: LocalApplicationOptions) {
  return openLocalApplication({
    ...options,
    routes(registry) {
      registry.get(
        "/hello",
        z.object({ message: z.string(), userId: z.string() }).strict(),
        async ({ user }) => ({
          message: `Hello, ${user.name}`,
          userId: user.id,
        }),
      );
      options.routes?.(registry);
    },
  });
}
