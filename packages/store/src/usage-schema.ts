import type {
  PutUsageBudgetInput,
  UsageAttemptView,
  UsageInvoiceView,
  UsagePriceView,
} from "@godseye/contracts";
import {
  bigint,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
export const usageAttempts = pgTable(
  "usage_attempts",
  {
    id: uuid("id").primaryKey(),
    runId: uuid("run_id").notNull(),
    sequence: integer("sequence").notNull(),
    projectId: uuid("project_id").notNull(),
    metadata: jsonb("metadata").$type<UsageAttemptView>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [unique("usage_attempt_run_sequence").on(t.runId, t.sequence)],
);
export const usagePrices = pgTable("usage_prices", {
  id: uuid("id").primaryKey(),
  identity: text("identity").notNull().unique(),
  metadata: jsonb("metadata").$type<UsagePriceView>().notNull(),
});
export const usageBudgets = pgTable("usage_budgets", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  identity: text("identity").notNull().unique(),
  revision: integer("revision").notNull(),
  metadata: jsonb("metadata").$type<PutUsageBudgetInput>().notNull(),
});
export const usageReservations = pgTable(
  "usage_reservations",
  {
    id: uuid("id").primaryKey(),
    budgetId: uuid("budget_id").notNull(),
    runId: uuid("run_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    charged: bigint("charged", { mode: "number" }).notNull().default(0),
    state: text("state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [unique("usage_reservation_budget_run").on(t.budgetId, t.runId)],
);
export const usageInvoices = pgTable("usage_invoices", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  identity: text("identity").notNull().unique(),
  metadata: jsonb("metadata").$type<UsageInvoiceView>().notNull(),
});
export const usageReceipts = pgTable("usage_receipts", {
  key: text("key").primaryKey(),
  digest: text("digest").notNull(),
  result: jsonb("result").$type<unknown>().notNull(),
});
