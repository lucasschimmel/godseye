import type { JobDefinitionView } from "@godseye/contracts";
import { definitionView } from "@godseye/core";
import { type Store, schema } from "@godseye/store";
import { and, eq } from "drizzle-orm";
import type { LocalInngestCell } from "../../control-api/src/inngest-config.js";
import type { WorkerChild } from "./child.js";

/** Scoped finite catalog; overflow refuses registration instead of silently omitting accepted jobs. */
export async function readCellDefinitions(store: Store, cells: LocalInngestCell[]) {
  const definitions: JobDefinitionView[] = [];
  for (const cell of cells) {
    const rows = await store.db
      .select()
      .from(schema.jobDefinitions)
      .where(
        and(
          eq(schema.jobDefinitions.projectId, cell.projectId),
          eq(schema.jobDefinitions.environmentId, cell.environmentId),
        ),
      )
      .orderBy(schema.jobDefinitions.id)
      .limit(101);
    if (rows.length > 100)
      throw new Error("Autonomous cell catalog exceeds its explicit 100-definition bound");
    definitions.push(...rows.map(definitionView));
  }
  return definitions;
}
export async function reconcileCellCatalog(
  cell: { config: LocalInngestCell; worker?: WorkerChild; catalog?: string },
  definitions: JobDefinitionView[],
  register: boolean,
) {
  const catalog = definitions.filter(
    (definition) =>
      definition.projectId === cell.config.projectId &&
      definition.environmentId === cell.config.environmentId &&
      definition.trigger.kind === "cron" &&
      !definition.paused,
  );
  const hash = JSON.stringify(catalog.map(({ id, hash, paused }) => [id, hash, paused]));
  if (hash === cell.catalog) return false;
  await cell.worker?.peer.request("catalog", catalog);
  if (register) {
    const response = await fetch(`http://127.0.0.1:${cell.config.workerPort}/api/inngest`, {
      method: "PUT",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error("Autonomous signed catalog reconciliation failed");
  }
  cell.catalog = hash;
  return true;
}
