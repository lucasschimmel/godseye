import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import { webhookUrlProblem } from "@godseye/contracts";
import {
  AesGcmSealer,
  httpsTransport,
  type SendPolicy,
  type TransportOutcome,
  type WebhookRequest,
  type WebhookTransport,
} from "@godseye/core";
import { describe, expect, it } from "vitest";
import { isPublicAddress } from "../packages/core/src/notification-address.js";
import {
  classifyNetworkError,
  guardedLookup,
  sendWebhook,
  signWebhook,
} from "../packages/core/src/notification-webhook.js";

const TOKEN = "hook-token-3f9a1c0d77";
const URL_OK = `https://hooks.example.org/services/${TOKEN}`;
const FIXED = () => new Date("2026-11-16T12:00:00.000Z");
const NO_WAIT: SendPolicy = { maxAttempts: 2, backoffMs: 0, sleep: async () => undefined };

describe("public address classification", () => {
  it.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111", "2002:5db8:d822::1"])(
    "accepts the routable address %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::7f00:1",
    "2001:db8::1",
    "2002:7f00:1::1",
    "not-an-address",
    "",
  ])("refuses %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});

describe("webhook URL policy", () => {
  it("accepts a public https URL with a token path and the standard port", () => {
    expect(webhookUrlProblem(`${URL_OK}?channel=ops`)).toBeNull();
    expect(webhookUrlProblem("https://hooks.example.org:443/x")).toBeNull();
  });
  it.each([
    ["http://hooks.example.org/x", "scheme"],
    ["https://user:pass@hooks.example.org/x", "credentials"],
    ["https://hooks.example.org:8443/x", "port"],
    ["https://hooks.example.org/x#frag", "fragment"],
    ["https://127.0.0.1/x", "host"],
    ["https://[::1]/x", "host"],
    ["https://169.254.169.254/latest/meta-data", "host"],
    ["https://localhost/x", "host"],
    ["https://db.internal/x", "host"],
    ["https://printer.local/x", "host"],
    ["https://single/x", "host"],
    ["https://hooks.example.org./x", "host"],
    ["not a url", "syntax"],
    ["https://hooks.example.org/x\r\nHost: evil", "syntax"],
  ])("refuses %s", (value, problem) => {
    expect(webhookUrlProblem(value)).toBe(problem);
  });
});

type Resolver = Parameters<typeof guardedLookup>[0];
function resolver(addresses: { address: string; family: 4 | 6 }[]): Resolver {
  return ((_host: string, _options: unknown, callback: (...args: unknown[]) => void) =>
    callback(null, addresses)) as unknown as Resolver;
}
function runLookup(resolve: Resolver, all: boolean) {
  return new Promise<{ error: (Error & { code?: string }) | null; result: unknown }>((done) =>
    guardedLookup(resolve)("hooks.example.org", { all }, ((
      error: (Error & { code?: string }) | null,
      result: unknown,
    ) => done({ error, result })) as never),
  );
}

describe("connect-time DNS guard", () => {
  it("lets a public answer through in both lookup shapes", async () => {
    const answer = resolver([{ address: "93.184.216.34", family: 4 }]);

    const single = await runLookup(answer, false);
    const all = await runLookup(answer, true);

    expect([single.error, single.result]).toEqual([null, "93.184.216.34"]);
    expect(all.result).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });
  it("refuses a name that resolves to a private address", async () => {
    const { error } = await runLookup(resolver([{ address: "10.0.0.5", family: 4 }]), true);
    expect(error?.code).toBe("GODSEYE_TARGET_BLOCKED");
  });
  it("refuses a name when any one of its answers is private", async () => {
    const mixed = resolver([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    const { error } = await runLookup(mixed, false);
    expect(error?.code).toBe("GODSEYE_TARGET_BLOCKED");
  });
  it("refuses an empty answer", async () => {
    const { error } = await runLookup(resolver([]), true);
    expect(error?.code).toBe("GODSEYE_TARGET_BLOCKED");
  });
});

describe("network error classification", () => {
  it.each([
    ["GODSEYE_TARGET_BLOCKED", "TARGET_BLOCKED"],
    ["ENOTFOUND", "DNS_FAILED"],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "TLS_FAILED"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "TLS_FAILED"],
    ["ECONNREFUSED", "CONNECTION_FAILED"],
    ["", "CONNECTION_FAILED"],
  ])("maps %s to %s", (code, reason) => {
    expect(classifyNetworkError(Object.assign(new Error("secret host detail"), { code }))).toBe(
      reason,
    );
  });
  it("classifies by the first cause of an aggregate error", () => {
    const error = new AggregateError([Object.assign(new Error("x"), { code: "ECONNREFUSED" })]);
    expect(classifyNetworkError(error)).toBe("CONNECTION_FAILED");
  });
});

/** Minimal stand-in for `https.request`; the test decides how the exchange ends. */
function fakeRequest(behave: (request: EventEmitter, respond: (status: number) => void) => void) {
  const seen: { options: Record<string, unknown>; body: string }[] = [];
  const request = ((options: Record<string, unknown>, callback: (response: unknown) => void) => {
    const emitter = Object.assign(new EventEmitter(), {
      destroy: () => emitter,
      end: (body: string) => {
        seen.push({ options, body });
        behave(emitter, (status) => callback({ statusCode: status }));
      },
    });
    return emitter;
  }) as never;
  return { request, seen };
}
const post = (transport: WebhookTransport) =>
  transport.post({
    url: new URL(URL_OK),
    body: '{"a":1}',
    headers: { "content-type": "application/json" },
  });

describe("https transport", () => {
  it("posts with certificate verification, TLS 1.2+, port 443 and the guarded lookup", async () => {
    const { request, seen } = fakeRequest((_req, respond) => respond(204));

    const outcome = await post(httpsTransport({ request }));

    expect(outcome).toEqual({ kind: "response", status: 204 });
    expect(seen[0]?.options).toMatchObject({
      method: "POST",
      port: 443,
      hostname: "hooks.example.org",
      path: `/services/${TOKEN}`,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      servername: "hooks.example.org",
      agent: false,
    });
    expect(typeof seen[0]?.options.lookup).toBe("function");
  });
  it("reports a refused connection as not sent", async () => {
    const { request } = fakeRequest((req) =>
      req.emit("error", Object.assign(new Error("x"), { code: "ECONNREFUSED" })),
    );

    expect(await post(httpsTransport({ request }))).toEqual({
      kind: "error",
      reason: "CONNECTION_FAILED",
      sent: false,
    });
  });
  it("reports a stalled exchange after the TLS handshake as sent but unanswered", async () => {
    const { request } = fakeRequest((req) => {
      const socket = new EventEmitter();
      req.emit("socket", socket);
      socket.emit("secureConnect");
    });

    expect(await post(httpsTransport({ request, timeoutMs: 20 }))).toEqual({
      kind: "error",
      reason: "TIMED_OUT",
      sent: true,
    });
  });
  it("refuses a private resolution on the real https stack without any network traffic", async () => {
    const asked: string[] = [];
    const resolve = ((host: string, _options: unknown, callback: (...args: unknown[]) => void) => {
      asked.push(host);
      callback(null, [{ address: "10.0.0.9", family: 4 }]);
    }) as unknown as Resolver;

    const outcome = await post(httpsTransport({ resolve, timeoutMs: 2000 }));

    expect(outcome).toEqual({ kind: "error", reason: "TARGET_BLOCKED", sent: false });
    expect(asked).toEqual(["hooks.example.org"]);
  });
});

function scripted(...outcomes: TransportOutcome[]) {
  const requests: WebhookRequest[] = [];
  const transport: WebhookTransport = {
    async post(request) {
      requests.push(request);
      return outcomes[Math.min(requests.length, outcomes.length) - 1] as TransportOutcome;
    },
  };
  return { transport, requests };
}
const send = (transport: WebhookTransport, secret: string | null = null) =>
  sendWebhook(transport, NO_WAIT, { url: URL_OK, secret }, { type: "t" }, "key:1", FIXED);

describe("webhook delivery", () => {
  it("confirms only on a 2xx answer and signs the exact body", async () => {
    const { transport, requests } = scripted({ kind: "response", status: 200 });

    const result = await send(transport, "s3cret-signing-key-0001");

    const request = requests[0] as WebhookRequest;
    const timestamp = String(Math.floor(FIXED().getTime() / 1000));
    expect(result).toEqual({ state: "confirmed", reason: null, httpStatus: 200, attempts: 1 });
    expect(request.headers["x-godseye-signature"]).toBe(
      `v1=${createHmac("sha256", "s3cret-signing-key-0001").update(`${timestamp}.${request.body}`).digest("hex")}`,
    );
    expect(request.headers["idempotency-key"]).toBe("key:1");
  });
  it("never puts the signing secret or the URL token in the request body or headers", async () => {
    const { transport, requests } = scripted({ kind: "response", status: 200 });

    await send(transport, "s3cret-signing-key-0001");

    const wire = JSON.stringify([requests[0]?.body, requests[0]?.headers]);
    expect([wire.includes("s3cret-signing-key-0001"), wire.includes(TOKEN)]).toEqual([
      false,
      false,
    ]);
  });
  it("omits the signature header when no secret is configured", async () => {
    const { transport, requests } = scripted({ kind: "response", status: 200 });

    await send(transport);

    expect(requests[0]?.headers["x-godseye-signature"]).toBeUndefined();
  });
  it("retries a 503 once with the same idempotency key and then confirms", async () => {
    const { transport, requests } = scripted(
      { kind: "response", status: 503 },
      { kind: "response", status: 200 },
    );

    const result = await send(transport);

    expect(result.state).toBe("confirmed");
    expect(result.attempts).toBe(2);
    expect(requests.map((request) => request.headers["idempotency-key"])).toEqual([
      "key:1",
      "key:1",
    ]);
  });
  it("bounds retries and reports a persistent 5xx as failed", async () => {
    const { transport, requests } = scripted({ kind: "response", status: 500 });

    const result = await send(transport);

    expect([result.state, result.reason, result.attempts, requests.length]).toEqual([
      "failed",
      "SERVER_ERROR",
      2,
      2,
    ]);
  });
  it("does not retry a 4xx rejection", async () => {
    const { transport, requests } = scripted({ kind: "response", status: 404 });

    const result = await send(transport);

    expect([result.state, result.reason, requests.length]).toEqual(["failed", "REJECTED", 1]);
  });
  it("refuses to follow a redirect and does not retry it", async () => {
    const { transport, requests } = scripted({ kind: "response", status: 302 });

    const result = await send(transport);

    expect([result.reason, requests.length]).toEqual(["REDIRECT_REFUSED", 1]);
  });
  it("does not retry a blocked target or a TLS failure", async () => {
    const blocked = scripted({ kind: "error", reason: "TARGET_BLOCKED", sent: false });
    const tls = scripted({ kind: "error", reason: "TLS_FAILED", sent: false });

    await send(blocked.transport);
    await send(tls.transport);

    expect([blocked.requests.length, tls.requests.length]).toEqual([1, 1]);
  });
  it("reports a timeout after the handshake as unknown rather than failed", async () => {
    const { transport } = scripted({ kind: "error", reason: "TIMED_OUT", sent: true });

    const result = await send(transport);

    expect([result.state, result.reason, result.attempts]).toEqual(["unknown", "TIMED_OUT", 2]);
  });
  it("reports a refused connection as failed because nothing was sent", async () => {
    const { transport } = scripted({ kind: "error", reason: "CONNECTION_FAILED", sent: false });

    expect((await send(transport)).state).toBe("failed");
  });
  it("keeps unknown when a later retry fails definitively after an ambiguous first attempt", async () => {
    const { transport } = scripted(
      { kind: "error", reason: "TIMED_OUT", sent: true },
      { kind: "response", status: 500 },
    );

    expect((await send(transport)).state).toBe("unknown");
  });
  it("signs different timestamps differently", () => {
    expect(signWebhook("k".repeat(20), "1", "{}")).not.toBe(signWebhook("k".repeat(20), "2", "{}"));
  });
});

describe("sealed webhook targets", () => {
  const sealer = new AesGcmSealer("k".repeat(64));
  const plain = JSON.stringify({ url: URL_OK, secret: "s3cret-signing-key-0001" });

  it("round-trips a target bound to its row", () => {
    expect(sealer.open(sealer.seal(plain, "row-1"), "row-1")).toBe(plain);
  });
  it("produces ciphertext that reveals neither the URL nor the secret", () => {
    const sealed = sealer.seal(plain, "row-1");
    expect([
      sealed.includes(TOKEN),
      sealed.includes("s3cret"),
      sealed.includes("hooks.example"),
    ]).toEqual([false, false, false]);
  });
  it("seals the same value differently each time", () => {
    expect(sealer.seal(plain, "row-1")).not.toBe(sealer.seal(plain, "row-1"));
  });
  it("refuses to open a value under another row context", () => {
    expect(() => sealer.open(sealer.seal(plain, "row-1"), "row-2")).toThrow();
  });
  it("refuses a modified ciphertext", () => {
    const [version, iv, tag, data] = sealer.seal(plain, "row-1").split(".");
    const flipped = `${data?.slice(0, -2)}${data?.endsWith("AA") ? "BB" : "AA"}`;
    expect(() => sealer.open([version, iv, tag, flipped].join("."), "row-1")).toThrow();
  });
  it("refuses to open under different key material", () => {
    expect(() =>
      new AesGcmSealer("z".repeat(64)).open(sealer.seal(plain, "row-1"), "row-1"),
    ).toThrow();
  });
  it("rejects weak key material", () => {
    expect(() => new AesGcmSealer("short")).toThrow();
  });
});
