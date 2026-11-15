import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DATABASE_ROLES } from "@godseye/contracts";
import { z } from "zod";
import { backupScheduleDetector } from "../../../packages/core/src/backup-schedule.js";
import {
  type CellHostConfigInput,
  type CellHostExecutor,
  parseCellHost,
} from "../../../packages/core/src/cell-host.js";
import {
  createDatabaseMaterial,
  type DatabaseMaterial,
} from "../../../packages/core/src/database-postgres.js";
import type {
  DatabaseMaterialDelivery,
  DatabaseProviderScope,
} from "../../../packages/core/src/database-provider.js";
import { ManagedPostgresProvider } from "../../../packages/core/src/database-provider.js";
import {
  hostQualification,
  ServerPostgresTransport,
} from "../../../packages/core/src/database-server-transport.js";
import type { RecoveryRepositoryMaterial } from "../../../packages/core/src/recovery-pgbackrest-provider.js";
import { ManagedPgBackRestProvider } from "../../../packages/core/src/recovery-pgbackrest-provider.js";
import type { RecoveryScope } from "../../../packages/core/src/recovery-provider.js";
import { ServerPgBackRestTransport } from "../../../packages/core/src/recovery-server-transport.js";
import { HelperSocketExecutor, UnixSocketHelperTransport } from "./cell-host-process.js";
import { privateDirectory } from "./identity/runtime.js";
import { readPrivateJson } from "./private-json.js";

const Binding = z
  .object({
    providerId: z.string().min(1).max(64),
    targetId: z.string().uuid(),
    generation: z.string().min(1).max(64),
    version: z.string().min(1).max(64).default("postgresql-18/pgbackrest-2.60"),
    /** Interim private file store for generated role and repository material (0700/0600). */
    secretsDirectory: z.string().regex(/^\/[A-Za-z0-9_./-]+$/),
    host: z.record(z.string(), z.unknown()),
  })
  .strict();
const key = (value: string) => {
  z.string().uuid().parse(value);
  return value;
};
/** Generated once per cell and persisted privately; the production path is the OpenBao broker. */
export class FileDatabaseMaterial implements DatabaseMaterialDelivery {
  constructor(private readonly directory: string) {}
  async withMaterial(
    scope: DatabaseProviderScope,
    roles: readonly (typeof DATABASE_ROLES)[number][],
    consume: (material: DatabaseMaterial) => Promise<void>,
    assertDispatch: () => Promise<void>,
  ) {
    if (roles.length !== DATABASE_ROLES.length) throw new Error("Incomplete role material request");
    const folder = join(this.directory, key(scope.allocationId));
    await privateDirectory(folder);
    const file = join(folder, "roles.json");
    await assertDispatch();
    let material: DatabaseMaterial;
    try {
      material = JSON.parse(await readFile(file, "utf8")) as DatabaseMaterial;
    } catch {
      material = createDatabaseMaterial();
      await writeFile(file, JSON.stringify(material), { mode: 0o600, flag: "wx" });
    }
    await consume(material);
  }
}
export async function repositoryPassphrase(directory: string, allocationId: string) {
  const folder = join(directory, key(allocationId));
  await privateDirectory(folder);
  const file = join(folder, "repository.pass");
  try {
    return (await readFile(file, "utf8")).trim();
  } catch {
    const value = randomBytes(32).toString("base64url");
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await writeFile(file, value, { mode: 0o600, flag: "wx" });
    await chmod(file, 0o600);
    return value;
  }
}
class FileRepositoryMaterial implements RecoveryRepositoryMaterial {
  constructor(private readonly directory: string) {}
  async withMaterial(
    scope: RecoveryScope,
    consume: (passphrase: string) => Promise<void>,
    gate: () => Promise<void>,
  ) {
    await gate();
    await consume(await repositoryPassphrase(this.directory, scope.sourceAllocationId));
  }
  withInspectionMaterial = this.withMaterial.bind(this);
}
/**
 * Optional private composition. Without `GODSEYE_PG_CELLS_FILE` (a 0600 JSON binding) nothing is
 * constructed and database execution, recovery and the backup schedule stay `unconfigured`. With
 * it, the database provider is qualified only by a live host probe; recovery stays unqualified until
 * an independent per-scope attestation exists, so no production recovery path opens by accident.
 */
export function configuredCellProviders(
  env: NodeJS.ProcessEnv = process.env,
  injectedExecutor?: CellHostExecutor,
) {
  const file = env.GODSEYE_PG_CELLS_FILE;
  if (!file) return undefined;
  const binding = Binding.parse(readPrivateJson(file));
  const host = parseCellHost(binding.host as CellHostConfigInput);
  const executor =
    injectedExecutor ?? new HelperSocketExecutor(new UnixSocketHelperTransport(host.helperSocket));
  const provider = {
    providerId: binding.providerId,
    targetId: binding.targetId,
    version: binding.version,
    generation: binding.generation,
  };
  const archiveCipher = (scope: DatabaseProviderScope) =>
    repositoryPassphrase(binding.secretsDirectory, scope.allocationId);
  const databaseTransport = new ServerPostgresTransport({ host, executor, archiveCipher });
  return {
    databaseProvider: new ManagedPostgresProvider(
      provider,
      databaseTransport,
      new FileDatabaseMaterial(binding.secretsDirectory),
      hostQualification(host, executor, provider),
    ),
    recoveryProvider: new ManagedPgBackRestProvider(
      provider,
      new ServerPgBackRestTransport(host, executor),
      new FileRepositoryMaterial(binding.secretsDirectory),
      async () => null,
    ),
    backupSchedule: backupScheduleDetector({ executor }),
  };
}
