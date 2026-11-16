import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/coding-composition-native.test.ts"],
    maxWorkers: 1,
    testTimeout: 300000,
    hookTimeout: 180000,
    reporters: ["default", "junit"],
    outputFile: { junit: "artifacts/test-results/coding-runners-composition-native.xml" },
  },
});
