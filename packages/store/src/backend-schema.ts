import type { BackendConfigurationInput } from "@godseye/contracts";
import { integer, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

/** Desired application settings only; application identities/data live in separate stores. */
export const backendConfigurations = pgTable("backend_configurations", {
  environmentId: uuid("environment_id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  revision: integer("revision").notNull(),
  projectRevision: integer("project_revision").notNull(),
  environmentRevision: integer("environment_revision").notNull(),
  configuration: jsonb("configuration").$type<BackendConfigurationInput>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
