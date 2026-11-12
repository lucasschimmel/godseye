# Development and releases

The repository is private and operated by one owner. `develop` contains the complete
work in progress. `main` starts with a short project presentation and receives code
only when a release is explicitly approved. Local development and publication do
not authorize any dedicated-server deployment.

## Daily work

Create a short-lived `codex/` or feature branch from `develop`. Keep commits focused
on one responsibility and preserve human-only author attribution. Run the checks
appropriate to the change, then open a pull request into `develop` with behavior,
verification and material limitations. A solo maintainer may review and merge their
own work; there is no mandatory second reviewer.

## Release to main

Prepare a pull request from `develop` to `main` for a named release. Its description
must identify scope, verification evidence, migration/recovery considerations and
remaining qualification limits. Merge only with the owner's explicit release
decision. Creating the repository or pushing `develop` is not that release decision.
Tag and publish a GitHub release only when separately requested.

Request-based protection should prevent accidental direct updates, force pushes and
deletion of `main` when the repository's GitHub plan supports it. Required check names
must correspond to real connected checks. Prepared Jenkins files are not a running
CI service, and no placeholder required check is installed.

## Initial publication provenance

The first publication groups the existing final source tree into small commits by
responsibility. These are publication snapshots, not a reconstruction of the exact
historical editing sequence or a claim that each intermediate commit was separately
buildable or tested. The original seven local checkpoint commits are retained on a
local backup reference. Verification applies to the final published `develop` tree.

Runtime data, local owner material, test artifacts, dependencies and build output
remain excluded from Git. Source/API changes continue to follow the complete V1
specification and its local-only qualification boundaries.
