import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../infra/dedicated-server/host");
const read = (name: string) => readFileSync(resolve(root, name), "utf8");
const shellScripts = readdirSync(root).filter((name) => name.endsWith(".sh"));

describe("host hardening scripts", () => {
  it("makes every installer fail fast", () => {
    // The guest matrix deliberately keeps going after a failed check and counts failures instead.
    const missing = shellScripts
      .filter((name) => name !== "h05-guest-network-tests.sh")
      .filter((name) => !read(name).includes("set -euo pipefail"));
    expect(missing).toEqual([]);
  });

  it("never embeds credential values", () => {
    const leaking = shellScripts.filter((name) =>
      /(AWS_SECRET_ACCESS_KEY|RESTIC_PASSWORD)=[A-Za-z0-9+/]{12,}/.test(read(name)),
    );
    expect(leaking).toEqual([]);
  });

  it("ships every systemd unit the backup installer enables", () => {
    const installer = read("h01-host-backup.sh");
    const units = [
      "godseye-host-config-backup.service",
      "godseye-host-config-backup.timer",
      "godseye-offhost-backup@.service",
      "godseye-offhost-backup-config.timer",
      "godseye-offhost-backup-vms.timer",
    ];
    const absent = units.filter(
      (unit) => !installer.includes(unit) || !existsSync(resolve(root, "units", unit)),
    );
    expect(absent).toEqual([]);
  });

  it("keeps the guard firewall table drop-only", () => {
    const guard = read("templates/godseye-guard.nft");
    expect(guard.replace(/policy accept/g, "")).not.toMatch(/^[^#\n]*\baccept\b/m);
  });

  it("arms an automatic rollback before applying the firewall change", () => {
    const script = read("h06-firewall-hardening.sh");
    expect(script.indexOf("systemd-run")).toBeLessThan(script.indexOf('nft -f "$GUARD"'));
  });
});
