// Runs the Playwright journeys one isolated application at a time.
//
// `playwright test` starts one web server per project at once (about ten API + console pairs), which needs
// more memory than the 6 GiB CI agent offers and made the kernel kill browsers and servers. Running one
// project per invocation keeps a single application alive, so peak memory stays flat. Every project writes its
// own JUnit file and the exit status is non-zero if any project failed.
//
//   node scripts/e2e-sequential.mjs [project ...]
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const ALL_PROJECTS = [
  "console",
  "access",
  "infrastructure",
  "databases",
  "recovery",
  "delivery",
  "backend",
  "jobs",
  "lifecycle",
  "agents",
  "owner-auth",
];

const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !ALL_PROJECTS.includes(name));
if (unknown.length > 0) {
  console.error(`Unknown E2E project: ${unknown.join(", ")}`);
  process.exit(2);
}
const projects = requested.length > 0 ? requested : ALL_PROJECTS;

// `owner-auth` ceremonies bring no application of their own; pair them with the lightest instance.
const instanceFor = (project) => (project === "owner-auth" ? "console" : project);

mkdirSync("artifacts/test-results", { recursive: true });
const failed = [];
for (const project of projects) {
  console.info(`\n=== E2E project: ${project} ===`);
  const run = spawnSync("bun", ["run", "playwright", "test", `--project=${project}`], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      GODSEYE_E2E_INSTANCE: instanceFor(project),
      GODSEYE_E2E_JUNIT: `artifacts/test-results/e2e-${project}.xml`,
    },
  });
  if (run.status !== 0) failed.push(project);
}

if (failed.length > 0) {
  console.error(`\nE2E projects with failures: ${failed.join(", ")}`);
  process.exit(1);
}
console.info(`\nAll ${projects.length} E2E projects passed.`);
