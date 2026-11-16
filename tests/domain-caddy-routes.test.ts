import { isPublicHostname } from "@godseye/contracts";
import { evaluateRouting, isApexDomain, isPlatformHostname } from "@godseye/core";
import { describe, expect, it } from "vitest";
import type { RouteStore } from "../apps/control-api/src/delivery/caddy-routes.js";
import type { CommandRunner } from "../apps/control-api/src/delivery/command-runner.js";
import { DockerRuntime } from "../apps/control-api/src/delivery/docker-runtime.js";
import {
  parseDomainRoutes,
  renderDomainRoutes,
  retargetDomainRoutes,
  routeUpstream,
} from "../apps/control-api/src/delivery/domain-routes.js";
import { RegistryClient } from "../apps/control-api/src/delivery/registry-client.js";

const ENVIRONMENT = "11111111-1111-4111-8111-111111111111";
const CNAME = "godseye.example.org";

function memoryStore() {
  const files = new Map<string, string>();
  const store: RouteStore = {
    read: async (id) => files.get(id) ?? null,
    write: async (id, content) => void files.set(id, content),
    remove: async (id) => void files.delete(id),
  };
  return { files, store };
}

describe("custom domain Caddy blocks", () => {
  it("renders one on-demand HTTP-01 block per host proxying to the environment upstream", () => {
    const content = renderDomainRoutes({
      environmentId: ENVIRONMENT,
      upstream: "gdy-run:8080",
      hostnames: ["b.customer.com", "a.customer.com"],
    });

    expect(content).toContain("https://a.customer.com {\n\ttls {\n\t\ton_demand\n\t}");
    expect(content).toContain("reverse_proxy gdy-run:8080 {");
    expect(content.indexOf("a.customer.com {")).toBeLessThan(content.indexOf("b.customer.com {"));
    expect(content).not.toContain("dns ");
  });

  it("answers 503 instead of proxying while the environment has no deployment", () => {
    const content = renderDomainRoutes({
      environmentId: ENVIRONMENT,
      upstream: null,
      hostnames: ["a.customer.com"],
    });

    expect(content).toContain('respond "No active deployment" 503');
    expect(content).not.toContain("reverse_proxy");
  });

  it("round-trips through its header and retargets without changing the host set", () => {
    const first = renderDomainRoutes({
      environmentId: ENVIRONMENT,
      upstream: null,
      hostnames: ["a.customer.com", "b.customer.com"],
    });

    const next = retargetDomainRoutes(first, "gdy-new:8080");

    expect(parseDomainRoutes(next)).toEqual({
      environmentId: ENVIRONMENT,
      upstream: "gdy-new:8080",
      hostnames: ["a.customer.com", "b.customer.com"],
    });
  });

  it("refuses hostnames and upstreams that could inject Caddyfile directives", () => {
    const render =
      (hostnames: string[], upstream: string | null = null) =>
      () =>
        renderDomainRoutes({ environmentId: ENVIRONMENT, upstream, hostnames });

    expect(render(["a.customer.com {\n\timport evil"])).toThrow();
    expect(render(["a.customer.com"], "x:1 {\n}")).toThrow();
    expect(render([])).toThrow();
  });

  it("reads the upstream back from a platform route file", () => {
    const route = "# godseye-route\nhttps://h {\n\treverse_proxy gdy-abc:8080 {\n\t}\n}\n";

    expect(routeUpstream(route)).toBe("gdy-abc:8080");
    expect(routeUpstream(null)).toBeNull();
  });
});

describe("hostname policy", () => {
  it("accepts public names and rejects wildcards, IPs, ports and reserved suffixes", () => {
    expect(isPublicHostname("app.customer.com")).toBe(true);
    for (const bad of [
      "*.a.com",
      "10.0.0.1",
      "a.com:443",
      "a.local",
      "localhost",
      "-a.com",
      "A.com",
    ])
      expect(isPublicHostname(bad)).toBe(false);
  });

  it("separates apex from subdomains including common two-label suffixes", () => {
    expect(isApexDomain("customer.com")).toBe(true);
    expect(isApexDomain("customer.co.uk")).toBe(true);
    expect(isApexDomain("www.customer.com")).toBe(false);
    expect(isApexDomain("www.customer.co.uk")).toBe(false);
  });

  it("treats the platform domain and everything below it as unbindable", () => {
    expect(isPlatformHostname(CNAME, CNAME)).toBe(true);
    expect(isPlatformHostname(`x.${CNAME}`, CNAME)).toBe(true);
    expect(isPlatformHostname(`x${CNAME}`, CNAME)).toBe(false);
  });
});

describe("routing evidence", () => {
  const target = { cname: CNAME, ipv4: ["203.0.113.10"], platformDomain: CNAME };
  const dns = (cname: Record<string, string[]>, ipv4: Record<string, string[]>) => ({
    cname: async (name: string) => cname[name] ?? [],
    ipv4: async (name: string) => ipv4[name] ?? [],
    txt: async () => [],
  });

  it("follows a CNAME chain to the platform host", async () => {
    const resolver = dns({ "a.c.com": ["edge.cdn.net."], "edge.cdn.net": [CNAME] }, {});

    expect(await evaluateRouting(resolver, "a.c.com", target)).toEqual({
      status: "ok",
      via: "cname",
    });
  });

  it("rejects a mix of platform and foreign A records", async () => {
    const resolver = dns({}, { "a.c.com": ["203.0.113.10", "198.51.100.1"] });

    expect(await evaluateRouting(resolver, "a.c.com", target)).toEqual({ status: "elsewhere" });
  });

  it("reports a name with no records as not configured", async () => {
    expect(await evaluateRouting(dns({}, {}), "a.c.com", target)).toEqual({ status: "none" });
  });

  it("stops following a CNAME loop instead of hanging", async () => {
    const resolver = dns({ "a.c.com": ["b.c.com"], "b.c.com": ["a.c.com"] }, {});

    expect(await evaluateRouting(resolver, "a.c.com", target)).toEqual({ status: "elsewhere" });
  });
});

describe("DockerRuntime custom domain publishing", () => {
  function runtime(options: { reloadFails?: boolean } = {}) {
    const routes = memoryStore();
    const domains = memoryStore();
    const commands: string[] = [];
    const run: CommandRunner = async (argv) => {
      commands.push(argv.join(" "));
      const reload = argv.includes("reload");
      return options.reloadFails && reload
        ? { code: 1, stdout: "", stderr: "reload failed" }
        : { code: 0, stdout: "", stderr: "" };
    };
    const instance = new DockerRuntime({
      registry: new RegistryClient({ baseUrl: "http://127.0.0.1:5000", repositoryPrefix: "gdy" }),
      routes: routes.store,
      domainRoutes: domains.store,
      run,
      caddyContainer: "godseye-edge",
      appDomain: CNAME,
    });
    return { instance, routes, domains, commands };
  }

  it("writes the host set against the current route upstream and reloads Caddy once", async () => {
    const { instance, routes, domains, commands } = runtime();
    routes.files.set(ENVIRONMENT, "x\n\treverse_proxy gdy-run:8080 {\n");

    await instance.publishDomains(ENVIRONMENT, ["a.customer.com"]);

    expect(parseDomainRoutes(domains.files.get(ENVIRONMENT) ?? null)).toMatchObject({
      upstream: "gdy-run:8080",
      hostnames: ["a.customer.com"],
    });
    expect(commands.filter((command) => command.includes(" reload "))).toHaveLength(1);
  });

  it("removes the file when the host set becomes empty", async () => {
    const { instance, domains } = runtime();
    await instance.publishDomains(ENVIRONMENT, ["a.customer.com"]);

    await instance.publishDomains(ENVIRONMENT, []);

    expect(domains.files.has(ENVIRONMENT)).toBe(false);
  });

  it("restores the previous file when the reload fails", async () => {
    const { instance, domains } = runtime();
    await instance.publishDomains(ENVIRONMENT, ["a.customer.com"]);
    const before = domains.files.get(ENVIRONMENT);
    const failing = runtime({ reloadFails: true });
    failing.domains.files.set(ENVIRONMENT, before as string);

    await expect(
      failing.instance.publishDomains(ENVIRONMENT, ["b.customer.com"]),
    ).rejects.toThrow();

    expect(failing.domains.files.get(ENVIRONMENT)).toBe(before);
  });

  it("does nothing when the published set is unchanged", async () => {
    const { instance, commands } = runtime();
    await instance.publishDomains(ENVIRONMENT, ["a.customer.com"]);
    const reloads = commands.length;

    await instance.publishDomains(ENVIRONMENT, ["a.customer.com"]);

    expect(commands).toHaveLength(reloads);
  });
});
