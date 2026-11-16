import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Console components import through the same "@" alias as the Vite app.
  // React is installed in the console workspace only, so resolve it from there.
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./apps/console/src", import.meta.url)) },
      {
        find: /^(react|react-dom)(\/.*)?$/,
        replacement: `${fileURLToPath(new URL("./apps/console/node_modules", import.meta.url))}/$1$2`,
      },
    ],
  },
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
