import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/infrastructure-runsc.test.ts"],
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    reporters: ["default", "junit"],
    outputFile: { junit: "artifacts/test-results/infra-lab.xml" },
  },
});
