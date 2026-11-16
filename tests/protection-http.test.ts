import { randomUUID } from "node:crypto";
import { CONTROL_API_HEADER, CONTROL_API_VERSION } from "@godseye/contracts";
import { InfrastructureEngine } from "@godseye/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../apps/control-api/src/app.js";
import { loadConfiguration } from "../apps/control-api/src/config.js";
import { createControlClient } from "../packages/control-client/src/index.js";
import { type OwnerAuthFixture, ownerAuthFixture } from "./owner-auth-fixture.js";

describe("owner backup, rotation and incident routes", () => {
  let fixture: OwnerAuthFixture;
  let app: ReturnType<typeof createApp>;
  let headers: Headers;
  beforeEach(async () => {
    fixture = await ownerAuthFixture();
    const infrastructure = new InfrastructureEngine(fixture.store);
    app = createApp(
      fixture.core,
      loadConfiguration({ GODSEYE_MODE: "local" }),
      fixture.identity,
      infrastructure.foundation,
      undefined,
      infrastructure,
    );
    headers = (await fixture.session()).headers;
    headers.set(CONTROL_API_HEADER, CONTROL_API_VERSION);
  });
  afterEach(async () => {
    await fixture.close();
  });
  function request(path: string, method = "GET", body?: unknown) {
    const selected = new Headers(headers);
    if (method !== "GET") selected.set("idempotency-key", randomUUID());
    return app.request(new URL(`/api/v1${path}`, fixture.origin), {
      method,
      headers: selected,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  it("authenticates every route before interpreting its body", async () => {
    const id = randomUUID();
    for (const [method, path] of [
      ["GET", "/databases/backups"],
      ["GET", "/databases/rotations"],
      ["POST", "/databases/rotations"],
      ["POST", `/databases/rotations/${id}/reconcile`],
      ["GET", "/incidents"],
      ["POST", "/incidents/evaluations"],
      ["POST", `/incidents/${id}/acknowledge`],
      ["POST", `/incidents/${id}/mute`],
      ["POST", `/incidents/${id}/resolve`],
    ]) {
      const response = await app.request(new URL(`/api/v1${path}`, fixture.origin), {
        method,
        headers: fixture.headers(),
        ...(method === "GET" ? {} : { body: "{}" }),
      });
      expect(response.status).toBe(401);
    }
  });

  it("reports every unconfigured provider honestly and keeps read-only status available", async () => {
    expect(await (await request("/databases/backups")).json()).toEqual({
      provider: "unconfigured",
      environments: [],
    });
    expect(await (await request("/databases/rotations")).json()).toMatchObject({
      execution: "unconfigured",
      roles: [],
    });
    expect(await (await request("/incidents")).json()).toEqual({
      notifier: "unconfigured",
      incidents: [],
    });
  });

  it("evaluates an empty system to no incidents", async () => {
    const response = await request("/incidents/evaluations", "POST", {});

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notifier: "unconfigured", incidents: [] });
  });

  it("refuses rotation with 503 when no provider is configured and rejects injected fields", async () => {
    const body = {
      projectId: randomUUID(),
      environmentId: randomUUID(),
      allocationId: randomUUID(),
      role: "api",
      slotId: null,
      expectedGeneration: 1,
    };

    expect((await request("/databases/rotations", "POST", body)).status).toBe(503);
    expect(
      (await request("/databases/rotations", "POST", { ...body, password: "caller" })).status,
    ).toBe(422);
  });

  it("serves the typed client against the real routes", async () => {
    const client = createControlClient({
      baseUrl: `${fixture.origin}/api/v1`,
      headers,
      fetch: async (input, init) => app.request(new Request(input, init)),
    });

    expect(await client.databaseBackups()).toMatchObject({ provider: "unconfigured" });
    expect(await client.incidentOverview()).toMatchObject({ notifier: "unconfigured" });
    await expect(client.evaluateIncidents("")).rejects.toThrow(/idempotency/i);
  });
});
