# Coding runner runtime research

Date: 2026-11-14. Read-only reconnaissance; no credentials, private bindings, login state, model calls, installation, Git mutation or system configuration changes.

## Local evidence

- Windows Codex exists: `codex-cli 0.167.0-alpha.4.1`; Claude exists: `2.1.215 (Claude Code)`. Both `--help` outputs inspected without login/model calls.
- WSL Ubuntu: kernel `6.6.87.2-microsoft-standard-WSL2`; `kvm_intel` and `kvm` loaded; CPU exposes `vmx`; `/dev/kvm` is `root:kvm`, mode `0660`.
- WSL account: uid/gid 1000, supplementary groups do not include kvm. Python `os.access` confirms no KVM read/write access. `sudo -n true` requires interactive authentication.
- WSL PATH has no `qemu-system-x86_64`, `cloud-localds`, `virsh`, native Linux Claude. Its `codex` resolves into Windows App installation on `/mnt/c`; this does not establish a usable Linux guest binary. `/boot` is empty. `gcc`, `setpriv`, `curl`, `gpg`, `ar`, `tar` exist; busybox absent.
- KVM API/create-VM and guest boot have not been exercised. Device presence alone is not qualification. No automatic TCG fallback is acceptable.

## Existing seams

`AgentProvider` already separates pure `supports`, guarded `submit`, read-only `inspect`, exact-task `stop`; terminal observations require `stopped`. Preserve these semantics. `AgentProviderContext.assertActive()` is awaited before physical dispatch. Provider events currently admit text delta only, so command/file/usage events require a separate normalized coding event contract.

`InfrastructureProvider` represents runsc application cells, not KVM task guests. Do not label it a coding host adapter. `DeliveryProvider` has observed, expiring qualification plus exact scope/epoch/generation and guard patterns worth reusing. `scripts/hermes_tools_runtime.py` proves unit/cgroup/process ownership only for fixed trusted scratch helpers, not arbitrary shell execution. I10 still requires disposable KVM guests.

## Headless protocols

### Codex

Use an argv array for `codex exec --json --sandbox workspace-write --ignore-user-config --ignore-rules --output-schema <trusted-schema> -C <guest-repository> -`; stdin carries the task. JSONL provides thread/turn lifecycle and item events; retain `thread.started.thread_id`. Bind continuation to exact task/session ID, never `--last`; `codex exec resume <ID>` is the documented continuation. The final schema is separate from stream event validation. Default read-only is insufficient for editing. `--full-auto` is removed. Confirm resume flags against pinned Linux binary help before implementation. [Official non-interactive documentation](https://learn.chatgpt.com/docs/non-interactive-mode)

Saved CLI auth is reused; API-key or device-code login are documented options. Auth caches are sensitive and must not be shared into repository-controlled execution. API-key automation should use a private model proxy; do not inject upstream keys into a guest that runs hostile code. Existing owner subscription login cannot be assumed transferable to a scoped broker. Authentication qualification is separate from guest qualification. [Official authentication documentation](https://learn.chatgpt.com/docs/auth)

### Claude Code

`claude -p <task> --output-format stream-json --verbose --include-partial-messages` emits NDJSON; final `result` carries terminal metadata. Structured output uses `--json-schema`, with `structured_output` presence checked. Continue using exact `--resume <session-id>`, retained by project/environment/task, never directory-wide `--continue`. Nonzero process exit and missing/failed result must fail; no final message after disconnect means unknown. [Official headless documentation](https://code.claude.com/docs/en/headless)

Pin help-supported flags: installed 2.1.215 supports `--bare`, `--safe-mode`, explicit `--tools`, `--allowedTools`, `--setting-sources`, `--strict-mcp-config`, `--session-id`, `--permission-mode dontAsk`; current docs describe newer flags such as `--permission-prompts none` which installed help does not expose. `--bare` skips subscription OAuth, requiring API-key/helper or provider auth. Safe mode preserves auth while disabling customizations, but its exact behavior needs isolated fixture qualification. Neither policy is a hypervisor boundary. [CLI reference](https://code.claude.com/docs/en/cli-reference)

`CLAUDE_CONFIG_DIR` isolates per-account settings and history; it does not itself constrain host file access. Subscription login and Console/API/cloud-provider modes differ. No auth cache was inspected. [Authentication](https://code.claude.com/docs/en/authentication)

## Concrete local KVM option without permanent host changes

Feasible candidate, not yet proven: project-local pinned Linux QEMU, verified distro kernel/initramfs and guest toolchain; direct host adapter creates one ephemeral allocation. WSL root entrypoint invokes existing `setpriv --reuid=1000 --regid=1000 --groups=<observed-kvm-gid> --no-new-privs` before starting the fixed QEMU binary. This grants only transient supplementary KVM membership; no `/etc/group`, sudoers, device mode, global install or service change is intrinsically required. Root WSL entrypoint availability and resulting effective IDs must be probed first. Numeric kvm gid must come from the actual device/group, never a guessed constant.

QEMU must execute as an unprivileged identity inside a task mount/user/network namespace with only trusted runtime assets, its private disk and KVM device. Launch through a fixed reviewed helper: never accept caller QEMU arguments, host paths, shared mounts, QMP commands, raw network destinations or root shell commands. Hash-check assets and reject symlink/path changes. Do not start arbitrary user-writable executables as root. The alternative QEMU `-run-with user=uid:gid,chroot=...` drops privileges immediately before guest execution but initializes QEMU as root; transient supplementary-group launch is preferable. [QEMU invocation](https://www.qemu.org/docs/master/system/invocation.html)

Start qualification with a networkless minimal guest and bounded serial control/artifact channel, fixed `-accel kvm` and supported `microvm` or `q35`, no 9p/virtiofs/mounts, no host devices other than KVM in the VMM namespace, no guest administrative network. Verify actual KVM acceleration, separate guest kernel, host-marker unreadability, cgroup CPU/memory/pids bounds, hard disk/artifact bounds, deadline/lease revocation, restart uncertainty and complete VM teardown. QEMU's security policy requires hardware acceleration and supported machines; TCG explicitly has no isolation guarantee. Host cgroups must constrain VMM overhead as well as configured guest RAM. [QEMU security](https://www.qemu.org/docs/master/system/security.html)

The KVM VM lifetime follows the last VM fd, so teardown evidence must account for all descendants and retained descriptors, not simply an exited launcher PID. Prefer QEMU opening KVM itself after transient group drop over handoff tricks for VM/vCPU fds. [Kernel KVM API](https://docs.kernel.org/virt/kvm/api.html)

## Recommended implementation contract

1. One `DisposableCodingGuestProvider` owns allocate/inspect/stop/export, trusted source snapshot digest, pinned runtime digest, resource limits, task scope, manifest hash, invocation identity, epoch and expiring observed qualification.
2. Controller copies an authorized repository snapshot into task-private guest disk; no linked host `.git` worktree paths or original repository mounts. Guest Git metadata is private. Export a bounded validated diff/archive tied to base commit; applying it is a distinct owner-controlled action.
3. CLI adapters normalize streams and exact resume IDs; model broker outside guest owns upstream authentication and spend policy. Guest receives a revocable run-scoped gateway capability only. Initially offline fixtures demonstrate CLI launch/parser/control behavior; no claim of model execution without a real qualified authorized model exchange.
4. Per-provider `readiness` reports CLI missing/incompatible, guest unavailable/unqualified, broker unavailable, repository unavailable. Browser/owner configuration cannot set `qualified=true`. Do not silently fall back to host, WSL native shell, gVisor, Docker or TCG.
5. Implement actual networkless KVM shell/patch qualification first. Both headless runners depend on that boundary; do not duplicate separate guest stacks for SDK wrappers. Networked broker transport can use a narrowly framed serial/vsock channel to host broker without granting guest general IP access. Performance/protocol compatibility remains a follow-up qualification item.

No system mutation appears intrinsically necessary if reversible WSL root-to-unprivileged transient group launch is permitted. Actual guest qualification still needs downloaded pinned artifacts and implementation work. Owner permission is needed only for a concrete privileged launch if existing session authorization does not already cover it, or if the selected mechanism ultimately requires system/device configuration changes.
