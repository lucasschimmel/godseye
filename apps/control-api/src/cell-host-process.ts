import { spawn } from "node:child_process";
import { assertArgv, type CellHostExecutor } from "../../../packages/core/src/cell-host.js";

export interface SpawnedProcess {
  run(
    argv: readonly string[],
    options: { env: Record<string, string>; stdin?: string },
  ): Promise<{ code: number; stdout: string }>;
}
const OUTPUT_LIMIT = 4 * 1024 * 1024;
/** Shell-free process runner with a bounded output size and no inherited environment. */
export const nodeSpawn: SpawnedProcess = {
  run: (argv, options) =>
    new Promise((resolve, reject) => {
      const [command, ...args] = argv;
      if (!command) return reject(new Error("Invalid private host command"));
      const child = spawn(command, args, {
        env: options.env,
        shell: false,
        stdio: ["pipe", "pipe", "ignore"],
      });
      const chunks: Buffer[] = [];
      let size = 0;
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > OUTPUT_LIMIT) child.kill("SIGKILL");
        else chunks.push(chunk);
      });
      child.once("error", () => reject(new Error("Private host command unavailable")));
      child.once("close", (code) =>
        resolve({
          code: size > OUTPUT_LIMIT ? 1 : (code ?? 1),
          stdout: Buffer.concat(chunks).toString("utf8"),
        }),
      );
      child.stdin.end(options.stdin ?? "");
    }),
};
const q = (value: string) => {
  if (!/^[A-Za-z0-9_./@:=-]+$/.test(value)) throw new Error("Invalid private host argument");
  return value;
};
/**
 * Executes the cell transport's fixed commands as the privileged host user through `sudo -n`. The
 * matching sudoers rules are an owner-reviewed deployment input (see docs/development/dedicated-cells.md);
 * this adapter never builds shell strings and never forwards the parent environment.
 */
export class SudoCellHostExecutor implements CellHostExecutor {
  constructor(
    private readonly spawner: SpawnedProcess = nodeSpawn,
    private readonly sudo = "/usr/bin/sudo",
  ) {}
  private async exec(
    argv: readonly string[],
    stdin?: string,
    user?: string,
    secrets: Readonly<Record<string, string>> = {},
  ) {
    assertArgv(argv);
    // Secrets travel only in the spawned process environment and `--preserve-env`, never in argv
    // (visible to `ps`). The sudoers rule must allow preserving exactly these names.
    const preserve = Object.keys(secrets).map(q);
    const full = [
      this.sudo,
      "-n",
      ...(preserve.length ? [`--preserve-env=${preserve.join(",")}`] : []),
      ...(user ? ["-u", q(user)] : []),
      "--",
      ...argv,
    ];
    return this.spawner.run(full, {
      env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C.UTF-8", ...secrets },
      ...(stdin === undefined ? {} : { stdin }),
    });
  }
  async run(
    argv: readonly string[],
    options?: { user?: string; stdin?: string; env?: Readonly<Record<string, string>> },
  ) {
    const result = await this.exec(argv, options?.stdin, options?.user, options?.env);
    if (result.code !== 0) throw new Error("Private host command failed");
    return result.stdout;
  }
  async writeFile(
    path: string,
    content: string,
    options: { mode: number; owner?: string; group?: string },
  ) {
    const parent = path.slice(0, path.lastIndexOf("/"));
    await this.run(["/usr/bin/install", "-d", "-m", "0750", parent]);
    await this.exec(
      [
        "/usr/bin/install",
        "-m",
        options.mode.toString(8).padStart(4, "0"),
        ...(options.owner ? ["-o", q(options.owner)] : []),
        ...(options.group ? ["-g", q(options.group)] : []),
        "/dev/stdin",
        q(path),
      ],
      content,
    ).then((result) => {
      if (result.code !== 0) throw new Error("Private host file write failed");
    });
  }
  async readFile(path: string) {
    const result = await this.exec(["/usr/bin/cat", "--", q(path)]);
    return result.code === 0 ? result.stdout : null;
  }
  async listDirectory(path: string) {
    const result = await this.exec(["/usr/bin/ls", "-1", "--", q(path)]);
    return result.code === 0 ? result.stdout.split("\n").filter(Boolean) : [];
  }
  async removeFile(path: string) {
    await this.run(["/usr/bin/rm", "-f", "--", q(path)]);
  }
}
