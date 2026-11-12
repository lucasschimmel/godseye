import type {
  ConfigureBackendInput,
  CreateEnvironmentInput,
  CreateProjectInput,
  OperationRequest,
  Overview,
  RepositoryConfigurationInput,
  UpdateEnvironmentInput,
  UpdateProjectInput,
} from "@godseye/contracts";
import { type Store, schema } from "@godseye/store";
import { desc, eq } from "drizzle-orm";
import type { z } from "zod";
import { backendConfiguration, configureBackend } from "./backend-configuration.js";
import { DomainError } from "./errors.js";
import { type GithubDelivery, receiveGithubDelivery } from "./github.js";
import { listOperations, operationView, requestOperation } from "./operations.js";
import { type Actor, assertOwner, assertProjectAccess } from "./policy.js";
import { createEnvironment, updateEnvironment, updateProject } from "./project-management.js";

export { ProjectLifecycleEngine } from "./project-lifecycle.js";

import { configureRepository, createProject, getProject, listProjects } from "./projects.js";

export * from "./access.js";
export * from "./backend-configuration.js";
export * from "./database.js";
export * from "./delivery.js";
export { DomainError } from "./errors.js";
export * from "./foundations.js";
export { verifyGithubSignature } from "./github.js";
export * from "./incidents.js";
export * from "./infrastructure.js";
export * from "./inngest.js";
export * from "./jobs.js";
export { appendAudit, existingRequest, fingerprint, verifyAudit, write } from "./journal.js";
export { type Actor, assertProjectAccess, assertTransition } from "./policy.js";
export * from "./recovery.js";

/** Application boundary; no infrastructure credential or privileged execution capability. */
export class ControlPlane {
  constructor(private readonly store: Store) {}

  backendConfiguration(actor: Actor, projectId: string, environmentId: string) {
    return backendConfiguration(this.store, actor, projectId, environmentId);
  }
  configureBackend(
    actor: Actor,
    projectId: string,
    environmentId: string,
    input: ConfigureBackendInput,
    key: string,
  ) {
    return configureBackend(this.store, actor, projectId, environmentId, input, key);
  }

  createProject(actor: Actor, input: CreateProjectInput, key: string) {
    return createProject(this.store, actor, input, key);
  }
  getProject(actor: Actor, id: string) {
    return getProject(this.store.db, actor, id);
  }
  listProjects(actor: Actor) {
    return listProjects(this.store, actor);
  }
  updateProject(actor: Actor, id: string, input: UpdateProjectInput, key: string) {
    return updateProject(this.store, actor, id, input, key);
  }
  createEnvironment(actor: Actor, projectId: string, input: CreateEnvironmentInput, key: string) {
    return createEnvironment(this.store, actor, projectId, input, key);
  }
  updateEnvironment(
    actor: Actor,
    projectId: string,
    environmentId: string,
    input: UpdateEnvironmentInput,
    key: string,
  ) {
    return updateEnvironment(this.store, actor, projectId, environmentId, input, key);
  }
  configureRepository(
    actor: Actor,
    id: string,
    input: RepositoryConfigurationInput,
    revision: number,
    key: string,
  ) {
    return configureRepository(this.store, actor, id, input, revision, key);
  }
  requestOperation(actor: Actor, id: string, input: z.infer<typeof OperationRequest>, key: string) {
    return requestOperation(this.store, actor, id, input, key);
  }
  listOperations(actor: Actor) {
    return listOperations(this.store, actor);
  }
  receiveGithubDelivery(input: GithubDelivery, key: string) {
    return receiveGithubDelivery(this.store, input, key);
  }

  async getOperation(actor: Actor, id: string) {
    const [row] = await this.store.db
      .select()
      .from(schema.operations)
      .where(eq(schema.operations.id, id));
    if (!row) throw new DomainError("NOT_FOUND", "Operation not found", 404);
    if (row.projectId) assertProjectAccess(actor, row.projectId);
    else assertOwner(actor);
    return operationView(row);
  }

  async listCiRuns(actor: Actor) {
    assertOwner(actor);
    const rows = await this.store.db
      .select({ run: schema.ciRuns, projectName: schema.projects.name })
      .from(schema.ciRuns)
      .innerJoin(schema.projects, eq(schema.ciRuns.projectId, schema.projects.id))
      .orderBy(desc(schema.ciRuns.createdAt));
    return rows.map(({ run, projectName }) => ({
      ...run,
      projectName,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    }));
  }

  async listAudit(actor: Actor) {
    assertOwner(actor);
    const rows = await this.store.db
      .select()
      .from(schema.audit)
      .orderBy(desc(schema.audit.sequence))
      .limit(100);
    return rows.map(({ previousHash: _previous, hash: _hash, ...entry }) => ({
      ...entry,
      occurredAt: entry.occurredAt.toISOString(),
    }));
  }

  async overview(actor: Actor): Promise<Overview> {
    assertOwner(actor);
    const [projects, operations, runs, activity] = await Promise.all([
      this.listProjects(actor),
      this.listOperations(actor),
      this.listCiRuns(actor),
      this.listAudit(actor),
    ]);
    return {
      mode: "local",
      projectCount: projects.length,
      environmentCount: projects.reduce((total, project) => total + project.environments.length, 0),
      operationCount: operations.length,
      ciRunCount: runs.length,
      recentActivity: activity.slice(0, 8),
      qualification: { completed: 0, total: 8, serverConnected: false },
      capabilities: [
        {
          id: "control",
          name: "Control plane",
          status: "local",
          description: "Persistent project registry and operation journal",
        },
        {
          id: "proxmox",
          name: "Proxmox / AX41",
          status: "unconfigured",
          description: "Server installation and hardware qualification are pending",
        },
        {
          id: "runtime",
          name: "Docker + gVisor",
          status: "unqualified",
          description: "Sandbox runtime and network isolation require Linux qualification",
        },
        {
          id: "coolify",
          name: "Coolify",
          status: "unconfigured",
          description: "Deployment adapter is not connected",
        },
        {
          id: "github",
          name: "GitHub App",
          status: "unconfigured",
          description: "Repository bindings are local; API head verification is pending",
        },
        {
          id: "jenkins",
          name: "Jenkins",
          status: "unconfigured",
          description: "Private controller and isolated agents must be configured",
        },
        {
          id: "inngest",
          name: "Inngest",
          status: "unconfigured",
          description: "Per-environment workflow runtimes are not provisioned",
        },
        {
          id: "hermes",
          name: "Hermes CORE",
          status: "unconfigured",
          description: "Scoped skills, budgets and execution policy are pending",
        },
      ],
    };
  }
}
