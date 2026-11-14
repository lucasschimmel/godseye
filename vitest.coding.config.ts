import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/coding-contracts.test.ts",
      "tests/coding-tasks.test.ts",
      "tests/coding-protocol.test.ts",
      "tests/coding-http.test.ts",
      "tests/coding-bindings.test.ts",
      "tests/coding-provider.test.ts",
    ],
    testTimeout: 30000,
    hookTimeout: 60000,
    maxWorkers: 2,
    reporters: ["default", "junit"],
    outputFile: { junit: "artifacts/test-results/coding-runners-focused-final.xml" },
  },
});
