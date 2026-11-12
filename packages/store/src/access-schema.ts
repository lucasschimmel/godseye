import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const moment = (name: string) => timestamp(name, { withTimezone: true });
export const serviceIdentities = pgTable("service_identities", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  environmentId: uuid("environment_id").notNull(),
  purpose: text("purpose").notNull(),
  name: text("name").notNull(),
  workerId: text("worker_id"),
  epoch: integer("epoch").notNull(),
  revision: integer("revision").notNull(),
  status: text("status").notNull(),
  proofDigest: text("proof_digest"),
  proofIssued: boolean("proof_issued").notNull(),
  expiresAt: moment("expires_at"),
  createdAt: moment("created_at").notNull(),
});
export const accessSlots = pgTable("access_slots", {
  id: uuid("id").primaryKey(),
  identityId: uuid("identity_id").notNull(),
  name: text("name").notNull(),
  revision: integer("revision").notNull(),
  activeVersion: integer("active_version"),
  stagedVersion: integer("staged_version"),
  state: text("state").notNull(),
});
export const accessOperations = pgTable("access_operations", {
  id: uuid("id").primaryKey(),
  slotId: uuid("slot_id").notNull(),
  kind: text("kind").notNull(),
  state: text("state").notNull(),
  materialFingerprint: text("material_fingerprint"),
  candidateVersion: integer("candidate_version").notNull(),
  previousVersion: integer("previous_version"),
  expectedProviderVersion: integer("expected_provider_version").notNull(),
  adapterId: text("adapter_id"),
  receipt: text("receipt"),
  createdAt: moment("created_at").notNull(),
});
