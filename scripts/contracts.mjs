import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createControlOpenApi } from "../packages/contracts/src/index.ts";

const target = new URL("../docs/contracts/control-openapi.json", import.meta.url);
const content = `${JSON.stringify(createControlOpenApi(), null, 2)}\n`;
if (process.argv.slice(2).some((argument) => argument !== "--check"))
  throw new Error("Usage: contracts.mjs [--check]");
if (process.argv.includes("--check")) {
  const current = await readFile(target, "utf8");
  if (current.replace(/\r\n/g, "\n") !== content)
    throw new Error("Generated control OpenAPI is stale; run contracts:generate");
  console.info("Control OpenAPI matches its runtime schemas");
} else {
  await mkdir(new URL("../docs/contracts/", import.meta.url), { recursive: true });
  await writeFile(target, content);
  console.info("Generated docs/contracts/control-openapi.json from current control schemas");
}
