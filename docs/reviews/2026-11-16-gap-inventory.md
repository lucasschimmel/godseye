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
| A11 | Incidents/notifications: no channel configuration, no real delivery | important | C + O |
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

Stale or contradictory documentation:
- Coolify still named in the V1 plan/spec, isolation spec, dedicated-server spec, ADR-002 and both handoff files (decision: Docker + runsc direct delivery).
- PG17 control DB / PG18 project cells split is not in the spec; custom domains (ADR-020) absent from the feature table; API version quoted as 1.15.0 (code 1.16.0).
- Jenkins "develop" in the handoff, plan E05.S06 and ledger entry 012 (now `main` + candidate job).
- AX41 and its capacity numbers (machine is an EX44); I10a (work-VM sandbox) missing from the plan; ledger has no entries for PRs #13–#18 and inconsistent DS numbering and storage commitments.

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
