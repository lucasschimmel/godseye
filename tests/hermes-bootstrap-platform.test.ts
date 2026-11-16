import { describe, expect, it } from "vitest";
import {
  bootstrapEnvironment,
  commandSpec,
  holderProgram,
  inspectProgram,
  parseBootstrapOptions,
  resolveServiceUid,
  userManagerUnit,
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
  it("derives the service uid from the running Linux user", () => {
    expect(resolveServiceUid("linux", {}, () => 994)).toBe(994);
    expect(resolveServiceUid("linux", { GODSEYE_SERVICE_UID: "1000" }, () => 1000)).toBe(1000);
    expect(resolveServiceUid("win32", {}, () => 5)).toBe(1000);
  });
  it("refuses root and a mismatched declared uid", () => {
    expect(() => resolveServiceUid("linux", {}, () => 0)).toThrow(/unprivileged/);
    expect(() => resolveServiceUid("linux", { GODSEYE_SERVICE_UID: "1000" }, () => 994)).toThrow(
      /differs/,
    );
    expect(() => resolveServiceUid("linux", { GODSEYE_SERVICE_UID: "x" }, () => 994)).toThrow();
  });
  it("renders uid-specific manager unit and programs", () => {
    expect(userManagerUnit(994)).toBe("user@994.service");
    expect(inspectProgram(994)).toContain("user-994.slice/user@994.service");
    expect(inspectProgram(994)).toContain("/run/user/994/bus");
    expect(inspectProgram(994)).not.toContain("1000");
    expect(inspectProgram(1000)).toContain("os.getuid()==1000");
    expect(holderProgram(60, 994)).toContain("os.getuid()==994");
  });
  it("refuses relative bootstrap programs", () => {
    const settings = parseBootstrapOptions([], "linux");
    expect(() => commandSpec(settings, { argv: ["systemctl"] })).toThrow(/absolute/);
  });
});
