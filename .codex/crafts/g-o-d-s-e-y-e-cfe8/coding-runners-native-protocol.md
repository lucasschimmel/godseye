# Native coding runtime protocol, revision 2

Private server IPC, implemented 2026-11-14. No browser caller can select host paths, QEMU/systemd arguments, endpoints, credentials or fixture mode. Exact sources: coding-runners-native-source-freeze.json.

## Entrypoint and authorization

`python3 -I scripts/coding_guest_control.py <canonicalLinuxWorkspace> <action>` reads one JSON line, at most 262144 bytes. Production actions:

- `readiness`: private bindings/pool to availability, reason and versions. Checks small executable manifests and successful actual CLI proof, stable host software/policy, and fresh KVM API/create-VM access without bulk-reading assets. Every launch still hashes all CLI assets and the complete VMM filesystem before untrusted code.
- `source`: request preparation and private binding to independently verified repositoryHash, commitSha, archiveHash and bounded staging metadata.
- `preflight`: preparation/binding to strict CodingQualification; no task guest, model call or source execution. Actual dispatch independently rehashes all runtime/image bytes.
- `run`: frozen CodingProviderRequest and private binding to a final native lifecycle envelope. Keep stdin open for authorization replies.
- `inspect` / `stop`: exact retained request to observed lifecycle. Inspect never allocates/restarts/renews/replays. Stop revokes only the exact task and stops its derived unit after invocation/boot validation.

Controller frames `{kind:"authorize",correlationId,sequence}` require the real provider to await `context.assertActive()` and reply exactly `{kind:"authorized",correlationId,sequence}` within five seconds. Increasing sequence, single use, maximum 64. EOF, timeout, revocation or changed identity denies. Barriers occur before launch, before preparation release, after actual jail/hash/cgroup inspection immediately before QEMU dispatch, at broker predebit/pre-POST and before forwarding a response. A guest cannot authorize itself. The privileged launch subprocess has DEVNULL stdin: nested WSL/systemd and QEMU console input never receive or consume the separate controller authorization pipe.

Production configuration has no fixture mode. Explicit owner qualification uses coding_guest_qualify.py/controller lab. Composition tests replace only upstream HTTPS through a trusted test launcher; production run and policy stay unchanged.

## Source and image

coding_guest_source.snapshot uses anchored openat/nofollow descriptors over independent Git objects. It rejects hardlinks, alternates, linked metadata, submodules and unavailable packed-only closure. Commit/tree/blob type, declared length and SHA1 are verified under byte/file/depth bounds. Only the requested commit/tree/blob closure is staged with fixed trusted HEAD/config and refs/heads/assigned; no owner hooks/config/filters are copied.

Trusted guest Git plumbing reads exact tree/blob bytes. Forced add and trusted attribute overrides preserve tracked ignored files and export/encoding attributes cannot rewrite selected bytes. It removes original storage, creates independent task Git metadata and a real private worktree, then verifies seed/worktree filesystem equality. No host Git command or repository code executes.

Pinned asset bytes and complete ELF closure form a hash-verified compressed base plus exact source/task/trusted-worker overlay. Top-level native imageHash is the actual loaded initramfs SHA256. Qualification guestImageHash identifies the template/input recipe, independently of task-specific source/prompt bytes. Completion checks exact runtime source hashes again.

## Physical profile

Local target: x86_64 Ubuntu WSL2, observed host kernel 6.6.87.2-microsoft-standard-WSL2; guest 7.0.0-30-generic; QEMU10.2.1+ds-1ubuntu3.3, KVM-only q35. No TCG/container/host-shell fallback, guest NIC/disk, shared host filesystem or administration identity. Guest loopback alone serves the serial-backed model proxy.

| Bound | Enforced value |
| --- | --- |
| Guest RAM / RAM-backed workspace upper bound | 4096 MiB |
| Outer VMM memory | 5120 MiB |
| CPU | 1000 millicores; observed cpu.max 100000/100000 |
| Outer VMM processes/threads | TasksMax64 |
| Guest CLI / separate verification processes | each pids.max64, strict setup/readback |
| Shared-memory tmpfs | 64 MiB |
| Service lifetime | 180s; controller deadline at most175s |
| Source content/objects | 64 MiB,10000 entries, bounded loose closure |

Only canonical systemd-run/setpriv execute privileged. Host uid/gid drops to1000 plus observed numeric KVM group before any workspace Python/QEMU. Fresh user/mount/network/PID namespaces, complete runtime hashes and read-only VMM chroot precede guest execution. Observed cgroups and KillMode=control-group constrain QEMU overhead. Guest CLI/test uid/gid1000 cannot rewrite root-owned assets, trusted worker, raw serial or process limits.

Software capability identity binds stable kernel/architecture/machine hash/KVM device/cgroup policy plus fresh access checks. Idle WSL reboot does not invalidate unchanged software qualification. Every allocation remains strictly bound to its own boot ID, task, derived unit, InvocationID, image and cgroup. Old uncertain allocation identity never becomes positive stop proof.

## Model channel and accounting

Guest loopback HTTP proxies through ttyS1 to an exact task-private native Unix socket. One frame at most1MiB: `{id,method,path,headers:{},body:base64RequestBytes}`. Controller decodes body for broker.handle and returns `{id,status,headers:{"content-type":...},bodyBase64}`. Maximum16 requests. Fixed official endpoint and reviewed model, no guest endpoint/header authority; upstream key stays in host memory.

Finite request/output/time/spend policy and durable conservative debit precede each POST. Durable normalized fingerprints and pending-uncertainty guards deny retries/replays across failures/restarts. Unknown usage is never free/refunded. No paid entitlement probe occurs. Existing desktop/subscription homes are not copied. Codex uses fixed reasoning effort none; the broker validates and drops only known bounded client metadata and the encrypted-content request hint, while actual encrypted continuation inputs remain denied. Tool namespace members are bounded local function/custom tools; external schema references and server tools remain denied. The exact Claude clear-thinking/keep-all no-op is validated then omitted upstream.

## Result, tests and cleanup

Trusted worker emits one GODSEYE_RESULT base64 JSON: kind,runner,commitSha,cli(code/stdout/stderr),patch,patchSha256,treeHash,test(code/stdout/stderr) or null,worktree. Provider validates actual pinned vendor JSONL, source/task/worktree identity, byte bounds and physical stop evidence before producing CodingResult.

CLI descendants are killed and their cgroup verified empty before independent testing. Tests run and quiesce in a separate bounded cgroup. Exact root-private filesystem hashes before/after must match. New root-owned export Git metadata uses immutable baseline/final copies, forced add and trusted attributes; untrusted index/config is not export authority. Git generates paths natively; no header/hunk rewriting. CLI summary, actual test status and patch are distinct observations.

Missing output after exact owned stop plus revoked grants is terminal failed with conservative accounting. Active/unproven stop, changed invocation or mismatched allocation boot remains unknown/quarantined. Explicit cancellation is terminal only with physical stop proof. Initial no-incident quarantine becomes retained only after stopped/revoked proof plus valid launch/image identity; reason-bearing integrity quarantine and released evidence remain unchanged. Inspect computes this disposition without writing state. Intent/state use atomic file replacement, file fsync and parent-directory fsync. Unit names derive from UUIDs, not arbitrary stored strings.

The guest worktree/home exists only during allocation. Retained means frozen source image, patch, logs and lifecycle evidence; no running/reattachable VM, modified persistent disk or CLI resume home is promised. Original source refs/index/files never change. Preview/publication remain separate delivery capabilities.
