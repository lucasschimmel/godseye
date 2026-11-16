import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const moment = (name: string) => timestamp(name, { withTimezone: true });
type Result = "never" | "confirmed" | "failed" | "unknown";
type Reason =
  | "TARGET_BLOCKED"
  | "DNS_FAILED"
  | "CONNECTION_FAILED"
  | "TLS_FAILED"
  | "TIMED_OUT"
  | "REJECTED"
  | "REDIRECT_REFUSED"
  | "SERVER_ERROR"
  | "NO_CONFIRMATION";
/** Owner notification channels; the target (URL, optional signing secret) is sealed outside the database key. */
export const notificationChannels = pgTable("notification_channels", {
  id: uuid("id").primaryKey(),
  kind: text("kind").$type<"webhook">().notNull(),
  label: text("label").notNull(),
  host: text("host").notNull(),
  signed: boolean("signed").notNull(),
  sealedTarget: text("sealed_target").notNull(),
  state: text("state").$type<"active" | "removed">().notNull(),
  revision: integer("revision").notNull(),
  testState: text("test_state").$type<Result>().notNull(),
  testAt: moment("test_at"),
  testReason: text("test_reason").$type<Reason>(),
  testHttpStatus: integer("test_http_status"),
  testAttempts: integer("test_attempts").notNull(),
  deliveryState: text("delivery_state").$type<Result>().notNull(),
  deliveryAt: moment("delivery_at"),
  deliveryReason: text("delivery_reason").$type<Reason>(),
  deliveryHttpStatus: integer("delivery_http_status"),
  deliveryAttempts: integer("delivery_attempts").notNull(),
  createdAt: moment("created_at").notNull(),
  updatedAt: moment("updated_at").notNull(),
  removedAt: moment("removed_at"),
});
