import type { OperationState } from "@godseye/contracts";
import { DomainError } from "./errors.js";

const transitions: Record<OperationState, readonly OperationState[]> = {
  queued: ["validating", "cancel_requested", "failed"],
  validating: ["running", "awaiting_approval", "failed", "cancel_requested"],
  running: ["waiting", "succeeded", "failed", "unknown", "cancel_requested"],
  waiting: ["running", "failed", "unknown", "cancel_requested"],
  awaiting_approval: ["running", "failed", "cancel_requested"],
  cancel_requested: ["cancelled", "unknown", "failed"],
  unknown: ["reconciling"],
  reconciling: ["succeeded", "failed", "cancelled", "unknown"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export function assertTransition(from: OperationState, to: OperationState): void {
  if (!transitions[from].includes(to)) {
    throw new DomainError("INVALID_TRANSITION", `Cannot transition ${from} to ${to}`, 409);
  }
}

export interface Actor {
  id: string;
  kind: "owner" | "service";
  projectIds: readonly string[];
  sessionId?: string;
  authenticatedAt?: string;
}
export function assertProjectAccess(actor: Actor, projectId: string): void {
  if (actor.kind !== "owner" && !actor.projectIds.includes(projectId)) {
    throw new DomainError("FORBIDDEN", "Project access is not granted", 403);
  }
}

export function assertOwner(actor: Actor): void {
  if (actor.kind !== "owner") throw new DomainError("FORBIDDEN", "Owner access is required", 403);
}
