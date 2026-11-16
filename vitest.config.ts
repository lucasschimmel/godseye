import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: [
      "tests/e2e/**",
      "tests/infrastructure-runsc.test.ts",
      "tests/pg-lab-native.test.ts",
      "tests/recovery-lab-native.test.ts",
    ],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    maxWorkers: 2,
    reporters: ["default", "junit"],
    outputFile: { junit: "artifacts/test-results/unit.xml" },
  },
});
