import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) =>
  readFileSync(resolve(import.meta.dirname, "../infra/dedicated-server", name), "utf8");
const install = read("p10-install-edge-caddy.sh");

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
  it("requires a digest-pinned image and persists Let's Encrypt state in named volumes", () => {
    expect(install).toContain("GODSEYE_CADDY_IMAGE");
    expect(install).toContain("must be pinned by sha256 digest");
    expect(install).toContain('-v "${DATA_VOLUME}:/data"');
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
