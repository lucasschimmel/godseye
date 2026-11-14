/** Fixed privilege drop, available only inside the disposable guest. */
import { readFileSync, writeFileSync } from "node:fs";

const group = process.argv[2];
const binary = process.argv[3];
if (
  !["coding", "verification"].includes(group) ||
  !["/usr/bin/codex", "/usr/bin/claude", "/usr/bin/node", "/usr/bin/git"].includes(binary)
) {
  throw new Error("Invalid fixed guest child policy");
}
if (
  process.getuid() !== 0 ||
  readFileSync(`/sys/fs/cgroup/${group}/pids.max`, "utf8").trim() !== "64"
) {
  throw new Error("Guest process ceiling is unavailable");
}
writeFileSync(`/sys/fs/cgroup/${group}/cgroup.procs`, String(process.pid));
if (!readFileSync("/proc/self/cgroup", "utf8").trim().endsWith(`/${group}`)) {
  throw new Error("Guest child did not enter its exact cgroup");
}
process.setgroups([]);
process.setgid(1000);
process.setuid(1000);
if (process.getuid() !== 1000 || process.geteuid() !== 1000 || process.getgid() !== 1000) {
  throw new Error("Guest privilege drop failed");
}
process.execve(binary, [binary, ...process.argv.slice(4)], process.env);
