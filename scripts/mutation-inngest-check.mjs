// Reuse the source-copy runner. Never mutate the developer's working tree.
process.env.GODSEYE_MUTATION_SUITE = "inngest";
await import("./mutation-check.mjs");
