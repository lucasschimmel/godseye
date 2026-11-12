import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

await mkdir("dist/backend-template", { recursive: true });
await build({
  entryPoints: ["apps/backend-template/src/server.ts"],
  outfile: "dist/backend-template/server.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
  plugins: [
    {
      name: "application-workspaces",
      setup(builder) {
        builder.onResolve({ filter: /^@godseye\/app-backend$/ }, () => ({
          path: resolve("packages/app-backend/src/index.ts"),
        }));
      },
    },
  ],
});
process.stdout.write("Built local backend template\n");
