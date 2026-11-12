import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

// Keep Inngest external: its SDK owns separate runtime/heartbeat assets beside its package.
await build({
  entryPoints: ["server", "worker", "platform", "runtime"].map(
    (entry) => `apps/jobs-runtime/src/${entry}.ts`,
  ),
  outdir: "dist/jobs-runtime",
  outExtension: { ".js": ".mjs" },
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
await cp("apps/control-api/src/inngest-guardian.mjs", "dist/jobs-runtime/inngest-guardian.mjs");
await mkdir("dist/migrations", { recursive: true });
await cp("packages/store/migrations", "dist/migrations", { recursive: true });
