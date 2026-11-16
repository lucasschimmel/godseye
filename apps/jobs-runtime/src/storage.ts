import { createConnection } from "node:net";
import { connect as tlsConnect } from "node:tls";
import pg from "pg";
import { type ExternalStorage, localStorageUri } from "./config.js";

/** Private native dependency preflight; diagnostics never include connection strings or server output. */
export async function inspectWorkflowStorage(
  input: Pick<ExternalStorage, "postgresUri" | "redisUri">,
) {
  const url = localStorageUri(input.postgresUri, "postgresql:");
  const redis = localStorageUri(input.redisUri, "redis:");
  const client = new pg.Client({
    connectionString: url.href,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
  });
  let disconnected = false;
  client.on("error", () => {
    disconnected = true;
  });
  try {
    await client.connect();
    const result = await client.query<{
      database: string;
      role: string;
      port: number;
      privileged: boolean;
    }>(
      "SELECT current_database() AS database, current_user AS role, inet_server_port() AS port, (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls) AS privileged FROM pg_roles WHERE rolname=current_user",
    );
    if (
      !result.rows[0] ||
      result.rows[0].privileged ||
      result.rows[0].database !== decodeURIComponent(url.pathname.slice(1))
    )
      throw new Error("Workflow PostgreSQL requires its own non-superuser database owner");
    const info = await redisCommand(redis, ["INFO", "server"]);
    const persistence = await redisCommand(redis, ["INFO", "persistence"]);
    const memory = await redisCommand(redis, ["CONFIG", "GET", "maxmemory-policy"]);
    if (disconnected) throw new Error("Workflow PostgreSQL readiness authority disconnected");
    if (
      typeof info !== "string" ||
      typeof persistence !== "string" ||
      !/^aof_enabled:1\r?$/m.test(persistence) ||
      !Array.isArray(memory) ||
      memory[1] !== "noeviction"
    )
      throw new Error("Workflow Redis requires authenticated AOF persistence and noeviction");
    const runId = /^run_id:([a-f0-9]+)\r?$/m.exec(info)?.[1];
    if (!runId) throw new Error("Workflow Redis did not provide an instance identity");
    return {
      database: result.rows[0].database,
      role: result.rows[0].role,
      postgresPort: result.rows[0].port,
      redisInstanceId: runId,
    };
  } catch {
    throw new Error("External workflow storage failed its private readiness and authority checks");
  } finally {
    await client.end();
  }
}

type RedisValue = string | number | null | RedisValue[];
function parseReply(buffer: Buffer, offset = 0): { value: RedisValue; end: number } | undefined {
  const end = buffer.indexOf("\r\n", offset);
  if (end < 0) return;
  const line = buffer.toString("utf8", offset + 1, end),
    kind = buffer.toString("utf8", offset, offset + 1);
  if (kind === "-") throw new Error("Private Redis request refused");
  if (kind === "+") return { value: line, end: end + 2 };
  if (kind === ":") return { value: Number(line), end: end + 2 };
  if (kind === "$") {
    const size = Number(line);
    if (size === -1) return { value: null, end: end + 2 };
    if (!Number.isSafeInteger(size) || size < 0 || size > 262144)
      throw new Error("Invalid private Redis response");
    if (buffer.length < end + 2 + size + 2) return;
    return { value: buffer.toString("utf8", end + 2, end + 2 + size), end: end + 2 + size + 2 };
  }
  if (kind === "*") {
    const count = Number(line);
    if (!Number.isSafeInteger(count) || count < 0 || count > 100)
      throw new Error("Invalid private Redis response");
    let position = end + 2;
    const values: RedisValue[] = [];
    for (let index = 0; index < count; index++) {
      const item = parseReply(buffer, position);
      if (!item) return;
      values.push(item.value);
      position = item.end;
    }
    return { value: values, end: position };
  }
  throw new Error("Invalid private Redis protocol");
}
function encode(values: string[]) {
  return `*${values.length}\r\n${values.map((value) => `$${Buffer.byteLength(value)}\r\n${value}\r\n`).join("")}`;
}
async function redisCommand(url: URL, command: string[]): Promise<RedisValue> {
  return new Promise((resolve, reject) => {
    const secure = url.protocol === "rediss:";
    const target = {
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: Number(url.port),
    };
    const socket = secure
      ? tlsConnect({ ...target, minVersion: "TLSv1.2", rejectUnauthorized: true })
      : createConnection(target);
    let buffer = Buffer.alloc(0),
      authenticated = false,
      settled = false;
    const finish = (error?: Error, value?: RedisValue) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(value ?? null);
    };
    socket.setTimeout(5000, () => finish(new Error("Private Redis deadline exceeded")));
    socket.once("error", () => finish(new Error("Private Redis connection failed")));
    socket.once("end", () => finish(new Error("Private Redis response closed")));
    // Verified TLS (CA chain + IP SAN) for per-cell bridge addresses; plaintext only on loopback.
    socket.once(secure ? "secureConnect" : "connect", () =>
      socket.write(
        encode([
          "AUTH",
          ...(url.username ? [decodeURIComponent(url.username)] : []),
          decodeURIComponent(url.password),
        ]),
      ),
    );
    socket.on("data", (part) => {
      buffer = Buffer.concat([buffer, part]);
      try {
        if (buffer.length > 524288) throw new Error("Private Redis response exceeds limit");
        const reply = parseReply(buffer);
        if (!reply) return;
        buffer = buffer.subarray(reply.end);
        if (!authenticated) {
          if (reply.value !== "OK") throw new Error("Private Redis authentication refused");
          authenticated = true;
          socket.write(encode(command));
        } else finish(undefined, reply.value);
      } catch {
        finish(new Error("Private Redis response refused"));
      }
    });
  });
}
