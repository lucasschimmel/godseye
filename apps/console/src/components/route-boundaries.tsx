import type { ErrorComponentProps } from "@tanstack/react-router";
import { Failure, Loading } from "./shared";

/** Generic per-route error boundary: shows the failure inside the shell with a retry. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  return (
    <Failure
      error={error instanceof Error ? error : new Error("Le panneau n’a pas pu être chargé.")}
      retry={reset}
    />
  );
}

/** Generic per-route pending state, shown while a route transition is slow. */
export function RoutePending() {
  return <Loading />;
}
