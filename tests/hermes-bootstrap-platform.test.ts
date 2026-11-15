import { describe, expect, it } from "vitest";
import {
  bootstrapEnvironment,
  commandSpec,
  parseBootstrapOptions,
} from "../scripts/hermes-tools-bootstrap-lib.mjs";

describe("Hermes tools bootstrap on native Linux and WSL2", () => {
  it("accepts native Linux without a distribution argument", () => {
    const settings = parseBootstrapOptions(["--start-user-manager"], "linux");
    expect(settings).toMatchObject({ platform: "linux", distro: null, repair: true });
  });
  it("runs fixed commands directly on Linux without wsl.exe", () => {
    const settings = parseBootstrapOptions([], "linux");
    expect(
      commandSpec(settings, { argv: ["/usr/bin/systemctl", "show", "user@1000.service"] }),
    ).toEqual({
      command: "/usr/bin/systemctl",
      args: ["show", "user@1000.service"],
    });
  });
  it("never escalates to root on Linux", () => {
    const settings = parseBootstrapOptions([], "linux");
    expect(() =>
      commandSpec(settings, {
        asRoot: true,
        argv: ["/usr/bin/systemctl", "start", "user@1000.service"],
      }),
    ).toThrow(/Administrator action required/);
  });
  it("rejects a WSL distribution argument on Linux", () => {
    expect(() => parseBootstrapOptions(["Ubuntu"], "linux")).toThrow();
  });
  it("keeps the WSL2 command shape on Windows", () => {
    const settings = parseBootstrapOptions(["Ubuntu"], "win32");
    expect(
      commandSpec(settings, { asRoot: true, argv: ["/usr/bin/systemctl", "start", "x"] }),
    ).toEqual({
      command: "wsl.exe",
      args: ["-d", "Ubuntu", "-u", "root", "--exec", "/usr/bin/systemctl", "start", "x"],
    });
  });
  it("passes no ambient environment to Linux children", () => {
    expect(bootstrapEnvironment("linux", { SECRET_TOKEN: "x", PATH: "/tmp/evil" })).toEqual({
      PATH: "/usr/bin:/bin",
      LC_ALL: "C",
    });
  });
  it("refuses relative bootstrap programs", () => {
    const settings = parseBootstrapOptions([], "linux");
    expect(() => commandSpec(settings, { argv: ["systemctl"] })).toThrow(/absolute/);
  });
});
