import { resolve } from "node:path";
import { build } from "esbuild";

// Bundles the root cell helper (and the operator proof harness) into single files that the
// installer copies to root-owned paths. Workspace packages and dependencies are inlined so the
// helper does not depend on a deploy-user-writable node_modules.
const workspace = {
  name: "workspace-packages",
  setup(builder) {
    builder.onResolve({ filter: /^@godseye\// }, (args) => ({
      path: resolve(`packages/${args.path.slice("@godseye/".length)}/src/index.ts`),
    }));
  },
};
for (const [entry, outfile] of [
  ["apps/control-api/src/cell-helper-main.ts", "dist/cell-helper/cell-helper.mjs"],
  ["apps/control-api/src/cells-proof-cli.ts", "dist/cell-helper/cells-proof.mjs"],
]) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    external: ["pg-native"],
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    plugins: [workspace],
  });
}
