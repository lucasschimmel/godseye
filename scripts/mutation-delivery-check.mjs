// Reuse the source-copy runner; the delivery suite contains twelve new guards and affected M07.
process.env.GODSEYE_MUTATION_SUITE = "delivery";
await import("./mutation-check.mjs");
