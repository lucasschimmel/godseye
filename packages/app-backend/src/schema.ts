import { bigint, boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const time = (name: string) => timestamp(name, { withTimezone: true }).notNull();
export const appScope = pgTable("app_scope", {
  id: integer("id").primaryKey(),
  projectId: text("project_id").notNull(),
  environmentId: text("environment_id").notNull(),
  migrationHash: text("migration_hash").notNull(),
  recoveryHold: boolean("recovery_hold").notNull(),
  recoveryConfiguration: jsonb("recovery_configuration").$type<unknown>(),
  storeId: text("store_id").notNull(),
});
export const user = pgTable("app_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  image: text("image"),
  createdAt: time("created_at"),
  updatedAt: time("updated_at"),
});
export const session = pgTable("app_session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  token: text("session_value").notNull().unique(),
  expiresAt: time("expires_at"),
  createdAt: time("created_at"),
  updatedAt: time("updated_at"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
});
export const account = pgTable("app_account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_value"),
  refreshToken: text("refresh_value"),
  idToken: text("id_value"),
  password: text("password_hash"),
  scope: text("scope"),
  accessTokenExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }),
  createdAt: time("created_at"),
  updatedAt: time("updated_at"),
});
export const verification = pgTable("app_verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: time("expires_at"),
  createdAt: time("created_at"),
  updatedAt: time("updated_at"),
});
export const files = pgTable("app_files", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  offset: bigint("upload_offset", { mode: "number" }).notNull(),
  status: text("status").$type<"uploading" | "committed" | "deleted">().notNull(),
  expectedHash: text("expected_hash"),
  sha256: text("sha256"),
  revision: integer("revision").notNull(),
  pendingOffset: bigint("pending_offset", { mode: "number" }),
  pendingHash: text("pending_hash"),
  cleanupPending: boolean("cleanup_pending").notNull(),
  createdAt: time("created_at"),
  expiresAt: time("expires_at"),
});
export const grants = pgTable("app_download_grants", {
  id: text("id").primaryKey(),
  fileId: text("file_id")
    .notNull()
    .references(() => files.id),
  userId: text("user_id").notNull(),
  expiresAt: time("expires_at"),
  revoked: boolean("revoked").notNull(),
});
export const events = pgTable("app_events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<unknown>().notNull(),
  eventKey: text("event_key").notNull().unique(),
  digest: text("digest").notNull(),
  occurredAt: time("occurred_at"),
});
export const authSchema = { user, session, account, verification };
export const receipts = pgTable("app_receipts", {
  key: text("key").primaryKey(),
  digest: text("digest").notNull(),
  result: jsonb("result").$type<unknown>().notNull(),
});
/** Independent from the bounded SSE history: unresolved job intent is never trimmed with it. */
export const jobEvents = pgTable("app_job_events", {
  id: text("id").primaryKey(),
  eventKey: text("event_key").notNull().unique(),
  envelope: jsonb("envelope")
    .$type<import("@godseye/contracts").ApplicationJobEnvelopeInput>()
    .notNull(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  createdAt: time("created_at"),
});
