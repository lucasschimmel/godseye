---
criticity: production
design: provisional
updated: 2026-11-11
---
# G.O.D.S.E.Y.E implementation constitution

1. The accepted V1 specifications and ADR-002 govern isolation; no remote setup occurs during local preparation.
2. Projects never acquire another project's identity, data, provider mapping or privileged runtime configuration.
3. Unconfigured providers report unavailable; local configuration is never presented as deployed infrastructure.
4. Every side effect has durable intent, an idempotency boundary and reconciliation; unknown is not success.
5. Provider credentials stay server-side; no application/build receives controller or production credentials.
6. Bun 1.4.4 workspaces/package management with Node.js 24 runtime, strict TypeScript, English identifiers and human-only Conventional Commits; local UI prose is French.
7. CI repeats all checks independently of hooks; security/recovery gates are not waived to claim V1 completeness.

The user approved local development now and remote Proxmox/account setup later. Physical E00 qualification remains pending; it does not prevent testing local first-party components against explicit adapters. Context7 is unavailable in this runtime; current official documentation and installed types are the fallback.
