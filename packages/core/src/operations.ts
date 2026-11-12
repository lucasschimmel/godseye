import { randomUUID } from "node:crypto";
import { OperationRequest, type OperationState, type OperationView } from "@godseye/contracts";
import { type Store, schema } from "@godseye/store";
import { desc, eq } from "drizzle-orm";
import type { z } from "zod";
import { DomainError, parseInput } from "./errors.js";
import { appendAudit, existingRequest, fingerprint, write } from "./journal.js";
import { type Actor, assertOwner, assertTransition } from "./policy.js";
import { getProject } from "./projects.js";

export const operationView = (row: typeof schema.operations.$inferSelect): OperationView => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export async function listOperations(store: Store, actor: Actor): Promise<OperationView[]> {
  assertOwner(actor);
  return (
    await store.db.select().from(schema.operations).orderBy(desc(schema.operations.createdAt))
  ).map(operationView);
}

/** Only local validation runs here. Infrastructure actions fail closed until qualified. */
export async function requestOperation(
  store: Store,
  actor: Actor,
  projectId: string,
  input: z.infer<typeof OperationRequest>,
  key: string,
): Promise<OperationView> {
  assertOwner(actor);
  const data = parseInput(OperationRequest, input);
  if (data.action !== "project.validate")
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "Infrastructure provider is not connected and qualified",
      503,
    );
  const digest = fingerprint({ actor: actor.id, projectId, ...data });
  return write(store, async (tx) => {
    const existing = await existingRequest(tx, key, digest);
    if (existing) {
      const [row] = await tx
        .select()
        .from(schema.operations)
        .where(eq(schema.operations.id, existing.resourceId));
      if (!row)
        throw new DomainError("JOURNAL_INCONSISTENT", "Operation journal is inconsistent", 500);
      return operationView(row);
    }
    const project = await getProject(tx, actor, projectId);
    if (project.revision !== data.expectedRevision)
      throw new DomainError(
        "REVISION_CONFLICT",
        "Project has changed; reload before validating",
        409,
      );
    const id = randomUUID();
    const now = new Date();
    await tx.insert(schema.operations).values({
      id,
      projectId,
      action: data.action,
      status: "queued",
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });
    let revision = 0;
    let from: OperationState = "queued";
    for (const to of ["validating", "running", "succeeded"] as const) {
      assertTransition(from, to);
      await tx
        .update(schema.operations)
        .set({ status: to, revision: ++revision, updatedAt: new Date() })
        .where(eq(schema.operations.id, id));
      from = to;
    }
    await tx
      .update(schema.projects)
      .set({ status: "validated", revision: project.revision + 1, updatedAt: new Date() })
      .where(eq(schema.projects.id, projectId));
    await tx.insert(schema.requests).values({
      key,
      fingerprint: digest,
      resourceId: id,
      resourceKind: "operation",
      createdAt: now,
    });
    await appendAudit(
      tx,
      actor,
      projectId,
      data.action,
      `Validated local project configuration for ${project.slug}; no resources provisioned`,
    );
    const [row] = await tx.select().from(schema.operations).where(eq(schema.operations.id, id));
    if (!row)
      throw new DomainError("JOURNAL_INCONSISTENT", "Operation journal is inconsistent", 500);
    return operationView(row);
  });
}
