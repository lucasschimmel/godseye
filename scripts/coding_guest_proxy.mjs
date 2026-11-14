/** Guest loopback model transport. The guest receives no general network interface. */

import { openSync, read, writeSync } from "node:fs";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

const MAX_FRAME_BYTES = 1048576;
const MAX_REQUESTS = 16;
const device = openSync("/dev/ttyS1", "r+");
let next = 0;
let pendingBytes = 0;
const pending = new Map();
const input = new Readable({
  read() {
    const bytes = Buffer.alloc(65536);
    read(device, bytes, 0, bytes.length, null, (error, length) => {
      if (error) this.destroy(error);
      else if (length) this.push(bytes.subarray(0, length));
      else this.push(null);
    });
  },
});
const lines = createInterface({ input });
lines.on("line", (line) => {
  if (Buffer.byteLength(line) > MAX_FRAME_BYTES) process.exit(71);
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
input.on("data", (bytes) => {
  pendingBytes += bytes.length;
  if (pendingBytes > MAX_FRAME_BYTES * MAX_REQUESTS) process.exit(74);
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
  writeSync(device, `${frame}\n`);
});
server.listen(8080, "127.0.0.1", () => process.send?.({ ready: true }));
setTimeout(() => process.exit(75), 180000).unref();
