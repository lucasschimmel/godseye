import { createAuthClient } from "better-auth/react";

/** Browser client for the same-origin /api/auth routes. */
export const authClient = createAuthClient({ basePath: "/api/auth" });
