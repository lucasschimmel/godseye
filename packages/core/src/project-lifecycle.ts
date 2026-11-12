import { randomUUID } from "node:crypto";
import {
  CreateProjectExport,
  type CreateProjectExportInput,
  PurgeProject,
  type PurgeProjectInput,
  QuarantineProject,
  type QuarantineProjectInput,
  ReleaseQuarantine,
  type ReleaseQuarantineInput,
  ResumeProject,
  type ResumeProjectInput,
  SuspendProject,
  type SuspendProjectInput,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { and, eq } from "drizzle-orm";
import { DomainError, parseInput } from "./errors.js";
import { assertFresh, foundationState, recordRequest, requestFor } from "./foundation-data.js";
import { appendAudit, fingerprint, write } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";
import {
  describeBlockers,
  exportView,
  lifecycleBlockers,
  lifecycleView,
  loadProject,
  QUARANTINE_MS,
} from "./project-lifecycle-view.js";

export { assertProjectMutable } from "./project-lifecycle-view.js";

type Phase = "active" | "suspended" | "quarantined" | "purged";
const REVISION = "Project has changed";
function conflict(code: string, message: string): never {
  throw new DomainError(code, message, 409);
}
function sameRevision(actual: number, expected: number) {
  if (actual !== expected) conflict("REVISION_CONFLICT", REVISION);
}
function needPhase(phase: Phase, ...allowed: Phase[]) {
  if (!allowed.includes(phase))
    conflict(
      "INVALID_LIFECYCLE",
      `Project is ${phase}; this command needs ${allowed.join(" or ")}`,
    );
}

/**
 * Staged project deletion and control-metadata export (F03/F41, D10). Commands are metadata-only and
 * run beside the Foundation queue like database rotation: the lifecycle row, revision bump, idempotency
 * receipt and audit entry are the journal. They never stop physical resources; the view reports which
 * services are gated by the platform and which still need a qualified provider.
 */
export class ProjectLifecycleEngine {
  constructor(
    private readonly store: Store,
    private readonly options: { now: () => Date },
  ) {}
  private get fresh() {
    return foundationState(this.store, { now: this.options.now });
  }
  async view(actor: Actor, projectId: string) {
    assertOwner(actor);
    return write(this.store, (tx) => lifecycleView(tx, actor, projectId, this.options.now()));
  }
  async exportById(actor: Actor, projectId: string, exportId: string) {
    assertOwner(actor);
    return write(this.store, async (tx) => {
      await loadProject(tx, actor, projectId);
      const [row] = await tx
        .select()
        .from(schema.projectExports)
        .where(
          and(
            eq(schema.projectExports.id, exportId),
            eq(schema.projectExports.projectId, projectId),
          ),
        );
      if (!row) throw new DomainError("NOT_FOUND", "Export not found", 404);
      return exportView(row);
    });
  }
  suspend(actorInput: Actor, projectId: string, input: SuspendProjectInput, key: string) {
    assertOwner(actorInput);
    const data = parseInput(SuspendProject, input);
    return this.command(actorInput, projectId, "project.suspend", data, key, async (ctx) => {
      needPhase(ctx.phase, "active");
      sameRevision(ctx.project.revision, data.expectedRevision);
      await ctx.tx.insert(schema.projectLifecycles).values({
        projectId,
        phase: "suspended",
        resumeStatus: ctx.project.status === "validated" ? "validated" : "draft",
        reason: data.reason,
        revision: 1,
        suspendedAt: ctx.now,
        updatedAt: ctx.now,
      });
      await ctx.setProject(ctx.project.revision + 1, "suspended");
      return ["project.suspended", `Suspended project: ${data.reason}`];
    });
  }
  resume(actorInput: Actor, projectId: string, input: ResumeProjectInput, key: string) {
    assertOwner(actorInput);
    const data = parseInput(ResumeProject, input);
    return this.command(actorInput, projectId, "project.resume", data, key, async (ctx) => {
      needPhase(ctx.phase, "suspended");
      sameRevision(ctx.project.revision, data.expectedRevision);
      const resume = ctx.lifecycle?.resumeStatus ?? "draft";
      await ctx.tx
        .delete(schema.projectLifecycles)
        .where(eq(schema.projectLifecycles.projectId, projectId));
      await ctx.setProject(ctx.project.revision + 1, resume);
      return ["project.resumed", "Resumed project admission"];
    });
  }
  /** Writes a deterministic control-metadata manifest; application data needs a qualified provider. */
  async exportMetadata(
    actorInput: Actor,
    projectId: string,
    input: CreateProjectExportInput,
    key: string,
  ) {
    assertOwner(actorInput);
    const data = parseInput(CreateProjectExport, input);
    return write(this.store, async (tx) => {
      const request = await requestFor(tx, actorInput, key, "project.export", { projectId, data });
      if (request.existing) {
        const [row] = await tx
          .select()
          .from(schema.projectExports)
          .where(eq(schema.projectExports.id, request.existing.resourceId));
        if (!row) throw new DomainError("NOT_FOUND", "Export not found", 404);
        return exportView(row);
      }
      const { project, lifecycle } = await loadProject(tx, actorInput, projectId);
      if (lifecycle?.phase === "purged") conflict("INVALID_LIFECYCLE", "Project is purged");
      sameRevision(project.revision, data.expectedRevision);
      const manifest = await buildManifest(tx, projectId, this.options.now());
      const row = {
        id: randomUUID(),
        projectId,
        projectRevision: project.revision,
        digest: fingerprint(manifest.content),
        manifest: manifest.document,
        createdAt: this.options.now(),
      };
      await tx.insert(schema.projectExports).values(row);
      await recordRequest(tx, this.fresh, key, request.digest, row.id, "project.export");
      await appendAudit(
        tx,
        actorInput,
        projectId,
        "project.exported",
        `Exported control metadata manifest ${row.digest.slice(0, 12)} at revision ${project.revision}`,
      );
      return exportView(row);
    });
  }
  quarantine(actorInput: Actor, projectId: string, input: QuarantineProjectInput, key: string) {
    assertFresh(actorInput, this.fresh);
    const data = parseInput(QuarantineProject, input);
    return this.command(actorInput, projectId, "project.quarantine", data, key, async (ctx) => {
      needPhase(ctx.phase, "suspended");
      sameRevision(ctx.project.revision, data.expectedRevision);
      const [stored] = await ctx.tx
        .select()
        .from(schema.projectExports)
        .where(
          and(
            eq(schema.projectExports.id, data.exportId),
            eq(schema.projectExports.projectId, projectId),
          ),
        );
      if (!stored || stored.projectRevision !== ctx.project.revision)
        conflict("EXPORT_REQUIRED", "An export of the current project revision is required");
      const blockers = await lifecycleBlockers(ctx.tx, projectId);
      if (blockers.length > 0) conflict("LIFECYCLE_BLOCKED", describeBlockers(blockers));
      await ctx.tx
        .update(schema.projectLifecycles)
        .set({
          phase: "quarantined",
          reason: data.reason,
          quarantinedAt: ctx.now,
          purgeAfter: new Date(ctx.now.getTime() + QUARANTINE_MS),
          revision: (ctx.lifecycle?.revision ?? 0) + 1,
          updatedAt: ctx.now,
        })
        .where(eq(schema.projectLifecycles.projectId, projectId));
      await ctx.setProject(ctx.project.revision + 1, "suspended");
      return [
        "project.quarantined",
        `Quarantined project with export ${stored.digest.slice(0, 12)}: ${data.reason}`,
      ];
    });
  }
  release(actorInput: Actor, projectId: string, input: ReleaseQuarantineInput, key: string) {
    assertOwner(actorInput);
    const data = parseInput(ReleaseQuarantine, input);
    return this.command(actorInput, projectId, "project.release", data, key, async (ctx) => {
      needPhase(ctx.phase, "quarantined");
      sameRevision(ctx.project.revision, data.expectedRevision);
      await ctx.tx
        .update(schema.projectLifecycles)
        .set({
          phase: "suspended",
          quarantinedAt: null,
          purgeAfter: null,
          revision: (ctx.lifecycle?.revision ?? 0) + 1,
          updatedAt: ctx.now,
        })
        .where(eq(schema.projectLifecycles.projectId, projectId));
      await ctx.setProject(ctx.project.revision + 1, "suspended");
      return ["project.released", "Released project from quarantine back to suspension"];
    });
  }
  /** A refused purge commits its own audit entry, so the failure stays visible and reviewable. */
  async purge(actorInput: Actor, projectId: string, input: PurgeProjectInput, key: string) {
    assertFresh(actorInput, this.fresh);
    const data = parseInput(PurgeProject, input);
    const refusal = await write(this.store, async (tx) => {
      const { project, lifecycle } = await loadProject(tx, actorInput, projectId);
      const request = await requestFor(tx, actorInput, key, "project.purge", { projectId, data });
      if (request.existing) return null;
      const phase: Phase = lifecycle?.phase ?? "active";
      needPhase(phase, "quarantined");
      sameRevision(project.revision, data.expectedRevision);
      if (data.confirmSlug !== project.slug)
        throw new DomainError("SLUG_MISMATCH", "Confirmation does not match the project", 422);
      const view = await lifecycleView(tx, actorInput, projectId, this.options.now());
      if (!view.purgeable) {
        const reason = describeBlockers(view.blockers);
        await appendAudit(tx, actorInput, projectId, "project.purge_refused", reason.slice(0, 500));
        return new DomainError("PURGE_BLOCKED", reason, 409);
      }
      const now = this.options.now();
      await tx
        .update(schema.projectLifecycles)
        .set({
          phase: "purged",
          purgedAt: now,
          revision: (lifecycle?.revision ?? 0) + 1,
          updatedAt: now,
        })
        .where(eq(schema.projectLifecycles.projectId, projectId));
      await tx
        .update(schema.projects)
        .set({ repository: null, revision: project.revision + 1, updatedAt: now })
        .where(eq(schema.projects.id, projectId));
      await recordRequest(tx, this.fresh, key, request.digest, projectId, "project.purge");
      await appendAudit(
        tx,
        actorInput,
        projectId,
        "project.purged",
        "Purged project control metadata; audit and recovery history retained",
      );
      return null;
    });
    if (refusal) throw refusal;
    return this.view(actorInput, projectId);
  }

  /** Shared transactional shell: idempotency, loading, project revision bump, audit and view. */
  private command(
    actor: Actor,
    projectId: string,
    kind: string,
    data: unknown,
    key: string,
    work: (ctx: Context) => Promise<[string, string]>,
  ) {
    return write(this.store, async (tx) => {
      const request = await requestFor(tx, actor, key, kind, { projectId, data });
      if (request.existing) return lifecycleView(tx, actor, projectId, this.options.now());
      const { project, lifecycle } = await loadProject(tx, actor, projectId);
      const now = this.options.now();
      const [action, summary] = await work({
        tx,
        now,
        project,
        lifecycle,
        phase: lifecycle?.phase ?? "active",
        setProject: async (revision, status) => {
          await tx
            .update(schema.projects)
            .set({ status, revision, updatedAt: now })
            .where(eq(schema.projects.id, projectId));
        },
      });
      await recordRequest(tx, this.fresh, key, request.digest, projectId, kind);
      await appendAudit(tx, actor, projectId, action, summary);
      return lifecycleView(tx, actor, projectId, now);
    });
  }
}
interface Context {
  tx: DatabaseAccess;
  now: Date;
  project: typeof schema.projects.$inferSelect;
  lifecycle: typeof schema.projectLifecycles.$inferSelect | undefined;
  phase: Phase;
  setProject: (revision: number, status: "draft" | "validated" | "suspended") => Promise<void>;
}

async function buildManifest(tx: DatabaseAccess, projectId: string, now: Date) {
  const [project] = await tx
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!project) throw new DomainError("NOT_FOUND", "Project not found", 404);
  const environments = await tx
    .select()
    .from(schema.environments)
    .where(eq(schema.environments.projectId, projectId));
  const allocations = await tx
    .select()
    .from(schema.databaseAllocations)
    .where(eq(schema.databaseAllocations.projectId, projectId));
  const backups = await tx
    .select()
    .from(schema.recoveryBackups)
    .where(eq(schema.recoveryBackups.projectId, projectId));
  const jobs = await tx
    .select()
    .from(schema.jobDefinitions)
    .where(eq(schema.jobDefinitions.projectId, projectId));
  const backends = await tx
    .select()
    .from(schema.backendConfigurations)
    .where(eq(schema.backendConfigurations.projectId, projectId));
  const sorted = <T extends { id?: string; environmentId?: string }>(rows: T[]) =>
    [...rows].sort((a, b) =>
      String(a.id ?? a.environmentId).localeCompare(String(b.id ?? b.environmentId)),
    );
  const content = {
    format: "godseye.project-export/1",
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      kind: project.kind,
      description: project.description,
      status: project.status,
      revision: project.revision,
      repository: project.repository,
    },
    environments: sorted(environments).map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      recoveryHold: row.recoveryHold,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      memoryMiB: row.memoryMiB,
      cpuMilliCores: row.cpuMilliCores,
      diskGiB: row.diskGiB,
    })),
    databases: sorted(allocations).map((row) => ({
      id: row.id,
      environmentId: row.environmentId,
      state: row.state,
      requestedState: row.requestedState,
    })),
    backups: sorted(backups).map((row) => ({
      id: row.id,
      environmentId: row.environmentId,
      kind: row.kind,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
    })),
    jobs: sorted(jobs).map((row) => ({
      id: row.id,
      environmentId: row.environmentId,
      name: row.name,
      trigger: row.trigger,
      effectPolicy: row.effectPolicy,
      limits: row.limits,
      paused: row.paused,
    })),
    backend: sorted(backends).map((row) => ({
      environmentId: row.environmentId,
      configuration: row.configuration,
    })),
    data: {
      included: false,
      reason: "Application data, files and identities need a qualified provider export",
    },
  };
  return { content, document: { ...content, exportedAt: now.toISOString() } };
}
