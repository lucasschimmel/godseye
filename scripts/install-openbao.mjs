import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const version = "2.7.2";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const platforms = { win32: "windows", linux: "linux", darwin: "darwin" };
const architectures = { x64: "amd64", arm64: "arm64" };
const platform = platforms[process.platform];
const architecture = architectures[process.arch];
if (!platform || !architecture)
  throw new Error("OpenBao lab installer supports Windows/Linux/macOS x64/arm64");
const extension = platform === "windows" ? "zip" : "tar.gz";
const archiveName = `openbao_${version}_${platform}_${architecture}.${extension}`;
const binaryName = platform === "windows" ? "bao.exe" : "bao";
const directory = join(root, "artifacts", "tools", "openbao", version);
const archivePath = join(directory, archiveName);
const output = join(directory, "bin", binaryName);
const base = `https://github.com/openbao/openbao/releases/download/v${version}`;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function assertUnlinkedParents(target) {
  const path = relative(root, target);
  if (path.startsWith("..")) throw new Error("Tool installation must remain inside this workspace");
  let current = root;
  for (const part of path.split(/[\\/]/)) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error("Linked tool installation paths are refused");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

async function download(name, maxBytes) {
  const response = await fetch(`${base}/${name}`, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body)
    throw new Error(`OpenBao release download failed (${response.status})`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error("OpenBao release download exceeded its bound");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function obtainArchive(expected) {
  let archive;
  try {
    archive = await readFile(archivePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!archive) {
    archive = await download(archiveName, 536_870_912);
    if (digest(archive) !== expected)
      throw new Error("Downloaded OpenBao archive failed SHA256 verification");
    await writeFile(archivePath, archive);
  }
  if (digest(archive) !== expected)
    throw new Error("Cached OpenBao archive failed SHA256 verification");
}

async function extractBinary() {
  if (platform === "windows") {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const executable = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const program = `
      $ErrorActionPreference = 'Stop'
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $archive = [IO.Compression.ZipFile]::OpenRead($env:GODSEYE_BAO_ARCHIVE)
      try {
        $entry = @($archive.Entries | Where-Object { $_.FullName -ceq 'bao.exe' })
        if ($entry.Count -ne 1) { throw 'Expected one exact OpenBao executable entry' }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry[0], $env:GODSEYE_BAO_OUTPUT, $true)
      } finally { $archive.Dispose() }
    `;
    await execute(executable, ["-NoProfile", "-NonInteractive", "-Command", program], {
      env: {
        SystemRoot: systemRoot,
        PSModulePath: join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "Modules"),
        GODSEYE_BAO_ARCHIVE: archivePath,
        GODSEYE_BAO_OUTPUT: `${output}.installing`,
      },
      windowsHide: true,
      timeout: 60_000,
    });
    await rename(`${output}.installing`, output);
    return;
  }
  const listing = await execute("tar", ["-tzf", archivePath], { timeout: 30_000 });
  const candidates = listing.stdout
    .split(/\r?\n/)
    .filter((entry) => entry === "bao" || entry === "./bao");
  if (candidates.length !== 1) throw new Error("Expected one exact OpenBao executable entry");
  await execute("tar", ["-xzf", archivePath, "-C", dirname(output), "--", candidates[0]], {
    timeout: 60_000,
  });
  await chmod(output, 0o755);
}

/** Install only an explicit pinned lab tool; no global install or service changes. */
async function main() {
  await assertUnlinkedParents(directory);
  await mkdir(join(directory, "bin"), { recursive: true });
  await assertUnlinkedParents(output);
  const checksums = await download("checksums.txt", 1_048_576);
  const matching = checksums
    .toString("utf8")
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[1]?.replace(/^\*/, "") === archiveName);
  const expected = matching.length === 1 ? matching[0][0] : undefined;
  if (!expected || !/^[a-fA-F0-9]{64}$/.test(expected))
    throw new Error("Published OpenBao SHA256 entry missing");
  await obtainArchive(expected.toLowerCase());
  await writeFile(join(directory, "checksums.txt"), checksums);
  await extractBinary();
  const binarySha256 = digest(await readFile(output));
  if (
    platform === "windows" &&
    architecture === "amd64" &&
    binarySha256 !== "aae41e2de4700a8e1475793538f82858cf9ad91fbe29bc91b4ad3ae455f93874"
  )
    throw new Error("Pinned Windows OpenBao executable failed SHA256 verification");
  await writeFile(
    join(directory, "manifest.json"),
    `${JSON.stringify(
      {
        version,
        platform: process.platform,
        architecture: process.arch,
        archive: archiveName,
        archiveSha256: expected.toLowerCase(),
        binarySha256,
        checksumValidated: true,
        signatureVerified: false,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `OpenBao ${version} lab tool installed with published SHA256 verification (${process.platform}/${process.arch})`,
  );
  console.log(
    "Release signature verification was not performed; no service or global tool was installed",
  );
}

await main();
