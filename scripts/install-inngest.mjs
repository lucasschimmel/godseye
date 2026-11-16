import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";

const version = "1.52.0";
const sha256 = "92c67bfcbad2fd142f7d7248884c9f4dc06127527208c0dccfdb43e0b84a343b";
if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("This pinned local installer currently supports Windows x64 only");
const directory = resolve("artifacts", "tools", `inngest-${version}`);
for (const path of [resolve("artifacts"), resolve("artifacts", "tools"), directory]) {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error("Linked tool paths are refused");
  } catch (error) {
    if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
  }
}
await mkdir(directory, { recursive: true });
const archive = join(directory, `inngest_${version}_windows_amd64.zip`);
let bytes;
try {
  const info = await lstat(archive);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
    throw new Error("Unsafe cached tool archive");
  bytes = await readFile(archive);
} catch (error) {
  if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
  const response = await fetch(
    `https://github.com/inngest/inngest/releases/download/v${version}/inngest_${version}_windows_amd64.zip`,
    { signal: AbortSignal.timeout(120000) },
  );
  if (!response.ok) throw new Error("Pinned Inngest download failed");
  bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== sha256)
    throw new Error("Pinned Inngest archive checksum mismatch");
  await writeFile(archive, bytes, { flag: "wx" });
}
if (createHash("sha256").update(bytes).digest("hex") !== sha256)
  throw new Error("Cached Inngest archive checksum mismatch");
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const binary = join(directory, "inngest.exe");
try {
  const info = await lstat(binary);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
    throw new Error("Unsafe existing Inngest binary");
} catch (error) {
  if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
}
const staging = await mkdtemp(join(directory, ".install-"));
if (!resolve(staging).startsWith(`${directory}${sep}`))
  throw new Error("Tool staging escaped its private target");
try {
  await promisify(execFile)(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory(${quote(archive)}, ${quote(staging)})`,
    ],
    { windowsHide: true },
  );
  const extracted = await readFile(join(staging, "inngest.exe"));
  try {
    const info = await lstat(binary);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      createHash("sha256")
        .update(await readFile(binary))
        .digest("hex") !== createHash("sha256").update(extracted).digest("hex")
    )
      throw new Error(
        "Existing Inngest binary does not match the pinned archive; replacement refused",
      );
  } catch (error) {
    if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
    await writeFile(binary, extracted, { flag: "wx", mode: 0o700 });
  }
} finally {
  await rm(staging, { recursive: true, force: true });
}
const info = await lstat(binary);
if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
  throw new Error("Unsafe extracted Inngest binary");
const result = await promisify(execFile)(binary, ["version"], { windowsHide: true });
if (!result.stdout.includes(version)) throw new Error("Pinned Inngest binary version differs");
process.stdout.write(
  `Installed project-local Inngest ${version}; upstream server SSPL license applies. No system service was installed.\n`,
);
