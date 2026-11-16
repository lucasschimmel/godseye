# ADR-003: Develop local foundations before remote qualification and add private CI

Date: 2026-11-11
Status: accepted sequencing and scope amendment from the owner's explicit local-first development request; infrastructure remains unqualified

## Context

The owner approved starting development against the existing V1 specification and plan, preparing everything locally before dedicated-server installation. The server is reported reset to Ubuntu 26.04; its actual state has not been inspected. The original dependency graph placed all E01 work after physical E00 qualification, which would prevent useful authorized local development.

The owner also requested Jenkins for recurring checks and private-repository CI, plus GitHub synchronization so an accepted `main` update can deploy the associated site or backend. This adds an intentionally bounded automated production delivery path to the earlier fresh-approval-only promotion policy.

## Decision

Permit the local portions of E01, local owner-console journeys and CI event/configuration preparation before remote E00. Keep providers disabled or explicitly unconfigured. A local checkpoint is not a completed full epic or V1 release. Local database tests do not qualify Linux sandboxing, real PostgreSQL separation, private networking, restoration or host capacity.

Use a persistent PGlite control database by default so the console and API can be developed without a Docker daemon. Retain a PostgreSQL driver for later qualification. The local owner adapter binds only to loopback and production startup is refused until real owner authentication and private management access exist.

Prepare a private Jenkins controller with zero built-in executors. Builds use qualified isolated agents; no fallback executes arbitrary builds on the production Docker daemon. The platform repository receives nightly and SCM-triggered checks. GitHub event intake authenticates raw bytes, records receipts and queues one intention per matching project; provider verification and execution remain separate stages.

Add F44–F46 and T41–T43 for recurring CI, signed source synchronization and bounded standing auto-deployment. An owner-created standing policy may authorize exact-scope production artifact promotion after required checks, source freshness and provider qualification. Destructive/incompatible data changes, restore activation and privilege expansion retain fresh approval requirements. The event receipt, successful test and successful deployment are distinct observable states.

## Unchanged architecture and gates

[ADR-002](ADR-002-professional-vm-and-dual-stack.md) remains the placement/network decision: one physical Proxmox installation, one professional VM, one personal VM and an optional disposable sibling work VM; Docker/Compose with qualified gVisor application profiles inside the professional VM; IPv6-first with one public IPv4 targeted and at most two justified.

No nested Proxmox is introduced. The later host installation must use a supported Debian/Proxmox recovery installation route rather than add Proxmox to Ubuntu. Existing data, recovery access, actual hardware, Robot addressing, routing and firewall behavior must be verified before installation or activation.

## Consequences

Local product work can proceed now and produce real reviewed behavior without pretending the dedicated server is ready. E00 still gates any enabled infrastructure capability; E02 still gates production identity; E05 still gates actual CI dispatch and delivery. E12 release evidence must include all original requirements and the new CI families.

The plan records partial local progress separately from complete story acceptance. The UI shows planned environments and unknown/unconfigured observations honestly. No elapsed schedule or test percentage substitutes for isolation, authorization, recovery or delivery freshness evidence.
