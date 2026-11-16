import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditMutations } from "./mutation-audit-cases.mjs";
import { autonomousMutations } from "./mutation-autonomous-cases.mjs";
import { backendMutations } from "./mutation-backend-cases.mjs";
import { mutations as historicalMutations } from "./mutation-cases.mjs";
import { deliveryMutations } from "./mutation-delivery-cases.mjs";
import { inngestMutations } from "./mutation-inngest-cases.mjs";
import { jobsMutations } from "./mutation-jobs-cases.mjs";

const suite = process.env.GODSEYE_MUTATION_SUITE ?? "historical";
if (
  !["historical", "delivery", "backend", "jobs", "audit", "inngest", "autonomous"].includes(suite)
)
  throw new Error("Unknown curated mutation suite");
// M07 is the only historical exact target changed by delivery's push/PR parser integration.
const affectedIntake = historicalMutations.find(({ id }) => id === "M07");
if (!affectedIntake) throw new Error("Affected GitHub intake mutation is missing");
const allMutations =
  suite === "autonomous"
    ? autonomousMutations
    : suite === "inngest"
      ? inngestMutations
      : suite === "audit"
        ? auditMutations
        : suite === "backend"
          ? backendMutations
          : suite === "jobs"
            ? jobsMutations
            : suite === "delivery"
              ? [affectedIntake, ...deliveryMutations]
              : historicalMutations;

const requestedIds = (process.env.GODSEYE_MUTATION_IDS ?? "").split(",").filter(Boolean);
if (requestedIds.some((id) => !allMutations.some((mutation) => mutation.id === id)))
  throw new Error("Unknown curated mutation ID");
const mutations = requestedIds.length
  ? allMutations.filter(({ id }) => requestedIds.includes(id))
  : allMutations;
const selectionSuffix = `${suite === "historical" ? "" : `-${suite}`}${requestedIds.length ? `-${requestedIds.join("-")}` : ""}`;

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const reportPath = join(
  root,
  `.codex/crafts/g-o-d-s-e-y-e-cfe8/reviews/mutations${selectionSuffix}.json`,
);
const artifactDir = join(root, "artifacts/mutation-results");
const timeoutMs = Number(process.env.GODSEYE_MUTATION_TIMEOUT_MS ?? 180_000);

const digest = (content) => createHash("sha256").update(content).digest("hex");

async function prepareSandbox(sandbox, junctions) {
  for (const directory of [
    "packages/contracts",
    "packages/store",
    "packages/core",
    "apps/control-api",
    ...(suite === "autonomous" ? ["apps/jobs-runtime"] : []),
    ...(suite === "backend" || suite === "inngest"
      ? ["packages/app-backend", "packages/sdk", "packages/control-client"]
      : []),
  ]) {
    await mkdir(join(sandbox, directory), { recursive: true });
    await cp(join(root, directory, "src"), join(sandbox, directory, "src"), { recursive: true });
    await cp(join(root, directory, "package.json"), join(sandbox, directory, "package.json"));
    const dependencyLink = join(sandbox, directory, "node_modules");
    if (existsSync(join(root, directory, "node_modules"))) {
      await symlink(join(root, directory, "node_modules"), dependencyLink, "junction");
      junctions.push(dependencyLink);
    }
  }
  await cp(join(root, "packages/store/migrations"), join(sandbox, "packages/store/migrations"), {
    recursive: true,
  });
  await cp(join(root, "docs/contracts"), join(sandbox, "docs/contracts"), { recursive: true });
  await mkdir(join(sandbox, "tests"), { recursive: true });
  for (const name of [
    "control.test.ts",
    "webhook.test.ts",
    "policy-audit.test.ts",
    "api.test.ts",
    "helpers.ts",
    "access-authority.test.ts",
    "access-task.test.ts",
    "access-rotation.test.ts",
    "access-helpers.ts",
    "foundations-helpers.ts",
    "openbao-provider.test.ts",
    "openbao-fixture.ts",
    "infra-authority.test.ts",
    "infra-admission.test.ts",
    "infra-network.test.ts",
    "infra-execution.test.ts",
    "infra-recovery.test.ts",
    "infra-docker.test.ts",
    "infra-helpers.ts",
    "infra-provider-fixture.ts",
    "infra-docker-helpers.ts",
    "pg-helpers.ts",
    "pg-policy.test.ts",
    "pg-projects.test.ts",
    "pg-admission.test.ts",
    "pg-recovery.test.ts",
    "pg-renewal.test.ts",
    "pg-bootstrap.test.ts",
    "pg-lab-native.test.ts",
    "pg-lab-fixture.ts",
    "pg-lab-host.ts",
    "recovery-admission.test.ts",
    "recovery-archive.test.ts",
    "recovery-faults.test.ts",
    "recovery-hold.test.ts",
    "recovery-material.test.ts",
    "recovery-policy.test.ts",
    "recovery-provider.test.ts",
    "recovery-helpers.ts",
    "delivery-helpers.ts",
    "delivery-provider-fixture.ts",
    "delivery-policy-authority.test.ts",
    "delivery-preparation.test.ts",
    "delivery-source.test.ts",
    "delivery-managed.test.ts",
    "delivery-execution.test.ts",
    "delivery-faults.test.ts",
    "delivery-preview-faults.test.ts",
    "delivery-rollback.test.ts",
    "delivery-migration.test.ts",
    "delivery-scan-usage.test.ts",
    "jobs-helpers.ts",
    "jobs-faults.test.ts",
    "jobs-isolation.test.ts",
    "jobs-outbox.test.ts",
    "jobs-retention.test.ts",
    "infra-helpers.ts",
    "helpers.ts",
  ]) {
    await cp(join(root, "tests", name), join(sandbox, "tests", name));
  }
  if (suite === "backend" || suite === "inngest") {
    for (const name of (await readdir(join(root, "tests"))).filter((name) =>
      /^(backend|sdk)[a-z0-9.-]*\.ts$/.test(name),
    ))
      await cp(join(root, "tests", name), join(sandbox, "tests", name));
    await cp(
      join(root, "tests/owner-auth-fixture.ts"),
      join(sandbox, "tests/owner-auth-fixture.ts"),
    );
  }
  if (suite === "audit") {
    for (const name of [
      "jobs-definition-regression.test.ts",
      "jobs-outbox-deadline.test.ts",
      "infra-approval-capacity.test.ts",
      "jenkins-artifacts.test.ts",
    ])
      await cp(join(root, "tests", name), join(sandbox, "tests", name));
    for (const name of ["Jenkinsfile", "playwright.config.ts"])
      await cp(join(root, name), join(sandbox, name));
  }
  if (suite === "autonomous") {
    for (const name of [
      "jobs-consumer-partition.test.ts",
      "jobs-runtime-ipc.test.ts",
      "jobs-runtime-config.test.ts",
      "jobs-runtime-broker.test.ts",
      "inngest-runtime-fixture.ts",
    ])
      await cp(join(root, "tests", name), join(sandbox, "tests", name));
  }
  for (const name of ["package.json", "tsconfig.json"])
    await cp(join(root, name), join(sandbox, name));
  await symlink(join(root, "node_modules"), join(sandbox, "node_modules"), "junction");
  junctions.push(join(sandbox, "node_modules"));
  // The pinned lab executable is read-only fixture tooling; never copy/mutate user runtime state.
  await mkdir(join(sandbox, "artifacts"), { recursive: true });
  const labToolLink = join(sandbox, "artifacts", "tools");
  await symlink(join(root, "artifacts", "tools"), labToolLink, "junction");
  junctions.push(labToolLink);
  const aliases = Object.fromEntries([
    ...(suite === "backend" || suite === "inngest"
      ? [["@godseye/app-backend/contracts", join(sandbox, "packages/app-backend/src/contracts.ts")]]
      : []),
    ...[
      "contracts",
      "store",
      "core",
      ...(suite === "backend" || suite === "inngest"
        ? ["app-backend", "sdk", "control-client"]
        : []),
    ].map((name) => [`@godseye/${name}`, join(sandbox, "packages", name, "src/index.ts")]),
  ]);
  await writeFile(
    join(sandbox, "vitest.config.mjs"),
    `import { defineConfig } from 'vitest/config';
export default defineConfig({ root: ${JSON.stringify(sandbox)}, cacheDir: ${JSON.stringify(join(sandbox, ".vite"))}, resolve: { alias: ${JSON.stringify(aliases)} },
test: { include: ['tests/**/*.test.ts'], fsModuleCachePath: ${JSON.stringify(join(sandbox, ".vitest-module-cache"))}, maxWorkers: 1, testTimeout: 30000, hookTimeout: 60000 } });\n`,
  );
}

async function runTests(sandbox, id, files, pattern) {
  const outputFile = join(artifactDir, `${id}${selectionSuffix}.json`);
  const args = [
    join(root, "node_modules/vitest/vitest.mjs"),
    "run",
    ...files,
    "--config",
    join(sandbox, "vitest.config.mjs"),
    "--testNamePattern",
    pattern,
    "--reporter=json",
    "--outputFile",
    outputFile,
  ];
  const execution = await new Promise((accept, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: sandbox,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        output = (output + chunk.toString()).slice(-64_000);
      });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      accept({ code, output, timedOut });
    });
  });
  if (execution.timedOut) return { status: "invalid", reason: "Runner timed out" };
  let report;
  try {
    report = JSON.parse(await readFile(outputFile, "utf8"));
  } catch (error) {
    return { status: "invalid", reason: `No valid runner report: ${error.message}` };
  }
  const assertions = (report.testResults ?? []).flatMap((suite) => suite.assertionResults ?? []);
  const failed = assertions.filter((assertion) => assertion.status === "failed");
  const assertionFailures = failed.filter(
    (assertion) =>
      new RegExp(pattern).test(assertion.fullName) &&
      assertion.failureMessages.some(
        (message) =>
          message.includes("AssertionError") ||
          (message.includes("__VITEST_REJECTS__") && message.includes("instead of rejecting")),
      ),
  );
  if (execution.code === 0 && report.numPassedTests > 0)
    return { status: "passed", passed: report.numPassedTests };
  if (execution.code === 1 && failed.length && assertionFailures.length === failed.length) {
    return {
      status: "assertion_failed",
      failures: failed.map((assertion) => ({
        name: assertion.fullName,
        message: assertion.failureMessages[0].split("\n")[0],
      })),
    };
  }
  return {
    status: "invalid",
    reason: execution.output.slice(-2000) || "Runner failed outside an assertion",
  };
}

async function cleanSandbox(sandbox, junctions) {
  const withinTemporaryRoot = relative(resolve(tmpdir()), resolve(sandbox));
  if (
    withinTemporaryRoot.startsWith("..") ||
    isAbsolute(withinTemporaryRoot) ||
    !basename(sandbox).startsWith("godseye-mutations-")
  ) {
    throw new Error("Refusing to remove a path outside the mutation sandbox");
  }
  for (const link of junctions.reverse()) await unlink(link);
  await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** Keep orchestration together so every mutation is restored before another is applied. */
async function main() {
  const sandbox = await mkdtemp(join(tmpdir(), "godseye-mutations-"));
  const junctions = [];
  const originals = new Map();
  const results = [];
  const startedAt = new Date().toISOString();
  let baseline;
  try {
    await mkdir(artifactDir, { recursive: true });
    await prepareSandbox(sandbox, junctions);
    for (const { file } of mutations)
      if (!originals.has(file)) originals.set(file, await readFile(join(root, file), "utf8"));
    console.log(
      `Mutation baseline: checking ${mutations.length} selected behavioral scenarios in an isolated copy`,
    );
    baseline = await runTests(
      sandbox,
      "baseline",
      [...new Set(mutations.map(({ test }) => test))],
      mutations.map(({ name }) => name).join("|"),
    );
    if (baseline.status !== "passed" || baseline.passed !== mutations.length)
      throw new Error(`Invalid mutation baseline: ${JSON.stringify(baseline)}`);
    for (const mutation of mutations) {
      const original = originals.get(mutation.file);
      if (original.split(mutation.from).length !== 2)
        throw new Error(`Mutation ${mutation.id} no longer has one exact target`);
      const location = join(sandbox, mutation.file);
      let evidence;
      try {
        await writeFile(location, original.replace(mutation.from, mutation.to));
        evidence = await runTests(sandbox, mutation.id, [mutation.test], mutation.name);
      } finally {
        await writeFile(location, original);
      }
      const status =
        evidence.status === "assertion_failed"
          ? "killed"
          : evidence.status === "passed"
            ? "survived"
            : "invalid";
      results.push({
        id: mutation.id,
        file: mutation.file,
        behavior: mutation.behavior,
        status,
        evidence,
      });
      console.log(`${mutation.id}: ${status} — ${mutation.behavior}`);
    }
    const restored = await runTests(
      sandbox,
      "restored",
      [...new Set(mutations.map(({ test }) => test))],
      mutations.map(({ name }) => name).join("|"),
    );
    const sourceUnchanged = (
      await Promise.all(
        [...originals].map(
          async ([file, content]) => digest(await readFile(join(root, file))) === digest(content),
        ),
      )
    ).every(Boolean);
    const report = {
      kind: "curated behavioral mutation experiment",
      suite,
      runnerTimeoutMs: timeoutMs,
      startedAt,
      finishedAt: new Date().toISOString(),
      scope: `${mutations.length} selected mutations; not an exhaustive mutation score or coverage claim`,
      isolation:
        "Temporary source copies with explicit Vitest workspace aliases; original source never mutated",
      baseline,
      restored,
      sourceUnchanged,
      selected: mutations.length,
      killed: results.filter(({ status }) => status === "killed").length,
      survived: results.filter(({ status }) => status === "survived").length,
      invalid: results.filter(({ status }) => status === "invalid").length,
      results,
    };
    await mkdir(resolve(reportPath, ".."), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    if (!sourceUnchanged || restored.status !== "passed" || report.survived || report.invalid)
      process.exitCode = 1;
  } finally {
    await cleanSandbox(sandbox, junctions);
  }
}

await main();
