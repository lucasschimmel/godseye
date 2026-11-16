import { execFile } from "node:child_process";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";

const output = resolve("dist/sdk");
await mkdir(output, { recursive: true });
const result = await build({
  entryPoints: ["packages/sdk/src/index.ts"],
  outfile: join(output, "index.js"),
  bundle: true,
  platform: "browser",
  target: "es2023",
  format: "esm",
  packages: "bundle",
  metafile: true,
});
const forbidden = Object.keys(result.metafile.inputs).filter(
  (path) =>
    /^(?:packages\/(?:core|store|control-client)\/|apps\/control-api\/)/.test(path) ||
    /(?:node:|better-auth|node_modules\/pg\/)/.test(path),
);
if (forbidden.length) throw new Error("SDK browser bundle contains controller or server code");
await promisify(execFile)(
  process.execPath,
  ["node_modules/typescript/bin/tsc", "--project", "packages/sdk/tsconfig.build.json"],
  { maxBuffer: 1024 * 1024 },
);
await promisify(execFile)(
  process.execPath,
  ["node_modules/typescript/bin/tsc", "--project", "packages/app-backend/tsconfig.contracts.json"],
  { maxBuffer: 1024 * 1024 },
);
const declarations = resolve(".local/sdk-declarations/packages/sdk/src");
for (const name of await readdir(declarations)) {
  if (!name.endsWith(".d.ts")) continue;
  const text = await readFile(join(declarations, name), "utf8");
  await writeFile(
    join(output, name),
    text.replaceAll('"@godseye/app-backend/contracts"', '"./app-contracts.js"'),
  );
}
await cp(
  ".local/sdk-declarations/packages/app-backend/src/contracts.d.ts",
  join(output, "app-contracts.d.ts"),
);
await writeFile(
  join(output, "package.json"),
  `${JSON.stringify(
    {
      name: "@godseye/sdk",
      version: "0.1.0",
      type: "module",
      private: true,
      exports: { ".": { types: "./index.d.ts", import: "./index.js" } },
      dependencies: { zod: "4.6.7" },
    },
    null,
    2,
  )}\n`,
);
await writeFile(
  join(output, "bundle-report.json"),
  `${JSON.stringify({ browser: true, serverImports: forbidden, inputs: Object.keys(result.metafile.inputs).length, bytes: Object.values(result.metafile.outputs).reduce((sum, item) => sum + item.bytes, 0) }, null, 2)}\n`,
);
process.stdout.write(
  "Built standalone browser SDK and TypeScript declarations; no controller/server imports\n",
);
