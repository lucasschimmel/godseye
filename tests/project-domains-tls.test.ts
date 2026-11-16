import { randomUUID } from "node:crypto";
import {
  CONTROL_API_HEADER,
  CONTROL_API_VERSION,
  DomainOverview,
  type DomainOverviewView,
  type ProjectDomainView,
} from "@godseye/contracts";
import {
  type CertificateProbe,
  classifyCertificate,
  DomainError,
  type DomainResolver,
  InfrastructureEngine,
} from "@godseye/core";
import { schema } from "@godseye/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../apps/control-api/src/app.js";
import { loadConfiguration } from "../apps/control-api/src/config.js";
import { projectInput } from "./helpers.js";
import { type OwnerAuthFixture, ownerAuthFixture } from "./owner-auth-fixture.js";

const CNAME = "godseye.example.org";
const PUBLIC_IP = "203.0.113.10";
const DAY_MS = 86_400_000;
const HOST = "app.customer.com";

type Answer = { notAfter: Date | null } | Error;
/** Edge stand-in: one scripted answer per host, recording every connection it was asked to make. */
function fakeProbe() {
  const answers = new Map<string, Answer>();
  const calls: { hostname: string; edgeAddress: string }[] = [];
  const probe: CertificateProbe = {
    async inspect(input) {
      calls.push(input);
      const answer = answers.get(input.hostname);
      if (!answer) throw new Error("no certificate scripted");
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { probe, answers, calls };
}
const inDays = (days: number) => new Date(Date.now() + days * DAY_MS);

describe("custom domain TLS expiry in the owner overview", () => {
  let fixture: OwnerAuthFixture;
  let app: ReturnType<typeof createApp>;
  let infrastructure: InfrastructureEngine;
  let headers: Headers;
  let projectId: string;
  let environmentId: string;
  let edge: ReturnType<typeof fakeProbe>;
  const records = new Map<string, string[]>();

  async function boot(withProbe: boolean) {
    fixture = await ownerAuthFixture();
    edge = fakeProbe();
    const resolver: DomainResolver = {
      cname: async (name) => records.get(name) ?? [],
      ipv4: async () => [],
      txt: async () => [],
    };
    infrastructure = new InfrastructureEngine(fixture.store, {
      domains: {
        resolver,
        publisher: { publish: async () => undefined },
        target: { cname: CNAME, ipv4: [PUBLIC_IP], platformDomain: CNAME },
        ...(withProbe ? { probe: edge.probe } : {}),
      },
    });
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
    const created = await request("/projects", "POST", projectInput);
    projectId = ((await created.json()) as { id: string }).id;
    const [environment] = await fixture.store.db.select().from(schema.environments);
    environmentId = (environment as { id: string }).id;
  }
  beforeEach(() => {
    records.clear();
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
  async function bind(hostname: string, verified = true) {
    const added = await request(`/projects/${projectId}/domains`, "POST", {
      environmentId,
      hostname,
      method: "dns",
    });
    const domain = (await added.json()) as ProjectDomainView;
    if (!verified) return domain;
    records.set(hostname, [CNAME]);
    await request(`/projects/${projectId}/domains/${domain.id}/verify`, "POST", {
      expectedRevision: domain.revision,
    });
    return domain;
  }
  const overview = async () =>
    DomainOverview.parse(await (await request("/domains")).json()) as DomainOverviewView;
  const tlsOf = async (hostname: string) =>
    (await overview()).domains.find((d) => d.hostname === hostname)?.tls;

  describe("with a certificate probe", () => {
    beforeEach(() => boot(true));

    it("reports a valid certificate with its real not-after date", async () => {
      const notAfter = inDays(60);
      edge.answers.set(HOST, { notAfter });
      await bind(HOST);

      const tls = await tlsOf(HOST);

      expect(tls).toMatchObject({
        state: "valid",
        expiresAt: notAfter.toISOString(),
        reason: null,
      });
    });

    it("flags a certificate that expires within 14 days", async () => {
      edge.answers.set(HOST, { notAfter: inDays(5) });
      await bind(HOST);

      expect((await tlsOf(HOST))?.state).toBe("expiring");
    });

    it("reports an expired certificate with its past date", async () => {
      const notAfter = inDays(-2);
      edge.answers.set(HOST, { notAfter });
      await bind(HOST);

      expect(await tlsOf(HOST)).toMatchObject({
        state: "expired",
        expiresAt: notAfter.toISOString(),
      });
    });

    it("reports unknown with no date when the handshake fails", async () => {
      edge.answers.set(HOST, new Error("ECONNRESET"));
      await bind(HOST);

      expect(await tlsOf(HOST)).toMatchObject({
        state: "unknown",
        expiresAt: null,
        reason: "HANDSHAKE_FAILED",
      });
    });

    it("reports unknown when the edge presents no certificate", async () => {
      edge.answers.set(HOST, { notAfter: null });
      await bind(HOST);

      expect((await tlsOf(HOST))?.reason).toBe("NO_CERTIFICATE");
    });

    it("never connects for a binding that is not served yet", async () => {
      edge.answers.set(HOST, { notAfter: inDays(60) });
      await bind(HOST, false);

      expect(await tlsOf(HOST)).toMatchObject({ state: "unknown", reason: "NOT_SERVED" });
      expect(edge.calls).toEqual([]);
    });

    it("never connects for a name whose DNS no longer points at the edge", async () => {
      edge.answers.set(HOST, { notAfter: inDays(60) });
      await bind(HOST);
      records.set(HOST, ["elsewhere.example.net"]);
      const probesBefore = edge.calls.length;
      const fresh = new InfrastructureEngine(fixture.store, {
        domains: {
          resolver: {
            cname: async (n) => records.get(n) ?? [],
            ipv4: async () => [],
            txt: async () => [],
          },
          target: { cname: CNAME, ipv4: [PUBLIC_IP], platformDomain: CNAME },
          probe: edge.probe,
        },
      });

      const view = await fresh.domains.listAll({
        id: "owner",
        kind: "owner",
        projectIds: [],
      });

      expect(view.domains[0]?.tls).toMatchObject({ state: "unknown", reason: "DNS_NOT_EDGE" });
      expect(edge.calls.length).toBe(probesBefore);
    });

    it("probes the platform edge address with the registered host, never a caller-chosen target", async () => {
      edge.answers.set(HOST, { notAfter: inDays(60) });
      await bind(HOST);

      await overview();

      expect(edge.calls).toEqual([{ hostname: HOST, edgeAddress: PUBLIC_IP }]);
    });

    it("refuses a non-owner actor with 403", async () => {
      const call = infrastructure.domains.listAll({ id: "svc", kind: "service", projectIds: [] });

      await expect(call).rejects.toBeInstanceOf(DomainError);
      await expect(call).rejects.toMatchObject({ status: 403 });
    });
  });

  describe("without a probe (local mode)", () => {
    beforeEach(() => boot(false));

    it("says the probe is not configured and invents no date", async () => {
      await bind(HOST);

      expect(await tlsOf(HOST)).toMatchObject({
        state: "unknown",
        expiresAt: null,
        reason: "PROBE_NOT_CONFIGURED",
      });
    });
  });
});

describe("certificate classification", () => {
  const now = new Date("2026-11-16T12:00:00.000Z");
  it("treats exactly now as expired and exactly 14 days as valid", () => {
    expect(classifyCertificate(now, now)).toBe("expired");
    expect(classifyCertificate(new Date(now.getTime() + 14 * DAY_MS), now)).toBe("valid");
    expect(classifyCertificate(new Date(now.getTime() + 14 * DAY_MS - 1), now)).toBe("expiring");
  });
});
