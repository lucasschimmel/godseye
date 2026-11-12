import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  type Actor,
  BaoAccessProvider,
  compileBrokerPolicy,
  FoundationEngine,
} from "@godseye/core";
import { openStore, schema } from "@godseye/store";
import { z } from "zod";
import { createRuntimeAccess } from "./access-runtime.js";
import { loadConfiguration } from "./config.js";
import { acquireInstance, loadIdentityMaterial, privateDirectory } from "./identity/runtime.js";

function option(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
async function input(limit: number) {
  if (process.stdin.isTTY) throw new Error("Material must enter through a private stdin pipe");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw new Error("Private input exceeds its size limit");
    chunks.push(bytes);
  }
  const value = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  if (!value.length) throw new Error("Private input is empty");
  return value;
}
/** Exclusive private file creation; a replay may reuse only the identical owned handoff. */
async function privateOutput(path: string, value: string) {
  try {
    const file = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      await file.writeFile(value, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST"))
      throw error;
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.size > 4096 ||
      (await readFile(path, "utf8")) !== value
    )
      throw new Error("Existing handoff cannot be replaced");
  }
}
/** Only explicit controller authority renewal may replace a file; service handoffs remain immutable. */
async function replaceControllerProof(path: string, value: string) {
  const existing = await lstat(path);
  if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1)
    throw new Error("Unsafe provider authority file");
  const temporary = `${path}.${randomUUID()}.new`;
  await privateOutput(temporary, value);
  try {
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT"))
        throw error;
    });
  }
}
/** The offline owner boundary is filesystem authority, never a caller-selected browser Actor. */
async function run() {
  const config = loadConfiguration({ ...process.env, GODSEYE_MODE: "local" });
  const command = process.argv[2];
  if (command === "policy") {
    console.info(compileBrokerPolicy(config.baoMount));
    return;
  }
  if (!["stage", "issue", "provider-auth"].includes(command ?? ""))
    throw new Error("Unknown access command");
  await privateDirectory(config.stateDir);
  const release = await acquireInstance(config.stateDir);
  try {
    const signingKey = await loadIdentityMaterial(config.identityDir);
    if (command === "provider-auth") {
      if (!config.baoAddress) throw new Error("Configure a local OpenBao origin first");
      const proof = (await input(4096)).trim();
      const provider = new BaoAccessProvider({
        address: config.baoAddress,
        mount: config.baoMount,
        proof: () => proof,
      });
      if ((await provider.health()).state !== "ready")
        throw new Error("Provider authority is not the exact compiled limited policy");
      const path = join(config.identityDir, "bao.auth");
      if (process.argv.includes("--replace")) await replaceControllerProof(path, proof);
      else await privateOutput(path, proof);
      console.info("Private limited OpenBao authority installed. No provider value was printed.");
      return;
    }
    const key = z
      .string()
      .regex(/^[A-Za-z0-9._:-]{16,128}$/)
      .parse(option("key"));
    const revision = z.coerce.number().int().positive().parse(option("revision"));
    if (!config.databaseUrl) await privateDirectory(config.dataDir);
    const store = await openStore({ dataDir: config.dataDir, databaseUrl: config.databaseUrl });
    try {
      const [owner] = await store.db.select().from(schema.ownerIdentity);
      if (!owner) throw new Error("Enroll the local owner before access administration");
      const actor: Actor = {
        id: owner.userId,
        kind: "owner",
        projectIds: [],
        authenticatedAt: new Date().toISOString(),
        sessionId: "offline-filesystem-owner",
      };
      const broker = createRuntimeAccess(store, new FoundationEngine(store), config, signingKey);
      if (command === "stage") {
        const slotId = z.string().uuid().parse(option("slot"));
        const result = await broker.stage(
          actor,
          { slotId, expectedRevision: revision },
          await input(16384),
          key,
        );
        console.info(JSON.stringify({ operationId: result.id, state: result.state }));
      } else {
        const id = z.string().uuid().parse(option("identity"));
        const directory = join(config.identityDir, "handoffs");
        await privateDirectory(directory);
        const path = join(directory, `${id}.${revision + 1}.proof`);
        await broker.issueProof(actor, id, revision, key, (proof) => privateOutput(path, proof));
        console.info(`Private service proof written to ${path}`);
      }
    } finally {
      await store.close();
    }
  } finally {
    await release();
  }
}
void run().catch(() => {
  console.error(
    "Access command failed. Stop the local controller, verify private state, metadata arguments and limited OpenBao readiness. Material is never printed.",
  );
  process.exitCode = 1;
});
