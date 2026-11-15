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

/** Default service uid for the WSL2 adapter (first interactive user). Linux derives it from the process. */
export const WSL_DEFAULT_UID = 1000;

/**
 * Resolve the service uid: the running user on native Linux (an optional GODSEYE_SERVICE_UID
 * declaration must match it), the WSL default on Windows. Root is refused.
 */
export function resolveServiceUid(platform, environment = {}, getuid = () => process.getuid?.()) {
  const declared = environment.GODSEYE_SERVICE_UID;
  const actual = platform === "linux" ? getuid() : WSL_DEFAULT_UID;
  if (!Number.isInteger(actual) || actual <= 0)
    throw new Error("The tools bootstrap requires an unprivileged service user");
  if (
    declared !== undefined &&
    declared !== "" &&
    (!/^[0-9]+$/.test(declared) || Number(declared) !== actual)
  )
    throw new Error("Declared service uid differs from the running user");
  return actual;
}

export function userManagerUnit(uid) {
  return `user@${uid}.service`;
}

export function inspectProgram(uid) {
  return (
    `import json,os,pathlib,subprocess; assert os.getuid()==${uid}; ` +
    `p=pathlib.Path('/sys/fs/cgroup/user.slice/user-${uid}.slice/user@${uid}.service'); ` +
    "assert p.is_dir() and os.access(p,os.W_OK); " +
    "assert {'cpu','memory','pids'}<=set((p/'cgroup.controllers').read_text().split()); " +
    `assert pathlib.Path('/run/user/${uid}/bus').is_socket(); ` +
    `print(json.dumps({'state':'available','uid':${uid},'delegatedControllers':['cpu','memory','pids']}))`
  );
}

export function holderProgram(lifetimeSeconds, uid) {
  return `import os,select,sys; assert os.getuid()==${uid}; print('READY',flush=True); select.select([sys.stdin],[],[],${lifetimeSeconds})`;
}
