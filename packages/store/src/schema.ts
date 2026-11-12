import type { CiState, OperationState, RepositoryConfigurationInput } from "@godseye/contracts";
import { sql } from "drizzle-orm";

export * from "./foundation-schema.js";

import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const controlLock = pgTable("control_lock", { id: integer("id").primaryKey() }, (table) => [
  check("control_lock_id_check", sql`${table.id} = 1`),
]);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    kind: text("kind").$type<"web" | "api" | "worker">().notNull(),
    description: text("description").notNull().default(""),
    status: text("status").$type<"draft" | "validated" | "suspended">().notNull(),
    revision: integer("revision").notNull().default(0),
    repository: jsonb("repository").$type<RepositoryConfigurationInput>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("projects_kind_check", sql`${table.kind} IN ('web', 'api', 'worker')`),
    check("projects_status_check", sql`${table.status} IN ('draft', 'validated', 'suspended')`),
    check("projects_revision_check", sql`${table.revision} >= 0`),
  ],
);

export const environments = pgTable(
  "environments",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    kind: text("kind").$type<"development" | "production" | "preview" | "recovery">().notNull(),
    recoveryHold: boolean("recovery_hold").notNull().default(false),
    name: text("name").notNull().default("development"),
    revision: integer("revision").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    memoryMiB: integer("memory_mib").notNull(),
    cpuMilliCores: integer("cpu_millicores").notNull(),
    diskGiB: integer("disk_gib").notNull(),
  },
  (table) => [
    unique("environments_project_id_name_key").on(table.projectId, table.name),
    check(
      "environments_kind_check",
      sql`${table.kind} IN ('development', 'production', 'preview', 'recovery')`,
    ),
    check("environments_memory_mib_check", sql`${table.memoryMiB} > 0`),
    check("environments_cpu_millicores_check", sql`${table.cpuMilliCores} > 0`),
    check("environments_disk_gib_check", sql`${table.diskGiB} > 0`),
  ],
);

export const operations = pgTable(
  "operations",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id").references(() => projects.id),
    action: text("action").notNull(),
    status: text("status").$type<OperationState>().notNull(),
    revision: integer("revision").notNull(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("operations_project_idx").on(table.projectId, table.createdAt),
    check("operations_revision_check", sql`${table.revision} >= 0`),
    check(
      "operations_status_check",
      sql`${table.status} IN ('queued','validating','running','waiting','awaiting_approval','cancel_requested','reconciling','succeeded','failed','cancelled','unknown')`,
    ),
  ],
);

export const requests = pgTable(
  "requests",
  {
    key: text("key").primaryKey(),
    fingerprint: text("fingerprint").notNull(),
    resourceId: uuid("resource_id").notNull(),
    resourceKind: text("resource_kind").$type<"project" | "operation">().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("requests_resource_kind_check", sql`${table.resourceKind} IN ('project', 'operation')`),
  ],
);

export const audit = pgTable("audit", {
  id: uuid("id").primaryKey(),
  sequence: integer("sequence").generatedAlwaysAsIdentity().unique(),
  actorId: text("actor_id").notNull(),
  projectId: uuid("project_id"),
  action: text("action").notNull(),
  summary: text("summary").notNull(),
  previousHash: text("previous_hash").notNull(),
  hash: text("hash").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
});

export const deliveries = pgTable("github_deliveries", {
  id: text("id").primaryKey(),
  payloadHash: text("payload_hash").notNull(),
  outcome: text("outcome").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
});

export const ciRuns = pgTable(
  "ci_runs",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    deliveryId: text("delivery_id"),
    branch: text("branch").notNull(),
    commitSha: text("commit_sha").notNull(),
    status: text("status").$type<CiState>().notNull(),
    trigger: text("trigger").$type<"push" | "pull_request" | "manual" | "scheduled">().notNull(),
    repositorySnapshot: jsonb("repository_snapshot").$type<RepositoryConfigurationInput>(),
    pullRequestNumber: integer("pull_request_number"),
    eventAction: text("event_action"),
    providerRef: text("provider_ref"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("ci_runs_delivery_project_idx").on(table.deliveryId, table.projectId),
    index("ci_runs_project_idx").on(table.projectId, table.createdAt),
    check("ci_runs_commit_sha_check", sql`${table.commitSha} ~ '^[a-f0-9]{40}$'`),
    check(
      "ci_runs_status_check",
      sql`${table.status} IN ('pending_verification','queued','running','succeeded','failed','cancelled','superseded','unavailable')`,
    ),
    check(
      "ci_runs_trigger_check",
      sql`${table.trigger} IN ('push', 'pull_request', 'manual', 'scheduled')`,
    ),
  ],
);
export * from "./access-schema.js";
export * from "./backend-schema.js";
export * from "./database-schema.js";
export * from "./delivery-schema.js";
export * from "./infra-schema.js";
export * from "./owner-schema.js";
export * from "./recovery-schema.js";
