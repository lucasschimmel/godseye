# Bun and local service-authority continuation

Date: 2026-11-11. User authorization: migrate pnpm to Bun and continue E02.S02 locally. No dedicated-server access, remote provisioning or general runtime enablement. Sequential stories; mandatory satellite reviews/tests/docs/git only. Node24 remains the separately qualified application/test runtime; Bun1.4.4 is the package manager/script entry point.

## Scope and boundaries

E02.S02 integrates the specified owner-operated OpenBao broker. Reuse owner sessions/freshness, immutable FoundationEngine scopes, execution leases/fences/epochs, audit journal, ordered migrations, strict response schemas and private runtime paths. No alternate general-purpose vault, root-token dashboard, browser secret reveal, arbitrary OpenBao path input, root-token default, dev-mode production substitute or local plaintext material database.

The console manages metadata: scoped service identities, secret slots/references, rotation/revocation status and provider health. Secret values enter via an explicit trusted local CLI stdin/private handoff, never process arguments or general owner HTTP. Values must never enter control DB, audit, idempotency fingerprints, error bodies, logs, browser DTOs, build contexts or general agent environments. High-entropy authentication proofs may be stored as one-way digests; low-entropy material must not be committed as an unkeyed digest.

A service identity binds exactly one existing project, one environment belonging to that project, and a purpose: runtime, migration, deploy or backup. Existing project-wide Actor.projectIds is insufficient. Browser/caller scope fields do not authorize lookup. Verification derives the principal from a random proof or qualified provider authentication and rechecks active identity/revision. No service proof authenticates owner/admin routes. Unknown, revoked, expired and cross-cell identities fail closed.

Private material consumption is a trusted broker API/callback/handoff, not a general HTTP reveal endpoint. The provider path is compiled from registered UUID scope, identity/purpose and slot identifiers, never arbitrary input. OpenBao uses deny-by-default per-cell/purpose policies. Controller provider access is separately scoped and must not silently accept a root/default omnipotent configuration. Default unconfigured state remains explicit and unavailable. A sealed/unavailable provider blocks new imports/issuance/rotation/reads; it does not delete already mounted static application material.

Short task access is bounded by the actual recorded FoundationEngine execution context and grant: project/environment, worker, command, tool/destination, epoch/fence, live lease, cancellation and expiry. Verify on each redemption, and after provider I/O before private delivery. Possession of an ID or caller-provided Actor is not authority. Do not expose worker claim/finish/epoch APIs or provider tokens to the browser/agent. Static runtime access and short migration/task authority are distinct.

## Rotation and failure model

Persist an intention before external mutation, stable operation identity and pending/unknown state. Idempotent replay cannot create extra versions or auth proofs; mismatched parameters conflict. Reconcile ambiguous writes using registered provider version/operation evidence before retry. KV uses CAS, bounded responses, redirect refusal, deadlines and sanitized failures.

Static rotation stages replacement material, then a qualified trusted consumer adapter must attest its real connection transition and revocation of old upstream access. A KV write alone cannot certify D05. Missing adapters report unavailable; owner checkboxes and arbitrary proof strings cannot mark a live target transition complete. Failed readiness keeps the previous active material. Unknown post-dispatch transitions hold uncertainty visibly and reconcile; never blindly resubmit or silently activate. Real PostgreSQL service transition qualification remains E03/provider work unless actually exercised.

## Local OpenBao evidence

Official GitHub latest release queried: OpenBao2.7.2 has a native windows_amd64 archive. Download to ignored tooling with published checksum verification. Tests use a disposable loopback non-dev server and private temporary single-node Raft storage. Initialize and unseal only via in-memory fixture HTTP, never print/store root material in reports. Rehearse sealed denial, unseal, cold restart and persistent material recovery. Verify actual compiled per-cell policy denials, CAS and revocation against OpenBao. Fixture assumptions and local-only HTTP qualification are explicit; no off-host recovery, TLS/private networking, production hardware or real database transition claim.

## Stories and acceptance

| Criterion | Observable behavior | Tests |
| --- | --- | --- |
| AC-13 | Bun replaces pnpm in active workspace, scripts, hooks and CI; frozen install reproduces pins/security override and original runtime/build/browser behavior. | T-AC-13; migration commands and baseline suites |
| AC-14 | Owner-only metadata management rejects caller authority, wrong project/environment ancestry, stale freshness/revisions and conflicting replay; no values appear in DTOs or audit. | T-AC-14; broker HTTP/core and browser |
| AC-15 | Verified service identities are exact-cell/purpose scoped, revocable and cannot administer owner APIs; private lookup derives provider scope from the identity. | T-AC-15; broker authority |
| AC-16 | Short task access checks real worker/lease/grant/epoch/fence/cancellation before and after provider I/O; expired/cancelled/forged/cross-cell grants cannot deliver values. | T-AC-16; actual FoundationEngine integration |
| AC-17 | Static rotation preserves the old connection on failed pre-transition readiness; unsupported or uncertain operations cannot claim activation. Lost revocation receipts preserve uncertainty without assuming the old access still works, and replay reconciles. | T-AC-17; rotation faults/restart |
| AC-18 | Real OpenBao per-cell ACL/CAS/revocation and non-dev seal/unseal/cold recovery pass with disposable fixture data; unavailable state preserves existing static consumer material. | T-AC-18; pinned native lab |

Story1: Bun migration + original153unit/14browser/build/smoke regression. Story2: broker contracts/schema/provider/core and private ingestion/runtime wiring, then HTTP/client/UI. Tests authored by GAUNTLET against actual behavior; fresh security/FABER review before completion. SCRIBE updates active docs and preserves previous run history. Gitsmith owns all git and final local commit. No parallel epic implementation.
