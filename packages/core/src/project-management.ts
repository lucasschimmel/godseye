import { randomUUID } from "node:crypto";
import {
  CreateEnvironment,
  type CreateEnvironmentInput,
  UpdateEnvironment,
  type UpdateEnvironmentInput,
  UpdateProject,
  type UpdateProjectInput,
} from "@godseye/contracts";
import { type Store, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { DomainError, parseInput } from "./errors.js";
import { environmentFor, foundationState, recordRequest, requestFor } from "./foundation-data.js";
import { appendAudit, write } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";
import { assertProjectMutable } from "./project-lifecycle-view.js";
import { getProject } from "./projects.js";

function revision(actual: number, expected: number) {
  if (actual !== expected)
    throw new DomainError("REVISION_CONFLICT", "Project or environment has changed", 409);
}
function expiry(value: string | null, preview: boolean, now: Date) {
  if (!preview && value !== null)
    throw new DomainError("INVALID_EXPIRY", "Standard environments cannot expire", 422);
  const date = value ? new Date(value) : null;
  if (
    preview &&
    (!date || date.getTime() <= now.getTime() || date.getTime() > now.getTime() + 30 * 86400000)
  )
    throw new DomainError("INVALID_EXPIRY", "Preview expiry must be in the next thirty days", 422);
  return date;
}
export async function updateProject(
  store: Store,
  actor: Actor,
  id: string,
  input: UpdateProjectInput,
  key: string,
) {
  assertOwner(actor);
  const data = parseInput(UpdateProject, input);
  return write(store, async (tx) => {
    const request = await requestFor(tx, actor, key, "project.update", { id, data });
    if (request.existing) return getProject(tx, actor, id);
    await assertProjectMutable(tx, id);
    const project = await getProject(tx, actor, id);
    revision(project.revision, data.expectedRevision);
    await tx
      .update(schema.projects)
      .set({
        name: data.name,
        description: data.description,
        revision: project.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, id));
    await recordRequest(tx, foundationState(store, {}), key, request.digest, id, "project.update");
    await appendAudit(
      tx,
      actor,
      id,
      "project.updated",
      "Updated project metadata with revision protection",
    );
    return getProject(tx, actor, id);
  });
}
export async function createEnvironment(
  store: Store,
  actor: Actor,
  projectId: string,
  input: CreateEnvironmentInput,
  key: string,
) {
  assertOwner(actor);
  const data = parseInput(CreateEnvironment, input);
  return write(store, async (tx) => {
    const request = await requestFor(tx, actor, key, "environment.create", { projectId, data });
    if (request.existing) return getProject(tx, actor, projectId);
    await assertProjectMutable(tx, projectId);
    const project = await getProject(tx, actor, projectId);
    revision(project.revision, data.expectedProjectRevision);
    if (project.environments.some((env) => env.name === data.name))
      throw new DomainError("NAME_CONFLICT", "Environment name already exists", 409);
    if (project.environments.filter((env) => env.kind === "preview").length >= 8)
      throw new DomainError(
        "ENVIRONMENT_LIMIT",
        "At most eight persistent previews are allowed",
        409,
      );
    const now = new Date();
    await tx.insert(schema.environments).values({
      id: randomUUID(),
      projectId,
      name: data.name,
      kind: "preview",
      expiresAt: expiry(data.expiresAt, true, now),
      memoryMiB: data.memoryMiB,
      cpuMilliCores: data.cpuMilliCores,
      diskGiB: data.diskGiB,
    });
    await tx
      .update(schema.projects)
      .set({ revision: project.revision + 1, updatedAt: now })
      .where(eq(schema.projects.id, projectId));
    await recordRequest(
      tx,
      foundationState(store, {}),
      key,
      request.digest,
      projectId,
      "environment.create",
    );
    await appendAudit(
      tx,
      actor,
      projectId,
      "environment.created",
      `Registered bounded persistent preview ${data.name}; no resources provisioned`,
    );
    return getProject(tx, actor, projectId);
  });
}
export async function updateEnvironment(
  store: Store,
  actor: Actor,
  projectId: string,
  environmentId: string,
  input: UpdateEnvironmentInput,
  key: string,
) {
  assertOwner(actor);
  const data = parseInput(UpdateEnvironment, input);
  return write(store, async (tx) => {
    const request = await requestFor(tx, actor, key, "environment.update", {
      projectId,
      environmentId,
      data,
    });
    if (request.existing) return getProject(tx, actor, projectId);
    await assertProjectMutable(tx, projectId);
    const project = await getProject(tx, actor, projectId),
      environment = await environmentFor(tx, actor, projectId, environmentId, true);
    revision(project.revision, data.expectedProjectRevision);
    revision(environment.revision, data.expectedRevision);
    if (project.environments.some((env) => env.id !== environmentId && env.name === data.name))
      throw new DomainError("NAME_CONFLICT", "Environment name already exists", 409);
    await tx
      .update(schema.environments)
      .set({
        name: data.name,
        expiresAt: expiry(data.expiresAt, environment.kind === "preview", new Date()),
        memoryMiB: data.memoryMiB,
        cpuMilliCores: data.cpuMilliCores,
        diskGiB: data.diskGiB,
        revision: environment.revision + 1,
      })
      .where(eq(schema.environments.id, environmentId));
    await tx
      .update(schema.projects)
      .set({ revision: project.revision + 1, updatedAt: new Date() })
      .where(eq(schema.projects.id, projectId));
    await recordRequest(
      tx,
      foundationState(store, {}),
      key,
      request.digest,
      projectId,
      "environment.update",
    );
    await appendAudit(
      tx,
      actor,
      projectId,
      "environment.updated",
      "Updated requested environment policy; physical allocation is unchanged",
    );
    return getProject(tx, actor, projectId);
  });
}
