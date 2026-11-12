import type { ActionCommandInput } from "@godseye/contracts";
import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const moment = (name: string) => timestamp(name, { withTimezone: true });
const amount = (name: string) => bigint(name, { mode: "number" });
export const resources = pgTable("control_resources", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  environmentId: uuid("environment_id").notNull(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  createdAt: moment("created_at").notNull(),
});
export const executionPlans = pgTable("execution_plans", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  environmentId: uuid("environment_id").notNull(),
  targetId: uuid("target_id").notNull(),
  expectedRevision: integer("expected_revision").notNull(),
  adapterId: text("adapter_id").notNull(),
  command: jsonb("command").$type<ActionCommandInput>().notNull(),
  hash: text("hash").notNull(),
  maxCostMicros: amount("max_cost_micros").notNull(),
  tools: jsonb("tools").$type<string[]>().notNull(),
  destinations: jsonb("destinations").$type<string[]>().notNull(),
  requiresApproval: boolean("requires_approval").notNull(),
  createdAt: moment("created_at").notNull(),
});
export const approvals = pgTable("control_approvals", {
  id: uuid("id").primaryKey(),
  planId: uuid("plan_id").notNull().unique(),
  planHash: text("plan_hash").notNull(),
  ownerId: text("owner_id").notNull(),
  sessionId: text("session_id").notNull(),
  authenticatedAt: moment("authenticated_at").notNull(),
  approvedAt: moment("approved_at").notNull(),
  expiresAt: moment("expires_at").notNull(),
});
export const activationEpochs = pgTable("activation_epochs", {
  environmentId: uuid("environment_id").primaryKey(),
  epoch: integer("epoch").notNull(),
});
export const budgetAccounts = pgTable("budget_accounts", {
  projectId: uuid("project_id").primaryKey(),
  limitMicros: amount("limit_micros").notNull(),
  reservedMicros: amount("reserved_micros").notNull(),
  spentMicros: amount("spent_micros").notNull(),
  revision: integer("revision").notNull(),
});
export const executionRuns = pgTable("execution_runs", {
  id: uuid("id").primaryKey(),
  planId: uuid("plan_id").notNull(),
  projectId: uuid("project_id").notNull(),
  environmentId: uuid("environment_id").notNull(),
  epoch: integer("epoch").notNull(),
  fence: integer("fence").notNull(),
  workerId: text("worker_id"),
  leaseExpiresAt: moment("lease_expires_at"),
  grantId: uuid("grant_id"),
  cleanupState: text("cleanup_state")
    .$type<"not_required" | "pending" | "running" | "complete" | "failed">()
    .notNull(),
  reservedMicros: amount("reserved_micros").notNull(),
  chargedMicros: amount("charged_micros").notNull(),
  terminalAt: moment("terminal_at"),
  createdAt: moment("created_at").notNull(),
});
export const effects = pgTable("effect_journal", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").notNull().unique(),
  effectKey: text("effect_key").notNull().unique(),
  fingerprint: text("fingerprint").notNull(),
  status: text("status").$type<"intent" | "succeeded" | "failed" | "unknown">().notNull(),
  evidenceRef: text("evidence_ref"),
  createdAt: moment("created_at").notNull(),
  updatedAt: moment("updated_at").notNull(),
});
export const taskGrants = pgTable("task_grants", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").notNull(),
  actorId: text("actor_id").notNull(),
  environmentId: uuid("environment_id").notNull(),
  epoch: integer("epoch").notNull(),
  fence: integer("fence").notNull(),
  tools: jsonb("tools").$type<string[]>().notNull(),
  destinations: jsonb("destinations").$type<string[]>().notNull(),
  maxCostMicros: amount("max_cost_micros").notNull(),
  usedMicros: amount("used_micros").notNull(),
  expiresAt: moment("expires_at").notNull(),
  revokedAt: moment("revoked_at"),
});
export const foundationRequests = pgTable("foundation_requests", {
  key: text("key").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  resourceId: text("resource_id").notNull(),
  kind: text("kind").notNull(),
  terminalAt: moment("terminal_at"),
  createdAt: moment("created_at").notNull(),
});
