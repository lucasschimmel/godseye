import { describe, expect, it } from "vitest";
import {
  type SpawnedProcess,
  SudoCellHostExecutor,
} from "../apps/control-api/src/cell-host-process.js";
import { configuredCellProviders } from "../apps/control-api/src/cell-providers.js";

function recorder(code = 0, stdout = "") {
  const calls: { argv: readonly string[]; stdin?: string; env: Record<string, string> }[] = [];
  const spawner: SpawnedProcess = {
    run: async (argv, options) => {
      calls.push({ argv, stdin: options.stdin, env: options.env });
      return { code, stdout };
    },
  };
  return { calls, spawner };
}

describe("configuredCellProviders", () => {
  it("stays unconfigured without a private cell binding", () => {
    expect(configuredCellProviders({})).toBeUndefined();
  });
});

describe("SudoCellHostExecutor", () => {
  it("wraps fixed argv in non-interactive sudo without a shell", async () => {
    const { calls, spawner } = recorder(0, "ok");

    await new SudoCellHostExecutor(spawner).run([
      "/usr/bin/systemctl",
      "start",
      "godseye-pg@x.service",
    ]);

    expect(calls[0]?.argv).toEqual([
      "/usr/bin/sudo",
      "-n",
      "--",
      "/usr/bin/systemctl",
      "start",
      "godseye-pg@x.service",
    ]);
  });
  it("keeps the cipher passphrase out of argv and passes it through the preserved environment", async () => {
    const { calls, spawner } = recorder();
    const secret = "p".repeat(40);

    await new SudoCellHostExecutor(spawner).run(["/usr/bin/pgbackrest", "info"], {
      user: "postgres",
      env: { PGBACKREST_REPO1_CIPHER_PASS: secret },
    });

    expect(calls[0]?.argv.join(" ")).not.toContain(secret);
    expect(calls[0]?.argv.slice(0, 5)).toEqual([
      "/usr/bin/sudo",
      "-n",
      "--preserve-env=PGBACKREST_REPO1_CIPHER_PASS",
      "-u",
      "postgres",
    ]);
    expect(calls[0]?.env.PGBACKREST_REPO1_CIPHER_PASS).toBe(secret);
  });
  it("rejects a relative executable", async () => {
    await expect(
      new SudoCellHostExecutor(recorder().spawner).run(["zfs", "list"]),
    ).rejects.toThrow();
  });
  it("rejects unsafe path characters before spawning", async () => {
    const { calls, spawner } = recorder();

    await expect(new SudoCellHostExecutor(spawner).readFile("/etc/x; rm -rf /")).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it("reports a missing file as null and a failed command as an error", async () => {
    const executor = new SudoCellHostExecutor(recorder(1).spawner);

    await expect(executor.readFile("/etc/godseye/pg/none/cell.env")).resolves.toBeNull();
    await expect(executor.run(["/usr/bin/true"])).rejects.toThrow("failed");
  });
});
