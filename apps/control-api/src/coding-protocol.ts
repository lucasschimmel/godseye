import { Buffer } from "node:buffer";
import type { CodingPreparationView } from "@godseye/contracts";
import { codingCodexArguments } from "../../../scripts/coding_runner_config.mjs";

type Runner = CodingPreparationView["runner"];
type ObjectValue = Record<string, unknown>;
export interface CodingProtocolResult {
  sessionId: string;
  summary: string;
  inputTokens: number | null;
  outputTokens: number | null;
}
const MAX_EVENT_BYTES = 262144;
const MAX_EVENTS = 10000;
const MAX_SESSION_LENGTH = 160;

function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Coding runner emitted an invalid event");
  }
  return value as ObjectValue;
}
function count(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("Coding runner emitted invalid usage");
  }
  return value as number;
}
function session(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    value.length > MAX_SESSION_LENGTH
  ) {
    throw new Error("Coding runner emitted an invalid session identity");
  }
  return value;
}

/** Bounded protocol decoding only; a valid stream is never physical stop or isolation evidence. */
export class CodingProtocolParser {
  private pending = "";
  private events = 0;
  private sessionId: string | null = null;
  private terminal = false;
  private failed = false;
  private summary = "";
  private inputTokens: number | null = null;
  private outputTokens: number | null = null;

  constructor(
    private readonly runner: Runner,
    private readonly maximumOutputBytes: number,
  ) {
    if (
      !Number.isSafeInteger(maximumOutputBytes) ||
      maximumOutputBytes < 1 ||
      maximumOutputBytes > 32768
    ) {
      throw new Error("Invalid coding output bound");
    }
  }

  push(chunk: string): void {
    this.pending += chunk;
    if (Buffer.byteLength(this.pending) > MAX_EVENT_BYTES)
      throw new Error("Coding event exceeds byte bound");
    let newline = this.pending.indexOf("\n");
    while (newline >= 0) {
      const line = this.pending.slice(0, newline).trim();
      this.pending = this.pending.slice(newline + 1);
      if (line) this.accept(object(JSON.parse(line)));
      newline = this.pending.indexOf("\n");
    }
  }

  finish(exitCode: number | null): CodingProtocolResult {
    if (this.pending.trim()) this.accept(object(JSON.parse(this.pending)));
    this.pending = "";
    if (exitCode !== 0 || !this.terminal || this.failed || !this.sessionId) {
      throw new Error("Coding runner did not prove a successful terminal result");
    }
    return {
      sessionId: this.sessionId,
      summary: this.summary,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
    };
  }

  private text(value: unknown): void {
    if (typeof value !== "string" || Buffer.byteLength(value) > this.maximumOutputBytes) {
      throw new Error("Coding result exceeds output bound");
    }
    this.summary = value;
  }

  private bind(value: unknown): void {
    const next = session(value);
    if (this.sessionId && this.sessionId !== next)
      throw new Error("Coding session identity changed");
    this.sessionId = next;
  }

  private accept(event: ObjectValue): void {
    this.events += 1;
    if (this.events > MAX_EVENTS || this.terminal)
      throw new Error("Unexpected coding runner event after terminal result");
    if (typeof event.type !== "string") throw new Error("Coding event has no type");
    if (this.runner === "codex") this.codex(event);
    else this.claude(event);
  }

  private codex(event: ObjectValue): void {
    if (event.type === "thread.started") this.bind(event.thread_id);
    if (event.type === "item.completed") {
      const item = object(event.item);
      if (item.type === "agent_message") this.text(item.text);
    }
    if (event.type === "turn.failed" || event.type === "error") {
      this.failed = true;
      this.terminal = true;
    }
    if (event.type === "turn.completed") {
      const usage = object(event.usage);
      this.inputTokens = count(usage.input_tokens);
      this.outputTokens = count(usage.output_tokens);
      this.terminal = true;
    }
  }

  private claude(event: ObjectValue): void {
    if (event.session_id !== undefined) this.bind(event.session_id);
    if (event.type === "result") {
      this.failed = event.is_error !== false || event.subtype !== "success";
      if (!this.failed) this.text(event.result);
      const usage = event.usage === undefined ? {} : object(event.usage);
      this.inputTokens = count(usage.input_tokens);
      this.outputTokens = count(usage.output_tokens);
      this.terminal = true;
    }
  }
}

/** Fixed guest-only argv. The caller cannot add CLI arguments, paths, tools or endpoints. */
export function codingRunnerArguments(runner: Runner): readonly string[] {
  return runner === "codex"
    ? codingCodexArguments()
    : [
        "--bare",
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--tools",
        "Read,Edit,Write,Bash",
        "--allowedTools",
        "Read,Edit,Write,Bash",
        "--permission-mode",
        "dontAsk",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
      ];
}
