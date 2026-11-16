import { randomUUID } from "node:crypto";
import {
  CreateProject,
  type CreateProjectInput,
  type ProjectView,
  RepositoryConfiguration,
  type RepositoryConfigurationInput,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { desc, eq } from "drizzle-orm";
import { DomainError, parseInput } from "./errors.js";
import { appendAudit, existingRequest, fingerprint, write } from "./journal.js";
import { type Actor, assertOwner, assertProjectAccess } from "./policy.js";
import { assertProjectMutable } from "./project-lifecycle-view.js";

const ENVIRONMENT_DEFAULTS = { memoryMiB: 2048, cpuMilliCores: 1000, diskGiB: 20 } as const;

export async function getProject(
  db: DatabaseAccess,
  actor: Actor,
  id: string,
): Promise<ProjectView> {
  assertProjectAccess(actor, id);
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
  if (!project) throw new DomainError("NOT_FOUND", "Project not found", 404);
  const environments = await db
    .select()
    .from(schema.environments)
    .where(eq(schema.environments.projectId, id));
  const allocations = await db
    .select()
    .from(schema.databaseAllocations)
    .where(eq(schema.databaseAllocations.projectId, id));
  const deliveries = await db
    .select()
    .from(schema.deliveryRuns)
    .where(eq(schema.deliveryRuns.projectId, id));
  const previews = await db
    .select()
    .from(schema.deliveryPreviews)
    .where(eq(schema.deliveryPreviews.projectId, id));
  return {
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    environments: environments.map((environment) => ({
      ...environment,
      deliveryHold: previews.some(
        (preview) =>
          preview.environmentId === environment.id &&
          (["cleanup-required", "retired", "unknown"].includes(preview.state) ||
            preview.expiresAt.getTime() <= Date.now()),
      ),
      expiresAt: environment.expiresAt?.toISOString() ?? null,
      status: environmentStatus(environment, allocations, deliveries, previews),
      requestedState: (allocations.find(
        (row) => row.environmentId === environment.id && row.state !== "released",
      )?.requestedState ?? null) as "ready" | "suspended" | null,
      isolationProfile: "gvisor-service-sandbox",
    })),
  };
}

export async function listProjects(store: Store, actor: Actor): Promise<ProjectView[]> {
  assertOwner(actor);
  const rows = await store.db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .orderBy(desc(schema.projects.createdAt));
  return Promise.all(rows.map(({ id }) => getProject(store.db, actor, id)));
}

export async function createProject(
  store: Store,
  actor: Actor,
  input: CreateProjectInput,
  key: string,
): Promise<ProjectView> {
  assertOwner(actor);
  const data = parseInput(CreateProject, input);
  const digest = fingerprint({ actor: actor.id, action: "project.create", data });
  return write(store, async (tx) => {
    const existing = await existingRequest(tx, key, digest);
    if (existing) return getProject(tx, actor, existing.resourceId);
    const [duplicate] = await tx
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.slug, data.slug));
    if (duplicate) throw new DomainError("SLUG_CONFLICT", "This project slug already exists", 409);
    const id = randomUUID();
    const now = new Date();
    await tx
      .insert(schema.projects)
      .values({ ...data, id, status: "draft", revision: 0, createdAt: now, updatedAt: now });
    await tx.insert(schema.environments).values(
      (["development", "production"] as const).map((kind) => ({
        id: randomUUID(),
        projectId: id,
        kind,
        name: kind,
        ...ENVIRONMENT_DEFAULTS,
      })),
    );
    await tx.insert(schema.requests).values({
      key,
      fingerprint: digest,
      resourceId: id,
      resourceKind: "project",
      createdAt: now,
    });
    await appendAudit(
      tx,
      actor,
      id,
      "project.created",
      `Registered ${data.slug}; environments are planned`,
    );
    return getProject(tx, actor, id);
  });
}
function environmentStatus(
  environment: typeof schema.environments.$inferSelect,
  allocations: (typeof schema.databaseAllocations.$inferSelect)[],
  deliveries: (typeof schema.deliveryRuns.$inferSelect)[],
  previews: (typeof schema.deliveryPreviews.$inferSelect)[],
): ProjectView["environments"][number]["status"] {
  const allocation = allocations.find(
    (row) => row.environmentId === environment.id && row.state !== "released",
  );
  const preview = previews.find((row) => row.environmentId === environment.id);
  if (preview && preview.expiresAt.getTime() <= Date.now()) return "expired";
  const delivery = deliveries.filter((row) => row.environmentId === environment.id);
  if (delivery.some((row) => row.state === "unknown" || row.state === "quarantined"))
    return "unknown";
  if (preview?.state === "retired") return "suspended";
  if (preview?.state === "cleanup-required") return "quarantined";
  if (allocation && ["unknown", "quarantined"].includes(allocation.state))
    return allocation.state as "unknown" | "quarantined";
  if (delivery.some((row) => row.state === "active")) return "ready";
  if (
    delivery.some(
      (row) => row.state === "reserved" || row.state === "building" || row.state === "staged",
    )
  )
    return "reserved";
  if (allocation) return allocation.state as ProjectView["environments"][number]["status"];
  return environment.expiresAt && environment.expiresAt.getTime() <= Date.now()
    ? "expired"
    : "planned";
}

export async function configureRepository(
  store: Store,
  actor: Actor,
  id: string,
  input: RepositoryConfigurationInput,
  expectedRevision: number,
  key: string,
): Promise<ProjectView> {
  assertOwner(actor);
  const repository = parseInput(RepositoryConfiguration, input);
  const digest = fingerprint({
    actor: actor.id,
    action: "repository.configure",
    id,
    repository,
    expectedRevision,
  });
  return write(store, async (tx) => {
    const existing = await existingRequest(tx, key, digest);
    if (existing) return getProject(tx, actor, existing.resourceId);
    await assertProjectMutable(tx, id);
    const project = await getProject(tx, actor, id);
    if (project.revision !== expectedRevision)
      throw new DomainError("REVISION_CONFLICT", "Project has changed; reload before saving", 409);
    await tx
      .update(schema.projects)
      .set({ repository, revision: project.revision + 1, updatedAt: new Date() })
      .where(eq(schema.projects.id, id));
    await appendAudit(
      tx,
      actor,
      id,
      "repository.configured",
      `Bound ${repository.fullName}:${repository.branch}; provider verification is required`,
    );
    await tx.insert(schema.requests).values({
      key,
      fingerprint: digest,
      resourceId: id,
      resourceKind: "project",
      createdAt: new Date(),
    });
    return getProject(tx, actor, id);
  });
}
