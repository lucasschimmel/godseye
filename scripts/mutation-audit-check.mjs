// Reuse the existing safe source-copy runner and report classification.
process.env.GODSEYE_MUTATION_SUITE = "audit";
await import("./mutation-check.mjs");
