import type { Overview } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { resource } from "./api";
import { type Deployment, describeDeployment } from "./deployment";

/** Deployment mode from the shared, cached /overview query (same key as the dashboard). */
export function useDeployment(): Deployment {
  const overview = useQuery(resource<Overview>("overview", "/overview"));
  return describeDeployment(overview.data);
}
