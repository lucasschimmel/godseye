import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) =>
  readFileSync(resolve(import.meta.dirname, "../infra/dedicated-server", name), "utf8");
const install = read("p10-install-edge-caddy.sh");
const build = read("p10-build-edge-caddy-image.sh");
const store = read("p10-store-edge-credentials.sh");
const render = read("p10-render-edge-env.sh");

describe("edge Caddy container install template", () => {
  it("matches the container name, route directory and Caddyfile path the delivery runtime uses", () => {
    expect(install).toContain('EDGE_CONTAINER="${GODSEYE_EDGE_CONTAINER:-godseye-edge}"');
    expect(install).toContain('-v "${ROUTE_DIR}:/etc/caddy/apps.d:ro"');
    expect(install).toContain("import /etc/caddy/apps.d/*.caddy");
    expect(install).toContain("--config /etc/caddy/Caddyfile");
  });
  it("publishes the private console port only on the WireGuard address and never uses host networking", () => {
    expect(install).toContain('-p "${GODSEYE_WG_BIND}:443:8443"');
    expect(install).not.toMatch(/--network host|--net=host|-p "?0\.0\.0\.0|-p "?\d+:\d+"?\s/);
  });
  it("refuses unpinned tags but accepts a digest reference or a locally built image id", () => {
    expect(install).toContain("must be pinned by sha256 digest or local image id");
    expect(install).toContain(
      "*@sha256:????????????????????????????????????????????????????????????????)",
    );
    expect(install).toMatch(/\n {2}sha256:\?{64}\)/);
    expect(install).toContain('-v "${DATA_VOLUME}:/data"');
  });
  it("defaults the console certificate to Let's Encrypt DNS-01 through OVH EU with env placeholders", () => {
    expect(install).toContain("dns ovh {");
    expect(install).toContain("endpoint ovh-eu");
    expect(install).toContain("application_key {env.OVH_APPLICATION_KEY}");
    expect(install).toContain("application_secret {env.OVH_APPLICATION_SECRET}");
    expect(install).toContain("consumer_key {env.OVH_CONSUMER_KEY}");
    expect(install).toContain("GODSEYE_CONSOLE_TLS_DIRECTIVE");
    expect(install).toContain("propagation_timeout");
  });
  it("passes credentials through --env-file and orders the edge after OpenBao", () => {
    expect(install).toContain('--env-file "${ENV_FILE}"');
    expect(install).toContain("ExecStartPre=${LIB_DIR}/render-edge-env.sh");
    expect(install).toContain("After=${WG_UNIT} docker.service ${BAO_UNIT}");
    expect(install).toContain('ENV_FILE="${GODSEYE_EDGE_ENV_FILE:-/run/godseye/edge.env}"');
  });
  it("uses the owner console hostname and keeps the local-command route refused", () => {
    expect(install).toContain("console.godseye.lucasschimmel.fr");
    expect(install).toContain("handle /api/v1/owner/local-command");
  });
  it("leaves the old host-systemd Caddy script as a non-executing stub", () => {
    expect(read("p07-caddy-https.sh")).toContain("exit 1");
  });
  it("renders the owner origin from the console hostname in the platform deploy script", () => {
    expect(read("p07-deploy-platform.sh")).toContain(
      "GODSEYE_PUBLIC_ORIGIN:=https://console.godseye.lucasschimmel.fr",
    );
  });
});

describe("edge Caddy image build template", () => {
  it("requires digest-pinned builder and base images", () => {
    expect(build).toContain("GODSEYE_CADDY_BUILDER_IMAGE");
    expect(build).toContain("must be pinned by sha256 digest");
  });
  it("builds the verified OVH module at an exact tag with xcaddy and checks it is compiled in", () => {
    expect(build).toContain("github.com/caddy-dns/ovh");
    expect(build).toContain("v1.1.0");
    expect(build).toContain("xcaddy build");
    expect(build).toContain("dns.providers.ovh");
  });
  it("labels the image with versions and outputs the image id", () => {
    expect(build).toContain("godseye.edge.dns-module");
    expect(build).toContain("godseye.edge.caddy-version");
    expect(build).toContain("GODSEYE_CADDY_IMAGE=${IMAGE_ID}");
  });
});

describe("edge credential handling templates", () => {
  it("prompts silently and never takes secrets from argv", () => {
    expect(store).toContain("read -rs");
    expect(store).not.toMatch(/\$\{?[1-9]\}?.*(OVH_|TOKEN)/);
  });
  it("grants a read-only policy on the single OVH path and an AppRole bound to loopback", () => {
    expect(store).toContain("godseye-edge-read");
    expect(store).toContain('capabilities = [\\"read\\"]');
    expect(store).toContain("${MOUNT}/data/${SECRET_PATH}");
    expect(store).toContain("127.0.0.1/32");
    expect(store).toContain("unset OVH_APPLICATION_KEY");
  });
  it("renders a 0600 root env file on tmpfs and exits 75 when OpenBao is sealed", () => {
    expect(render).toContain('ENV_FILE="${GODSEYE_EDGE_ENV_FILE:-/run/godseye/edge.env}"');
    expect(render).toContain("EX_TEMPFAIL=75");
    expect(render).toContain("chmod 0600");
    expect(render).toContain("auth/approle/login");
  });
  it("keeps secret values out of curl argv in every script", () => {
    for (const script of [store, render]) {
      expect(script).toContain('-K <(printf \'header = "X-Vault-Token: %s"');
      expect(script).not.toMatch(/-H\s+"?X-Vault-Token/);
    }
  });
});
