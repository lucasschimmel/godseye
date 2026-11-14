# ADR-013: Pinned local Hermes setup and immutable profile snapshots

Status: accepted for local preparation, 2026-11-13.

## Context

The owner narrowed the first E07 delivery to installation, setup, profile roles and
skill versioning. OpenAI is the selected API; operational skills are subsequent work.
Existing grants and per-cell isolation must govern eventual agent operations.

## Decision

Install a pinned Hermes release/commit with independent Python 3.14, minimal frozen
PM environment and immutable provenance in workspace-bound native Linux storage.
Windows uses existing non-root WSL. Smoke-test the real package offline. Avoid
global installation, setup wizard, self-updater, aliases, gateway and model calls.

Prepare independent project/environment/role homes for operations, security and
research-marketing. UUID declarations remain unqualified bindings. Copy exact
reviewed skills into immutable revisions; serialize local writers with an OS lock
and promote with expected-current CAS. Retain snapshots for explicit rollback.

The first-party catalog contains only a bootstrap context skill. Disable discovery,
seeding, template execution and learning; use empty toolsets. Provider keys and
runtime conversations never enter Git. An unspecified model stays unconfigured.

## Consequences

Setup is reproducible before dedicated-host deployment. Profiles are a private local
setup registry, separate from owner data, with no execution authority. Agent Center
must validate real project/environment state and issue bounded grants before launch.
S01 remains partial at epic level; S02–S05 and E09 are not completed by this decision.
A private home is not an OS sandbox. See the [guide](../development/hermes.md) and
[authority contract](ADR-004-owner-authority-and-foundations.md).
