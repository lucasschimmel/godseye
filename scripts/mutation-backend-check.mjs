// The backend suite reuses the isolated source-copy runner and preserves historical selections.
process.env.GODSEYE_MUTATION_SUITE = "backend";
await import("./mutation-check.mjs");
