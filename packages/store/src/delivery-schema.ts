import type {
  CreateDeliveryPolicyInput,
  DeliveryArtifactView,
  RepositoryConfigurationInput,
} from "@godseye/contracts";
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const deliveryPolicies = pgTable("delivery_policies", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  environmentId: uuid("environment_id").notNull(),
  input: jsonb("input").$type<CreateDeliveryPolicyInput>().notNull(),
  repository: jsonb("repository").$type<RepositoryConfigurationInput>().notNull(),
  hash: text("hash").notNull(),
  revision: integer("revision").notNull().default(0),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
export const deliveryPreparations = pgTable("delivery_preparations", {
  id: uuid("id").primaryKey(),
  policyId: uuid("policy_id").notNull(),
  projectId: uuid("project_id").notNull(),
  environmentId: uuid("environment_id").notNull(),
  ciRunId: uuid("ci_run_id").notNull(),
  intent: text("intent").$type<"build" | "release" | "rollback" | "cleanup">().notNull(),
  commitSha: text("commit_sha").notNull(),
  artifactId: uuid("artifact_id"),
  deploymentId: uuid("deployment_id"),
  manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
  hash: text("hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
export const deliveryCommands = pgTable("delivery_commands", {
  planId: uuid("plan_id").primaryKey(),
  preparationId: uuid("preparation_id").notNull(),
  epoch: integer("epoch").notNull(),
  authority: text("authority").$type<"owner" | "policy">().notNull(),
});
export const deliveryRuns = pgTable("delivery_runs", {
  id: uuid("id").primaryKey(),
  preparationId: uuid("preparation_id").notNull(),
  runId: uuid("run_id").notNull().unique(),
  projectId: uuid("project_id").notNull(),
  environmentId: uuid("environment_id").notNull(),
  intent: text("intent").$type<"build" | "release" | "rollback" | "cleanup">().notNull(),
  state: text("state")
    .$type<
      | "reserved"
      | "building"
      | "built"
      | "staged"
      | "active"
      | "retired"
      | "released"
      | "unknown"
      | "quarantined"
    >()
    .notNull(),
  artifactId: uuid("artifact_id"),
  previousDeploymentId: uuid("previous_deployment_id"),
  generation: integer("generation").notNull(),
  evidence: text("evidence"),
  reason: text("reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
export const deliveryArtifacts = pgTable("delivery_artifacts", {
  id: uuid("id").primaryKey(),
  preparationId: uuid("preparation_id").notNull().unique(),
  projectId: uuid("project_id").notNull(),
  environmentId: uuid("environment_id").notNull(),
  metadata: jsonb("metadata").$type<DeliveryArtifactView>().notNull(),
  providerEvidence: jsonb("provider_evidence").$type<Record<string, unknown>>().notNull(),
});
export const deliveryTargets = pgTable("delivery_targets", {
  environmentId: uuid("environment_id").primaryKey(),
  activeDeploymentId: uuid("active_deployment_id"),
  pendingRunId: uuid("pending_run_id"),
  generation: integer("generation").notNull().default(0),
});
export const deliverySteps = pgTable(
  "delivery_steps",
  {
    id: uuid("id").primaryKey(),
    runId: uuid("run_id").notNull(),
    step: text("step").notNull(),
    state: text("state").$type<"intended" | "observed">().notNull(),
    scopeHash: text("scope_hash").notNull(),
    evidence: text("evidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("delivery_step_run_key").on(table.runId, table.step)],
);
export const deliveryPreviews = pgTable("delivery_previews", {
  id: uuid("id").primaryKey(),
  policyId: uuid("policy_id").notNull(),
  projectId: uuid("project_id").notNull(),
  environmentId: uuid("environment_id").notNull().unique(),
  pullRequestNumber: integer("pull_request_number").notNull(),
  state: text("state")
    .$type<"prepared" | "active" | "cleanup-required" | "retired" | "unknown">()
    .notNull(),
  url: text("url"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
