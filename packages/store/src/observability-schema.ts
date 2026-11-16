import type { IngestTelemetryInput } from "@godseye/contracts";
import { bigint, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const moment = (name: string) => timestamp(name, { withTimezone: true });
export const telemetrySources = pgTable("telemetry_sources", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  authenticatedActorId: text("authenticated_actor_id").notNull(),
  projectId: uuid("project_id"),
  environmentId: uuid("environment_id"),
  resourceId: uuid("resource_id"),
  kind: text("kind").notNull(),
  staleAfterSeconds: integer("stale_after_seconds").notNull(),
  createdAt: moment("created_at").notNull(),
  logFloor: bigint("log_floor", { mode: "number" }).notNull().default(0),
  metricFloor: bigint("metric_floor", { mode: "number" }).notNull().default(0),
  healthCursor: bigint("health_cursor", { mode: "number" }),
  healthState: text("health_state"),
  healthObservedAt: moment("health_observed_at"),
  healthReceivedAt: moment("health_received_at"),
});
export const telemetryRecords = pgTable("telemetry_records", {
  cursor: bigint("cursor", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  id: uuid("id").notNull().unique(),
  sourceId: uuid("source_id").notNull(),
  requestKey: text("request_key").notNull().unique(),
  digest: text("digest").notNull(),
  observedAt: moment("observed_at").notNull(),
  receivedAt: moment("received_at").notNull(),
  data: jsonb("data").$type<IngestTelemetryInput>().notNull(),
});
export const incidentOutbox = pgTable("incident_outbox", {
  id: uuid("id").primaryKey(),
  incidentId: uuid("incident_id").notNull().unique(),
  payloadKey: text("payload_key").notNull().unique(),
  state: text("state").notNull(),
  attempts: integer("attempts").notNull(),
  claimId: uuid("claim_id"),
  claimedAt: moment("claimed_at"),
  updatedAt: moment("updated_at").notNull(),
  receipt: text("receipt"),
});
export const telemetryMetricRecords = pgTable("telemetry_metric_records", {
  cursor: bigint("cursor", { mode: "number" }).primaryKey(),
  id: uuid("id").notNull().unique(),
  sourceId: uuid("source_id").notNull(),
  requestKey: text("request_key").notNull().unique(),
  digest: text("digest").notNull(),
  observedAt: moment("observed_at").notNull(),
  receivedAt: moment("received_at").notNull(),
  data: jsonb("data").$type<IngestTelemetryInput>().notNull(),
});
