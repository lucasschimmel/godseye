import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/store/src/schema.ts",
  out: "./packages/store/generated",
});
