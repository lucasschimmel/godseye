import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Single owner-controlled switch row; reads, reconciliation and protective stops ignore it. */
export const infrastructureAdmission = pgTable("infrastructure_admission", {
  id: integer("id").primaryKey(),
  state: text("state").$type<"open" | "paused">().notNull(),
  revision: integer("revision").notNull(),
  reason: text("reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});
