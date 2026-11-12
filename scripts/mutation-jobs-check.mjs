// The jobs suite reuses the isolated source-copy runner.
process.env.GODSEYE_MUTATION_SUITE = "jobs";
await import("./mutation-check.mjs");
