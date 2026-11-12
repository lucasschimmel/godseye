import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { ApplicationError, type ApplicationScopeInput } from "./contracts.js";
import { writeAll } from "./io.js";
import {
  applicationFilePath,
  openApplicationFile,
  prepareApplicationFiles,
} from "./private-files.js";
import {
  ApplicationRecoveryArchive,
  ApplicationRecoveryEnvelope,
  RECOVERY_METADATA_BYTES,
} from "./recovery-contract.js";
import { applicationSnapshot } from "./recovery-snapshot.js";
import { account, appScope, events, files, user } from "./schema.js";
import type { ApplicationState } from "./state.js";

export { applicationSnapshot } from "./recovery-snapshot.js";

interface RecoveryArchive {
  version: 1;
  scope: ApplicationScopeInput;
  capturedAt: string;
  timeCoverage: ReturnType<typeof initialTimeCoverage>;
  configuration: ReturnType<typeof publicConfiguration>;
  users: (typeof user.$inferSelect)[];
  accounts: (typeof account.$inferSelect)[];
  files: (typeof files.$inferSelect)[];
}
function initialTimeCoverage(state: ApplicationState) {
  const now = state.now().toISOString();
  return {
    databaseCapturedAt: now,
    configurationCapturedAt: now,
    fileCopyStartedAt: now,
    fileCopyCompletedAt: now,
    clockDomain: "local-runtime" as const,
    postgresRecoveryPointAt: null,
    gapAssessment: "external-recovery-point-unknown" as const,
    activationAllowed: false as const,
  };
}
function publicConfiguration(state: ApplicationState) {
  return {
    baseUrl: state.baseUrl,
    trustedOrigins: state.origins,
    registrationEnabled: state.registrationEnabled,
    limits: state.limits,
  };
}
async function destination(state: ApplicationState, directory: string) {
  if (resolve(directory) === resolve(state.filesRoot))
    throw new ApplicationError("RECOVERY_SOURCE_REUSE", "Recovery requires separate storage", 409);
  const target = { ...state, filesRoot: directory };
  await prepareApplicationFiles(target);
  return target;
}
async function copyObject(source: ApplicationState, target: ApplicationState, id: string) {
  const input = await openApplicationFile(source, id);
  let output: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const { assertApplicationRoot } = await import("./private-files.js");
    await assertApplicationRoot(target);
    output = await open(applicationFilePath(target, id), "wx", 0o600);
    let offset = 0;
    for await (const chunk of input.createReadStream({ autoClose: false })) {
      await writeAll(output, chunk, offset);
      offset += chunk.byteLength;
    }
    await output.sync();
  } finally {
    await output?.close();
    await input.close();
  }
}
/** Private offline recovery export; protected auth hashes never cross an HTTP/SDK boundary. */
export function exportApplicationRecovery(state: ApplicationState, input: { directory: string }) {
  return state.store.exclusive(() =>
    state.store.transaction(async (tx) => {
      await tx.select().from(appScope).where(eq(appScope.id, 1)).for("update");
      const snapshot = await applicationSnapshot(state, tx);
      if (!snapshot.coverage.files)
        throw new ApplicationError("RECOVERY_INCOMPLETE", "Committed files are incomplete", 409);
      const target = await destination(state, input.directory);
      const archive: RecoveryArchive = {
        version: 1,
        scope: state.scope,
        capturedAt: state.now().toISOString(),
        timeCoverage: initialTimeCoverage(state),
        configuration: publicConfiguration(state),
        users: await tx.select().from(user),
        accounts: (await tx.select().from(account)).map((row) => ({
          ...row,
          accessToken: null,
          refreshToken: null,
          idToken: null,
        })),
        files: (await tx.select().from(files)).filter((row) => row.status === "committed"),
      };
      let payload = JSON.stringify(archive);
      let signature = createHmac("sha256", state.authMaterial).update(payload).digest("hex");
      let envelope = JSON.stringify({ payload, signature });
      if (Buffer.byteLength(envelope, "utf8") > RECOVERY_METADATA_BYTES)
        throw new ApplicationError(
          "RECOVERY_TOO_LARGE",
          "Recovery metadata exceeds its bound",
          413,
        );
      ApplicationRecoveryArchive.parse(JSON.parse(payload));
      for (const row of archive.files) await copyObject(state, target, row.id);
      archive.timeCoverage.fileCopyCompletedAt = state.now().toISOString();
      payload = JSON.stringify(archive);
      signature = createHmac("sha256", state.authMaterial).update(payload).digest("hex");
      envelope = JSON.stringify({ payload, signature });
      if (Buffer.byteLength(envelope, "utf8") > RECOVERY_METADATA_BYTES)
        throw new ApplicationError(
          "RECOVERY_TOO_LARGE",
          "Recovery metadata exceeds its bound",
          413,
        );
      const handle = await open(join(target.filesRoot, "recovery.json"), "wx", 0o600);
      try {
        await handle.writeFile(envelope);
        await handle.sync();
      } finally {
        await handle.close();
      }
      return {
        scope: state.scope,
        capturedAt: archive.capturedAt,
        timeCoverage: archive.timeCoverage,
        files: archive.files.length,
        users: archive.users.length,
        sha256: createHash("sha256").update(payload).digest("hex"),
        activationAllowed: false,
      };
    }),
  );
}
/** Import only into a separate empty held destination. No activation API exists in this tranche. */
export function importApplicationRecovery(
  state: ApplicationState,
  input: { directory: string; sourceAuthMaterial: string },
) {
  return state.store.exclusive(async () => {
    const lifecycle = await state.lifecycle();
    if (lifecycle.available || state.store.recoveryHeld)
      throw new ApplicationError(
        "RECOVERY_HOLD_REQUIRED",
        "An empty held application destination is required",
        409,
      );
    const sourceRoot = { ...state, filesRoot: resolve(input.directory) };
    const handle = await openApplicationFile(sourceRoot, "recovery.json");
    let envelope: { payload: string; signature: string };
    try {
      if ((await handle.stat()).size > RECOVERY_METADATA_BYTES)
        throw new ApplicationError(
          "RECOVERY_TOO_LARGE",
          "Recovery metadata exceeds its bound",
          413,
        );
      envelope = ApplicationRecoveryEnvelope.parse(JSON.parse(await handle.readFile("utf8")));
    } finally {
      await handle.close();
    }
    if (
      !timingSafeEqual(
        Buffer.from(
          createHmac("sha256", input.sourceAuthMaterial).update(envelope.payload).digest("hex"),
        ),
        Buffer.from(envelope.signature),
      )
    )
      throw new ApplicationError(
        "RECOVERY_INTEGRITY",
        "Recovery archive authentication failed",
        409,
      );
    const archive = ApplicationRecoveryArchive.parse(JSON.parse(envelope.payload));
    if (
      archive.version !== 1 ||
      archive.scope.projectId !== state.scope.projectId ||
      archive.scope.environmentId === state.scope.environmentId
    )
      throw new ApplicationError(
        "RECOVERY_SCOPE_MISMATCH",
        "Recovery requires a new environment of the same project",
        409,
      );
    if (
      !Array.isArray(archive.files) ||
      !Array.isArray(archive.users) ||
      !Array.isArray(archive.accounts) ||
      archive.files.length > state.limits.maxFiles ||
      archive.files.some(
        (row) =>
          !Number.isSafeInteger(row.size) ||
          row.size < 0 ||
          row.size > state.limits.objectBytes ||
          row.status !== "committed",
      ) ||
      archive.files.reduce((total, row) => total + row.size, 0) > state.limits.storageBytes
    )
      throw new ApplicationError(
        "RECOVERY_INCOMPATIBLE",
        "Recovery exceeds target storage policy",
        409,
      );
    const source = { ...state, scope: archive.scope, filesRoot: resolve(input.directory) };
    // The hold survives all later transaction or filesystem failures, including partial copies.
    await state.store.transaction(async (tx) => {
      await tx.select().from(appScope).where(eq(appScope.id, 1)).for("update");
      if (
        (await tx.select().from(user).limit(1)).length ||
        (await tx.select().from(files).limit(1)).length
      )
        throw new ApplicationError(
          "RECOVERY_NOT_EMPTY",
          "Recovery target already contains application data",
          409,
        );
      await tx
        .update(appScope)
        .set({
          recoveryHold: true,
          recoveryConfiguration: {
            sourceScope: archive.scope,
            capturedAt: archive.capturedAt,
            timeCoverage: archive.timeCoverage,
            configuration: archive.configuration,
            status: "importing",
          },
        })
        .where(eq(appScope.id, 1));
    });
    state.store.recoveryHeld = true;
    await state.store.transaction(async (tx) => {
      await tx.select().from(appScope).where(eq(appScope.id, 1)).for("update");
      if (
        (await tx.select().from(user).limit(1)).length ||
        (await tx.select().from(files).limit(1)).length ||
        (await tx.select().from(events).limit(1)).length
      )
        throw new ApplicationError(
          "RECOVERY_NOT_EMPTY",
          "Recovery target already contains application data",
          409,
        );
      const dates = <T extends object>(row: T): T =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            value !== null &&
            [
              "createdAt",
              "updatedAt",
              "expiresAt",
              "accessTokenExpiresAt",
              "refreshTokenExpiresAt",
            ].includes(key)
              ? new Date(value as string)
              : value,
          ]),
        ) as T;
      if (archive.users.length) await tx.insert(user).values(archive.users.map(dates));
      if (archive.accounts.length) await tx.insert(account).values(archive.accounts.map(dates));
      for (const row of archive.files) {
        if (row.status !== "committed" || row.size > state.limits.objectBytes)
          throw new ApplicationError(
            "RECOVERY_INCOMPATIBLE",
            "Recovery file exceeds target policy",
            409,
          );
        await copyObject(source, state, row.id);
        await tx.insert(files).values(dates(row));
      }
      const snapshot = await applicationSnapshot(state, tx);
      if (!snapshot.coverage.files)
        throw new ApplicationError(
          "RECOVERY_INCOMPLETE",
          "Restored objects failed integrity validation",
          409,
        );
      if ((await state.lifecycle()).available)
        throw new ApplicationError(
          "RECOVERY_HOLD_REQUIRED",
          "Recovery target must remain held",
          409,
        );
      await tx
        .update(appScope)
        .set({
          recoveryConfiguration: {
            sourceScope: archive.scope,
            capturedAt: archive.capturedAt,
            timeCoverage: archive.timeCoverage,
            configuration: archive.configuration,
            status: "held",
          },
        })
        .where(eq(appScope.id, 1));
    });
    return {
      sourceScope: archive.scope,
      scope: state.scope,
      capturedAt: archive.capturedAt,
      timeCoverage: archive.timeCoverage,
      recoveryHeld: true,
      activationAllowed: false,
      configuration: archive.configuration,
      sessionsRestored: false,
      externalEffectsReconciled: false,
    };
  });
}
