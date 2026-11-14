# E07 Hermes local setup research

Date: 2026-11-13. Mode: SCOUT current official documentation and immutable source inspection.
Scope: installation, profile preparation and versioned skills. No model inference, external
accounts, server setup or operational skills are qualified here. The owner selected OpenAI API
and three initial roles: operations, security and research/marketing.

## Version and runtime contract

- The latest immutable stable GitHub release observed is **v0.23.1**, published 2026-11-10 UTC,
  target commit `3b421578588243f920886e6fe79a6faa87ea026e` [1].
- Official current installs support **Python 3.14**. The broader `>=3.11,<3.15` declaration exists
  to let older installations run their updater; it does not qualify 3.11–3.13 for current use [2].
- Upstream PM pins Linux x64 CPython **3.14.9+20261021**, SHA256
  `dfa4c5a40c47f338f41658017be550c72247c391e6bfb1fa4da03ebc8451abdf` [3].
- Official source archive for the immutable commit was downloaded over HTTPS and hashed locally:
  **91,372,324 bytes**, SHA256
  `2525046f165880c22f177f2214c8da3e26c58cb0aeab5bd09aad940556538897` [4]. This is a reviewed
  content pin derived from the official HTTPS source, not an independently signed upstream release digest.
- Upstream PM uses its own hash-pinned uv **0.13.5**. We do not expose or globally install uv,
  pip, Python, Node, desktop Hermes, PATH wrappers, shell aliases or services [3].

## Installation API verified in immutable source

The documented developer activation (`source ./activate`) syncs `all` extras and prepares a test
environment. It deliberately avoids the setup wizard and shell edits, but is broader than this
foundation needs [5]. The narrower public PM interface is:

```text
<pinned-python>/bin/python3.14 -B -m pm.build_env
  --source <immutable-source>
  --out <fresh-venv>
  --python <pinned-python>/bin/python3.14
  --sealed
  --cache <project-owned-cache>
```

No `--resolve`, extras or development groups: the committed `uv.lock` remains frozen. The output
must be new. PM bootstraps its small private dependency-manager runtime before the application
environment; raw `pip`/`uv sync` is explicitly discouraged by upstream [5][6].

Both `HERMES_HOME` and `HERMES_RUNTIME_DIR` must be project-owned. PM download partials otherwise
use the account's default Hermes root, so bootstrap children also receive a private process-local
`HOME` and XDG directories. This does not change the host account's actual home [7].

Source archives deliberately have version `0.0.0` without an installation stamp. A separate
owned `identity/install-stamp.json`, selected with `HERMES_INSTALL_ROOT`, supplies the actual
release/commit and `updateMechanism: external`; verified source bytes remain unchanged [8].

## Profiles and isolation

A Hermes profile is a separate `HERMES_HOME`: configuration, identity, skills, memory, state DB,
sessions and cron. Upstream explicitly warns against two writers on the same home [9].

Profile state separation is not an OS sandbox. Host tools use the real account `HOME` by default;
`terminal.home_mode: profile` can select profile CLI configuration but cannot prevent file or
network access by the OS user. GODSEYE must retain actual Docker/gVisor/disposable task isolation
and granted-tool qualification for later E07 stories [9].

Use fresh explicit homes, never `--clone`/`--clone-all`, sticky profile selection, imported
global skills or OAuth inheritance. Those features can copy configuration/material, and named
profiles can fall back to root OAuth state [9]. A project/environment/role binding prepared in
local metadata is a declaration, not proof of an admitted real environment or execution grant.

## Conservative setup configuration

Verified keys at the pinned commit [10][11]:

| Concern | Explicit setup configuration |
| --- | --- |
| Tools | `platform_toolsets.cli: []`, `platform_toolsets.api_server: []`; verify resolved sets are empty |
| Coding posture | `agent.coding_context: off` (string); avoids focus posture selecting coding tools |
| Bundled catalog | `.no-bundled-skills` marker in each prepared home |
| Project discovery | `skills.project_discovery: false`, `trusted_project_dirs: []` |
| External catalog | `skills.external_dirs: []`, no shared writable skill directory |
| Inline execution | `skills.inline_shell: false`, `skills.template_vars: false` |
| Learned skills | `skills.write_approval: true`, curator disabled; toolsets do not expose mutation tools |
| Background maintenance | `curator.enabled: false`, `auxiliary.background_review.enabled: false` |
| Memory | `memory.memory_enabled: false`, `user_profile_enabled: false`, `nudge_interval: 0` |
| Other model calls | title generation/upgrade and compression disabled for setup |
| Network services | webapp disabled; no gateway/API process, messaging channels or MCP servers started |

An empty toolset list must be checked through the real installed resolver. Omission/null means
defaults, which is different from an explicit empty allowlist [11]. No setting alone is claimed
to enforce an operating-system egress policy. Native setup smoke denies socket connection and
DNS functions before importing application modules, and never constructs or executes a model run.

## Skills versioning and deterministic activation

Upstream skills follow Agent Skills format (`SKILL.md` plus support files). The default catalog is
seeded automatically; `--no-skills` or `.no-bundled-skills` opts out. `skills opt-out` does not
delete previously installed material [12]. Fresh homes avoid that ambiguity.

Upstream precedence is trusted project, profile-local, `create_dir`, then `external_dirs`.
Missing auto-load/preload entries can warn and skip, and external directories are **not** read-only
protection: agent edits can modify the source if writable. Environment tags are relevance filters,
not guaranteed hard compatibility checks for explicit loads [12][13]. Therefore GODSEYE should:

1. Version each reviewed package's complete path/hash set and compatibility bounds in Git.
2. Copy an exact package set into a fresh per-binding profile snapshot.
3. Refuse missing files, links, changed hashes, path escapes, unsupported versions or extra skills.
4. Validate the actual native catalog before publishing a prepared profile receipt.
5. Keep mutable learned/draft material outside the trusted catalog; promotion belongs to later review.

Only a minimal identity/context skill is warranted now. Security audits, publishing, marketing
pipelines, recurring log investigations and coding agents remain later E07/E09 work.

## Runs API and explicit remaining boundaries

The current gateway actually provides authenticated Runs API admission, polling, SSE events,
cancellation, approval/clarification and unknown-outcome handling [14]. Profiles/API credentials
and canonical session authority affect idempotency and persistence semantics; a successful HTTP
submission is not evidence that a side effect completed. A restarted canonical run can become
`unknown` until explicitly resolved; retained IDs and bounded terminal state are necessary [14].

This setup slice does not implement or qualify Runs API integration (E07.S02), revocable task grants,
disposable tools, budgets/cancellation/fencing (S03), owner approval inbox (S04), Codex/Claude runner
(S05), or full lost-run reconciliation (S06). Do not label the whole E07 complete.

## Sources

All accessed 2026-11-13; independence group: NousResearch upstream. This is an API-shaped official
documentation/source digest, not a comparative market study. Fan-out was sequential. Coverage:
targeted setup only; production confinement, model billing and real API compatibility not measured.

1. [GitHub immutable v0.23.1 release](https://github.com/NousResearch/hermes-agent/releases/tag/v0.23.1).
2. [Pinned installation guide](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/website/docs/getting-started/installation.md).
3. [Pinned managed tool lock](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/pm/lock.json).
4. [Commit source archive](https://codeload.github.com/NousResearch/hermes-agent/tar.gz/3b421578588243f920886e6fe79a6faa87ea026e).
5. [Pinned package management guide](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/website/docs/reference/package-management.md).
6. [PM explicit build CLI](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/pm/build_env.py).
7. [PM storage paths](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/pm/paths.py).
8. [Version provenance](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/hermes_cli/version_info.py).
9. [Pinned profiles guide](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/website/docs/user-guide/profiles.md).
10. [Configuration defaults](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/hermes_cli/config_defaults.py).
11. [Actual platform toolset resolution](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/hermes_cli/tools_config.py).
12. [Pinned skills guide](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/website/docs/user-guide/features/skills.md).
13. [Actual skill resolution](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/agent/skill_utils.py).
14. [Pinned API server and Runs API guide](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/website/docs/user-guide/features/api-server.md).

## Native implementation findings

The local installer records its actual final status separately. During implementation, the real
frozen-core PM build succeeded, and qualification caught three integration details before completion:
source archives need the external installation stamp; PM creates source `.egg-info` and refreshes
bundled Python bytecode, so interrupted retries must preserve those derived bytes and re-extract clean
verified inputs; PM hardlinks application files into its cache despite `UV_LINK_MODE=copy`, so the
installer materializes private copies before recording its immutable runtime manifest. None of these
intermediate attempts was reported as an installed runtime.

Final actual local installer qualification on 2026-11-13 passed: install, status, socket-denied
smoke and idempotent install all returned the reviewed release/commit, CPython 3.14.9 and OpenAI
SDK 2.54.0 with zero model calls. The application receipt covers **36,386 immutable entries**:
23,592 source, 4,706 Python, 8,087 venv and one identity stamp. Its immutable-files manifest SHA256
is `0bfa2e83ed5160b0537b8c27e67ff379afeb8cd7cfb8d0bb513c863acbb5fa4d`.

Concurrent installer verification takes a nonblocking exclusive ownership lock; one overlapping
call was safely refused while the independent qualification ran, then a serialized idempotent
install passed in 4.46 seconds. No byte drift or receipt resealing occurred. Generated profile
configuration/catalog smoke belongs to the separate profile test evidence, not this installer result.

SYNAPSE docs digest saved as
`Cortex 60-research/godseye-hermes-setup/2026-11-13-snapshot.md`; parent research index and vault log
updated. No matching fresh setup digest existed; no cross-check conflict with ADR-002 was found.
Sync is left to the existing vault daemon; no Git operation was performed.
