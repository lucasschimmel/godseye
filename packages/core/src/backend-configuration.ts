import {
  BackendConfigurationView,
  ConfigureBackend,
  type ConfigureBackendInput,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { DomainError, parseInput } from "./errors.js";
import { assertFresh, currentEpoch, environmentFor, foundationState } from "./foundation-data.js";
import { appendAudit, existingRequest, fingerprint, write } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";
import { getProject } from "./projects.js";

export async function backendConfiguration(
  store: Store,
  actor: Actor,
  projectId: string,
  environmentId: string,
  tx: DatabaseAccess = store.db,
) {
  assertOwner(actor);
  const project = await getProject(tx, actor, projectId);
  const environment = project.environments.find((row) => row.id === environmentId);
  if (!environment) throw new DomainError("NOT_FOUND", "Environment not found", 404);
  const [row] = await tx
    .select()
    .from(schema.backendConfigurations)
    .where(eq(schema.backendConfigurations.environmentId, environmentId));
  const held =
    environment.recoveryHold ||
    environment.deliveryHold ||
    (environment.expiresAt !== null && Date.parse(environment.expiresAt) <= Date.now()) ||
    project.status === "suspended" ||
    environment.status === "expired" ||
    environment.status === "suspended" ||
    ["quarantined", "unknown"].includes(environment.status);
  const stale =
    row &&
    (row.projectRevision !== project.revision || row.environmentRevision !== environment.revision);
  const state = held
    ? "held"
    : stale
      ? "stale"
      : !row
        ? "unconfigured"
        : row.configuration.enabled
          ? "prepared"
          : "disabled";
  return BackendConfigurationView.parse({
    projectId,
    environmentId,
    revision: row?.revision ?? 0,
    configuration: row?.configuration ?? null,
    state,
    runtimeConnected: false,
    reasons: [
      ...(held ? ["Environment lifecycle blocks ordinary application access"] : []),
      ...(stale ? ["Project or environment changed; confirm current application settings"] : []),
      "No qualified hosted application runtime is connected to this controller",
    ],
    updatedAt: row?.updatedAt.toISOString() ?? null,
  });
}

/** One ordered transaction keeps replay, revision checks, metadata and audit atomic. */
export async function configureBackend(
  store: Store,
  actor: Actor,
  projectId: string,
  environmentId: string,
  input: ConfigureBackendInput,
  key: string,
) {
  assertFresh(actor, foundationState(store, {}));
  const data = parseInput(ConfigureBackend, input);
  const digest = fingerprint({
    actor: actor.id,
    action: "backend.configure",
    projectId,
    environmentId,
    data,
  });
  return write(store, async (tx) => {
    assertFresh(actor, foundationState(store, {}));
    const existing = await existingRequest(tx, key, digest);
    if (existing) return backendConfiguration(store, actor, projectId, environmentId, tx);
    const project = await getProject(tx, actor, projectId);
    const previous = await backendConfiguration(store, actor, projectId, environmentId, tx);
    const environment = await environmentFor(tx, actor, projectId, environmentId);
    if (
      project.status === "suspended" ||
      (environment.expiresAt && environment.expiresAt.getTime() <= Date.now())
    )
      throw new DomainError(
        "BACKEND_HELD",
        "Inactive environment cannot change application settings",
        409,
      );
    if (previous.state === "held")
      throw new DomainError("BACKEND_HELD", "Environment is held", 409);
    if (data.configuration.storageMiB > environment.diskGiB * 1024)
      throw new DomainError(
        "CAPACITY_EXCEEDED",
        "Application file quota exceeds the environment disk budget",
        409,
      );
    if (
      previous.revision !== data.expectedRevision ||
      project.revision !== data.expectedProjectRevision ||
      environment.revision !== data.expectedEnvironmentRevision
    )
      throw new DomainError(
        "REVISION_CONFLICT",
        "Backend configuration changed; reload before saving",
        409,
      );
    const values = {
      projectId,
      environmentId,
      revision: previous.revision + 1,
      projectRevision: project.revision,
      environmentRevision: environment.revision,
      configuration: data.configuration,
      updatedAt: new Date(),
    };
    await tx.insert(schema.backendConfigurations).values(values).onConflictDoUpdate({
      target: schema.backendConfigurations.environmentId,
      set: values,
    });
    await tx.insert(schema.requests).values({
      key,
      fingerprint: digest,
      resourceId: projectId,
      resourceKind: "project",
      createdAt: new Date(),
    });
    await appendAudit(
      tx,
      actor,
      projectId,
      "backend.configured",
      `Prepared application configuration for environment ${environmentId}; runtime remains disconnected`,
    );
    return backendConfiguration(store, actor, projectId, environmentId, tx);
  });
}

/** Private server composition only. This is not an HTTP enrollment or execution capability. */
export function applicationLifecycleGuard(
  store: Store,
  scope: { projectId: string; environmentId: string; configurationRevision: number },
) {
  const binding = Object.freeze({ ...scope });
  return () =>
    write(store, async (tx) => {
      const actor: Actor = {
        id: "internal-lifecycle-reader",
        kind: "service",
        projectIds: [binding.projectId],
      };
      const environment = await environmentFor(
        tx,
        actor,
        binding.projectId,
        binding.environmentId,
        true,
        true,
      );
      const project = await getProject(tx, actor, binding.projectId);
      const view = project.environments.find((row) => row.id === binding.environmentId);
      const [configuration] = await tx
        .select()
        .from(schema.backendConfigurations)
        .where(eq(schema.backendConfigurations.environmentId, binding.environmentId));
      return {
        epoch: await currentEpoch(tx, binding.environmentId),
        available: Boolean(
          configuration &&
            configuration.projectId === binding.projectId &&
            configuration.revision === binding.configurationRevision &&
            configuration.projectRevision === project.revision &&
            configuration.environmentRevision === environment.revision &&
            configuration.configuration.enabled &&
            (!environment.expiresAt || environment.expiresAt.getTime() > Date.now()) &&
            project.status !== "suspended" &&
            view &&
            !view.recoveryHold &&
            !view.deliveryHold &&
            !["expired", "suspended", "quarantined", "unknown"].includes(view.status),
        ),
      };
    });
}
