import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(import.meta.dirname, "../.github/workflows/external-observer.yml"),
  "utf8",
);

describe("external uptime observer workflow", () => {
  it("runs every five minutes and on demand only", () => {
    expect(workflow).toContain('cron: "*/5 * * * *"');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/pull_request|push:/);
  });
  it("holds no permissions, no secrets and no third-party actions", () => {
    expect(workflow).toContain("permissions: {}");
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toMatch(/^\s*-?\s*uses:/m);
  });
  it("checks health body, certificate lifetime and the closed admin ports", () => {
    expect(workflow).toContain("godseye-edge-ok");
    expect(workflow).toContain("/healthz");
    expect(workflow).toContain('MIN_CERT_DAYS: "14"');
    expect(workflow).toContain("-checkend");
    for (const port of ["22", "8006", "8080", "8200", "5432", "6379"])
      expect(workflow).toMatch(new RegExp(`CLOSED_PORTS: "[^"]*\\b${port}\\b`));
  });
});
