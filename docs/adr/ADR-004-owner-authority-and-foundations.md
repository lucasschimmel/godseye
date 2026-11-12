# ADR-004: Local owner authority and durable control foundations

- Status: accepted for local implementation; remote qualification remains pending
- Date: 2026-11-11
- Related decisions: [ADR-002](ADR-002-professional-vm-and-dual-stack.md), [ADR-003](ADR-003-local-first-and-ci.md)

## Context

The owner requested completion of the control foundations and owner authentication while all work remains local. The first checkpoint's developer-process owner adapter was insufficient for this boundary. Future deployment, agent and data providers need reusable durable authority/effect controls before they can execute.

## Decision

Use one pre-created owner identity with Better Auth/passkey 1.7.20. Require resident passkeys and user verification, absolute eight-hour sessions without a session cookie cache, and a five-minute fresh passkey confirmation for sensitive actions. Deny public signup, alternate login methods and unneeded native authentication endpoints. Derive owner/session authority on the server and expose only sanitized metadata to the console.

Use the canonical localhost console origin during local development. Initial enrollment is a ten-minute single-use ticket prepared by a private local CLI broker. Its HMAC proof is timestamped and replay protected. Verified enrollment consumes the ticket in the same true Drizzle transaction that stores the passkey/session. Authentication and recovery share a serialized authority lane.

Provide explicit online recovery and an independent offline CLI procedure guarded by the local instance lock. Recovery revokes sessions, passkeys, old challenges and tickets before preparing replacement enrollment. Real owner registration remains a human device ceremony; virtual browser tests cannot perform it for the owner.

Protect local identity/database directories with OS permissions, reject unsafe shared-root aliases and linked state entries, and fail closed if permissions or locks cannot be established. Authentication writes persist an audit outbox event atomically; export into the core journal occurs after the authentication transaction.

The common foundation uses strict scoped references and immutable plans, exact recent-owner approvals, persistent effect identity, leases/fencing/activation epochs, revocable bounded grants and atomic budget reservations. Unknown outcomes require evidence-based reconciliation before any retry. Retention and independently anchored audit export preserve evidence needed by later recovery modules.

Keep the first-party control HTTP contract/version and response validators shared with OpenAPI, console consumption and an internal typed owner client. This client does not replace the future project SDK. Real provider registration remains trusted and qualification-dependent; the default execution registry is empty.

## Consequences

The local console no longer has an unauthenticated developer-owner mode. Browser session revocation, key replacement and account recovery are explicit, auditable operations. Existing local data is preserved through ordered checksummed migrations.

The owner must enroll a real passkey through the CLI-produced link. Changing from localhost to a server management origin requires a separately qualified enrollment/recovery procedure. Trusted local filesystem access remains a stronger recovery authority than the browser identity.

No dedicated-server access or installation follows from this decision. Production mode, Proxmox/IPv6/firewall/sandbox admission, real PostgreSQL multi-process behavior, protected off-host recovery, Jenkins/agents and application providers remain gated by their original qualification requirements. This decision does not close E00 or certify the V1 release.

## Verification

Use real isolated PGlite stores for control invariants and virtual-authenticator browser ceremonies for enrollment, login, user verification, origin binding, revocation and recovery. Record final run-specific evidence and unresolved qualification separately in [the verification strategy](../../tests/STRATEGY.md) and [development plan](../plan/v1-development.md).
