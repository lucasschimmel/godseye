# E07 local Hermes installation and profile foundation

Date: 2026-11-13. Request: install and prepare Hermes locally, version skills and
define profiles; do not implement operational skill bundles yet. Continue the
existing project. No dedicated-host action, automatic Git publication or paid call.

## Scope and decisions

- Owner selected the OpenAI API and operations, security, research-marketing roles.
- Use a pinned upstream release/commit, Python 3.14 and an isolated minimal frozen
  PM source environment. Windows uses the existing non-root Ubuntu WSL runtime.
  Install below a workspace-bound native ext4 tree, never the account's Hermes home.
- Local setup is an offline administrative CLI. No agent chat, Runs API, gateway,
  scheduler, shell/MCP/plugin tools or model requests are exposed by this tranche.
- Each declared project/environment/role gets a separate Hermes home. UUID labels
  are local declarations, **not** validated project ownership, task grants or OS
  confinement. Every view must report this explicitly and remain non-runnable.
- Skills are a small reviewed source catalog, exact semantic versions and file
  hashes. Only one context/bootstrap skill is supplied. No learned skill promotion,
  community import, arbitrary path import or implicit bundled skill synchronization.
- Profile revisions are immutable snapshots. Explicit local promotion uses exact
  expected-current revision CAS; history and rollback select retained snapshots.
  A workspace-wide OS lock excludes concurrent writers. No stale PID killing.
- OpenAI is the provider preference. A model may be recorded explicitly; an unset
  model remains unconfigured. No key is requested or read during preparation.
- Secrets, conversations, memories and actual profile homes are ignored runtime
  data. Only templates, catalog, code, tests and redacted evidence enter Git.

## Sequential stories

1. E07.SETUP01: pinned installer, provenance, minimal dependency environment,
   idempotent inspection and real no-network upstream import/config/version smoke.
2. E07.SETUP02: versioned skill catalog and role policy, immutable scoped profile
   preparation, verification, exact promotion and retained rollback; safe CLI.
3. E07.SETUP03: regression/native qualification, security and fresh review,
   operator guide, spec/plan reflecting precisely this partial E07 boundary.

No parallel epic implementation swarm: one dependent epic. Research/installer,
GAUNTLET tests and fresh FABER review are dedicated CRAFTS satellites with explicit
file ownership. Existing private-path protection and local tool patterns were read
before selecting native ext4 profile storage; do not duplicate the E01 job scheduler.
Legacy repository graph is grep-based; targeted source query found no Hermes
profile manager to reuse. Existing contracts agent.run/skill.promote remain disabled.

## Acceptance contract

| Criterion | Test ID | Observable outcome / refusal |
| --- | --- | --- |
| AC-701 | T-AC-701 | Installer pins archive/commit/runtime and refuses mismatched cached sources; interrupted staging never reports installed, retry preserves any valid installation, and publication is atomic; no global installation or account home mutation. |
| AC-702 | T-AC-702 | Actual installed Hermes imports/config/version work offline, without key, model, gateway or network access. |
| AC-703 | T-AC-703 | Three explicit roles and UUID scopes produce distinct private homes; unknown fields/roles, invalid IDs and traversals fail closed. |
| AC-704 | T-AC-704 | Catalog validates exact versions/provenance, bounded regular files and hashes; changed, added or linked skill files are refused. |
| AC-705 | T-AC-705 | Prepared home has only pinned skills, no bundled/discovered skills or tool/learning authority; OpenAI preference does not claim connectivity. |
| AC-706 | T-AC-706 | Revisions are immutable/idempotent; promotion uses exact CAS; rollback retains previous snapshots and unrelated profile data. |
| AC-707 | T-AC-707 | Concurrent writers, foreign ownership, linked/hardlinked paths and tampered profile state are refused without overwrite. |
| AC-708 | T-AC-708 | CLI returns bounded public setup metadata only, no runner/admission or private material; upstream operational qualification stays pending. |

## Qualification boundaries

No full E07 completion claim: S01 has a local preparation implementation only.
Owner HTTP/Agent Center persistence and binding, Runs API/chat/SSE, task grants,
budget reservation, revocation/cancellation/unknown-run reconciliation, disposable
tool execution, approval inbox and Codex/Claude runners remain later E07 stories.
E09 supplies operational skills. WSL process/home separation is not Docker/gVisor
or VM containment. No existing owner state is opened or migrated in this tranche.

## Memory and gates

Context sources: existing context-pack.json, project-dna.md, constitution,
Agentics crafts-godseye playbook, Cortex ai-bootstrap/stack index. Track record:
E06 1225 ordinary and 11 separate native scenarios; full tests take roughly sixteen
minutes. Preserve historical evidence; use targeted tests plus static checks/build
and a scaled full regression where changes affect shared code. No Hermes stack
note exists; version-pinned official source governs. Review native filesystem,
archive and profile trust boundaries. Run real offline smoke, not only fake binaries.
User's explicit instruction authorizes local implementation; routine technical
choices are recorded here without a separate approval gate.
