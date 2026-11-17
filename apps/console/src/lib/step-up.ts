import { isStepUpRequired } from "./api";

/**
 * Step-up requests. A refused sensitive action (STEP_UP_REQUIRED) asks the shell to show one
 * passkey sheet describing the action. Nothing is retried when the owner cancels or the
 * ceremony fails; a confirmed request is retried exactly once.
 */
export interface StepUpRequest {
  title: string;
  detail?: string;
  /** Re-run the refused action after a successful ceremony. */
  retry?: () => Promise<unknown>;
  /** Called once with the ceremony outcome (true when confirmed). */
  settle?: (confirmed: boolean) => void;
}

type Listener = (request: StepUpRequest) => void;
let listener: Listener | undefined;

export function onStepUpRequest(next: Listener): () => void {
  listener = next;
  return () => {
    if (listener === next) listener = undefined;
  };
}

export function requestStepUp(request: StepUpRequest): boolean {
  if (!listener) return false;
  listener(request);
  return true;
}

/** Opens the passkey sheet and resolves with whether the owner confirmed. */
export function confirmIdentity(title: string, detail?: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!requestStepUp({ title, detail, settle: resolve })) resolve(false);
  });
}

/** Runs `work`; when the server asks for a recent passkey, confirms and runs it once more. */
export async function withStepUp<T>(title: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!isStepUpRequired(error)) throw error;
    if (!(await confirmIdentity(title))) throw error;
    return work();
  }
}

/** Mutation meta marking callers that handle the step-up themselves (see withStepUp). */
export const MANUAL_STEP_UP = { stepUp: "manual" } as const;
