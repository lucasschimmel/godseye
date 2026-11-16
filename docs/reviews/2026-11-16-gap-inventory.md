# Gap inventory — 2026-11-16 (after Release 1)

Sources: three read-only audits (console, V1 spec/plan, dedicated-server spec/plan) cross-checked against code and the operations ledger. Nothing here was re-measured on the live server. Needs: **C** code, **S** server work by the assistant, **O** owner input, **D** decision.

## A. Console (apps/console)

| # | Gap | Severity | Needs |
|---|---|---|---|
| A1 | Shell ignores server mode: "Serveur non connecté" strip, "Développement local" pill, local-session captions, local-first footer | blocker | C |
| A2 | Owner entry and recovery copy point to a local terminal; no remote-friendly enrolment/recovery explanation | blocker | C (+D for flow) |
| A3 | Infrastructure page still describes a generic Proxmox/AX41 plan; no host/VM metrics (CPU, RAM, disk, ZFS), no WireGuard/OpenBao/Jenkins/B2 health | blocker | C (new endpoint) |
| A4 | Overview and operational panels: local wording, placeholder host-metrics note | important | C |
| A5 | CI/CD page: "planned" badges, "install Jenkins" steps, no Jenkins build link/log | important | C |
| A6 | Delivery: no current release per environment, no deploy health, no redeploy/restart | important | C |
| A7 | Backups: no B2 repository state, last full/diff/WAL age, restore-test result | important | C |
| A8 | Passkeys: no "add a passkey" flow; revoke disabled with no explanation; ticket creation is CLI-only | important | C |
| A9 | Audit export/anchor exist in the API with no console surface | important | C |
| A10 | Secrets: no remote import flow; "à connecter" rotation labels without a path | important | C |
| A11 | Incidents/notifications: webhook adapter, console configuration and arrival test now exist (owner API 1.22.0); email absent (no SMTP contract); no live receiver qualified | important | C + O |
| A12 | Backend panel, project create/detail, repository form: stale "runtime non connecté", "validated locally" copy | important | C |
| A13 | Custom domains: no cross-project list, no TLS expiry/state | polish | C |
| A14 | Usage/jobs/Hermes copy ("fixture", "local"), English fragments, duplicate nav icons | polish | C |
| A15 | Per-route error/pending components, tablet breakpoint, a11y and mobile evidence, no console tests (E10.S03/T33) | important | C |
| A16 | Laya (E10.S01/S02, F29) not started; plan blocks it on evaluation | deferred | O + D |

Proposed PR order: shell + copy sweep → infrastructure rewrite → host metrics endpoint → passkeys + audit → delivery/Jenkins → backups → domains → secrets/notifications → UX pass.

## B. V1 spec and plan vs code

| Epic | Status |
|---|---|
| E00 | Partial: Hermes/paid-model qualification, two representative projects, compatibility/capacity report missing |
| E01–E02 | Done locally; off-host audit destination and OpenBao custody evidence missing |
| E03 | Restore **activation hard-blocked** (`recovery.ts`), producer fencing open, lifecycle is metadata only, no real project cell yet |
| E04 | Done locally; SSE only (no WebSocket); no hosted app cell on the server |
| E05 | Docker runsc adapter and edge exist; GitHub App, registry, Trivy, build agent, real preview/rollback never run |
| E06 | Done locally; jobs unit never executed on the server |
| E07 | Done locally; no general shell; coding runner `available:false` (VM egress rule + owner acceptance missing) |
| E08 | No host/guest metrics, no notifier wired, observer only starts now |
| E09–E12 | **No code**: recurring security skills, investigation, marketing, Laya, games adapter, export/Supabase migration, physical purge, recovery set, upgrade drill, final qualification |

Stale or contradictory documentation (status updated 2026-11-16 by the `docs/spec-plan-sync` change; each fix was checked against the code, the execution ledger and the evidence files):

| # | Item | Status | Where / reason |
|---|---|---|---|
| B1 | Coolify named in plan/spec/ADRs | **Closed** except the handoff files | [ADR-021](../adr/ADR-021-direct-docker-runsc-delivery-and-server-decisions.md) written; V1 spec and plan, dedicated-server spec and plan, isolation spec, architecture, ADR-001/002 and the development guides corrected or annotated. **Open:** `docs/development/handoff.md` and `docs/development/gemini-server-handoff.md` still say Coolify (out of scope of this change by instruction); the research notes (`docs/research/`) and ADR-001/002 reference lists keep Coolify as the historical record |
| B2 | PG17 control DB / PG18 cells split missing from the spec | **Closed** | ADR-021, `docs/spec/dedicated-server.md` section 5, `docs/architecture.md` |
| B3 | Console reachable only over WireGuard not in the spec | **Closed** | ADR-021, dedicated-server spec topology and diagrams (verified against `p10-install-edge-caddy.sh` and ledger entry 016) |
| B4 | Custom domains (ADR-020) absent from the feature table | **Closed** | F47 in `docs/spec/v1.md`, plan E05 rows and requirement range updated (test IDs: T13 files `project-domains-http.test.ts`, `domain-caddy-routes.test.ts`; no new T-number was invented). Live DNS/TLS qualification remains open |
| B5 | API version quoted as 1.15.0 | **Closed** | Current version is `1.19.0` (`docs/contracts/control-openapi.json` already carried it; `packages/contracts/src/http-endpoints.ts`). V1 spec, plan and ledger snapshot lines corrected; the `1.15.0` mentions that describe the E08 checkpoint (ADR-019, usage-observability guide, E08 rows) are intentionally kept as history. The contract file itself needed no change |
| B6 | Jenkins "develop" in plan E05.S06, DS15, ledger entry 012 and the handoff | **Closed** except the handoff | Plan E05.S06, DS15, installation plan P07 and entry 012 now describe `main` only plus the manual candidate job; entry 026 added. **Open:** the handoff files (out of scope) |
| B7 | AX41 and its capacity numbers (machine is an EX44) | **Closed** in spec, plan, ADRs, architecture, development guides and the ledger | The ledger now reconciles the 300/360/420/480 GiB figures. **Open:** `docs/research/*` and the reference lists of ADR-001/002 keep the AX41 sizing research as historical text; the handoff files; `tests/STRATEGY.md` still quotes F01-F46 |
| B8 | I10a (work-VM sandbox) missing from the plan | **Closed** | Plan requirement range and the I10/I10a traceability row (the isolation spec and ADR-017 already carried I10a) |
| B9 | Ledger has no entries for PRs #13-#18 | **Closed** | Entry 018 (#13-#20), entry 025 (#21-#29), new entry 026 (#30-#34, Release 2 #32). PRs #1-#12 are covered by entries 015-017 without per-PR numbers |
| B10 | Inconsistent DS numbering and storage commitments | **Closed** | Ledger entries 010, 011, 014, 017 and 019 renumbered to the DS definitions of the spec; a reconciliation note explains the 300 / 360 / 420 / 480 GiB figures. The disk/RAM over-commit itself is a capacity decision and stays open (section C) |
| B11 | Stale OpenBao custody claim in ledger entry 016 (init material still on the VM) | **Closed** | Entries 015, 016 and 012 corrected from the owner's confirmation that the VM copy was deleted and only the desktop holds parts. **Not verified here:** deletion on the VM, root-token revocation evidence and an unseal rehearsal (section C and D item 8) |

Code-side spec/plan gaps, status after the restore-activation change (owner API `1.22.0`):

| # | Gap | Status | Reason / what remains |
|---|---|---|---|
| G1 | Restore activation: a restored backup becomes active data only after an explicit owner-confirmed step (E03.S03, D08, DS10) | **Partially closed (control plane)** | Implemented and tested: fresh-passkey, exact-binding, acknowledged step that fences the source (hold, epoch, grants), requires an independent provider promotion proof and only then designates the restore active; fails closed and resumes. **Open:** no real provider implements promotion (`PROMOTION_UNAVAILABLE` on the shipped pgBackRest stack), so it is only exercised with a fixture; jobs/backend/domain definitions stay on the fenced source; the restored database is not yet adopted as a managed allocation; files/auth/config snapshots and app-level business-effect coverage do not exist (owner acknowledges them) |
| G2 | Lifecycle composed all-service stop/resume and resource release (E03.S01) | **Open** | Needs each service's provider (database suspend, cell stop, preview teardown) driven through approved Foundation plans on a deployed stack; not implementable or testable without those providers |
| G3 | F18 realtime events (SSE/WebSocket with cursor/refetch, revocation) | **Open (minor)** | SSE with signed cursors, `refetch`/`revoked` frames, bounded buffers and an SDK reader are implemented and tested (E04.S03). No WebSocket transport and no console consumer of application events; not changed here |
| G4 | E07.S03 task grants, admission, disposable execution, tool allowlists | **Open** | Grants/reservations/allowlists exist locally; deployed I10/I11 containment, the general Hermes shell interface and the work-VM egress rule need the server and owner acceptance |

## C. Dedicated server vs spec/plan

Done: P00, P03 (host), P05 lab isolation, P06c vzdump restores, P07 edge/DNS-01/owner passkey.

Partial or never exercised on the real server: ZFS member boot/resilver/Rescue (both NVMe worn), WireGuard laptop/mobile peers, per-cell PG18 (disposable cells only), B2 cell restore drill (daily cap), control-stanza retention policy and WAL RPO, Jenkins nightly/source/missed/cancel, a green platform build on current `main` (first run pending), OpenBao custody evidence (root-token revocation and init-file removal not recorded), games VM (test world only, unpinned image), Hermes (no model calls).

Not done: Proxmox TOTP and scoped API tokens, work-VM egress allowlist, in-guest firewalls, host-level off-host copy (needs dedicated B2 key + restic passphrase escrow), cell file/auth snapshots (`scsi1` has `backup=0`), producer fencing, GitHub App and webhook receiver tests, registry/Trivy/app-build-agent execution, per-cell Redis/Inngest, alert channel and alert-arrival test, IPv6 edge qualification, host-rebuild and upgrade drills, 404 for unknown hosts on the deployed edge.

**Capacity finding:** provisioned VM disks (420 GiB) plus the 60 GiB backup quota is 480 GiB against a 472 GiB pool; RAM commitment is 63,488 of 64,076 MiB. This breaks the 80 % commitment rule and blocks a dedicated coding VM. A resize or a recorded exception is needed before any freeze.

## D. Freeze checklist before any 72 h soak

1. Capacity and ZFS layout decided (any rebuild finished first).
2. Off-host host copy connected, restic passphrase escrowed.
3. B2 cell restore passed, cells A/B torn down, per-scope B2 keys.
4. Cell backup timers on, CPU/RAM ceilings applied, real prod/dev projects and reference game deployed with pinned images.
5. Edge 404 deployed; AAAA published and qualified or declared out of scope.
6. In-guest firewalls and work-VM egress allowlist in place; host reboot with the guard proven.
7. All WireGuard peers drilled, emergency key offline, TOTP enabled.
8. OpenBao custody recorded, root token revoked, unseal rehearsal.
9. Alert channel live with one proven alert; observer extended (IPv6, console, backup age, Bao sealed).
10. Jenkins runs proven; configuration hash recorded; any later change restarts the clock.
