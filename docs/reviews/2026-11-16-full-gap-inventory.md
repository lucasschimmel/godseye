# Full gap inventory — 2026-11-16 (after Release 3 and PRs #45-#48)

Three read-only audits re-checked the V1 spec and plan against `develop` (`1c04f2a`), and the dedicated-server spec and plan against the execution ledger and evidence files. Nothing was re-measured on the live server for this document. It supersedes the status columns of [2026-11-16-gap-inventory.md](2026-11-16-gap-inventory.md) where the two differ.

Needs: **C** code by the assistant, **S** server work by the assistant, **O** owner-only action, **D** owner decision. The owner steps are written up in [the owner actions guide](../operations/owner-actions-guide.md).

Vocabulary: *local* means done with fixtures and tests only; *server* means proven on the real server according to the ledger.

## 0. Owner decisions of 2026-11-16 (after this inventory was written)

- **Notifications go to Discord, not email.** A GODSEYE Discord server with one category per project (status, logs, later a limited dashboard and two-way chat with Hermes). Phase 1: a Discord-format webhook adapter (Discord rejects the current generic body, which has no `content` or `embeds`) for alerts, status and logs; the external heartbeat uses healthchecks.io forwarding to Discord so it does not depend on the monitored server. Phase 2: a Discord bot for two-way use, restricted to the owner's Discord user id, with the bot token in OpenBao and dangerous actions still gated by passkey approval. Email (L1) is dropped.
- **No payment for GitHub Actions.** The repository stays public; scheduled and manual `external-observer` runs succeed again (2026-11-16 20:06 UTC), so the billing block recorded in ledger entries 020 and 022 is stale.
- **First real project: Melvyn** (`D:\Developer\Projects\Melvyn`, private GitHub repository, Bun and discord.js bot with SQLite). It also exercises the GitHub App, webhook and delivery chain. Only one bot process may run per token and database: stop any other deployment before this one starts.
- **Host reboot drill only when reconnection is certain** (laptop WireGuard tested, two OpenBao shares reachable, remote console requested from Hetzner).
- **OpenBao shares stay on the desktop for now**; no redistribution yet.
- **B2 per-prefix keys: deferred** (owner choice, to be done later; the shared-key risk R-P06b stays accepted). Lifecycle rule to apply in the Backblaze console: keep prior versions for 30 days, not "last version only", so a deleted or overwritten backup stays recoverable for 30 days.
- **Backup slimming (planned, not implemented).** Measured 2026-11-16: real VM data is 6.3 GiB (pro), 1.1 GiB (games) and 4.3 GiB (work); the local vzdump set uses 12.5 GiB of its 60 GiB quota and only the newest archive per VM goes off-host weekly (keep 2), so the B2 cost is cents per month. Regenerable weight inside the guests is about 2 GiB on pro (`node_modules` 676 MiB, bun cache 670 MiB, `/var/cache` 628 MiB, apt lists 169 MiB) and about 2 GiB on work (Jenkins workspaces 954 MiB, `/opt/godseye` 650 MiB, caches 450 MiB). vzdump cannot exclude paths inside a VM disk, so the plan is (1) a guest hygiene timer (apt clean, journal vacuum, bun cache trim, Jenkins workspace cleanup), and (2) an exclude list applied to every future per-project file and config snapshot (`node_modules`, `.next`, `.turbo`, `dist`, `build`, `target`, `.venv`, `__pycache__`, `.gradle`, `.cache`, framework caches) with per-language rules reviewed so that vendored sources and lockfiles are kept, plus compression (zstd) before upload.
- **OpenBao session:** OpenBao 2.7 no longer allows `generate-root` without a token (verified: 403). The session uses the initial root token from the owner's init file; if it was already revoked, the plan B is a temporary listener option (see the owner guide). One command, `p13-openbao-owner-session.sh`, does the whole session.
- **Code backlog is paused** (the items marked C in sections 3.1 and 3.2 and step 5 of the critical path) until the owner picks what to start with. The priority is the server and owner steps.

## 1. Known limits (recorded so they are not forgotten)

| # | Limit | Where it bites |
|---|---|---|
| L1 | Notification webhooks were never sent to a real receiver; only fakes and a private-address refusal were tested. There is no email channel (no SMTP contract). | A11, DS11 |
| L2 | Restore activation cannot promote on the shipped pgBackRest stack (`PROMOTION_UNAVAILABLE`); it only works with a fixture provider. Jobs, backend and domain definitions stay on the fenced source; the restored database is not adopted as a managed allocation. | G1, E03.S03 |
| L3 | Jenkins build links depend on the git plugin revision shape. Checked on the real Jenkins (`godseye-platform` build 13 exposes `lastBuiltRevision.SHA1`, equal to the `main` commit); the console rendering itself was not re-checked with a real build. Links are derived per request, so older runs show "Build Jenkins non rapporté". | A5, E05.S06 |
| L4 | Reports of green Jenkins builds are not stored in the repository (no JUnit, no config hash). | DS15 |
| L5 | No project, database or hosted backend cell exists on the server; everything about cells is lab-level. | E03, E04, E06 |
| L6 | The controller has no OpenBao identity (`bao.auth` missing); the Access page shows `no_authority`. Raft snapshot and the jobs and Redis units are disabled. | E02.S02 |
| L7 | The capacity over-commit (480 of 472 GiB disks, 99.1 % RAM) is undecided; no dedicated coding VM fits. | DS03 |
| L8 | Notification retries after an unclear send rely on the receiver honouring `Idempotency-Key`; Slack/Discord-style incoming webhooks probably reject the body, so use a generic receiver (ntfy, healthchecks). | A11 |
| L9 | Local PC: the OpenBao lab tool is not installed, so `access-cli` and `openbao-provider` vitest files fail there (they pass where the tool is installed). | tests |
| L10 | The repository is public; reverting it to private stops GitHub Actions and the external observer. The observer ran successfully on 2026-11-16 (the earlier billing block no longer applies). | DS11 |

## 2. Corrections to earlier claims

- The OpenAPI file and `CONTROL_API_VERSION` are `1.22.0`; `docs/spec/v1.md`, `docs/plan/v1-development.md` and ledger entry 025 still say `1.19.0`.
- The execution ledger stops at entry 026: it does not record Jenkins `main` build 13 or candidate build 13, nor that the controller has no `bao.auth`.
- Section A of the previous inventory is partly stale (A5, A6, A8, A11, A13 and A15 moved on); section C "work-VM egress allowlist not done" conflicts with `host-operations.md` (script `g03` delivered) and must be checked on the server.

## 3. V1 spec and plan versus code

### 3.1 Not started

| Epic | Missing | Needs |
|---|---|---|
| E09.S01 | Recurring security skills: scanner pipeline, baseline diff, remediation artifacts (F26, T27). `infra/hermes/skills/` is empty | C |
| E09.S02 | Log and metric investigation skills, redaction, deployment correlation (F27, T27) | C |
| E09.S03 | Market and marketing skills, source-linked deltas, publication policy (F28, T28) | C |
| E10.S01, S02 | Laya: frozen evaluation policy, labelled FR/EN dataset, service, held-out evaluation (F29) | D + O + C |
| E11.S01 | Games and bots adapter: lifecycle, logs, port inventory, API and UI (F36, T32, N03) | C + S |
| E11.S02 | Export, import, Supabase migration (F38, T35) | C |
| E11.S03 | Physical purge, tombstoning, residual-resource tracking (F41, T38); quarantine and purge are metadata only | C + S |
| E12.S01 | Recovery set and clean rebuild (F37, T31) | S + O |
| E12.S02 | T01-T43 qualification, upgrade, rollback and provider-outage drills, final 72 h soak (invalidated by entry 017) | S |
| E12.S03 | Release evidence ledger, compatibility and capacity matrix, owner walkthrough | C + O |
| E00.S05 | Two representative projects, games load, heavy task, compatibility and capacity report | D + S |

### 3.2 Partial

| Item | What is done | What remains | Needs |
|---|---|---|---|
| E00.S01-S04 | P00-P05 evidence; ZFS mirror; A/B gVisor isolation; Hermes installed with `modelCalls: 0` | Mirror-member boot, resilver and Rescue drills; IPv6 matrix and AAAA; overcommit rejection test; host reboot with guard; no model call | S + O |
| E01.S04 / F35 | Manual audit export and integrity panel | Automated protected off-host copy and trusted anchor kept elsewhere (T37) | C + D |
| E02.S01 | Owner passkey enrolled on the real origin | Console flow to add a passkey; ticket creation is CLI-only; remote recovery not drilled | C + O |
| E02.S02 | OpenBao runs and is unsealed | Provider token; default rotation adapter; root-token revocation and unseal rehearsal; raft snapshot timer | O + S |
| E02.S03 | Private subnet allocation, quota helper | Public-address inventory limit, game-port allocation, AAAA gating (N01/N03/N05); per-cell ceilings are scripted but not called by the API | C + S |
| E02.S04 / E08.S01 | Headroom, host-health push, observer | Guest and container metrics, raw-log ingestion, producer continuity | C + S |
| E03.S01 / G2 | Lifecycle saga as metadata | All-service stop, resume and resource release | C + S |
| E03.S02, S03 / G1 | Database roles, backups, restore, activation control plane (API 1.22.0) | See L2; producer fencing, file/auth/config snapshots (`scsi1` has `backup=0`), effect reconciliation | C + S |
| E03.S04 | Backup and rotation views | Archive and headroom incidents on real data | C |
| E04.S03 / G3 / F18 | SSE with signed cursors, refetch and revoked frames, SDK reader | WebSocket transport, console consumer of application events | C |
| E05.S01 | Build and registry client; scanner result read from a Jenkins artifact | Trivy adapter in code; registry, Trivy and app-build-agent installers unrun (htpasswd missing) | O + S |
| E05.S02-S04 | Docker runsc adapter, edge, preview TTL, migration lock, rollback, redeploy control | Never run on the server (T10, T12); IPv6 unqualified | S |
| E05.S05 | GitHub App auth and intake code | App not created, secrets not in OpenBao, webhook tests (replay, oversize, invalid) | O + S |
| E05.S06 | Jenkins client, drills passed | No green source-triggered run, first nightly 2026-11-17 04:40 UTC, no config hash | S |
| F47 | Domain code and tests | Live DNS and TLS qualification | S + O |
| E07.S01 / F23 | Profiles, one trusted skill | Skills catalog view (versions, provenance, review), Skills nav item | C |
| E07.S03 / G4 | Grants, reservations, allowlists locally | General shell, deployed I10/I11 containment, work-VM egress rule | S + D |
| E07.S04 / F34 | Plan and activation approvals inside their contexts | Unified approvals view | C |
| E07.S05 | 18 sandbox gates on the work VM | Runner `available:false`; owner acceptance; preview evidence | O + D + S |
| E08.S02 | Usage ledger, budgets | No provider invoice reconciliation; no paid usage exercised | O |
| E08.S03 | Webhook channels and arrival test | See L1, L8; observer blocked by billing; no heartbeat | O + C |
| E10.S03 / F40 | a11y suite (axe on 12 routes, 4 sizes, populated states, 200 % zoom), tablet breakpoint | Nav lacks Skills, Research/Marketing, Personal, Settings; unified approvals view; passkey-add flow | C |

### 3.3 Done locally, never proven on the server

F01-F08 to F14, F16, F17, F19-F22, F24, F25, F30-F33, F37 (partly), F39, F42-F46 and E04.S01, S02, S04, E06.S01-S03 have code and tests. The jobs, Redis and Inngest units are installed but disabled; nothing ran on the server (T20). Real PostgreSQL concurrency and fault runs on the server are outstanding (T18, T23, T37).

## 4. Dedicated server versus spec and plan

| DS | Status | What remains | Who |
|---|---|---|---|
| 01 Inventory | Done, evidenced | Wipe-scope sign-off not logged (minor) | none |
| 02 Proxmox, mirror, boot, emergency route | Partial | Boot from each mirror member, resilver, host reboot with guard, Rescue and console drills, TOTP; both NVMe carry the wear flag | O + S |
| 03 VM caps and overcommit | Partial | Overcommit rejection never shown; capacity decision (L7) | D + S |
| 04 Network, IPv4/IPv6 | Partial | AAAA scope and IPv6 matrix; webhook receiver tests; re-test after host reboot | D + O + S |
| 05 Admin closed, private and Rescue access | Partial | Laptop and mobile drill after the last boot; Rescue and console untested; TOTP; emergency key custody | O |
| 06 A/B isolation, runtime, quotas | Partial | Lab-level only; no real cell inspected after redeploy | S |
| 07 Per-cell DB, identity, workflow | Partial | No real project cell; per-cell Redis and Inngest not enabled; control-API ceiling wiring is code; no app-level cross-cell authorisation test | O + C + S |
| 08 Isolated builds, no prod authority | Partial | Coding runner not accepted | O + D |
| 09 Off-host recovery | Partial | Control stanza schedule, WAL RPO measurement, two full generations, restore to a held destination, files/auth recovery; shared B2 key (R-P06b); passphrase not escrowed; lifecycle rule missing | O + S |
| 10 Restore activation fails closed | Not done on the server | See L2, producer fencing, snapshots | C + S |
| 11 Metrics, external alert, backup and cert alarms | Partial | Billing, alert channel, heartbeat, alert-arrival proof, observer lacks IPv6, console, Bao sealed | O + S |
| 12 72 h soak | Not done | Rerun last on a frozen configuration | S |
| 13 Provider admission | Not done | `bao.auth`, GitHub App, registry, Trivy, app-build-agent, real project, coding bindings | O + S |
| 14 Replacement-host runbook, custody | Partial | Host rebuild and upgrade drills, passphrase escrow, share distribution, unseal rehearsal, root-token revocation evidence | O + S |
| 15 Jenkins | Done, not evidenced | See L4; nightly and source-triggered runs | S |
| 16 Autonomy with the PC off | Not done | Jobs unit, PC-off test, reboot of pro and host with sealed Bao | O + S |
| 17 Hermes, coding runner, Laya, accounting | Not done | First model call, runner acceptance, Laya, budget-refusal test | O + D + C |
| 18 Lifecycle, rotation, export, purge, off-host audit | Not done | E09-E12 code | C + D |

Isolation items: I03 is done and evidenced; I11 and I14 are not done; I01, I02, I04-I10a, I12, I13, I15 and I16 are partial (proven on fixtures or in the lab, not on a real cell). I16 is weakened by the shared B2 key.

## 5. Freeze checklist before the 72 h soak

| # | State |
|---|---|
| 1 Capacity and ZFS layout decided | Open: 480 vs 472 GiB; entry 021 recommends a recorded thin-provisioning exception |
| 2 Host copy connected, passphrase escrowed | Copy runs on the shared key; escrow and dedicated keys outstanding |
| 3 B2 cell restore, cells torn down, scoped keys | Restore and teardown done; per-scope keys outstanding |
| 4 Cell timers, ceilings, real projects, pinned game | Not done; no project |
| 5 Edge 404, AAAA | 404 deployed; AAAA undecided |
| 6 In-guest firewalls, egress allowlist, host reboot | Firewalls and allowlist done; reboot with guard held |
| 7 WireGuard drilled, emergency key offline, TOTP | Open |
| 8 OpenBao custody, root-token revocation, unseal rehearsal | Open; shares on a single machine |
| 9 Alert channel and observer | Open: billing, no channel, no heartbeat |
| 10 Jenkins proven, configuration hash | Mostly; nightly and source-triggered runs pending; hash not recorded |

## 6. Critical path to the soak

1. **D (parallel):** capacity exception or resize, AAAA scope, coding VM, alert receiver, scoped Proxmox token. A ZFS rebuild, if chosen, comes before everything else.
2. **O, one session:** GitHub billing or visibility; root token then `p12-openbao-owner-setup.sh` and `bao.auth`; share redistribution, unseal rehearsal, root-token revocation; scoped B2 keys, restic passphrase escrow, lifecycle rule; Proxmox TOTP; WireGuard laptop and mobile drill, emergency key custody; alert channel and heartbeat; GitHub App and registry credentials.
3. **S, after step 2:** wire `bao.auth`, rerun `h08` with scoped keys, enable the raft snapshot timer, install registry, Trivy and build agent, webhook tests over IPv4 and IPv6, alert-arrival test, extend the observer.
4. **O then S:** first real project through a fresh passkey session; provision prod and dev cells, timers, ceilings, Redis and Inngest; deploy the pinned reference game.
5. **C (can start now, independent of the owner):** producer fencing and file/auth snapshots, per-cell ceilings in the API, guest and container metrics, WebSocket transport and console consumer, Skills catalog and unified approvals view, passkey-add flow, audit off-host copy, E09-E12.
6. **O present:** reboot guests, then the pro VM, then the host; unseal; `p12-post-reboot-check.sh`; Rescue drill.
7. **S:** preview, rollback, lost-result and TTL cleanup; confirm nightly and source-triggered Jenkins runs; record the Jenkins configuration hash and store build evidence in the repository.
8. **Freeze**, then the 72 h soak; host-rebuild and upgrade drills follow.
