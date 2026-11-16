import { randomUUID } from "node:crypto";
import {
  CONTROL_API_HEADER,
  CONTROL_API_VERSION,
  type NotificationChannelOverviewView,
  type NotificationChannelView,
} from "@godseye/contracts";
import {
  AesGcmSealer,
  InfrastructureEngine,
  type TransportOutcome,
  type WebhookRequest,
  type WebhookTransport,
} from "@godseye/core";
import { schema } from "@godseye/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../apps/control-api/src/app.js";
import { loadConfiguration } from "../apps/control-api/src/config.js";
import { type OwnerAuthFixture, ownerAuthFixture } from "./owner-auth-fixture.js";

const STALE_MS = 3_600_000;
const TOKEN = "hook-token-3f9a1c0d77";
const SECRET = "s3cret-signing-key-0001";
const URL_OK = `https://hooks.example.org/services/${TOKEN}`;

/** Transport stand-in: records requests and answers from a queue the test controls. */
function fakeTransport() {
  const requests: WebhookRequest[] = [];
  let outcome: TransportOutcome = { kind: "response", status: 204 };
  const transport: WebhookTransport = {
    async post(request) {
      requests.push(request);
      return outcome;
    },
  };
  return {
    transport,
    requests,
    answer(next: TransportOutcome) {
      outcome = next;
    },
  };
}

describe("owner notification channels over the owner API", () => {
  let fixture: OwnerAuthFixture;
  let app: ReturnType<typeof createApp>;
  let headers: Headers;
  let staleHeaders: Headers;
  let wire: ReturnType<typeof fakeTransport>;
  const build = (sealer?: AesGcmSealer) => {
    const infrastructure = new InfrastructureEngine(fixture.store, {
      notifications: {
        sealer,
        transport: wire.transport,
        policy: { backoffMs: 0, sleep: async () => undefined },
      },
    });
    return createApp(
      fixture.core,
      loadConfiguration({ GODSEYE_MODE: "local" }),
      fixture.identity,
      infrastructure.foundation,
      undefined,
      infrastructure,
    );
  };
  beforeEach(async () => {
    fixture = await ownerAuthFixture();
    wire = fakeTransport();
    app = build(new AesGcmSealer("k".repeat(64)));
    headers = (await fixture.session()).headers;
    headers.set(CONTROL_API_HEADER, CONTROL_API_VERSION);
    staleHeaders = (await fixture.session(STALE_MS * 2)).headers;
    staleHeaders.set(CONTROL_API_HEADER, CONTROL_API_VERSION);
  });
  afterEach(async () => {
    await fixture.close();
  });
  function request(
    path: string,
    method = "GET",
    body?: unknown,
    key: string = randomUUID(),
    from = headers,
    target = app,
  ) {
    const selected = new Headers(from);
    if (method !== "GET") selected.set("idempotency-key", key);
    return target.request(new URL(`/api/v1/notifications/channels${path}`, fixture.origin), {
      method,
      headers: selected,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const create = (extra: Record<string, unknown> = {}, from = headers) =>
    request(
      "",
      "POST",
      { kind: "webhook", label: "Astreinte", url: URL_OK, signingSecret: SECRET, ...extra },
      undefined,
      from,
    );
  const created = async (extra: Record<string, unknown> = {}) =>
    (await (await create(extra)).json()) as NotificationChannelView;
  const test = (channel: NotificationChannelView, key?: string, from = headers) =>
    request(`/${channel.id}/test`, "POST", { expectedRevision: channel.revision }, key, from);
  const overview = async () =>
    (await (await request("")).json()) as NotificationChannelOverviewView;

  it("starts with no channel and reports the adapter as available", async () => {
    const body = await overview();

    expect([body.adapter, body.channels, body.kinds]).toEqual(["available", [], ["webhook"]]);
  });

  it("reports the adapter as unavailable and refuses creation when no sealing material exists", async () => {
    const bare = build(undefined);

    const read = (await (
      await request("", "GET", undefined, undefined, headers, bare)
    ).json()) as NotificationChannelOverviewView;
    const response = await request(
      "",
      "POST",
      { kind: "webhook", label: "x", url: URL_OK },
      undefined,
      headers,
      bare,
    );

    expect([read.adapter, response.status]).toEqual(["unavailable", 503]);
  });

  it("creates a channel and returns only its host, never the URL token or the signing secret", async () => {
    const response = await create();
    const text = await response.text();

    expect(response.status).toBe(201);
    expect(JSON.parse(text)).toMatchObject({
      host: "hooks.example.org",
      signed: true,
      test: { state: "never" },
      delivery: { state: "never" },
    });
    expect([text.includes(TOKEN), text.includes(SECRET)]).toEqual([false, false]);
  });

  it("stores the target sealed so the database holds neither the token nor the secret", async () => {
    await create();

    const [row] = await fixture.store.db.select().from(schema.notificationChannels);

    expect(JSON.stringify(row).includes(TOKEN) || JSON.stringify(row).includes(SECRET)).toBe(false);
  });

  it("does not repeat the token or secret in the audit journal", async () => {
    const channel = await created();
    await test(channel);

    const audit = JSON.stringify(await fixture.store.db.select().from(schema.audit));

    expect([audit.includes(TOKEN), audit.includes(SECRET)]).toEqual([false, false]);
  });

  it("refuses creation without a recent passkey session", async () => {
    const response = await create({}, staleHeaders);

    expect([response.status, (await overview()).channels]).toEqual([403, []]);
  });

  it.each([
    ["an http URL", { url: "http://hooks.example.org/x" }],
    ["a loopback address", { url: "https://127.0.0.1/x" }],
    ["a cloud metadata address", { url: "https://169.254.169.254/latest" }],
    ["localhost", { url: "https://localhost/x" }],
    ["an internal name", { url: "https://vault.internal/x" }],
    ["a non-standard port", { url: "https://hooks.example.org:8443/x" }],
    ["embedded credentials", { url: "https://u:p@hooks.example.org/x" }],
    ["an unknown channel kind", { kind: "email" }],
    ["a short signing secret", { signingSecret: "short" }],
  ])("refuses %s", async (_name, extra) => {
    const response = await create(extra);

    expect(response.status).toBe(422);
  });

  it("refuses a sixth live channel", async () => {
    for (let index = 0; index < 5; index += 1) await created({ label: `canal ${index}` });

    const response = await create({ label: "de trop" });

    expect(response.status).toBe(409);
  });

  it("confirms an arrival test only when the receiver answered 2xx and records the status", async () => {
    const channel = await created();
    wire.answer({ kind: "response", status: 204 });

    const response = await test(channel);
    const result = (await response.json()) as NotificationChannelView;

    expect(result.test).toMatchObject({ state: "confirmed", httpStatus: 204, attempts: 1 });
    expect(wire.requests).toHaveLength(1);
    expect(wire.requests[0]?.url.toString()).toBe(URL_OK);
    expect(wire.requests[0]?.headers["x-godseye-signature"]).toMatch(/^v1=[0-9a-f]{64}$/);
  });

  it("reports a receiver error as failed after bounded retries, never as delivered", async () => {
    const channel = await created();
    wire.answer({ kind: "response", status: 500 });

    const result = (await (await test(channel)).json()) as NotificationChannelView;

    expect(result.test).toMatchObject({
      state: "failed",
      reason: "SERVER_ERROR",
      httpStatus: 500,
      attempts: 2,
    });
  });

  it("reports a stalled send after the handshake as unknown", async () => {
    const channel = await created();
    wire.answer({ kind: "error", reason: "TIMED_OUT", sent: true });

    const result = (await (await test(channel)).json()) as NotificationChannelView;

    expect(result.test).toMatchObject({ state: "unknown", reason: "TIMED_OUT" });
  });

  it("reports a blocked target as failed without retrying", async () => {
    const channel = await created();
    wire.answer({ kind: "error", reason: "TARGET_BLOCKED", sent: false });

    const result = (await (await test(channel)).json()) as NotificationChannelView;

    expect([result.test.state, result.test.reason, wire.requests.length]).toEqual([
      "failed",
      "TARGET_BLOCKED",
      1,
    ]);
  });

  it("keeps the arrival test visible in the overview", async () => {
    const channel = await created();
    await test(channel);

    const [listed] = (await overview()).channels;

    expect(listed?.test.state).toBe("confirmed");
  });

  it("refuses an arrival test without a recent passkey session and sends nothing", async () => {
    const channel = await created();

    const response = await test(channel, undefined, staleHeaders);

    expect([response.status, wire.requests.length]).toEqual([403, 0]);
  });

  it("never sends again when the same idempotency key is replayed", async () => {
    const channel = await created();
    const key = randomUUID();

    await test(channel, key);
    const replay = await test(channel, key);

    expect([replay.status, wire.requests.length]).toEqual([200, 1]);
  });

  it("refuses a test against a stale revision", async () => {
    const channel = await created();

    const response = await request(`/${channel.id}/test`, "POST", {
      expectedRevision: channel.revision + 1,
    });

    expect([response.status, wire.requests.length]).toEqual([409, 0]);
  });

  it("removes a channel, destroys its sealed target and stops delivering to it", async () => {
    const channel = await created();

    const response = await request(`/${channel.id}/remove`, "POST", {
      expectedRevision: channel.revision,
    });
    const [row] = await fixture.store.db.select().from(schema.notificationChannels);
    const afterwards = await test(channel);

    expect([response.status, (await overview()).channels, row?.sealedTarget]).toEqual([
      200,
      [],
      "removed",
    ]);
    expect(afterwards.status).toBe(404);
  });

  it("refuses removal without a recent passkey session", async () => {
    const channel = await created();

    const response = await request(
      `/${channel.id}/remove`,
      "POST",
      { expectedRevision: channel.revision },
      undefined,
      staleHeaders,
    );

    expect([response.status, (await overview()).channels]).toEqual([403, [expect.anything()]]);
  });

  it("refuses every channel route without an owner session", async () => {
    const response = await app.request(new URL("/api/v1/notifications/channels", fixture.origin), {
      headers: { origin: fixture.origin, host: new URL(fixture.origin).host },
    });

    expect(response.status).toBe(401);
  });
});
