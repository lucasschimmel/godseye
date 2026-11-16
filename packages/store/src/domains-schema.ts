import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const moment = (name: string) => timestamp(name, { withTimezone: true });
/** Custom hostnames bound to one project environment; `removed` rows are history, not served. */
export const projectDomains = pgTable("project_domains", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  environmentId: uuid("environment_id").notNull(),
  hostname: text("hostname").notNull(),
  state: text("state")
    .$type<"pending_verification" | "verified" | "active" | "failed" | "removed">()
    .notNull(),
  method: text("method").$type<"dns" | "txt">().notNull(),
  challengeToken: text("challenge_token").notNull(),
  revision: integer("revision").notNull(),
  failureCode: text("failure_code").$type<
    "DNS_NOT_FOUND" | "DNS_POINTS_ELSEWHERE" | "TXT_NOT_FOUND" | "TXT_MISMATCH" | "PUBLISH_FAILED"
  >(),
  lastCheckedAt: moment("last_checked_at"),
  verifiedAt: moment("verified_at"),
  activatedAt: moment("activated_at"),
  removedAt: moment("removed_at"),
  createdAt: moment("created_at").notNull(),
  updatedAt: moment("updated_at").notNull(),
});
