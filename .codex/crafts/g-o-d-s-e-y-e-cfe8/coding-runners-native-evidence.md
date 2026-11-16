# Local coding runtime evidence

Date: 2026-11-14. Native Windows owner process, Ubuntu WSL2, nested KVM.

## Implemented boundary

- Signed Ubuntu workspace-local QEMU 10.2.1+ds-1ubuntu3.3, guest Linux 7.0.0-30, static BusyBox 1.37; complete host VMM libraries/firmware recursively hashed. No global install, group/device permission change or persistent service configuration.
- Canonical transient systemd service drops host uid/gid to 1000 plus observed KVM group 991 before executing any workspace code. Fresh user/mount/network/PID namespaces, read-only VMM chroot, fixed KVM-only q35, exact scoped serial broker socket. No guest NIC, host filesystem sharing or guest disks. Guest loopback is explicitly enabled only for the serial-backed local model proxy.
- Current measured profile: 4096 MiB guest RAM, 5120 MiB outer VMM memory ceiling, 1000 CPU millicores, outer TasksMax 64. Separate guest CLI and verification cgroups each enforce pids.max=64. CLI executes as guest uid/gid 1000; trusted worker, binary assets and raw serial devices remain root-owned.
- Actual controls and all VMM bytes are inspected before a final physical-ready authorization handshake. Every real model POST independently awaits the Foundation callback and a durable conservative debit. No upstream key or desktop/subscription home enters the guest.
- Private source registration accepts independent bounded loose Git objects, verifies requested commit/tree/blob SHA1/type/size closure, and stages only that closure. Packed-only source, alternates, hardlinks and unsupported submodules fail closed. Host Git hooks, config, filters and source code never execute.
- Trusted guest materialization reads exact tree/blob bytes, rejects metadata paths, builds an independent Git repository and actual private worktree, and verifies source/worktree filesystem equality. Original object storage is deleted before untrusted execution. Forced add and trusted attribute overrides preserve tracked ignored files and exact bytes.
- CLI descendants are killed and their cgroup verified empty before independent tests. Test descendants are killed separately. Root-private filesystem hashes before/after tests must match. Final patch uses new root-owned Git metadata over immutable baseline/final copies, so mutable task index/config and filename rewriting cannot alter export authority.
- Exact task/unit/InvocationID/boot/cgroup identity protects inspect/stop. Known stopped and revoked failures are terminal failed; uncertain physical stop remains unknown/quarantined. Inspect does not allocate or replay. Runtime source changes invalidate qualification.

## Actual normal CLI chains

| Property | Codex | Claude Code |
|---|---|---|
| Pinned version | 0.167.0-alpha.4.1 | 2.1.215 |
| Task | c522a63b-dabc-4583-b879-3d0e31ab6c8f | 23752f08-3302-42b7-9e9b-8952094fe803 |
| CLI / independent Node test exit | 0 / 0 | 0 / 0 |
| Local fake model requests | 3 Responses | 4 Messages/count |
| Actual edit | answer.cjs exports 1 → 42 | answer.cjs exports 1 → 42 |
| Final state | succeeded; stopped; grants revoked | succeeded; stopped; grants revoked |

Both exercised real vendor Linux binaries, real shell execution and actual Git worktrees inside the disposable KVM guest. Codex retained workspace-write and the integrity-matched bundled bubblewrap. The fake upstream required actual tool-result/test output before final completion. No paid vendor request or account entitlement check occurred. CLI-reported fixture cost is synthetic metadata.

Both normal receipts have the same runtime/source recipe freeze:

- Runtime filesystem hash: `7cb8a5e8d2ef7a546b9607190e66f4c3a630ba6d7884696113ca766111987316`
- Guest template/input recipe hash: `3d0aeaed78ff0f06abb60f90ad67de1470b1be221ddfd2cbaab4c4b4d67442f0`
- Codex actual loaded image hash: `497344c49a9d0ff8ac9a4776e697f4efa30cd70ae92c6ea7ecf2c8008247a4e6`
- Claude actual loaded image hash: `7db898af5810735259abe3f52412fabe1789b8aaf8b55558bbeb5c3b402de8af`
- Final tree hash: `232b95a1e5961bd59227d541ea5c9702ff76df2e3e5959d98c151bcfb8b6f293`
- Patch SHA256: `fda907638ab4e5184ba5f3fd0ce1fc72e3ef067c55139380602da18409a02212`

Actual receipts: `artifacts/tools/coding-kvm/10.2.1/codex-qualification.json` and `claude-code-qualification.json`. They retain all runtime source hashes, actual image, exact invocation, CLI stream, trusted test and patch bytes. Historical failed attempts are retained separately; they do not qualify later code.

## Independent evidence and remaining gates

- GAUNTLET actual KVM pids-setup failure: rejected before any CLI/model request, exact stop/revocation proven (37.073 seconds).
- GAUNTLET actual Claude mutable-index regression: untrusted Git diff really hid the edit, while independent trusted export still included 42 and actual test passed (115.427 seconds).
- GAUNTLET actual test mutation and background-descendant regressions passed in 35.354 and 35.243 seconds respectively. Test mutation rejected output; late descendants were quiesced before trusted verification.
- GAUNTLET actual registered-source attribute/path regression passed in 35.205 seconds after discovering and fixing a missing bare-repository refs directory. It verifies nine selected files including tracked ignored content, export attributes, raw UTF-8 under a declared UTF-16 attribute, and nested path/payload preservation.
- Stable software capability binds host kernel/architecture/machine identity/KVM device/cgroup policy, with fresh KVM access checks. Allocation inspect/stop still strictly binds boot and InvocationID. Independent readiness/launch checks passed 13/13; source checks passed 10/10. Server readiness reads small manifests/proofs rather than bulk-reading binaries under the ten-second adapter deadline; ALL CLI assets still verify before runner selection and every native byte verifies in the jail before code. Both normal chains were freshly qualified with identical current source hashes.
- Final actual Foundation → real provider → native RUN → real broker → KVM composition passed all three cases with only external HTTPS replaced by the synthetic vendor fixture. Claude happy: task `8d69cb05-36ae-45d8-85d2-40f88c7972c0`,38.397s,13 authorizations,3 successful synthetic POSTs. Codex happy: task `c750bb9b-686a-43ac-a5c5-a75f02fed3e7`,46.656s,12 authorizations,3 successful synthetic POSTs. Both returned actual independent passing Node checks and patch evidence, exact stop and released Foundation reservation. Epoch Claude: task `130edbf6-f502-4a99-a9c2-a70a1f248475`,38.892s,10 authorizations; revocation occurred after two successful synthetic POSTs including an actual successful tool result. Reconciliation reached cancelled/stopped, no result or patch published, and the stale tick could not resume execution. JUnit reports3/3,0 skips,123.9464835s test time; command wall time126.52s. Artifact: `artifacts/test-results/coding-runners-composition-native.xml`.
- Dedicated remote hosts, Proxmox, game coexistence, general source fetch/packed import, paid billing/entitlement and preview hosting are outside these measurements. Private production API binding remains explicit; default unconfigured availability fails closed.

At the final runtime handoff check, no `godseye-coding-*` transient unit and no task broker socket directory remained. The original repositories were never mutated. Exact current runtime source hashes match both latest normal receipts (`sourceMatchesBothNormalReceipts=true`) in `coding-runners-native-source-freeze.json`; adapter source changes are covered by the final three passing genuine composition cases.

The retained worktree disposition records the frozen source image and bounded patch/test evidence. The actual modified worktree and CLI home were RAM-backed and died with the guest; persistent CLI resume is not implemented or implied.


Historical composition failures exposed strict seams (executable lookup, readiness timeout, authorization stdin, metadata/tool normalization and retained-workspace cleanup). They remain diagnostic history; the final three-case passing JUnit above supersedes their pending status. No paid call occurred.




Final handoff: broker `353857c225cadb1c1dbd2d634e5ce08b765d4f90c092f349a52a36043d82e5f9`, helper `f451cdc1ca764fc9237b7308397df8771ac12ee236d67af4d56ed04c2f03b7f6`, both current normal receipts and all thirteen matching runtime sources, plus final genuine composition3/3. After completion, read-only checks found all three task states stopped/revoked/retained, no coding transient units, no controller processes, and no exact task socket directories. The epoch socket directory briefly remained during teardown and disappeared naturally before follow-up; no manual cleanup or broad sweep occurred. Hashing completed before handing root the quiet window; its original15-second built smoke then passed. No further VM/test activity is required.
