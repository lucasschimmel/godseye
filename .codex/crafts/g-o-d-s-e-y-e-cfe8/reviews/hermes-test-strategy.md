# GAUNTLET strategy — local Hermes setup

Date: 2026-11-13. Criticity: production. Scope: E07.SETUP01–03 only.
Framework: existing Vitest 5.1 (Node 24) orchestrating Python 3.14 stdlib unittest
under the existing non-root Ubuntu WSL. Existing tests do not cover Hermes.
Native upstream qualification remains separate from filesystem contract tests.

## Risk and execution order

1. High: exact source/catalog integrity and rejecting unsupported input before any
   write. Exercise production entry dispatch, bounded JSON, strict UUID/role/model
   fields and version/file hashes. Corrupted and extra files must not be loaded.
2. High: filesystem ownership and transaction safety. Exercise actual ext4 files,
   symlinks/hardlinks, explicit writer-lock exclusion, immutable snapshots and
   exact compare-and-swap promotion. Failed writes preserve prior active revision.
3. High: false readiness and inherited authority. Every public profile result must
   remain non-runnable with declared-local scope binding. OpenAI preference never
   means key/provider connectivity. Profiles have no tool/learning/discovery grant.
4. Medium: scoped role/home separation, deterministic idempotent preparation and
   retained rollback. Verify observed files and public results, not helper calls.
5. High: actual pinned upstream smoke without network/model/key. Use real installed
   Python source/config/skill resolution only; do not fake the Hermes binary or
   count an opt-in skipped case as passed. Installer mismatch refusal is tested
   independently from potentially slow dependency acquisition.

## Contract trace

| Criterion | Tests |
| --- | --- |
| AC-701 | T-AC-701 pinned provenance/cache rejection and installation ownership |
| AC-702 | T-AC-702 actual upstream version/config/skills import, network denied |
| AC-703 | T-AC-703 role/scope separation and malformed input table |
| AC-704 | T-AC-704 catalog drift, added files, paths and links |
| AC-705 | T-AC-705 generated config/catalog without tool/learning/discovery grants |
| AC-706 | T-AC-706 immutable idempotence, staging, exact promotion and rollback |
| AC-707 | T-AC-707 unsafe paths, state tampering and concurrent writer exclusion |
| AC-708 | T-AC-708 public metadata, unknown/runner command refusal, sanitized errors |

## Method and limits

Test production modules against disposable native ext4 roots; the optional root
injection is a Python constructor test seam, never a public CLI path override.
Use real OS `flock` exclusion and filesystem effects. Fault injection is limited
to disk/rename failure boundaries to establish failure preservation. Generate
several valid UUID pairs deterministically to check scope partitioning; malformed
parser tables cover traversal, unknown keys, invalid types and shell characters.
No full browser suite is needed for an offline CLI-only change. Existing broad
E01–E06 evidence remains historical unless explicitly rerun. No paid OpenAI calls,
real owner-store access, dedicated server or global package installation.

Estimated work: small input/metadata cases, medium filesystem transitions and one
native dependency smoke. No claim of full mutation coverage, OS containment or
complete E07 Agent Center is made by a passing setup suite.
