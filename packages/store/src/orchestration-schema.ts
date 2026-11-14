import type { OrchestrationDetailView } from "@godseye/contracts";
import { jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
export const orchestrationPlans = pgTable("orchestration_plans", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  metadata: jsonb("metadata").$type<OrchestrationDetailView>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
