import { randomBytes } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ApplicationScope, type ApplicationScopeInput } from "./contracts.js";
import { openApplicationFile, protectApplicationDirectory } from "./private-files.js";
import { createApplicationBackend } from "./runtime.js";
import { type ApplicationBackendOptions, applicationState } from "./state.js";
import { openApplicationStore } from "./store.js";

export interface LocalApplicationOptions
  extends Omit<ApplicationBackendOptions, "store" | "authMaterial" | "filesRoot" | "scope"> {
  directory: string;
  scope: ApplicationScopeInput;
}
/** Explicit local operator helper. Creates only project-owned private state; never owner accounts. */
export async function openLocalApplication(options: LocalApplicationOptions) {
  const scope = ApplicationScope.parse(options.scope);
  const directory = await protectApplicationDirectory(options.directory);
  const materialPath = join(directory, "identity.key");
  try {
    const handle = await open(materialPath, "wx", 0o600);
    try {
      await handle.writeFile(randomBytes(48).toString("base64url"));
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  const store = await openApplicationStore({ scope, dataDir: join(directory, "database") });
  try {
    const state = applicationState({
      ...options,
      scope,
      store,
      authMaterial: "pending-private-material-validation-0000",
      filesRoot: directory,
    });
    const handle = await openApplicationFile(state, "identity.key");
    let authMaterial: string;
    try {
      authMaterial = z
        .string()
        .regex(/^[A-Za-z0-9_-]{64}$/)
        .parse(await handle.readFile("utf8"));
    } finally {
      await handle.close();
    }
    return await createApplicationBackend({
      ...options,
      scope,
      store,
      authMaterial,
      filesRoot: join(directory, "files"),
    });
  } catch (error) {
    await store.close();
    throw error;
  }
}
