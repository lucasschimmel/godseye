/** Sandbox loopback model transport. The sandbox has no network device; frames travel on stdio only. */

import { createServer } from "node:http";
import { createInterface } from "node:readline";

const MAX_FRAME_BYTES = 1048576;
const MAX_REQUESTS = 16;
const FRAME_PREFIX = "GODSEYE_BROKER ";
let next = 0;
const pending = new Map();
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (Buffer.byteLength(line) > MAX_FRAME_BYTES * 2) process.exit(71);
  const frame = JSON.parse(line);
  const response = pending.get(frame.id);
  if (!response || !Number.isInteger(frame.status) || frame.status < 100 || frame.status > 599)
    process.exit(72);
  pending.delete(frame.id);
  const body = Buffer.from(frame.bodyBase64, "base64");
  if (body.length > MAX_FRAME_BYTES) process.exit(73);
  response.writeHead(frame.status, {
    "content-type": frame.headers?.["content-type"] ?? "application/json",
  });
  response.end(body);
});
const server = createServer(async (request, response) => {
  if (next >= MAX_REQUESTS || pending.size > 1) {
    response.writeHead(429).end();
    return;
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_FRAME_BYTES / 2) {
      response.writeHead(413).end();
      return;
    }
    chunks.push(chunk);
  }
  const id = ++next;
  pending.set(id, response);
  const frame = JSON.stringify({
    id,
    method: request.method,
    path: request.url,
    headers: {},
    body: Buffer.concat(chunks).toString("base64"),
  });
  process.stdout.write(`${FRAME_PREFIX}${frame}\n`);
});
server.listen(8080, "127.0.0.1", () => process.send?.({ ready: true }));
setTimeout(() => process.exit(75), 180000).unref();
