/** Runs only in a disposable KVM guest. Host code never interprets Git objects. */
import { fork, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  lchown,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { codingCodexArguments, codingCodexCatalog } from "/coding/runner-config.mjs";

const task = JSON.parse(await readFile("/task.json", "utf8"));
const adversary = task.labCase ? await import("/coding/adversary.mjs") : null;
const environment = {
  PATH: "/usr/bin:/bin:/opt/coding/bin",
  HOME: "/home/runner",
  LANG: "C.UTF-8",
  TERM: "dumb",
  SHELL: "/bin/sh",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_ALLOW_PROTOCOL: "",
  GIT_AUTHOR_NAME: "Local Fixture",
  GIT_AUTHOR_EMAIL: "fixture@invalid.local",
  GIT_COMMITTER_NAME: "Local Fixture",
  GIT_COMMITTER_EMAIL: "fixture@invalid.local",
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
};
const MAX_STREAM = 1048576;
async function run(binary, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const confined = options.unprivileged === true;
    const actualBinary = confined ? "/usr/bin/node" : binary;
    const group = options.group === "verification" ? "verification" : "coding";
    const actualArgs = confined ? ["/coding/drop.mjs", group, binary, ...args] : args;
    const child = spawn(actualBinary, actualArgs, {
      cwd: options.cwd ?? "/",
      env: { ...environment, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    for (const [stream, target] of [
      [child.stdout, stdout],
      [child.stderr, stderr],
    ]) {
      stream.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_STREAM) child.kill("SIGKILL");
        else target.push(chunk);
      });
    }
    child.on("error", reject);
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") reject(error);
    });
    child.on("exit", (code) => {
      if (bytes > MAX_STREAM) reject(new Error("Guest child output exceeds bound"));
      else
        resolve({
          code,
          stdout: options.binaryOutput ? Buffer.concat(stdout) : Buffer.concat(stdout).toString(),
          stderr: Buffer.concat(stderr).toString(),
        });
    });
    child.stdin.end(options.input ?? "");
  });
}
async function git(args, cwd = "/", unprivileged = false) {
  const value = await run(
    "/usr/bin/git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, unprivileged },
  );
  if (value.code !== 0) throw new Error(`Guest Git failed: ${value.stderr.slice(0, 512)}`);
  return value.stdout.trim();
}

const proxy = fork("/coding/proxy.mjs", [], {
  env: environment,
  stdio: ["ignore", "ignore", "inherit", "ipc"],
});
await new Promise((resolve, reject) => {
  proxy.once("message", resolve);
  proxy.once("error", reject);
  proxy.once("exit", () => reject(new Error("Guest model proxy stopped before readiness")));
});
await mkdir("/home/runner", { recursive: true });
await mkdir("/home/runner/codex", { recursive: true });
await mkdir("/home/runner/claude", { recursive: true });
await writeFile("/coding/codex-models.json", JSON.stringify(codingCodexCatalog), {
  mode: 0o444,
  flag: "wx",
});
if (task.syntheticFixture === true) {
  await mkdir("/seed");
  await git(["init", "/seed"]);
  await writeFile("/seed/answer.cjs", "module.exports = 1;\n");
  await writeFile(
    "/seed/answer.test.cjs",
    'const test = require("node:test"); const assert = require("node:assert/strict"); test("answer is corrected", () => assert.equal(require("./answer.cjs"), 42));\n',
  );
  await git(["add", "answer.cjs", "answer.test.cjs"], "/seed");
  await git(["commit", "--no-gpg-sign", "-m", "Prepare local isolated fixture"], "/seed");
  task.commitSha = await git(["rev-parse", "HEAD"], "/seed");
} else {
  if (!/^[a-f0-9]{40}$/.test(task.commitSha)) throw new Error("Invalid frozen source identity");
  const actual = await git(["--git-dir=/source.git", "rev-parse", `${task.commitSha}^{commit}`]);
  if (actual !== task.commitSha) throw new Error("Guest source commit differs");
  await mkdir("/seed");
  const tree = await run(
    "/usr/bin/git",
    ["--git-dir=/source.git", "ls-tree", "-rz", task.commitSha],
    { binaryOutput: true },
  );
  if (tree.code !== 0) throw new Error("Requested source tree cannot be enumerated");
  let sourceBytes = 0;
  for (const record of new TextDecoder("utf-8", { fatal: true })
    .decode(tree.stdout)
    .split("\0")
    .filter(Boolean)) {
    const match = /^(100644|100755|120000) blob ([a-f0-9]{40})\t(.+)$/s.exec(record);
    if (
      !match ||
      match[3].startsWith("/") ||
      match[3].split("/").some((part) => !part || part === "." || part === ".." || part === ".git")
    )
      throw new Error("Unsupported source tree path or submodule");
    const path = `/seed/${match[3]}`;
    const components = path.split("/").slice(1, -1);
    let parent = "";
    for (const component of components) {
      parent += `/${component}`;
      await mkdir(parent).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
      if (!(await lstat(parent)).isDirectory()) throw new Error("Source tree directory is linked");
    }
    const blob = await run(
      "/usr/bin/git",
      ["--git-dir=/source.git", "cat-file", "blob", match[2]],
      { binaryOutput: true },
    );
    sourceBytes += blob.stdout.length;
    if (blob.code !== 0 || sourceBytes > 64 * 1024 * 1024)
      throw new Error("Source tree exceeds bound");
    if (match[1] === "120000")
      await symlink(new TextDecoder("utf-8", { fatal: true }).decode(blob.stdout), path);
    else
      await writeFile(path, blob.stdout, {
        flag: "wx",
        mode: match[1] === "100755" ? 0o755 : 0o644,
      });
  }
  await rm("/source.git", { recursive: true, force: true });
  try {
    await lstat("/seed/.git");
    throw new Error("Requested source tree contains forbidden Git metadata");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await git(["init", "/seed"]);
  await mkdir("/seed/.git/info", { recursive: true });
  await writeFile(
    "/seed/.git/info/attributes",
    "* -text -filter -working-tree-encoding -ident -export-ignore -export-subst\n",
  );
  await git(["add", "--force", "--", "."], "/seed");
  await git(
    ["commit", "--allow-empty", "--no-gpg-sign", "-m", "Materialize assigned source tree"],
    "/seed",
  );
}
const privateBaseSha = await git(["rev-parse", "HEAD"], "/seed");
await git(["worktree", "add", "--detach", "/workspace", privateBaseSha], "/seed");
async function assign(path) {
  const metadata = await lstat(path);
  await lchown(path, 1000, 1000);
  if (metadata.isDirectory())
    for (const name of await readdir(path)) await assign(`${path}/${name}`);
}
await assign("/seed");
await assign("/workspace");
await assign("/home/runner");
await adversary?.beforeCli?.(task, { run, git });
await mkdir("/verification", { mode: 0o700 });
async function snapshotTree(source, destination, existingRoot = false) {
  let count = 0;
  let bytes = 0;
  const evidence = [];
  async function copy(relative = "") {
    const origin = relative ? `${source}/${relative}` : source;
    const target = relative ? `${destination}/${relative}` : destination;
    const metadata = await lstat(origin);
    count += 1;
    if (count > 10000) throw new Error("Verification tree exceeds file bound");
    if (metadata.isDirectory()) {
      if (relative || !existingRoot) await mkdir(target, { mode: 0o700 });
      for (const name of (await readdir(origin)).sort()) {
        if (!relative && name === ".git") continue;
        if (relative && name === ".git") throw new Error("Nested Git metadata cannot be exported");
        await copy(relative ? `${relative}/${name}` : name);
      }
    } else if (metadata.isSymbolicLink()) {
      const link = await readlink(origin);
      await symlink(link, target);
      evidence.push([relative, "link", link]);
    } else if (metadata.isFile()) {
      bytes += metadata.size;
      if (bytes > 64 * 1024 * 1024) throw new Error("Verification tree exceeds byte bound");
      await copyFile(origin, target);
      const content = await readFile(target);
      evidence.push([
        relative,
        metadata.mode & 0o111 ? "executable" : "file",
        createHash("sha256").update(content).digest("hex"),
      ]);
    } else throw new Error("Verification tree has a non-file node");
  }
  await copy();
  return createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
}
const materializedTreeHash = await snapshotTree("/workspace", "/verification/baseline");
const sourceTreeHash = await snapshotTree("/seed", "/verification/source");
if (sourceTreeHash !== materializedTreeHash) {
  throw new Error("Requested source tree changed during private worktree materialization");
}
const runnerEnvironment =
  task.runner === "codex"
    ? {
        CODEX_HOME: "/home/runner/codex",
        CODEX_API_KEY: "isolated-fixture-only",
        OPENAI_BASE_URL: "http://127.0.0.1:8080/v1",
      }
    : {
        CLAUDE_CONFIG_DIR: "/home/runner/claude",
        ANTHROPIC_API_KEY: "isolated-fixture-only",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:8080",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
      };
const args =
  task.runner === "codex"
    ? codingCodexArguments()
    : [
        "--bare",
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--tools",
        "Read,Edit,Write,Bash",
        "--allowedTools",
        "Read,Edit,Write,Bash",
        "--permission-mode",
        "dontAsk",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        ...(task.model ? ["--model", task.model] : []),
      ];
const cli = await run(task.runner === "codex" ? "/usr/bin/codex" : "/usr/bin/claude", args, {
  cwd: "/workspace",
  env: runnerEnvironment,
  input: task.input,
  unprivileged: true,
});
process.stderr.write(
  `GODSEYE_CLI_OBSERVATION ${Buffer.from(JSON.stringify({ code: cli.code, stdout: cli.stdout.slice(-4096), stderr: cli.stderr.slice(-4096) })).toString("base64")}\n`,
);
await adversary?.afterCli?.(task, { run, git });
async function quiesce(group) {
  await writeFile(`/sys/fs/cgroup/${group}/cgroup.kill`, "1");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (/^populated 0$/m.test(await readFile(`/sys/fs/cgroup/${group}/cgroup.events`, "utf8")))
      return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Guest child cgroup is still populated");
}
await quiesce("coding");
await adversary?.beforeTest?.(task, { run, git });
const beforeTest = await snapshotTree("/workspace", "/verification/before");
const verification =
  task.syntheticFixture === true
    ? await run("/usr/bin/node", ["--test", "answer.test.cjs"], {
        cwd: "/workspace",
        unprivileged: true,
        group: "verification",
      })
    : task.testProfile === "none"
      ? null
      : await run("/usr/bin/node", ["--run", task.testProfile], {
          cwd: "/workspace",
          unprivileged: true,
          group: "verification",
        });
await quiesce("verification");
await adversary?.afterTest?.(task, { run, git });
const afterTest = await snapshotTree("/workspace", "/verification/final");
if (beforeTest !== afterTest)
  throw new Error(
    "Repository changed during verification; test result is not bound to exported patch",
  );
await mkdir("/verification/export", { mode: 0o700 });
await git(["init", "/verification/export"]);
await mkdir("/verification/export/.git/info", { recursive: true });
await writeFile(
  "/verification/export/.git/info/attributes",
  "* -text -filter -working-tree-encoding -ident -export-ignore -export-subst\n",
);
await snapshotTree("/verification/baseline", "/verification/export", true);
await git(["add", "--force", "--all", "--", "."], "/verification/export");
await git(
  ["commit", "--allow-empty", "--no-gpg-sign", "-m", "Bind immutable task baseline"],
  "/verification/export",
);
for (const name of await readdir("/verification/export")) {
  if (name !== ".git") await rm(`/verification/export/${name}`, { recursive: true, force: true });
}
await snapshotTree("/verification/final", "/verification/export", true);
await git(["add", "--force", "--all", "--", "."], "/verification/export");
const patch = await run(
  "/usr/bin/git",
  [
    "--no-pager",
    "-c",
    "core.attributesFile=/dev/null",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.fsmonitor=false",
    "diff",
    "--cached",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    "--binary",
  ],
  { cwd: "/verification/export" },
);
if (patch.code !== 0 || Buffer.byteLength(patch.stdout) > task.maxPatchBytes)
  throw new Error("Independent guest patch export failed or exceeded bound");
proxy.kill("SIGKILL");
const result = {
  kind: "coding.guest.result",
  runner: task.runner,
  commitSha: task.commitSha,
  cli,
  patch: patch.stdout,
  patchSha256: createHash("sha256").update(patch.stdout).digest("hex"),
  treeHash: afterTest,
  test: verification,
  worktree: "/seed/.git",
};
process.stdout.write(`GODSEYE_RESULT ${Buffer.from(JSON.stringify(result)).toString("base64")}\n`);
