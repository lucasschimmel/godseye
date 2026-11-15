import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const directory = resolve(import.meta.dirname, "../infra/dedicated-server/templates");
const read = (name: string) => readFileSync(resolve(directory, name), "utf8");
const names = readdirSync(directory);

describe("dedicated-server coding/Hermes templates", () => {
  it("ships only non-executable .tmpl files", () => {
    expect(names.every((name) => name.endsWith(".tmpl"))).toBe(true);
  });
  it("runs the Hermes readiness gates as the unprivileged godseye user", () => {
    for (const name of [
      "godseye-hermes-gateway-ready.service.tmpl",
      "godseye-hermes-tools-ready.service.tmpl",
    ])
      expect(read(name)).toMatch(/^User=godseye$/m);
  });
  it("orders the Hermes gates before the control API and restarts on failure with backoff", () => {
    const unit = read("godseye-hermes-tools-ready.service.tmpl");
    expect(
      [/^Before=godseye-control-api\.service$/m, /^Restart=on-failure$/m, /^RestartSec=/m].map(
        (re) => re.test(unit),
      ),
    ).toEqual([true, true, true]);
  });
  it("renders bindings only onto tmpfs and removes them when OpenBao is sealed", () => {
    const script = read("render-bindings.sh.tmpl");
    expect(script).toContain('"tmpfs"');
    expect(script).toContain('refuse "OpenBao is sealed or unreachable"');
  });
  it("keeps the render unit credential-based with a private 0700 runtime directory", () => {
    const unit = read("godseye-bindings-render.service.tmpl");
    expect(
      [/^RuntimeDirectoryMode=0700$/m, /^LoadCredential=openbao-secret-id:/m].map((re) =>
        re.test(unit),
      ),
    ).toEqual([true, true]);
  });
  it("leaves unverified provenance as explicit placeholders in the install template", () => {
    expect(read("work-vm-coding-host-install.sh.tmpl")).toContain("@@RUNSC_BINARY_SHA256@@");
  });
  it("never embeds a credential value", () => {
    const all = names.map(read).join("\n");
    expect(all).not.toMatch(
      /(?:sk-[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY|hvs\.[A-Za-z0-9]{20,})/,
    );
  });
});
