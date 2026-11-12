import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/pg-lab-native.test.ts"],
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    reporters: ["default", "junit"],
    outputFile: { junit: "artifacts/test-results/pg-lab.xml" },
  },
});
