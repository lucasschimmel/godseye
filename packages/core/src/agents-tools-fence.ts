import {
  AGENT_TOOL_DESTINATION,
  type AgentToolName,
  type ExecutionContext,
} from "@godseye/contracts";
import type { DatabaseAccess } from "@godseye/store";
import type { AgentState } from "./agents-state.js";
import { DomainError } from "./errors.js";
import { runFor } from "./foundation-data.js";

/** Last transaction await is followed by synchronous time/abort checks before commit. */
export async function assertToolCommitFence(
  state: AgentState,
  tx: DatabaseAccess,
  context: ExecutionContext,
  tool: AgentToolName,
  deadline: string,
  signal: AbortSignal,
) {
  const grant = await state.foundation.assertDispatch(tx, context, {
    actorId: context.workerId,
    tool,
    destination: AGENT_TOOL_DESTINATION,
    costMicros: 0,
  });
  const { run } = await runFor(tx, context.runId);
  const now = state.now().getTime();
  if (
    signal.aborted ||
    grant.expiresAt.getTime() <= now ||
    !run.leaseExpiresAt ||
    run.leaseExpiresAt.getTime() <= now ||
    new Date(deadline).getTime() <= now
  )
    throw new DomainError("FENCED", "Task tool authority expired before transaction commit", 409);
}
