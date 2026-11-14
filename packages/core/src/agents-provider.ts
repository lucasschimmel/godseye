import type { AgentProfileView, AgentTaskToolSelection, AgentToolCall } from "@godseye/contracts";

/** Exact immutable server-owned profile; providers cannot choose a different scope or policy. */
export type AgentProviderProfile = Omit<
  AgentProfileView,
  "runtime" | "createdAt" | "updatedAt" | "busy" | "activeTaskId"
>;
export interface AgentProviderRequest {
  conversation?: { id: string; history: { role: "user" | "assistant"; content: string }[] };
  taskId: string;
  profile: AgentProviderProfile;
  input: string;
  /** Stable across uncertainty and process restarts; use for upstream session/idempotency identity. */
  correlationId: string;
  providerRunId: string | null;
  deadline: string;
  toolGrant?: AgentTaskToolSelection;
  toolPolicyHash?: string;
}
export interface AgentObservation {
  attempts?: import("@godseye/contracts").AttemptOutcomeInput[];
  state: "running" | "succeeded" | "failed" | "cancelled" | "unknown";
  providerRunId: string | null;
  output?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Terminal observations must prove the physical executor is no longer active. */
  stopped: boolean;
}
export interface AgentProviderEvent {
  type: "text.delta";
  sequence: number;
  providerRunId: string;
  text: string;
}
export interface AgentProviderContext {
  attempts?: import("@godseye/contracts").UsageAttemptReporter;
  /** Once, after native boot and before the first model POST; unavailable tools deny that POST. */
  prepareTools?(): Promise<void>;
  onToolCall?(call: AgentToolCall): Promise<string>;
  onEvent?(event: AgentProviderEvent): Promise<void>;
  signal: AbortSignal;
  /** Must be awaited after preparation and again immediately before physical submission. */
  assertActive(): Promise<void>;
}
export interface AgentProvider {
  readonly qualified: boolean;
  /** Pure local admission test: no network, filesystem mutation, secret disclosure or scope expansion. */
  supports(profile: AgentProviderProfile): boolean;
  submit(request: AgentProviderRequest, context: AgentProviderContext): Promise<AgentObservation>;
  /** Read-only: must never create/restart a gateway, renew grants or replay POST submission. */
  inspect(request: AgentProviderRequest, signal: AbortSignal): Promise<AgentObservation>;
  /** Protective stop of only this exact retained task; acknowledgment is not terminal proof. */
  stop(request: AgentProviderRequest, signal: AbortSignal): Promise<AgentObservation>;
}
