import type {
  CodingPreparationView,
  CodingProvider,
  CodingProviderRequest,
  CodingTaskView,
} from "@godseye/contracts";
import { CodingPreparation, CodingQualification, CodingTask } from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { DomainError } from "./errors.js";
import { environmentFor, type FoundationState } from "./foundation-data.js";
import type { FoundationEngine } from "./foundations.js";
import { fingerprint } from "./journal.js";
import type { Actor } from "./policy.js";

export const CODING_ADAPTER_ID = "local.coding";
export const CODING_TOOL = "coding.execute";
export const CODING_DESTINATION = "coding.task";
export const CODING_TERMINAL = ["succeeded", "failed", "cancelled"];
export function validateCodingQualification(
  state: CodingState,
  preparation: CodingPreparationView,
  raw: unknown,
) {
  const q = CodingQualification.parse(raw);
  const now = state.now().getTime();
  if (
    q.runner !== preparation.runner ||
    q.preparationHash !== preparation.hash ||
    q.repositoryHash !== preparation.repositoryHash ||
    q.commitSha !== preparation.commitSha ||
    Date.parse(q.observedAt) > now ||
    Date.parse(q.expiresAt) <= now ||
    now - Date.parse(q.observedAt) > 60000 ||
    q.network !== "broker-only"
  )
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "Coding qualification is stale or outside the admitted scope",
      503,
    );
  const capacity = state.capacity;
  if (
    !capacity ||
    !Object.values(capacity).every((value) => Number.isSafeInteger(value) && value > 0) ||
    q.resources.memoryMiB + capacity.vmmOverheadMiB > capacity.memoryMiB ||
    q.resources.cpuMilliCores > capacity.cpuMilliCores ||
    q.resources.maxProcesses > capacity.maxProcesses ||
    q.resources.diskMiB > capacity.diskMiB
  )
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "Coding resource pool including VMM overhead is unavailable",
      503,
    );
  return q;
}
export interface CodingCapacity {
  memoryMiB: number;
  cpuMilliCores: number;
  maxProcesses: number;
  diskMiB: number;
  vmmOverheadMiB: number;
}
export interface CodingOptions {
  provider?: CodingProvider;
  now?: () => Date;
  capacity?: CodingCapacity;
}
export interface CodingState {
  store: Store;
  foundation: FoundationEngine;
  request: FoundationState;
  now: () => Date;
  provider?: CodingProvider;
  capacity?: CodingCapacity;
  calls: Map<string, Promise<unknown>>;
  aborts: Map<string, AbortController>;
}
export async function preparationFor(tx: DatabaseAccess, id: string) {
  const [row] = await tx
    .select()
    .from(schema.codingPreparations)
    .where(eq(schema.codingPreparations.id, id));
  if (!row) throw new DomainError("NOT_FOUND", "Coding preparation not found", 404);
  const p = CodingPreparation.parse(row.metadata);
  const { hash, ...body } = p;
  if (hash !== fingerprint(body) || p.repositoryHash !== fingerprint(p.repository))
    throw new DomainError("FENCED", "Coding preparation integrity mismatch", 409);
  return p;
}
export async function codingTaskFor(tx: DatabaseAccess, id: string) {
  const [row] = await tx.select().from(schema.codingTasks).where(eq(schema.codingTasks.id, id));
  if (!row) throw new DomainError("NOT_FOUND", "Coding task not found", 404);
  const task = CodingTask.parse(row.metadata);
  if (
    task.id !== row.id ||
    task.runId !== row.runId ||
    task.preparationId !== row.preparationId ||
    task.projectId !== row.projectId
  )
    throw new DomainError("FENCED", "Coding task identity mismatch", 409);
  return { row, task };
}
export async function updateCodingTask(
  state: CodingState,
  tx: DatabaseAccess,
  task: CodingTaskView,
  change: Partial<CodingTaskView>,
) {
  const metadata = CodingTask.parse({ ...task, ...change, updatedAt: state.now().toISOString() });
  await tx
    .update(schema.codingTasks)
    .set({ metadata, runId: metadata.runId })
    .where(eq(schema.codingTasks.id, task.id));
  return metadata;
}
export async function codingScope(
  state: CodingState,
  tx: DatabaseAccess,
  actor: Actor,
  p: Pick<
    CodingPreparationView,
    "projectId" | "environmentId" | "expectedProjectRevision" | "expectedEnvironmentRevision"
  >,
  repositoryHash?: string,
) {
  const environment = await environmentFor(
    tx,
    actor,
    p.projectId,
    p.environmentId,
    false,
    false,
    state.now(),
  );
  const [project] = await tx
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, p.projectId));
  if (!project?.repository)
    throw new DomainError("REPOSITORY_REQUIRED", "Bind a repository first", 409);
  const [lifecycle] = await tx
    .select()
    .from(schema.projectLifecycles)
    .where(eq(schema.projectLifecycles.projectId, p.projectId));
  if (project.status === "suspended" || lifecycle)
    throw new DomainError("PROJECT_INACTIVE", "Coding requires an active project", 409);
  if (
    project.revision !== p.expectedProjectRevision ||
    environment.revision !== p.expectedEnvironmentRevision ||
    (repositoryHash && fingerprint(project.repository) !== repositoryHash)
  )
    throw new DomainError("REVISION_CONFLICT", "Coding source or scope changed", 409);
  return project.repository;
}
export const codingActor = (projectId: string): Actor => ({
  id: "coding-worker",
  kind: "service",
  projectIds: [projectId],
});
export function providerRequest(
  task: CodingTaskView,
  preparation: CodingPreparationView,
): CodingProviderRequest {
  return {
    taskId: task.id,
    correlationId: task.correlationId,
    worktreeId: task.worktree.id,
    preparation,
    deadline: new Date(
      Date.parse(task.createdAt) + preparation.limits.timeoutSeconds * 1000,
    ).toISOString(),
  };
}
