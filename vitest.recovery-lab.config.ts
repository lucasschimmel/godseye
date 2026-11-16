import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/recovery-lab-native.test.ts"],
    maxWorkers: 1,
    testTimeout: 180_000,
    hookTimeout: 240_000,
    reporters: ["default", "junit"],
    outputFile: { junit: "artifacts/test-results/recovery-lab.xml" },
  },
});
