/** Platform-neutral command planning for the explicit Hermes tools bootstrap (Windows/WSL2 or native Linux). */

const DISTRO = /^[A-Za-z0-9_.-]{1,64}$/;
export const MAX_LIFETIME_SECONDS = 8 * 60 * 60;

/** Parse operator options. WSL2 accepts an optional distribution; native Linux accepts none. */
export function parseBootstrapOptions(options, platform) {
  const repair = options.includes("--start-user-manager");
  const lifetimeOption = options.find((value) => value.startsWith("--lifetime-seconds="));
  const lifetimeSeconds = lifetimeOption
    ? Number(lifetimeOption.split("=")[1])
    : MAX_LIFETIME_SECONDS;
  if (
    !Number.isInteger(lifetimeSeconds) ||
    lifetimeSeconds < 1 ||
    lifetimeSeconds > MAX_LIFETIME_SECONDS
  )
    throw new Error("Operator lifetime must be between 1 second and 8 hours");
  const remaining = options.filter(
    (value) => value !== "--start-user-manager" && value !== lifetimeOption,
  );
  if (platform === "win32") {
    if (remaining.length > 1)
      throw new Error(
        "Use: node scripts/hermes-tools-bootstrap.mjs [Ubuntu] [--start-user-manager]",
      );
    const distro = remaining[0] ?? "Ubuntu";
    if (!DISTRO.test(distro)) throw new Error("Invalid WSL distribution");
    return { platform, distro, repair, lifetimeSeconds };
  }
  if (platform !== "linux" || remaining.length > 0)
    throw new Error("Use: node scripts/hermes-tools-bootstrap.mjs [--start-user-manager]");
  return { platform, distro: null, repair, lifetimeSeconds };
}

/**
 * Build the executable and argv for one fixed bootstrap command. `argv` must start with an absolute
 * program path. Root actions exist only through WSL; on Linux the service user never escalates.
 */
export function commandSpec(settings, { asRoot = false, argv }) {
  if (!argv[0]?.startsWith("/")) throw new Error("Bootstrap programs must be absolute");
  if (settings.platform === "win32") {
    return {
      command: "wsl.exe",
      args: ["-d", settings.distro, ...(asRoot ? ["-u", "root"] : []), "--exec", ...argv],
    };
  }
  if (asRoot)
    throw new Error(
      "Administrator action required: run `loginctl enable-linger <service-user>` as root; the Linux bootstrap never escalates",
    );
  return { command: argv[0], args: argv.slice(1) };
}

/** Minimal child environment per platform (no ambient secrets). */
export function bootstrapEnvironment(platform, source) {
  const names =
    platform === "win32"
      ? ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA"]
      : [];
  const picked = Object.fromEntries(
    names.filter((name) => source[name] !== undefined).map((name) => [name, source[name]]),
  );
  return platform === "win32" ? picked : { PATH: "/usr/bin:/bin", LC_ALL: "C" };
}

/**
 * The tools runtime pins the service user to uid 1000 (gVisor user mapping, per-user runtime
 * directory), so the Linux service user must be uid 1000 too; another uid is refused here rather
 * than failing later inside a task.
 */
export const SERVICE_UID = 1000;
export const USER_MANAGER_UNIT = `user@${SERVICE_UID}.service`;

export function inspectProgram() {
  return (
    `import json,os,pathlib,subprocess; assert os.getuid()==${SERVICE_UID}; ` +
    "p=pathlib.Path('/sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service'); " +
    "assert p.is_dir() and os.access(p,os.W_OK); " +
    "assert {'cpu','memory','pids'}<=set((p/'cgroup.controllers').read_text().split()); " +
    "assert pathlib.Path('/run/user/1000/bus').is_socket(); " +
    "print(json.dumps({'state':'available','uid':1000,'delegatedControllers':['cpu','memory','pids']}))"
  );
}

export function holderProgram(lifetimeSeconds) {
  return `import os,select,sys; assert os.getuid()==${SERVICE_UID}; print('READY',flush=True); select.select([sys.stdin],[],[],${lifetimeSeconds})`;
}
