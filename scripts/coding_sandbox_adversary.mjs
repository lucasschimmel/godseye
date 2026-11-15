/**
 * Trusted synthetic regression and containment probes, copied only into a laboratory sandbox. Every probe
 * runs as the unprivileged sandbox uid and reports through `GODSEYE_ADVERSARY` markers that the host
 * judges; nothing here is trusted to pass itself.
 */
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";

const incrementingTest = `const fs = require("node:fs");
const value = Number(/= (\\d+)/.exec(fs.readFileSync("answer.cjs", "utf8"))[1]);
fs.writeFileSync("answer.cjs", "module.exports = " + (value + 1) + ";\\n");
require("node:test")("synthetic mutating check", () => {});
`;

function marker(value) {
  process.stdout.write(
    `GODSEYE_ADVERSARY ${typeof value === "string" ? value : JSON.stringify(value)}\n`,
  );
}

const escapeProbe = `
const fs = require("node:fs");
const out = { uid: process.getuid(), hostFilesVisible: [], writesSucceeded: [], privilegedOps: [] };
for (const p of ["/home/jenkins-agent", "/var/lib/godseye", "/opt/godseye", "/etc/shadow", "/etc/ssh", "/root",
  "/run/user", "/run/systemd", "/var/run/docker.sock", "/sys/fs/cgroup/user.slice", "/sys/fs/cgroup/system.slice", "/sys/class/net/eth0", "/dev/kvm", "/dev/mem", "/mnt", "/boot", "/srv"])
  { try { fs.statSync(p); out.hostFilesVisible.push(p); } catch {} }
for (const p of ["/usr/godseye-escape", "/coding/x", "/opt/coding/x", "/task.json", "/source.git/x", "/etc/passwd", "/x", "/proc/sys/kernel/hostname"])
  { try { fs.writeFileSync(p, "x"); out.writesSucceeded.push(p); } catch {} }
try { process.setuid(0); out.privilegedOps.push("setuid-0"); } catch {}
try { process.kill(1, "SIGKILL"); out.privilegedOps.push("kill-init"); } catch {}
try { fs.readFileSync("/proc/1/environ"); out.privilegedOps.push("read-init-environ"); } catch {}
try { const m = fs.readFileSync("/proc/self/mountinfo", "utf8"); if (/\\/var\\/lib\\/godseye|\\/opt\\/godseye|jenkins/.test(m)) out.privilegedOps.push("mountinfo-host-path"); } catch {}
for (const [name, args] of [["mount", ["-t", "tmpfs", "none", "/tmp"]], ["chroot", ["/tmp", "/bin/true"]], ["insmod", ["/dev/null"]]]) {
  const r = require("node:child_process").spawnSync("/usr/bin/" + name, args, { timeout: 5000 });
  if (r.status === 0) out.privilegedOps.push(name);
}
process.stdout.write(JSON.stringify(out));
`;

const egressProbe = `
const net = require("node:net"), os = require("node:os"), fs = require("node:fs"), dns = require("node:dns");
const out = { connected: [], interfaces: Object.keys(os.networkInterfaces()).sort(), routes: 0 };
try { out.routes = Math.max(0, fs.readFileSync("/proc/net/route", "utf8").trim().split("\\n").length - 1); } catch {}
const targets = [["10.20.3.1", 22], ["10.20.3.10", 22], ["10.20.1.10", 22], ["10.20.1.10", 443], ["1.1.1.1", 443], ["8.8.8.8", 53], ["127.0.0.1", 22], ["127.0.0.1", 5432], ["::1", 22]];
const unix = ["/run/user/994/bus", "/run/systemd/private", "/run/dbus/system_bus_socket", "/var/run/docker.sock"];
const attempt = (connect, label) => new Promise((resolve) => {
  const socket = connect();
  const done = () => { socket.destroy(); resolve(); };
  socket.setTimeout(1500, done);
  socket.on("error", done);
  socket.on("connect", () => { out.connected.push(label); done(); });
});
(async () => {
  for (const [host, port] of targets) await attempt(() => net.connect({ host, port }), host + ":" + port);
  for (const path of unix) await attempt(() => net.connect({ path }), path);
  await new Promise((resolve) => dns.lookup("example.com", (error) => { if (!error) out.connected.push("dns"); resolve(); }));
  process.stdout.write(JSON.stringify(out));
})();
`;

const memoryProbe = `
const chunks = []; let mib = 0;
process.stdout.write(JSON.stringify({ started: true }) + "\\n");
try { for (;;) { chunks.push(Buffer.alloc(32 * 1024 * 1024, 1)); mib += 32; if (mib > 8192) break; } } catch (error) {}
process.stdout.write(JSON.stringify({ started: true, reachedLimit: mib <= 8192, allocatedMiB: mib }));
`;

const pidsProbe = `
const { spawn } = require("node:child_process");
const children = []; let refused = false;
for (let i = 0; i < 400; i += 1) {
  try {
    const child = spawn("/usr/bin/sleep", ["30"], { stdio: "ignore" });
    if (child.pid === undefined) { refused = true; break; }
    children.push(child);
  } catch (error) { refused = true; break; }
}
setTimeout(() => {
  const forked = children.filter((child) => child.pid !== undefined && child.exitCode === null).length;
  for (const child of children) try { child.kill("SIGKILL"); } catch {}
  process.stdout.write(JSON.stringify({ forked, refused: refused || forked < 400 }));
}, 1500);
`;

const diskProbe = `
const fs = require("node:fs");
const block = Buffer.alloc(1024 * 1024, 7);
const fd = fs.openSync("/workspace/fill.bin", "w");
let written = 0, refused = null;
try { for (let i = 0; i < 2048; i += 1) { fs.writeSync(fd, block); written += block.length; } } catch (error) { refused = error.code; }
fs.closeSync(fd);
fs.unlinkSync("/workspace/fill.bin");
process.stdout.write(JSON.stringify({ written, refused }));
`;

async function probe(run, script, label) {
  const result = await run("/usr/bin/node", ["-e", script], {
    cwd: "/workspace",
    unprivileged: true,
  });
  marker(`${label}-exit=${result.code}`);
  const text = result.stdout.trim().split("\n").pop() ?? "";
  try {
    marker({ case: label, ...JSON.parse(text) });
  } catch {
    marker({ case: label, unparsed: text.slice(0, 256), stderr: result.stderr.slice(0, 256) });
  }
}

export async function beforeCli(task) {
  if (task.labCase !== "attributes") return;
  const hidden = await readFile("/workspace/hidden.test.cjs", "utf8");
  const placeholder = await readFile("/workspace/substitution.txt", "utf8");
  if (hidden !== 'require("node:test")("hidden exact source is present", () => {});\n')
    throw new Error("Export-ignore changed the selected source tree");
  if (placeholder !== "$Format:%H$\n")
    throw new Error("Export-subst changed the selected source bytes");
  if (
    (await readFile("/workspace/encoded.txt", "utf8")) !==
    "Exact committed UTF-8 bytes must remain unchanged\n"
  )
    throw new Error("Working-tree encoding changed the selected source bytes");
  marker("exact-attribute-tree-preserved");
  const sha = (value) => createHash("sha256").update(value).digest("hex");
  const observed = [];
  async function walk(relative = "") {
    for (const name of (await readdir(`/workspace/${relative}`)).sort()) {
      if (!relative && name === ".git") continue;
      const path = relative ? `${relative}/${name}` : name;
      const metadata = await lstat(`/workspace/${path}`);
      if (metadata.isDirectory()) await walk(path);
      else if (metadata.isFile())
        observed.push([
          path,
          metadata.mode & 0o111 ? "executable" : "file",
          sha(await readFile(`/workspace/${path}`)),
        ]);
      else throw new Error("Unexpected materialized source node");
    }
  }
  await walk();
  marker(`source-tree-hash=${sha(JSON.stringify(observed))}`);
}

export async function afterCli(task, { run, git }) {
  if (task.labCase === "attributes") {
    const changed = await run(
      "/usr/bin/node",
      [
        "-e",
        'require("node:fs").writeFileSync("nested/payload.txt", "a/baseline/keep b/final/keep\\n")',
      ],
      { cwd: "/workspace", unprivileged: true },
    );
    if (changed.code !== 0) throw new Error("Synthetic nested patch setup failed");
  }
  if (task.labCase === "index") {
    await git(["update-index", "--assume-unchanged", "answer.cjs"], "/workspace", true);
    const hidden = await git(["diff", "--", "answer.cjs"], "/workspace", true);
    if (hidden !== "") throw new Error("Synthetic mutable index did not hide the edit");
    marker("mutable-index-hides-edit");
  }
  if (task.labCase === "test-mutation") {
    const changed = await run(
      "/usr/bin/node",
      [
        "-e",
        `require("node:fs").writeFileSync("answer.test.cjs", ${JSON.stringify(incrementingTest)})`,
      ],
      { cwd: "/workspace", unprivileged: true },
    );
    if (changed.code !== 0) throw new Error("Synthetic mutating test setup failed");
    marker("test-mutation-installed");
  }
  if (task.labCase === "background") {
    const writer = `const fs=require("node:fs");fs.writeFileSync("background-canary.txt","started\\n");process.stdout.write("writer-ready\\n");setInterval(()=>fs.appendFileSync("background-canary.txt","tick\\n"),10);`;
    const parent = `const {spawn}=require("node:child_process");const child=spawn(process.execPath,["-e",${JSON.stringify(writer)}],{stdio:["ignore","pipe","ignore"]});child.stdout.once("data",()=>{process.stdout.write("writer-handshake\\n");child.unref();process.exit(0)});setTimeout(()=>process.exit(2),5000).unref();`;
    const launched = await run("/usr/bin/node", ["-e", parent], {
      cwd: "/workspace",
      unprivileged: true,
    });
    if (launched.code !== 0 || !launched.stdout.includes("writer-handshake"))
      throw new Error("Synthetic background writer handshake failed");
    marker("background-writer-entered");
  }
  if (task.labCase === "escape") await probe(run, escapeProbe, "escape");
  if (task.labCase === "egress") await probe(run, egressProbe, "egress");
  if (task.labCase === "exhaust-memory") await probe(run, memoryProbe, "exhaust-memory");
  if (task.labCase === "exhaust-pids") await probe(run, pidsProbe, "exhaust-pids");
  if (task.labCase === "exhaust-disk") await probe(run, diskProbe, "exhaust-disk");
  if (task.labCase === "hang") {
    marker({ case: "hang", started: true });
    await run("/usr/bin/node", ["-e", "setInterval(() => {}, 1000)"], {
      cwd: "/workspace",
      unprivileged: true,
    });
  }
}

export async function beforeTest(task, { sandboxProcesses }) {
  if (task.labCase !== "background") return;
  if ((await sandboxProcesses()).length !== 0)
    throw new Error("Background CLI descendants survived quiescence");
  const content = await readFile("/workspace/background-canary.txt", "utf8");
  await writeFile("/verification/background-before.txt", content, { flag: "wx", mode: 0o600 });
  marker("background-quiesced-before-check");
}

export async function afterTest(task) {
  if (task.labCase !== "background") return;
  const before = await readFile("/verification/background-before.txt", "utf8");
  const after = await readFile("/workspace/background-canary.txt", "utf8");
  if (before !== after) throw new Error("Background writer changed the tested candidate");
  marker("background-tree-stable-after-check");
}
