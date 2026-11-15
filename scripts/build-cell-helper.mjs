import { resolve } from "node:path";
import { build } from "esbuild";

// Bundles the root cell helper into one file that the installer copies to a root-owned path.
await build({
  entryPoints: ["apps/control-api/src/cell-helper-main.ts"],
  outfile: "dist/cell-helper/cell-helper.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
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
