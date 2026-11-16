import type { AccessHealthView, ServiceIdentity } from "@godseye/contracts";

export type AccessScope = Pick<
  ServiceIdentity,
  "projectId" | "environmentId" | "purpose" | "id"
> & { slotId: string };
export interface AccessEnvelope {
  value: string;
  operationId: string;
  fingerprint: string;
}
export interface AccessVersion extends AccessEnvelope {
  version: number;
}
/** Private provider boundary. Implementations never place material in errors or logs. */
export interface AccessProvider {
  health(): Promise<AccessHealthView>;
  read(scope: AccessScope, version?: number): Promise<AccessVersion | null>;
  write(scope: AccessScope, envelope: AccessEnvelope, cas: number): Promise<number>;
}
export interface StaticTransitionContext {
  operationId: string;
  scope: AccessScope;
  candidateVersion: number;
  previousVersion: number | null;
}
export type StaticTransitionResult =
  | {
      status: "succeeded";
      operationId: string;
      candidateVersion: number;
      transitioned: true;
      oldAccessRevoked: true;
      evidence: string;
    }
  | {
      status: "failed";
      operationId?: string;
      candidateVersion?: number;
      previousAccessPreserved?: true;
      phase?: "readiness";
      evidence?: string;
    }
  | { status: "unknown" };
/** Qualified adapters own real target handoff AND old upstream access revocation. */
export interface StaticTransitionAdapter {
  id: string;
  qualified: boolean;
  transition(
    context: StaticTransitionContext,
    candidate: string,
    previous: string | null,
  ): Promise<StaticTransitionResult>;
  reconcile(context: StaticTransitionContext): Promise<StaticTransitionResult>;
}
