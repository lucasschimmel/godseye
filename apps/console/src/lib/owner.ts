import { passkeyClient } from "@better-auth/passkey/client";
import {
  OWNER_AUTH_REQUIRED_EVENT,
  OWNER_SESSION_QUERY,
  type OwnerStatusView,
} from "@godseye/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { createAuthClient } from "better-auth/client";

export const ownerAuth = createAuthClient({ basePath: "/api/auth", plugins: [passkeyClient()] });
export function forgetOwnerData(cache: QueryClient, status: OwnerStatusView) {
  cache.removeQueries({ predicate: (query) => query.queryKey[0] !== OWNER_SESSION_QUERY });
  cache.setQueryData([OWNER_SESSION_QUERY], {
    authenticated: false,
    configured: status.configured,
    origin: status.origin,
  });
}
export function ownerAuthenticationRequired() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OWNER_AUTH_REQUIRED_EVENT));
}
