import { randomUUID } from "node:crypto";
import {
  AesGcmSealer,
  InfrastructureEngine,
  type TransportOutcome,
  type WebhookRequest,
  type WebhookTransport,
} from "@godseye/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type RecoveryFixture, recoveryFixture } from "./recovery-helpers.js";

const TOKEN = "hook-token-3f9a1c0d77";
const URL_OK = `https://hooks.example.org/services/${TOKEN}`;

describe("incident delivery through owner webhook channels", () => {
  let fixture: RecoveryFixture;
  let engine: InfrastructureEngine;
  let requests: WebhookRequest[];
  let outcome: TransportOutcome;
  beforeEach(async () => {
    fixture = await recoveryFixture();
    requests = [];
    outcome = { kind: "response", status: 200 };
    const transport: WebhookTransport = {
      async post(request) {
        requests.push(request);
        return outcome;
      },
    };
    engine = new InfrastructureEngine(fixture.store, {
      ...fixture.configuration,
      notifications: {
        sealer: new AesGcmSealer("k".repeat(64)),
        transport,
        policy: { backoffMs: 0, sleep: async () => undefined },
      },
    });
  });
  afterEach(async () => {
    await fixture.store.close();
  });
  const addChannel = () =>
    engine.notifications.create(
      fixture.freshOwner(),
      { kind: "webhook", label: "Astreinte", url: URL_OK },
      randomUUID(),
    );
  /** A lagging archive is the stock fixture condition that raises an incident. */
  async function raiseIncident() {
    await fixture.backup();
    fixture.clock.advance(301_000);
    await engine.incidents.evaluate(fixture.freshOwner(), randomUUID());
  }
  const incidents = async () => (await engine.incidents.overview(fixture.freshOwner())).incidents;

  it("reports the notifier unconfigured and the incident unconfigured while no channel exists", async () => {
    await raiseIncident();

    const overview = await engine.incidents.overview(fixture.freshOwner());

    expect([overview.notifier, overview.incidents[0]?.delivery.state, requests.length]).toEqual([
      "unconfigured",
      "unconfigured",
      0,
    ]);
  });

  it("delivers a new incident to a live channel and marks it notified only after a 2xx answer", async () => {
    await addChannel();

    await raiseIncident();
    await engine.incidents.deliver();

    const [incident] = await incidents();
    expect(incident?.delivery).toMatchObject({ state: "notified", attempts: 1 });
    expect(JSON.parse(requests[0]?.body ?? "{}")).toMatchObject({
      source: "godseye",
      type: "incident",
      kind: "archive-lag",
      id: incident?.id,
    });
  });

  it("records the delivery result on the channel as confirmed", async () => {
    await addChannel();
    await raiseIncident();

    await engine.incidents.deliver();

    const [channel] = (await engine.notifications.overview(fixture.freshOwner())).channels;
    expect(channel?.delivery).toMatchObject({ state: "confirmed", httpStatus: 200 });
  });

  it("does not claim a notification when the receiver keeps failing", async () => {
    await addChannel();
    outcome = { kind: "response", status: 500 };
    await raiseIncident();

    await engine.incidents.deliver();

    const [incident] = await incidents();
    expect(incident?.delivery.state).toBe("failed");
  });

  it("marks the incident unknown, never notified, when the send may have reached the receiver", async () => {
    await addChannel();
    outcome = { kind: "error", reason: "TIMED_OUT", sent: true };
    await raiseIncident();

    await engine.incidents.deliver();

    const [incident] = await incidents();
    expect(incident?.delivery.state).toBe("unknown");
  });

  it("delivers an incident raised before any channel existed once a channel is added", async () => {
    await raiseIncident();
    await addChannel();

    await engine.incidents.deliver();

    const [incident] = await incidents();
    expect(incident?.delivery.state).toBe("notified");
  });

  it("reports the notifier unconfigured again once the only channel is removed", async () => {
    const channel = await addChannel();
    await engine.notifications.remove(
      fixture.freshOwner(),
      channel.id,
      { expectedRevision: channel.revision },
      randomUUID(),
    );

    const overview = await engine.incidents.overview(fixture.freshOwner());

    expect(overview.notifier).toBe("unconfigured");
  });

  it("uses one stable idempotency key per incident so a receiver can drop a repeat", async () => {
    await addChannel();
    outcome = { kind: "response", status: 500 };
    await raiseIncident();

    await engine.incidents.deliver();

    const keys = new Set(requests.map((request) => request.headers["idempotency-key"]));
    expect([requests.length > 1, keys.size]).toEqual([true, 1]);
  });
});
