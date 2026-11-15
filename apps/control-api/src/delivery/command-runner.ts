import { execFile } from "node:child_process";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}
/** Runs an executable with an argument vector; there is never a shell. Injected so tests use fakes. */
export type CommandRunner = (
  argv: readonly string[],
  options?: { timeoutMs?: number },
) => Promise<CommandResult>;

const DEFAULT_TIMEOUT_MS = 120_000;
const OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;

export const execCommandRunner: CommandRunner = (argv, options) =>
  new Promise((resolve, reject) => {
    const [file, ...args] = argv;
    if (!file) return reject(new Error("Command is empty"));
    execFile(
      file,
      args,
      {
        timeout: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: OUTPUT_LIMIT_BYTES,
        windowsHide: true,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (!error) return resolve({ code: 0, stdout, stderr });
        const code = (error as NodeJS.ErrnoException & { code?: unknown }).code;
        // A numeric code is the process exit status; anything else (ENOENT, timeout) is a runner failure.
        if (typeof code === "number") return resolve({ code, stdout, stderr });
        reject(new Error(`Command could not run: ${String(code ?? error.message)}`));
      },
    );
  });
