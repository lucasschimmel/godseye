import { z } from "zod";

export const AGENT_TOOL_NAMES = [
  "godseye_workspace_list",
  "godseye_workspace_read",
  "godseye_workspace_write",
  "godseye_workspace_search",
  "godseye_json_validate",
] as const;
export const AGENT_TOOL_LIMITS = {
  maxCalls: 3,
  maxModelRequests: 4,
  timeoutSeconds: 30,
  readBytes: 65536,
  writeBytes: 65536,
  workspaceBytes: 1048576,
  outputBytes: 32768,
  fileBytes: 16384,
  files: 8,
  directoryEntries: 64,
  pathDepth: 8,
  physicalWorkspaceBytes: 4194304,
} as const;
export const AGENT_TOOL_RESOURCES = {
  memoryMiB: 512,
  swapMiB: 0,
  pids: 128,
  cpuMilliCores: 500,
} as const;
export const AGENT_TOOL_DESTINATION = "local.hermes-tools";
export const AgentToolName = z.enum(AGENT_TOOL_NAMES);
export type AgentToolName = z.infer<typeof AgentToolName>;
const boundedText = (maximum: number) =>
  z
    .string()
    .max(maximum)
    .refine(
      (value) => new TextEncoder().encode(value).byteLength <= maximum,
      "Text exceeds its UTF-8 byte limit",
    );
export const AgentWorkspacePath = z
  .string()
  .max(160)
  .refine((path) => {
    const parts = path.split("/");
    return (
      /^(scratch|artifacts)\/[A-Za-z0-9._/-]+$/.test(path) &&
      parts.length <= AGENT_TOOL_LIMITS.pathDepth &&
      parts.every((part) => part !== "." && part !== ".." && part.length > 0)
    );
  }, "Expected a bounded relative scratch or artifacts path");
export const AgentWorkspaceDirectory = z.union([
  z.literal("."),
  AgentWorkspacePath,
  z.literal("scratch"),
  z.literal("artifacts"),
]);
export const AgentToolPolicy = z
  .object({
    version: z.literal(1),
    tools: z
      .array(AgentToolName)
      .min(1)
      .max(5)
      .refine((tools) => new Set(tools).size === tools.length, "Duplicate tools are forbidden"),
    maxCalls: z.number().int().min(1).max(AGENT_TOOL_LIMITS.maxCalls),
    timeoutSeconds: z.number().int().min(1).max(AGENT_TOOL_LIMITS.timeoutSeconds),
    maxReadBytes: z.number().int().min(1).max(AGENT_TOOL_LIMITS.readBytes),
    maxWriteBytes: z.number().int().min(1).max(AGENT_TOOL_LIMITS.writeBytes),
    maxWorkspaceBytes: z.number().int().min(1).max(AGENT_TOOL_LIMITS.workspaceBytes),
    maxOutputBytes: z.number().int().min(1).max(AGENT_TOOL_LIMITS.outputBytes),
    resources: z
      .object({
        memoryMiB: z.literal(512),
        swapMiB: z.literal(0),
        pids: z.literal(128),
        cpuMilliCores: z.literal(500),
      })
      .strict(),
  })
  .strict();
export type AgentToolPolicy = z.infer<typeof AgentToolPolicy>;
export const AgentTaskToolSelection = z
  .object({
    policy: AgentToolPolicy,
    maxModelRequests: z.number().int().min(2).max(AGENT_TOOL_LIMITS.maxModelRequests),
    workspace: z
      .object({
        kind: z.literal("scratch"),
        files: z
          .array(
            z
              .object({
                path: AgentWorkspacePath,
                content: boundedText(AGENT_TOOL_LIMITS.fileBytes),
              })
              .strict(),
          )
          .max(AGENT_TOOL_LIMITS.files),
      })
      .strict(),
  })
  .strict()
  .superRefine((grant, context) => {
    const paths = grant.workspace.files.map((file) => file.path);
    const bytes = grant.workspace.files.reduce(
      (total, file) => total + new TextEncoder().encode(file.content).byteLength,
      0,
    );
    if (new Set(paths).size !== paths.length)
      context.addIssue({ code: "custom", message: "Duplicate workspace paths are forbidden" });
    if (bytes > grant.policy.maxWriteBytes || bytes > grant.policy.maxWorkspaceBytes)
      context.addIssue({ code: "custom", message: "Workspace seeds exceed the task byte budget" });
  });
export type AgentTaskToolSelection = z.infer<typeof AgentTaskToolSelection>;
export const AgentToolArguments = {
  godseye_workspace_list: z.object({ path: AgentWorkspaceDirectory }).strict(),
  godseye_workspace_read: z.object({ path: AgentWorkspacePath }).strict(),
  godseye_workspace_write: z
    .object({ path: AgentWorkspacePath, content: boundedText(AGENT_TOOL_LIMITS.fileBytes) })
    .strict(),
  godseye_workspace_search: z
    .object({
      path: AgentWorkspaceDirectory,
      text: boundedText(AGENT_TOOL_LIMITS.fileBytes).refine((text) => text.length > 0),
    })
    .strict(),
  godseye_json_validate: z.object({ content: boundedText(AGENT_TOOL_LIMITS.fileBytes) }).strict(),
} as const;
export const AgentToolCall = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
    name: AgentToolName,
    arguments: z.unknown(),
  })
  .strict();
export type AgentToolCall = z.infer<typeof AgentToolCall>;
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const AgentToolReceipt = z
  .object({
    unitInvocationId: z.string().regex(/^[a-f0-9]{32}$/),
    ociId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
    profileHash: Hash,
  })
  .strict();
export type AgentToolReceipt = z.infer<typeof AgentToolReceipt>;
export const AgentToolArtifact = z
  .object({
    path: AgentWorkspacePath.refine((path) => path.startsWith("artifacts/")),
    contentUtf8: boundedText(AGENT_TOOL_LIMITS.fileBytes),
    sha256: Hash,
    bytes: z.number().int().nonnegative().max(AGENT_TOOL_LIMITS.fileBytes),
  })
  .strict();
export const AgentToolObservation = z
  .object({
    state: z.enum(["succeeded", "failed", "unknown"]),
    result: boundedText(AGENT_TOOL_LIMITS.outputBytes),
    artifacts: z.array(AgentToolArtifact).max(AGENT_TOOL_LIMITS.files),
    receipt: AgentToolReceipt,
    usage: z
      .object({
        readBytes: z.number().int().nonnegative().max(AGENT_TOOL_LIMITS.readBytes),
        writeBytes: z.number().int().nonnegative().max(AGENT_TOOL_LIMITS.writeBytes),
        workspaceBytes: z.number().int().nonnegative().max(AGENT_TOOL_LIMITS.workspaceBytes),
      })
      .strict(),
  })
  .strict();
export type AgentToolObservation = z.infer<typeof AgentToolObservation>;
export const AgentToolAllocationObservation = z
  .object({
    state: z.enum(["available", "stopped", "unknown"]),
    receipt: AgentToolReceipt.nullable(),
    stopped: z.boolean(),
  })
  .strict();
export type AgentToolAllocationObservation = z.infer<typeof AgentToolAllocationObservation>;
export const AgentToolAllocationRequest = z
  .object({
    taskId: z.string().uuid(),
    projectId: z.string().uuid(),
    environmentId: z.string().uuid(),
    profileHash: Hash,
    policyHash: Hash,
    correlationId: z.string().uuid(),
    deadline: z.string().datetime(),
    grant: AgentTaskToolSelection,
  })
  .strict()
  .refine(
    (request) => request.taskId === request.correlationId,
    "Workspace identity must equal its immutable task identity",
  );
export type AgentToolAllocationRequest = z.infer<typeof AgentToolAllocationRequest>;
export const AgentToolExecutionRequest = z
  .object({
    allocation: AgentToolAllocationRequest,
    callId: z.string().uuid(),
    name: AgentToolName,
    arguments: z.record(z.string(), z.string()),
    inputHash: Hash,
    sequence: z.number().int().min(1).max(AGENT_TOOL_LIMITS.maxCalls),
  })
  .strict()
  .superRefine((request, context) => {
    if (!AgentToolArguments[request.name].safeParse(request.arguments).success)
      context.addIssue({
        code: "custom",
        message: "Tool arguments do not match the exact catalog schema",
      });
  });
export type AgentToolExecutionRequest = z.infer<typeof AgentToolExecutionRequest>;
export interface AgentToolExecutorContext {
  signal: AbortSignal;
  assertActive(): Promise<void>;
}
export interface AgentToolExecutor {
  readonly qualified: boolean;
  supports(grant: AgentTaskToolSelection): boolean;
  prepare(
    request: AgentToolAllocationRequest,
    context: AgentToolExecutorContext,
  ): Promise<AgentToolAllocationObservation>;
  execute(
    request: AgentToolExecutionRequest,
    context: AgentToolExecutorContext,
  ): Promise<AgentToolObservation>;
  inspect(
    request: AgentToolAllocationRequest,
    signal: AbortSignal,
  ): Promise<AgentToolAllocationObservation>;
  stop(
    request: AgentToolAllocationRequest,
    signal: AbortSignal,
  ): Promise<AgentToolAllocationObservation>;
}
export const AgentToolCallView = z
  .object({
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    sequence: z.number().int().positive(),
    name: AgentToolName,
    state: z.enum(["intended", "running", "succeeded", "failed", "unknown", "cancelled"]),
    inputHash: Hash,
    result: boundedText(AGENT_TOOL_LIMITS.outputBytes).nullable(),
    resultHash: Hash.nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type AgentToolCallView = z.infer<typeof AgentToolCallView>;
export const AgentTaskToolsDetail = z
  .object({
    taskId: z.string().uuid(),
    toolGrant: AgentTaskToolSelection.nullable(),
    state: z.enum(["disabled", "intended", "available", "stopped", "unknown"]),
    stopped: z.boolean(),
    calls: z.array(AgentToolCallView).max(AGENT_TOOL_LIMITS.maxCalls),
    artifacts: z.array(AgentToolArtifact).max(AGENT_TOOL_LIMITS.files),
    usage: z
      .object({
        calls: z.number().int().nonnegative(),
        readBytes: z.number().int().nonnegative(),
        writeBytes: z.number().int().nonnegative(),
        outputBytes: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type AgentTaskToolsDetail = z.infer<typeof AgentTaskToolsDetail>;
