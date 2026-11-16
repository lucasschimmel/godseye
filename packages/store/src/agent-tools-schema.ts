import type {
  AgentToolAllocationRequest,
  AgentToolObservation,
  AgentToolReceipt,
} from "@godseye/contracts";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const agentToolAllocations = pgTable("agent_tool_allocations", {
  taskId: uuid("task_id").primaryKey(),
  request: jsonb("request").$type<AgentToolAllocationRequest>().notNull(),
  requestHash: text("request_hash").notNull(),
  state: text("state").notNull(),
  receipt: jsonb("receipt").$type<AgentToolReceipt>(),
  stopped: boolean("stopped").notNull().default(false),
  readBytes: integer("read_bytes").notNull().default(0),
  writeBytes: integer("write_bytes").notNull().default(0),
  outputBytes: integer("output_bytes").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
export const agentToolCalls = pgTable(
  "agent_tool_calls",
  {
    id: uuid("id").primaryKey(),
    taskId: uuid("task_id").notNull(),
    modelCallId: text("model_call_id").notNull(),
    sequence: integer("sequence").notNull(),
    name: text("name").notNull(),
    arguments: jsonb("arguments").$type<Record<string, string>>().notNull(),
    inputHash: text("input_hash").notNull(),
    state: text("state").notNull(),
    runId: uuid("run_id").notNull(),
    grantId: uuid("grant_id").notNull(),
    epoch: integer("epoch").notNull(),
    fence: integer("fence").notNull(),
    observation: jsonb("observation").$type<AgentToolObservation>(),
    resultHash: text("result_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("agent_tool_model_call").on(t.taskId, t.modelCallId),
    unique("agent_tool_sequence").on(t.taskId, t.sequence),
  ],
);
