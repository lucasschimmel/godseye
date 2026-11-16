import {
  type LifecycleBlockerView,
  type ProjectExportSummaryView,
  type ProjectExportView,
  type ProjectLifecycleView,
  QUARANTINE_RETENTION_DAYS,
} from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { and, desc, eq, inArray } from "drizzle-orm";
import { DomainError } from "./errors.js";
import { type Actor, assertProjectAccess } from "./policy.js";

export const QUARANTINE_MS = QUARANTINE_RETENTION_DAYS * 86_400_000;
export const OPEN_RUNS: (typeof schema.jobRuns.$inferSelect)["state"][] = [
  "running",
  "cancel_requested",
  "unknown",
  "reconciling",
];
export const OPEN_OUTBOX: (typeof schema.jobOutbox.$inferSelect)["state"][] = [
  "dispatching",
  "unknown",
  "reconciling",
];
const OPEN_OPERATIONS: (typeof schema.operations.$inferSelect)["status"][] = [
  "running",
  "cancel_requested",
  "reconciling",
  "unknown",
];
const OPEN_ROTATIONS = ["intended", "applying", "unknown"];
const CLOSED_DELIVERY = ["retired", "released"];

type Residual = ProjectLifecycleView["residual"];
type Service = ProjectLifecycleView["services"][number];
type ExportRow = typeof schema.projectExports.$inferSelect;

export async function loadProject(tx: DatabaseAccess, actor: Actor, id: string) {
  assertProjectAccess(actor, id);
  const [project] = await tx.select().from(schema.projects).where(eq(schema.projects.id, id));
  if (!project) throw new DomainError("NOT_FOUND", "Project not found", 404);
  const [lifecycle] = await tx
    .select()
    .from(schema.projectLifecycles)
    .where(eq(schema.projectLifecycles.projectId, id));
  return { project, lifecycle };
}
/** Quarantined and purged projects are immutable metadata; edit paths call this first. */
export async function assertProjectMutable(tx: DatabaseAccess, projectId: string) {
  const [row] = await tx
    .select()
    .from(schema.projectLifecycles)
    .where(eq(schema.projectLifecycles.projectId, projectId));
  if (row && row.phase !== "suspended")
    throw new DomainError(
      "PROJECT_QUARANTINED",
      "A quarantined or purged project cannot be changed",
      409,
    );
}
const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;
const summary = (row: ExportRow): ProjectExportSummaryView => ({
  id: row.id,
  projectId: row.projectId,
  projectRevision: row.projectRevision,
  digest: row.digest,
  createdAt: row.createdAt.toISOString(),
});
export const exportView = (row: ExportRow): ProjectExportView => ({
  ...summary(row),
  manifest: row.manifest,
});

async function residualResources(tx: DatabaseAccess, id: string) {
  const databases = await tx
    .select()
    .from(schema.databaseAllocations)
    .where(eq(schema.databaseAllocations.projectId, id));
  const cells = await tx
    .select()
    .from(schema.infrastructureAllocations)
    .where(eq(schema.infrastructureAllocations.projectId, id));
  const runs = await tx
    .select()
    .from(schema.deliveryRuns)
    .where(eq(schema.deliveryRuns.projectId, id));
  const previews = await tx
    .select()
    .from(schema.deliveryPreviews)
    .where(eq(schema.deliveryPreviews.projectId, id));
  const backups = await tx
    .select()
    .from(schema.recoveryBackups)
    .where(eq(schema.recoveryBackups.projectId, id));
  const residual: Residual = [
    ...databases
      .filter((row) => row.state !== "released")
      .map((row) => ({ kind: "database" as const, id: row.id, state: row.state })),
    ...cells
      .filter((row) => row.state !== "released")
      .map((row) => ({ kind: "cell" as const, id: row.id, state: row.state })),
    ...runs
      .filter((row) => !CLOSED_DELIVERY.includes(row.state))
      .map((row) => ({ kind: "delivery-run" as const, id: row.id, state: row.state })),
    ...previews
      .filter((row) => row.state !== "retired")
      .map((row) => ({ kind: "preview" as const, id: row.id, state: row.state })),
    ...backups.map((row) => ({ kind: "backup" as const, id: row.id, state: "retained" })),
  ];
  return { residual, databaseStates: databases.filter((row) => row.state !== "released") };
}
/** Work that may still be running or whose outcome is unknown; staged deletion never starts over it. */
export async function lifecycleBlockers(tx: DatabaseAccess, id: string) {
  const runs = await tx
    .select({ id: schema.jobRuns.id })
    .from(schema.jobRuns)
    .where(and(eq(schema.jobRuns.projectId, id), inArray(schema.jobRuns.state, OPEN_RUNS)));
  const outbox = await tx
    .select({ id: schema.jobOutbox.id })
    .from(schema.jobOutbox)
    .where(and(eq(schema.jobOutbox.projectId, id), inArray(schema.jobOutbox.state, OPEN_OUTBOX)));
  const operations = await tx
    .select({ id: schema.operations.id })
    .from(schema.operations)
    .where(
      and(eq(schema.operations.projectId, id), inArray(schema.operations.status, OPEN_OPERATIONS)),
    );
  const rotations = await tx
    .select({ id: schema.databaseRotations.id })
    .from(schema.databaseRotations)
    .where(
      and(
        eq(schema.databaseRotations.projectId, id),
        inArray(schema.databaseRotations.state, OPEN_ROTATIONS),
      ),
    );
  const unknownAllocations = (
    await tx
      .select({ id: schema.databaseAllocations.id })
      .from(schema.databaseAllocations)
      .where(
        and(
          eq(schema.databaseAllocations.projectId, id),
          inArray(schema.databaseAllocations.state, ["unknown", "reserved"]),
        ),
      )
  ).length;
  const blockers: LifecycleBlockerView[] = [];
  const add = (count: number, code: LifecycleBlockerView["code"]) => {
    if (count > 0) blockers.push({ code, count });
  };
  add(runs.length, "ACTIVE_JOB_RUNS");
  add(outbox.length, "ACTIVE_OUTBOX_EFFECTS");
  add(operations.length, "ACTIVE_OPERATIONS");
  add(rotations.length, "ACTIVE_ROTATIONS");
  add(unknownAllocations, "UNCONFIRMED_ALLOCATIONS");
  return blockers;
}
const DESCRIPTIONS: Record<LifecycleBlockerView["code"], string> = {
  SUSPEND_REQUIRED: "project suspension is required first",
  EXPORT_REQUIRED: "export of the current revision is required",
  ACTIVE_JOB_RUNS: "job run(s) still active or unresolved",
  ACTIVE_OUTBOX_EFFECTS: "outbox effect(s) in flight or unresolved",
  ACTIVE_OPERATIONS: "operation(s) still running or unresolved",
  ACTIVE_ROTATIONS: "database rotation(s) unresolved",
  UNCONFIRMED_ALLOCATIONS: "database allocation(s) with unconfirmed physical state",
  RETENTION_ACTIVE: "quarantine retention has not ended",
  RESIDUAL_RESOURCES: "physical resource(s) remain and must be released first",
  ALREADY_PURGED: "project is already purged",
};
export const describeBlockers = (blockers: LifecycleBlockerView[]) =>
  blockers.map((item) => `${item.count} ${DESCRIPTIONS[item.code]}`).join("; ");
function services(phase: string, residual: Residual, suspendedAll: boolean): Service[] {
  const idle = phase === "active";
  const gate = (service: Service["service"], detail: string): Service => ({
    service,
    state: idle ? "none" : "enforced",
    detail: idle ? "Project is active" : detail,
  });
  const physical = (service: Service["service"], kind: Residual[number]["kind"], noun: string) => {
    const count = residual.filter((item) => item.kind === kind).length;
    const result: Service = {
      service,
      state: "none",
      detail: idle ? "Project is active" : `No ${noun}`,
    };
    if (!idle && count > 0) {
      result.state = "pending-provider";
      result.detail = `${count} ${noun} still need qualified provider action; this command stopped none of them`;
    }
    return result;
  };
  const databases = physical("databases", "database", "database allocation(s)");
  if (databases.state === "pending-provider" && suspendedAll) {
    databases.state = "enforced";
    databases.detail = "Every database allocation is recorded as suspended";
  }
  return [
    gate("jobs", "Scheduling and outbox dispatch are blocked for this project"),
    gate("backend", "Application backend admission is refused for this project"),
    gate("delivery", "Delivery admission is refused for this project"),
    databases,
    physical("cells", "cell", "runtime cell allocation(s)"),
    physical("backups", "backup", "retained backup(s)"),
  ];
}
export async function lifecycleView(
  tx: DatabaseAccess,
  actor: Actor,
  id: string,
  now: Date,
): Promise<ProjectLifecycleView> {
  const { project, lifecycle } = await loadProject(tx, actor, id);
  const phase = lifecycle?.phase ?? "active";
  const { residual, databaseStates } = await residualResources(tx, id);
  const exports = await tx
    .select()
    .from(schema.projectExports)
    .where(eq(schema.projectExports.projectId, id))
    .orderBy(desc(schema.projectExports.createdAt))
    .limit(10);
  const blockers: LifecycleBlockerView[] = [];
  if (phase === "active") blockers.push({ code: "SUSPEND_REQUIRED", count: 1 });
  if (phase === "suspended") {
    if (!exports.some((row) => row.projectRevision === project.revision))
      blockers.push({ code: "EXPORT_REQUIRED", count: 1 });
    blockers.push(...(await lifecycleBlockers(tx, id)));
  }
  const quarantinable = phase === "suspended" && blockers.length === 0;
  if (phase === "quarantined") {
    if (lifecycle?.purgeAfter && lifecycle.purgeAfter.getTime() > now.getTime())
      blockers.push({ code: "RETENTION_ACTIVE", count: 1 });
    if (residual.length > 0) blockers.push({ code: "RESIDUAL_RESOURCES", count: residual.length });
  }
  if (phase === "purged") blockers.push({ code: "ALREADY_PURGED", count: 1 });
  return {
    projectId: id,
    slug: project.slug,
    phase,
    revision: project.revision,
    reason: lifecycle?.reason ?? null,
    suspendedAt: iso(lifecycle?.suspendedAt),
    quarantinedAt: iso(lifecycle?.quarantinedAt),
    purgeAfter: iso(lifecycle?.purgeAfter),
    purgedAt: iso(lifecycle?.purgedAt),
    services: services(
      phase,
      residual,
      databaseStates.length > 0 && databaseStates.every((row) => row.state === "suspended"),
    ),
    residual,
    exports: exports.map(summary),
    quarantinable,
    purgeable: phase === "quarantined" && blockers.length === 0,
    blockers,
  };
}
