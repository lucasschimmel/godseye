import type { RegisterJobDefinitionInput } from "@godseye/contracts";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const moment = (name: string) => timestamp(name, { withTimezone: true });
export const applicationJobEvents = pgTable("application_job_events", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  environmentId: uuid("environment_id").notNull(),
  producerId: uuid("producer_id").notNull(),
  epoch: integer("epoch").notNull(),
  hash: text("hash").notNull(),
  runIds: jsonb("run_ids").$type<string[]>().notNull(),
  createdAt: moment("created_at").notNull(),
});
export const jobDefinitions = pgTable(
  "job_definitions",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    name: text("name").notNull(),
    handler: text("handler").notNull(),
    trigger: jsonb("trigger").$type<RegisterJobDefinitionInput["trigger"]>().notNull(),
    effectPolicy: text("effect_policy")
      .$type<RegisterJobDefinitionInput["effectPolicy"]>()
      .notNull(),
    limits: jsonb("limits").$type<RegisterJobDefinitionInput["limits"]>().notNull(),
    revision: integer("revision").notNull().default(0),
    hash: text("hash").notNull(),
    paused: boolean("paused").notNull().default(false),
    nextFireAt: moment("next_fire_at"),
    createdAt: moment("created_at").notNull(),
    updatedAt: moment("updated_at").notNull(),
  },
  (table) => [uniqueIndex("job_definitions_cell_name_key").on(table.environmentId, table.name)],
);
export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey(),
    definitionId: uuid("definition_id").notNull(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    runId: uuid("run_id").unique(),
    state: text("state")
      .$type<
        | "queued"
        | "running"
        | "succeeded"
        | "failed"
        | "cancel_requested"
        | "cancelled"
        | "unknown"
        | "reconciling"
      >()
      .notNull(),
    trigger: text("trigger").$type<"cron" | "event" | "manual">().notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    payloadRef: uuid("payload_ref"),
    attempt: integer("attempt").notNull().default(1),
    scheduledFor: moment("scheduled_for").notNull(),
    startedAt: moment("started_at"),
    finishedAt: moment("finished_at"),
    reason: text("reason"),
    createdAt: moment("created_at").notNull(),
    updatedAt: moment("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("job_runs_dedupe_key").on(table.definitionId, table.dedupeKey),
    index("job_runs_state_idx").on(table.state, table.createdAt),
  ],
);
export const jobWorkerBindings = pgTable("job_worker_bindings", {
  environmentId: uuid("environment_id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  handlers: jsonb("handlers").$type<string[]>().notNull(),
  updatedAt: moment("updated_at").notNull(),
});
export const jobReconcileRequests = pgTable("job_reconcile_requests", {
  key: text("key").primaryKey(),
  jobRunId: uuid("job_run_id").notNull(),
  foundationRunId: uuid("foundation_run_id").notNull(),
  projectId: uuid("project_id").notNull(),
  environmentId: uuid("environment_id").notNull(),
  actorId: text("actor_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  state: text("state").$type<"pending" | "processing" | "complete">().notNull(),
  createdAt: moment("created_at").notNull(),
  completedAt: moment("completed_at"),
});
export const jobOutbox = pgTable(
  "job_outbox",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    jobRunId: uuid("job_run_id"),
    effectKey: text("effect_key").notNull(),
    destination: text("destination").notNull(),
    state: text("state")
      .$type<
        "pending" | "dispatching" | "delivered" | "failed" | "unknown" | "reconciling" | "held"
      >()
      .notNull(),
    attempts: integer("attempts").notNull().default(0),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    payloadHash: text("payload_hash").notNull(),
    lastError: text("last_error"),
    evidenceRef: text("evidence_ref"),
    claimedAt: moment("claimed_at"),
    createdAt: moment("created_at").notNull(),
    settledAt: moment("settled_at"),
  },
  (table) => [
    uniqueIndex("job_outbox_effect_key").on(table.environmentId, table.effectKey),
    index("job_outbox_state_idx").on(table.state, table.createdAt),
  ],
);
