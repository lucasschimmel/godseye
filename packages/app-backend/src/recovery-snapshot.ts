import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { isMissing, openApplicationFile } from "./private-files.js";
import { appScope, files, user } from "./schema.js";
import type { ApplicationState } from "./state.js";
import type { ApplicationAccess } from "./store.js";
export async function applicationSnapshot(
  state: ApplicationState,
  access: ApplicationAccess = state.store.db,
) {
  const rows = await access.select().from(files);
  const databaseCapturedAt = state.now().toISOString();
  const [custody] = await access
    .select({ configuration: appScope.recoveryConfiguration })
    .from(appScope);
  const objects = [];
  for (const row of rows) {
    let physical: "verified" | "missing" | "incomplete" | "deleted" =
      row.status === "deleted" ? "deleted" : "missing";
    if (row.status !== "deleted") {
      try {
        const handle = await openApplicationFile(state, row.id);
        try {
          const hash = createHash("sha256");
          for await (const bytes of handle.createReadStream({ autoClose: false }))
            hash.update(bytes);
          physical =
            row.status === "committed" &&
            (await handle.stat()).size === row.size &&
            hash.digest("hex") === row.sha256
              ? "verified"
              : "incomplete";
        } finally {
          await handle.close();
        }
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    objects.push({
      id: row.id,
      status: row.status,
      sha256: row.sha256,
      size: row.size,
      physical,
      pendingOffset: row.pendingOffset,
      cleanupPending: row.cleanupPending,
    });
  }
  const residualObjects = (await readdir(state.filesRoot)).filter(
    (name) =>
      !["cell.json", "instance.json", "instance.guard"].includes(name) &&
      !rows.some((row) => row.id === name),
  );
  return {
    scope: state.scope,
    capturedAt: state.now().toISOString(),
    recoveryHeld: state.store.recoveryHeld,
    recovery: custody?.configuration ?? null,
    timeCoverage: {
      databaseCapturedAt,
      filesInspectedAt: state.now().toISOString(),
      configurationCapturedAt: databaseCapturedAt,
      clockDomain: "local-runtime",
      postgresRecoveryPointAt: null,
      gapAssessment: "external-recovery-point-unknown",
      activationAllowed: false,
    },
    auth: {
      users: (await access.select({ id: user.id }).from(user)).length,
      sessionsRestorable: false,
    },
    configuration: {
      baseUrl: state.baseUrl,
      trustedOrigins: state.origins,
      registrationEnabled: state.registrationEnabled,
      limits: state.limits,
    },
    files: objects,
    residualObjects,
    coverage: {
      files:
        residualObjects.length === 0 &&
        objects.every((row) => row.status !== "committed" || row.physical === "verified"),
      auth: true,
      configuration: true,
      externalEffects: false,
      activationAllowed: false,
    },
  };
}
