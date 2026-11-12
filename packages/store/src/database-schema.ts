import type { DatabaseProfileInput } from "@godseye/contracts";
import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const moment = (name: string) => timestamp(name, { withTimezone: true });
export const databasePreparations = pgTable("database_preparations", {
  id: uuid("id").primaryKey(),
  allocationId: uuid("allocation_id").notNull(),
  projectId: uuid("project_id").notNull(),
  environmentId: uuid("environment_id").notNull(),
  expectedProjectRevision: integer("expected_project_revision").notNull(),
  expectedEnvironmentRevision: integer("expected_environment_revision").notNull(),
  hash: text("hash").notNull(),
  policyVersion: text("policy_version").notNull(),
  profile: jsonb("profile").$type<DatabaseProfileInput>().notNull(),
  binding: jsonb("binding").$type<Record<string, unknown>>(),
  inventoryRevision: integer("inventory_revision").notNull(),
  observationRevision: integer("observation_revision").notNull(),
  createdAt: moment("created_at").notNull(),
});
export const databaseAllocations = pgTable("database_allocations", {
  id: uuid("id").primaryKey(),
  preparationId: uuid("preparation_id").notNull().unique(),
  projectId: uuid("project_id").notNull(),
  environmentId: uuid("environment_id").notNull(),
  runId: uuid("run_id").notNull().unique(),
  state: text("state").notNull(),
  requestedState: text("requested_state").notNull(),
  generation: integer("generation").notNull(),
  epoch: integer("epoch").notNull(),
  systemIdentifier: text("system_identifier"),
  verifiedScope: jsonb("verified_scope").$type<Record<string, unknown>>(),
  providerRef: text("provider_ref"),
  reason: text("reason"),
  updatedAt: moment("updated_at").notNull(),
});
export const databaseSteps = pgTable("database_steps", {
  id: uuid("id").primaryKey(),
  allocationId: uuid("allocation_id").notNull(),
  runId: uuid("run_id").notNull(),
  generation: integer("generation").notNull(),
  intent: text("intent").notNull(),
  state: text("state").notNull(),
  scopeHash: text("scope_hash").notNull(),
  evidence: text("evidence"),
  createdAt: moment("created_at").notNull(),
});
export const databaseCommands = pgTable("database_commands", {
  planId: uuid("plan_id").primaryKey(),
  preparationId: uuid("preparation_id").notNull(),
  intent: text("intent").notNull(),
  expectedGeneration: integer("expected_generation").notNull(),
  epoch: integer("epoch").notNull(),
  previousScope: jsonb("previous_scope").$type<Record<string, unknown>>(),
});
