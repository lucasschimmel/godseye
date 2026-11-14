import type { CodingPreparationView, CodingResultView, CodingTaskView } from "@godseye/contracts";
import { jsonb, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const codingPreparations = pgTable("coding_preparations", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  metadata: jsonb("metadata").$type<CodingPreparationView>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
export const codingTasks = pgTable(
  "coding_tasks",
  {
    id: uuid("id").primaryKey(),
    preparationId: uuid("preparation_id").notNull(),
    projectId: uuid("project_id").notNull(),
    runId: uuid("run_id"),
    metadata: jsonb("metadata").$type<CodingTaskView>().notNull(),
    result: jsonb("result").$type<CodingResultView>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("coding_task_preparation").on(t.preparationId),
    unique("coding_task_run").on(t.runId),
  ],
);
