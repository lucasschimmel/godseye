import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const probe = spawnSync("python3", ["--version"]);
const python = probe.status === 0 ? "python3" : "python";
const available = spawnSync(python, ["--version"]).status === 0;

function run(code: string) {
  return spawnSync(python, ["-I", "-c", `import sys; sys.path.insert(0, "scripts"); ${code}`], {
    encoding: "utf8",
  });
}

describe.skipIf(!available)("Hermes service identity (python)", () => {
  it("derives per-uid runtime paths for 994 and 1000", () => {
    for (const uid of [994, 1000]) {
      const result = run(
        `import hermes_service_identity as i; u=i.service_uid(${uid}, ''); ` +
          "print(i.runtime_directory(u), i.user_manager_cgroup(u), i.environment(u)['DBUS_SESSION_BUS_ADDRESS'])",
      );
      expect(result.stdout.trim()).toBe(
        `/run/user/${uid} /user.slice/user-${uid}.slice/user@${uid}.service unix:path=/run/user/${uid}/bus`,
      );
    }
  });
  it("refuses root and a mismatched declared uid", () => {
    expect(run("import hermes_service_identity as i; i.service_uid(0, '')").status).not.toBe(0);
    expect(run("import hermes_service_identity as i; i.service_uid(994, '1000')").status).not.toBe(
      0,
    );
    expect(run("import hermes_service_identity as i; i.service_uid(994, '994')").status).toBe(0);
  });
});
