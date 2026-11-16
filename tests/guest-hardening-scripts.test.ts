import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../infra/dedicated-server/guest");
const read = (name: string) => readFileSync(resolve(root, name), "utf8");
const shellScripts = readdirSync(root).filter((name) => name.endsWith(".sh"));

describe("guest hardening scripts", () => {
  it("makes every installer fail fast", () => {
    const missing = shellScripts.filter((name) => !read(name).includes("set -euo pipefail"));
    expect(missing).toEqual([]);
  });

  it("never embeds credential values", () => {
    const leaking = shellScripts.filter((name) =>
      /(SECRET|PASSWORD|PASSPHRASE|TOKEN)=[A-Za-z0-9+/]{12,}/.test(read(name)),
    );
    expect(leaking).toEqual([]);
  });

  it("arms the automatic rollback before the inbound firewall is loaded", () => {
    const script = read("g01-guest-firewall.sh");
    const apply = script.slice(script.indexOf("  apply)"));
    expect(apply.indexOf("arm_rollback")).toBeGreaterThan(-1);
    expect(apply.indexOf("arm_rollback")).toBeLessThan(apply.indexOf('nft -f "$CONF"'));
  });

  it("never flushes the ruleset that Docker and the host guard share", () => {
    for (const name of shellScripts) {
      expect(read(name)).not.toMatch(/^\s*(nft\s+)?flush ruleset/m);
    }
  });

  it("keeps the inbound policy at drop and SSH limited to WireGuard peers", () => {
    const script = read("g01-guest-firewall.sh");
    expect(script).toContain("policy drop");
    expect(script).toMatch(/ip saddr \{ \$\{ssh_v4\} \} tcp dport 22 accept/);
    expect(script).not.toMatch(/^\s*tcp dport 22 accept/m);
  });

  it("arms the egress rollback before the work VM output chain is loaded", () => {
    const script = read("g03-work-egress.sh");
    const apply = script.slice(script.indexOf("  apply)"));
    expect(apply.indexOf("systemd-run")).toBeGreaterThan(-1);
    expect(apply.indexOf("systemd-run")).toBeLessThan(apply.indexOf('nft -f "$NFT_CONF"'));
  });

  it("drops by default and reaches the resolvers only as the dnsmasq user", () => {
    const script = read("g03-work-egress.sh");
    expect(script).toContain("policy drop");
    expect(script).toMatch(/meta skuid "\$DNS_USER" ip daddr/);
    expect(script).toContain("reject with icmpx type admin-prohibited");
  });

  it("allows only the registries and forges the pipeline needs", () => {
    const domains = read("work-egress-domains.txt")
      .split("\n")
      .map((line) => line.replace(/#.*/, "").trim())
      .filter(Boolean);
    expect(domains).toEqual(
      expect.arrayContaining([
        "github.com",
        "registry.npmjs.org",
        "pypi.org",
        "debian.org",
        "playwright.dev",
      ]),
    );
    for (const domain of domains) {
      expect(domain).toMatch(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/);
    }
    expect(domains).not.toContain("google.com");
    expect(domains).not.toContain("anthropic.com");
  });

  it("turns LLMNR and multicast DNS off", () => {
    const script = read("g02-disable-llmnr.sh");
    expect(script).toContain("LLMNR=no");
    expect(script).toContain("MulticastDNS=no");
  });
});
