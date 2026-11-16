import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const moment = (name: string) => timestamp(name, { withTimezone: true });
/** Staged-deletion state. No row means the project is active; purge keeps a tombstone row. */
export const projectLifecycles = pgTable("project_lifecycles", {
  projectId: uuid("project_id").primaryKey(),
  phase: text("phase").$type<"suspended" | "quarantined" | "purged">().notNull(),
  resumeStatus: text("resume_status").$type<"draft" | "validated">().notNull(),
  reason: text("reason"),
  revision: integer("revision").notNull(),
  suspendedAt: moment("suspended_at").notNull(),
  quarantinedAt: moment("quarantined_at"),
  purgeAfter: moment("purge_after"),
  purgedAt: moment("purged_at"),
  updatedAt: moment("updated_at").notNull(),
});
/** Control-metadata export manifests; they never contain credentials, SQL, paths or database rows. */
export const projectExports = pgTable("project_exports", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  projectRevision: integer("project_revision").notNull(),
  digest: text("digest").notNull(),
  manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
  createdAt: moment("created_at").notNull(),
});
