import { bigint, boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const ownerUser = pgTable("owner_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
export const ownerSession = pgTable("owner_session", {
  id: text("id").primaryKey(),
  token: text("session_value").notNull().unique(),
  userId: text("user_id")
    .notNull()
    .references(() => ownerUser.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
});
export const ownerAccount = pgTable("owner_account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => ownerUser.id),
  accessToken: text("access_value"),
  refreshToken: text("refresh_value"),
  idToken: text("id_value"),
  password: text("password_hash"),
  scope: text("scope"),
  accessTokenExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
export const ownerVerification = pgTable("owner_verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
export const ownerPasskey = pgTable("owner_passkey", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => ownerUser.id),
  credentialID: text("authenticator_id").notNull().unique(),
  counter: bigint("counter", { mode: "number" }).notNull(),
  deviceType: text("device_type").notNull(),
  backedUp: boolean("backed_up").notNull(),
  transports: text("transports"),
  createdAt: timestamp("created_at", { withTimezone: true }),
  aaguid: text("aaguid"),
});
export const ownerIdentity = pgTable("owner_identity", {
  singleton: integer("singleton").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => ownerUser.id),
});
export const ownerEvents = pgTable("owner_events", {
  id: uuid("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  action: text("action").notNull(),
  entityId: text("entity_id").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
});
export const ownerReceipts = pgTable("owner_receipts", {
  id: text("id").primaryKey(),
  fingerprint: text("fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
export const ownerThrottle = pgTable("owner_throttle", {
  bucket: text("bucket").primaryKey(),
  attempts: integer("attempts").notNull(),
});

export const ownerAuthSchema = {
  user: ownerUser,
  session: ownerSession,
  account: ownerAccount,
  verification: ownerVerification,
  passkey: ownerPasskey,
};
