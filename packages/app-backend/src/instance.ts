import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { ApplicationError } from "./contracts.js";
import { isMissing } from "./private-files.js";

/** One local writer; atomic guard protects PID inspection and stale-lock removal. */
export async function acquireApplicationInstance(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink())
    throw new ApplicationError("UNSAFE_STORAGE", "Linked instance directories are refused", 409);
  const guardPath = join(directory, "instance.guard");
  const guard = await open(guardPath, "wx", 0o600);
  const path = join(directory, "instance.json");
  const nonce = randomUUID();
  try {
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1)
        throw new ApplicationError("UNSAFE_STORAGE", "Linked instance locks are refused", 409);
      const handle = await open(path, "r");
      let previous: { pid: number };
      try {
        previous = JSON.parse(await handle.readFile("utf8"));
      } finally {
        await handle.close();
      }
      if (!Number.isSafeInteger(previous.pid) || previous.pid <= 0)
        throw new ApplicationError(
          "INSTANCE_LOCKED",
          "Application instance lock is malformed",
          409,
        );
      try {
        process.kill(previous.pid, 0);
        throw new ApplicationError("INSTANCE_LOCKED", "Application instance is already open", 409);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
      }
      await unlink(path);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, nonce }));
    } finally {
      await handle.close();
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      const current = await open(path, "r");
      let saved: { nonce: string };
      try {
        saved = JSON.parse(await current.readFile("utf8"));
      } finally {
        await current.close();
      }
      if (saved.nonce !== nonce)
        throw new ApplicationError("INSTANCE_LOCKED", "Application instance lock changed", 409);
      await unlink(path);
    };
  } finally {
    await guard.close();
    await unlink(guardPath);
  }
}
