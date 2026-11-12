import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const assets = [
  {
    directory: "runsc/release-20261102.0",
    name: "gvisor-x86_64.tar.bz2",
    url: "https://github.com/google/gvisor/releases/download/release-20261102.0/gvisor-x86_64.tar.bz2",
    sha256: "6f6b1a8f0f4665a403238135167d0d990bfaeaff5544abf68f5e0d822b35484a",
  },
  {
    directory: "alpine/3.24.4",
    name: "alpine-minirootfs-3.24.4-x86_64.tar.gz",
    url: "https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/x86_64/alpine-minirootfs-3.24.4-x86_64.tar.gz",
    sha256: "cdaa38cb8de3537967ee5b6c9b6cd00cc962da2b018e6eea48696bb274923012",
  },
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function checkedParents(target) {
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Tool path escaped workspace");
  let current = root;
  for (const entry of rel.split(/[\\/]/)) {
    current = join(current, entry);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error("Linked tool paths are refused");
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
    }
  }
}

async function install(asset) {
  const target = join(root, "artifacts", "tools", asset.directory, asset.name);
  await checkedParents(target);
  await mkdir(dirname(target), { recursive: true });
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
      throw new Error("Unsafe existing tool archive");
    if (sha256(await readFile(target)) !== asset.sha256)
      throw new Error("Cached archive checksum mismatch");
    return;
  } catch (error) {
    if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
  }
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error("Pinned tool download failed");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 256 * 1024 * 1024) throw new Error("Tool archive exceeded its bound");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (sha256(bytes) !== asset.sha256) throw new Error("Published pinned archive checksum mismatch");
  const temporary = `${target}.${randomUUID()}.part`;
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await checkedParents(target);
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch((error) => {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
    });
  }
}

if (process.arch !== "x64")
  throw new Error("This laboratory currently pins Linux x86_64 tooling only");
for (const asset of assets) await install(asset);
const manifestPath = join(root, "artifacts/tools/runsc/release-20261102.0/manifest.json");
await checkedParents(manifestPath);
try {
  const info = await lstat(manifestPath);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
    throw new Error("Unsafe tool manifest");
} catch (error) {
  if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
}
const manifest = `${JSON.stringify(
  {
    runtime: "release-20261102.0",
    fixture: "Alpine3.24.4/minimal BusyBox+musl only",
    architecture: "x86_64",
    assets,
    publishedChecksumValidated: true,
    releaseSignatureVerified: false,
    systemInstallation: false,
    quotaQualification: false,
  },
  null,
  2,
)}\n`;
const manifestTemporary = `${manifestPath}.${randomUUID()}.part`;
try {
  await writeFile(manifestTemporary, manifest, { flag: "wx", mode: 0o600 });
  await rename(manifestTemporary, manifestPath);
} finally {
  await unlink(manifestTemporary).catch((error) => {
    if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
  });
}
console.info(
  "Pinned gVisor and minimal Alpine laboratory archives verified; no system runtime installed",
);
