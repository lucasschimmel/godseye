import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

// Evidence metadata only; this command does not assert that tests or deployment passed.
const revision = process.env.GIT_COMMIT ?? null;
const report = {
  schemaVersion: 1,
  sourceRevision: revision,
  generatedAt: new Date().toISOString(),
  buildUrl: process.env.BUILD_URL ?? null,
  deployment: "not-configured",
};
const body = `${JSON.stringify(report, null, 2)}\n`;
await mkdir("artifacts/ci", { recursive: true });
await writeFile("artifacts/ci/report.json", body);
await writeFile(
  "artifacts/ci/report.sha256",
  `${createHash("sha256").update(body).digest("hex")}\n`,
);
