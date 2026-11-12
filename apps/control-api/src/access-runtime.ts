import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { AccessBroker, BaoAccessProvider, type FoundationEngine } from "@godseye/core";
import type { Store } from "@godseye/store";
import type { Configuration } from "./config.js";

/** Program-only material read from the existing owner-private state, never a request-selected path. */
async function controllerProof(config: Configuration) {
  const path = join(config.identityDir, "bao.auth");
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    resolve(await realpath(dirname(path))) !== resolve(config.identityDir)
  )
    throw new Error("Unsafe provider authority file");
  if (info.size < 1 || info.size > 4096) throw new Error("Invalid provider authority size");
  return (await readFile(path, "utf8")).trim();
}
export function createRuntimeAccess(
  store: Store,
  foundation: FoundationEngine,
  config: Configuration,
  fingerprintKey: string,
) {
  const provider = config.baoAddress
    ? new BaoAccessProvider({
        address: config.baoAddress,
        mount: config.baoMount,
        proof: () => controllerProof(config),
      })
    : undefined;
  // No runtime/target transition adapter is admitted by local configuration alone.
  return new AccessBroker(store, { foundation, provider, fingerprintKey });
}
