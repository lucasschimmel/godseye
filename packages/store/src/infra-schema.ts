import type { DeclareInventoryInput, InfrastructureObservationInput } from "@godseye/contracts";
import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const moment = (name: string) => timestamp(name, { withTimezone: true });
export const infrastructureReceipts = pgTable("infrastructure_receipts", {
  key: text("key").primaryKey(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
});
export const infrastructureInventory = pgTable("infrastructure_inventory", {
  id: integer("id").primaryKey(),
  revision: integer("revision").notNull(),
  desired: jsonb("desired").$type<DeclareInventoryInput>(),
  observationRevision: integer("observation_revision").notNull(),
  observation: jsonb("observation").$type<InfrastructureObservationInput>(),
});
export const infrastructurePreparations = pgTable("infrastructure_preparations", {
  id: uuid("id").primaryKey(),
  allocationId: uuid("allocation_id").notNull().unique(),
  projectId: uuid("project_id").notNull(),
  environmentId: uuid("environment_id").notNull(),
  expectedProjectRevision: integer("expected_project_revision").notNull(),
  hash: text("hash").notNull(),
  inventoryRevision: integer("inventory_revision").notNull(),
  observationRevision: integer("observation_revision").notNull(),
  policyVersion: text("policy_version").notNull(),
  manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
  createdAt: moment("created_at").notNull(),
});
export const infrastructureAllocations = pgTable("infrastructure_allocations", {
  id: uuid("id").primaryKey(),
  preparationId: uuid("preparation_id").notNull().unique(),
  projectId: uuid("project_id").notNull(),
  environmentId: uuid("environment_id").notNull(),
  runId: uuid("run_id").unique(),
  state: text("state").notNull(),
  cleanupState: text("cleanup_state").notNull().default("not_required"),
  ipv4Subnet: text("ipv4_subnet").notNull(),
  ipv6Subnet: text("ipv6_subnet").notNull(),
  reason: text("reason"),
  updatedAt: moment("updated_at").notNull(),
});
export const infrastructureSteps = pgTable("infrastructure_steps", {
  id: uuid("id").primaryKey(),
  allocationId: uuid("allocation_id").notNull(),
  runId: uuid("run_id").notNull(),
  kind: text("kind").notNull(),
  state: text("state").notNull(),
  scope: jsonb("scope").$type<Record<string, unknown>>().notNull(),
  providerId: text("provider_id"),
  configurationHash: text("configuration_hash").notNull(),
  evidence: text("evidence"),
  createdAt: moment("created_at").notNull(),
});
