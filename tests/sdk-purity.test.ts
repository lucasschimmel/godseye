// Static purity gate: shipped SDK and backend template must contain no Supabase Cloud runtime path.
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const pattern = /supabase/i;
/** Explicit allowlist of documentation comments (file suffix + line substring); currently none. */
const allowlist: { file: string; includes: string }[] = [];

async function sources(directory: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...(await sources(path)));
    else if (/\.(?:ts|tsx|js|mjs|json)$/.test(entry.name)) out.push(path);
  }
  return out;
}
function offending(file: string, text: string) {
  return text
    .split("\n")
    .map((line, index) => ({ line, index }))
    .filter(
      ({ line }) =>
        pattern.test(line) &&
        !allowlist.some((entry) => file.endsWith(entry.file) && line.includes(entry.includes)),
    )
    .map(({ index }) => `${file}:${index + 1}`);
}

describe("application runtime purity", () => {
  it("has no Supabase reference in SDK or backend template sources", async () => {
    const hits: string[] = [];
    for (const root of ["packages/sdk/src", "apps/backend-template/src"]) {
      for (const file of await sources(resolve(root)))
        hits.push(...offending(file, await readFile(file, "utf8")));
    }
    expect(hits).toEqual([]);
  });

  it("has no Supabase reference in the standalone browser SDK bundle", async () => {
    const result = await build({
      entryPoints: [resolve("packages/sdk/src/index.ts")],
      bundle: true,
      write: false,
      platform: "browser",
      target: "es2023",
      format: "esm",
      packages: "bundle",
      logLevel: "silent",
    });
    expect(result.outputFiles).toHaveLength(1);
    expect(offending("sdk-bundle", result.outputFiles[0]?.text ?? "")).toEqual([]);
  });
});
