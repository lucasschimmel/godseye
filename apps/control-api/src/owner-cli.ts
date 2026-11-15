import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openStore } from "@godseye/store";
import { loadConfiguration } from "./config.js";
import { createOwnerIdentity } from "./identity/index.js";
import { LOCAL_COMMAND_PATH, localProof } from "./identity/local-admin.js";
import { acquireInstance, loadIdentityMaterial, privateDirectory } from "./identity/runtime.js";
import { hostPort } from "./server-config.js";

async function run() {
  // Server hosts run this with the service environment (GODSEYE_MODE=server); a bare invocation is local.
  const config = loadConfiguration(
    { ...process.env, GODSEYE_MODE: process.env.GODSEYE_MODE ?? "local" },
    { purpose: "administration" },
  );
  const intent = process.argv.includes("recover") ? "recover" : "setup";
  let enrollment: { ticket: string; expiresAt: string };
  if (process.argv.includes("--offline")) {
    if (intent !== "recover") throw new Error("Offline mode is reserved for owner recovery");
    await privateDirectory(config.stateDir);
    const release = await acquireInstance(config.stateDir);
    try {
      const signingKey = await loadIdentityMaterial(config.identityDir);
      if (!config.databaseUrl) await privateDirectory(config.dataDir);
      const store = await openStore({ dataDir: config.dataDir, databaseUrl: config.databaseUrl });
      try {
        enrollment = await (
          await createOwnerIdentity(store, {
            origin: config.ownerOrigin,
            signingKey,
          })
        ).prepareEnrollment("recover");
      } finally {
        await store.close();
      }
    } finally {
      await release();
    }
  } else {
    const signingKey = (await readFile(join(config.identityDir, "identity.key"), "utf8")).trim();
    const body = JSON.stringify({ intent });
    const timestamp = Date.now().toString();
    const nonce = randomBytes(16).toString("hex");
    const response = await fetch(
      `http://${hostPort(config.host, config.apiPort)}${LOCAL_COMMAND_PATH}`,
      {
        method: "POST",
        body,
        headers: {
          "content-type": "application/json",
          "x-godseye-time": timestamp,
          "x-godseye-nonce": nonce,
          "x-godseye-proof": localProof(signingKey, body, timestamp, nonce),
        },
      },
    );
    if (!response.ok)
      throw new Error(
        "Local owner administration was refused; verify the API and the selected state directory",
      );
    enrollment = (await response.json()) as typeof enrollment;
  }
  // Displayed only by an explicit local CLI invocation; never written into logs or configuration.
  console.info(
    `Open this single-use enrollment link before ${enrollment.expiresAt}:\n${config.ownerOrigin}/#enroll=${enrollment.ticket}`,
  );
  if (process.argv.includes("--offline"))
    console.info("Restart the local API before using the link.");
}

void run().catch(() => {
  console.error(
    "Owner command failed. Start the local API, or stop it and use owner:recover --offline. Verify the local state directory and process lock.",
  );
  process.exitCode = 1;
});
