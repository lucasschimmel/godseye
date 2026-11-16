import { randomUUID } from "node:crypto";
import {
  CONTROL_API_HEADER,
  CONTROL_API_VERSION,
  MAX_DOMAINS_PER_PROJECT,
  type ProjectDomainListView,
  type ProjectDomainView,
} from "@godseye/contracts";
import {
  type DomainResolver,
  type DomainRoutePublisher,
  InfrastructureEngine,
} from "@godseye/core";
import { schema } from "@godseye/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../apps/control-api/src/app.js";
import { loadConfiguration } from "../apps/control-api/src/config.js";
import { projectInput } from "./helpers.js";
import { type OwnerAuthFixture, ownerAuthFixture } from "./owner-auth-fixture.js";

const STALE_MS = 3_600_000;
const CNAME = "godseye.example.org";
const PUBLIC_IP = "203.0.113.10";

/** DNS stand-in: a record table the test edits between verification attempts. */
function fakeDns() {
  const records = {
    cname: new Map<string, string[]>(),
    ipv4: new Map<string, string[]>(),
    txt: new Map<string, string[]>(),
  };
  const resolver: DomainResolver = {
    cname: async (name) => records.cname.get(name) ?? [],
    ipv4: async (name) => records.ipv4.get(name) ?? [],
    txt: async (name) => records.txt.get(name) ?? [],
  };
  return { records, resolver };
}
/** Edge stand-in recording the complete hostname set written per environment. */
function fakePublisher() {
  const published = new Map<string, string[]>();
  const calls: string[][] = [];
  let failing = false;
  const publisher: DomainRoutePublisher = {
    async publish({ environmentId, hostnames }) {
      if (failing) throw new Error("edge refused");
      published.set(environmentId, hostnames);
      calls.push(hostnames);
    },
  };
  return {
    publisher,
    published,
    calls,
    fail(value: boolean) {
      failing = value;
    },
  };
}

describe("custom application domains over the owner API", () => {
  let fixture: OwnerAuthFixture;
  let app: ReturnType<typeof createApp>;
  let headers: Headers;
  let projectId: string;
  let environmentId: string;
  let dns: ReturnType<typeof fakeDns>;
  let edge: ReturnType<typeof fakePublisher>;
  beforeEach(async () => {
    fixture = await ownerAuthFixture();
    dns = fakeDns();
    edge = fakePublisher();
    const infrastructure = new InfrastructureEngine(fixture.store, {
      domains: {
        resolver: dns.resolver,
        publisher: edge.publisher,
        target: { cname: CNAME, ipv4: [PUBLIC_IP], platformDomain: CNAME },
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
  ) {
    const selected = new Headers(from);
    if (method !== "GET") selected.set("idempotency-key", key);
    return app.request(new URL(`/api/v1${path}`, fixture.origin), {
      method,
      headers: selected,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const add = (hostname: string, method: "dns" | "txt" = "dns", from?: Headers) =>
    request(
      `/projects/${projectId}/domains`,
      "POST",
      { environmentId, hostname, method },
      undefined,
      from,
    );
  const verify = (domain: ProjectDomainView, key?: string) =>
    request(
      `/projects/${projectId}/domains/${domain.id}/verify`,
      "POST",
      { expectedRevision: domain.revision },
      key,
    );
  const remove = (domain: ProjectDomainView, from?: Headers) =>
    request(
      `/projects/${projectId}/domains/${domain.id}/remove`,
      "POST",
      { expectedRevision: domain.revision },
      undefined,
      from,
    );
  const list = async () =>
    (await (await request(`/projects/${projectId}/domains`)).json()) as ProjectDomainListView;
  const created = async (hostname: string, method: "dns" | "txt" = "dns") =>
    (await (await add(hostname, method)).json()) as ProjectDomainView;
  const ask = (domain: string) =>
    app.request(new URL(`/api/v1/domains/ask?domain=${domain}`, fixture.origin), {
      headers: { host: "172.30.0.1:4300" },
    });
  const pointAtPlatform = (hostname: string) => dns.records.cname.set(hostname, [CNAME]);

  it("binds a hostname as pending and offers the DNS target without serving it", async () => {
    const response = await add("app.customer.com");
    const domain = (await response.json()) as ProjectDomainView;

    expect(response.status).toBe(201);
    expect(domain).toMatchObject({
      hostname: "app.customer.com",
      state: "pending_verification",
      apex: false,
      challenge: null,
    });
    expect((await list()).target).toEqual({ cname: CNAME, ipv4: [PUBLIC_IP] });
    expect((await ask("app.customer.com")).status).toBe(404);
  });

  it("verifies a CNAME to the platform, publishes the route and activates the domain", async () => {
    const domain = await created("app.customer.com");
    pointAtPlatform("app.customer.com");

    const response = await verify(domain);
    const view = (await response.json()) as ProjectDomainView;

    expect(response.status).toBe(200);
    expect(view).toMatchObject({ state: "active", failure: null });
    expect(edge.published.get(environmentId)).toEqual(["app.customer.com"]);
    expect((await ask("app.customer.com")).status).toBe(200);
  });

  it("accepts an A record on the public IPv4 for an apex domain", async () => {
    const domain = await created("customer.com");
    dns.records.ipv4.set("customer.com", [PUBLIC_IP]);

    const view = (await (await verify(domain)).json()) as ProjectDomainView;

    expect(view).toMatchObject({ state: "active", apex: true });
  });

  it("refuses an apex that already points at another host and creates nothing", async () => {
    dns.records.ipv4.set("customer.com", ["198.51.100.7"]);

    const response = await add("customer.com");

    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "DOMAIN_POINTS_ELSEWHERE",
    );
    expect((await list()).domains).toHaveLength(0);
  });

  it("keeps a name without records pending and never serves it", async () => {
    const domain = await created("app.customer.com");

    const view = (await (await verify(domain)).json()) as ProjectDomainView;

    expect(view).toMatchObject({ state: "pending_verification" });
    expect(view.failure?.code).toBe("DNS_NOT_FOUND");
    expect(edge.calls).toHaveLength(0);
    expect((await ask("app.customer.com")).status).toBe(404);
  });

  it("fails a name that resolves to a foreign address and recovers once DNS is corrected", async () => {
    const domain = await created("app.customer.com");
    dns.records.ipv4.set("app.customer.com", ["198.51.100.7"]);
    const failed = (await (await verify(domain)).json()) as ProjectDomainView;
    dns.records.ipv4.set("app.customer.com", [PUBLIC_IP]);

    const retried = (await (await verify(failed)).json()) as ProjectDomainView;

    expect(failed).toMatchObject({ state: "failed" });
    expect(failed.failure?.code).toBe("DNS_POINTS_ELSEWHERE");
    expect(retried).toMatchObject({ state: "active", failure: null });
  });

  it("verifies ownership with the TXT challenge before any DNS switch", async () => {
    const domain = await created("app.customer.com", "txt");
    const challenge = domain.challenge as { name: string; value: string };
    dns.records.txt.set(challenge.name, ["godseye-verify=ffffffffffffffffffffffffffffffff"]);
    const wrong = (await (await verify(domain)).json()) as ProjectDomainView;
    dns.records.txt.set(challenge.name, [challenge.value]);

    const view = (await (await verify(wrong)).json()) as ProjectDomainView;

    expect(wrong.failure?.code).toBe("TXT_MISMATCH");
    expect(challenge.name).toBe("_godseye-challenge.app.customer.com");
    expect(view.state).toBe("active");
  });

  it("withdraws a served domain whose DNS later points elsewhere", async () => {
    const domain = await created("app.customer.com");
    pointAtPlatform("app.customer.com");
    const active = (await (await verify(domain)).json()) as ProjectDomainView;
    dns.records.cname.delete("app.customer.com");
    dns.records.ipv4.set("app.customer.com", ["198.51.100.7"]);

    const view = (await (await verify(active)).json()) as ProjectDomainView;

    expect(view.state).toBe("failed");
    expect(edge.published.get(environmentId)).toEqual([]);
    expect((await ask("app.customer.com")).status).toBe(404);
  });

  it("keeps a verified domain unserved with a publish failure when the edge refuses the route", async () => {
    const domain = await created("app.customer.com");
    pointAtPlatform("app.customer.com");
    edge.fail(true);

    const view = (await (await verify(domain)).json()) as ProjectDomainView;

    expect(view).toMatchObject({ state: "verified" });
    expect(view.failure?.code).toBe("PUBLISH_FAILED");
    expect(edge.published.size).toBe(0);
  });

  it("removes a domain with a fresh session, withdraws its route and stops certificate approval", async () => {
    const domain = await created("app.customer.com");
    pointAtPlatform("app.customer.com");
    const active = (await (await verify(domain)).json()) as ProjectDomainView;

    const response = await remove(active);

    expect(response.status).toBe(200);
    expect(((await response.json()) as ProjectDomainView).state).toBe("removed");
    expect(edge.published.get(environmentId)).toEqual([]);
    expect((await ask("app.customer.com")).status).toBe(404);
    expect((await list()).domains).toHaveLength(0);
  });

  it("keeps the binding when the edge cannot withdraw the route during removal", async () => {
    const domain = await created("app.customer.com");
    pointAtPlatform("app.customer.com");
    const active = (await (await verify(domain)).json()) as ProjectDomainView;
    edge.fail(true);

    const response = await remove(active);

    expect(response.status).toBe(502);
    expect((await list()).domains[0]?.state).toBe("active");
  });

  it("requires a fresh passkey session to add and to remove", async () => {
    const stale = (await fixture.session(STALE_MS * 2)).headers;
    stale.set(CONTROL_API_HEADER, CONTROL_API_VERSION);
    const domain = await created("app.customer.com");

    const adding = await add("other.customer.com", "dns", stale);
    const removing = await remove(domain, stale);

    expect(adding.status).toBe(403);
    expect(removing.status).toBe(403);
    expect(((await adding.json()) as { error: { code: string } }).error.code).toBe(
      "STEP_UP_REQUIRED",
    );
  });

  it("refuses platform hostnames, bare hosts and wildcards", async () => {
    const platform = await add(`app.${CNAME}`);
    const bare = await add("localhost");
    const wildcard = await add("*.customer.com");

    expect([platform.status, bare.status, wildcard.status]).toEqual([422, 422, 422]);
  });

  it("refuses a second binding of a live hostname and allows reuse after removal", async () => {
    const first = await created("app.customer.com");

    const duplicate = await add("app.customer.com");
    await remove(first);
    const reused = await add("app.customer.com");

    expect(duplicate.status).toBe(409);
    expect(reused.status).toBe(201);
  });

  it("limits the live domains of one project", async () => {
    for (let index = 0; index < MAX_DOMAINS_PER_PROJECT; index++)
      await created(`site${index}.customer.com`);

    const response = await add("extra.customer.com");

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "DOMAIN_LIMIT",
    );
  });

  it("replays an idempotent add and rejects a stale verification revision", async () => {
    const key = randomUUID();
    const body = { environmentId, hostname: "app.customer.com", method: "dns" };
    const first = await request(`/projects/${projectId}/domains`, "POST", body, key);
    const again = await request(`/projects/${projectId}/domains`, "POST", body, key);
    const domain = (await first.json()) as ProjectDomainView;

    const stale = await request(`/projects/${projectId}/domains/${domain.id}/verify`, "POST", {
      expectedRevision: domain.revision + 3,
    });

    expect(((await again.json()) as ProjectDomainView).id).toBe(domain.id);
    expect(stale.status).toBe(409);
    expect((await list()).domains).toHaveLength(1);
  });

  it("answers the edge ask guard without owner authentication", async () => {
    const domain = await created("app.customer.com");
    pointAtPlatform("app.customer.com");
    await verify(domain);

    const allowed = await ask("app.customer.com");
    const unknown = await ask("unknown.customer.com");
    const garbage = await ask("not a host");

    expect(allowed.status).toBe(200);
    expect([unknown.status, garbage.status]).toEqual([404, 404]);
  });
});

describe("custom domains without a configured resolver", () => {
  it("refuses to add a domain and says the capability is unavailable", async () => {
    const fixture = await ownerAuthFixture();
    const infrastructure = new InfrastructureEngine(fixture.store);
    const app = createApp(
      fixture.core,
      loadConfiguration({ GODSEYE_MODE: "local" }),
      fixture.identity,
      infrastructure.foundation,
      undefined,
      infrastructure,
    );
    const headers = (await fixture.session()).headers;
    headers.set(CONTROL_API_HEADER, CONTROL_API_VERSION);
    headers.set("idempotency-key", randomUUID());
    const project = await app.request(new URL("/api/v1/projects", fixture.origin), {
      method: "POST",
      headers,
      body: JSON.stringify(projectInput),
    });
    const { id } = (await project.json()) as { id: string };
    headers.set("idempotency-key", randomUUID());

    const response = await app.request(new URL(`/api/v1/projects/${id}/domains`, fixture.origin), {
      method: "POST",
      headers,
      body: JSON.stringify({ environmentId: randomUUID(), hostname: "app.customer.com" }),
    });

    expect(response.status).toBe(503);
    await fixture.close();
  });
});
