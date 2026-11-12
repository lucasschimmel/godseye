import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

await build({
  entryPoints: ["apps/control-api/src/server.ts"],
  outfile: "dist/control-api/server.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
  plugins: [
    {
      name: "workspace-packages",
      setup(builder) {
        builder.onResolve({ filter: /^@godseye\// }, (args) => ({
          path: resolve(`packages/${args.path.slice("@godseye/".length)}/src/index.ts`),
        }));
      },
    },
  ],
});
await mkdir("dist/migrations", { recursive: true });
await cp("packages/store/migrations", "dist/migrations", { recursive: true });
