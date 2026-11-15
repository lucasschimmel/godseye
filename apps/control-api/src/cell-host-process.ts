import { connect } from "node:net";
import {
  type CellHostExecutor,
  HELPER_VERBS,
  HelperError,
  type HelperVerb,
} from "../../../packages/core/src/cell-host.js";

/** One request/response exchange with the root helper; replaceable in tests. */
export interface HelperTransport {
  exchange(request: string): Promise<string>;
}
const RESPONSE_LIMIT = 4 * 1024 * 1024;
const TIMEOUT_MS = 6 * 60 * 60 * 1000;
/** Unix-socket transport: one JSON line out, one JSON line back, then the helper closes. */
export class UnixSocketHelperTransport implements HelperTransport {
  constructor(
    private readonly socketPath: string,
    private readonly timeoutMs = TIMEOUT_MS,
  ) {}
  exchange(request: string) {
    return new Promise<string>((resolve, reject) => {
      const socket = connect(this.socketPath);
      const chunks: Buffer[] = [];
      let size = 0;
      socket.setTimeout(this.timeoutMs, () => socket.destroy(new Error("Helper timed out")));
      socket.once("connect", () => socket.write(`${request}\n`));
      socket.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > RESPONSE_LIMIT) socket.destroy(new Error("Helper response too large"));
        else chunks.push(chunk);
      });
      socket.once("error", () => reject(new Error("Private host helper unavailable")));
      socket.once("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
  }
}
/**
 * Calls the fixed verbs of the root helper over its group-restricted Unix socket. There is no sudo,
 * no setuid binary and no generic command channel, so the control service can keep
 * `NoNewPrivileges=true`. Secrets travel only inside the request body, never in argv.
 */
export class HelperSocketExecutor implements CellHostExecutor {
  constructor(private readonly transport: HelperTransport) {}
  async call(verb: HelperVerb, args: readonly string[], options?: { stdin?: string }) {
    if (!HELPER_VERBS.includes(verb) || args.some((a) => /[\0]/.test(a)))
      throw new Error("Invalid private host command");
    const reply = await this.transport.exchange(
      JSON.stringify({ verb, args, stdin: options?.stdin ?? "" }),
    );
    let parsed: { code?: unknown; stdout?: unknown };
    try {
      parsed = JSON.parse(reply.trim()) as { code?: unknown; stdout?: unknown };
    } catch {
      throw new Error("Private host helper returned an invalid response");
    }
    if (typeof parsed.code !== "number" || typeof parsed.stdout !== "string")
      throw new Error("Private host helper returned an invalid response");
    if (parsed.code !== 0) throw new HelperError("Private host command failed", parsed.code);
    return parsed.stdout;
  }
}
