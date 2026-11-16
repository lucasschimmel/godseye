import type { BackupPolicyInput, RecoveryPreparationView } from "@godseye/contracts";
import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const moment = (name: string) => timestamp(name, { withTimezone: true });
export const recoveryPreparations = pgTable("recovery_preparations", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  sourceEnvironmentId: uuid("source_environment_id").notNull(),
  sourceAllocationId: uuid("source_allocation_id").notNull(),
  environmentId: uuid("environment_id").notNull(),
  allocationId: uuid("allocation_id").notNull(),
  kind: text("kind").$type<RecoveryPreparationView["kind"]>().notNull(),
  backupId: uuid("backup_id"),
  backupSnapshot: jsonb("backup_snapshot").$type<Record<string, unknown>>(),
  targetTime: text("target_time"),
  name: text("name"),
  expectedProjectRevision: integer("expected_project_revision").notNull(),
  expectedEnvironmentRevision: integer("expected_environment_revision").notNull(),
  policy: jsonb("policy").$type<BackupPolicyInput>().notNull(),
  policyVersion: text("policy_version").notNull(),
  hash: text("hash").notNull(),
  binding: jsonb("binding").$type<Record<string, unknown>>(),
  sourceHash: text("source_hash").notNull(),
  repositoryId: uuid("repository_id").notNull(),
  inventoryRevision: integer("inventory_revision").notNull(),
  observationRevision: integer("observation_revision").notNull(),
  createdAt: moment("created_at").notNull(),
});
export const recoveryRuns = pgTable("recovery_runs", {
  id: uuid("id").primaryKey(),
  preparationId: uuid("preparation_id").notNull().unique(),
  runId: uuid("run_id").notNull().unique(),
  projectId: uuid("project_id").notNull(),
  environmentId: uuid("environment_id").notNull(),
  allocationId: uuid("allocation_id").notNull(),
  kind: text("kind").$type<RecoveryPreparationView["kind"]>().notNull(),
  state: text("state").notNull(),
  epoch: integer("epoch").notNull(),
  reason: text("reason"),
  evidence: jsonb("evidence").$type<Record<string, unknown>>(),
  updatedAt: moment("updated_at").notNull(),
});
export const recoveryBackups = pgTable("recovery_backups", {
  id: uuid("id").primaryKey(),
  preparationId: uuid("preparation_id").notNull().unique(),
  projectId: uuid("project_id").notNull(),
  environmentId: uuid("environment_id").notNull(),
  sourceAllocationId: uuid("source_allocation_id").notNull(),
  repositoryId: uuid("repository_id").notNull(),
  kind: text("kind").$type<"full" | "diff">().notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
  createdAt: moment("created_at").notNull(),
  verifiedAt: moment("verified_at"),
});
export const recoveryCommands = pgTable("recovery_commands", {
  planId: uuid("plan_id").primaryKey(),
  preparationId: uuid("preparation_id").notNull(),
  epoch: integer("epoch").notNull(),
});
export const recoverySteps = pgTable("recovery_steps", {
  runId: uuid("run_id").primaryKey(),
  scopeHash: text("scope_hash").notNull(),
  state: text("state").notNull(),
  evidence: text("evidence"),
  createdAt: moment("created_at").notNull(),
});
/** Durable intent and outcome of an owner-confirmed restore activation; `fenced` and `unknown` are resumable. */
export const recoveryActivations = pgTable("recovery_activations", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  environmentId: uuid("environment_id").notNull().unique(),
  sourceEnvironmentId: uuid("source_environment_id").notNull(),
  preparationId: uuid("preparation_id").notNull(),
  state: text("state").$type<"fenced" | "unknown" | "activated">().notNull(),
  epoch: integer("epoch").notNull(),
  acknowledged: jsonb("acknowledged").$type<string[]>().notNull(),
  reason: text("reason"),
  evidence: text("evidence"),
  createdAt: moment("created_at").notNull(),
  updatedAt: moment("updated_at").notNull(),
  activatedAt: moment("activated_at"),
});
