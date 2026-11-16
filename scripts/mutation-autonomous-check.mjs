// The curated autonomous suite uses the isolated source-copy runner, never the working tree.
process.env.GODSEYE_MUTATION_SUITE = "autonomous";
await import("./mutation-check.mjs");
