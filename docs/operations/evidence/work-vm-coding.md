# Work-VM coding runner: evidence (2026-11-15)

Scope: `godseye-work` (VM 300, `10.20.3.10`, Debian 13, kernel 6.12 cloud, no nested KVM), profile
`disposable-vm-container` (owner-accepted weaker boundary: disposable VM plus per-task gVisor systrap).
No model call, no vendor network egress and no real API key were used; the model was the scripted fixture.
The runner is **still `available: false`**. This file is not the main ledger.

## Provenance (task 1)

| Item | Value |
| --- | --- |
| runsc | `release-20261109.0`, the apt package `runsc 20261109.0` already running on godseye-pro (the older `release-20261102.0` tarball pinned for Hermes tools was not used) |
| runsc `.deb` sha256 | `44a1c843b12e47956fe3e5d9d1684ad83550b050c578a63e950197ffaef1619b` (equals the SHA256 in the gVisor apt index and the pro VM's retained package) |
| runsc binary sha256 | `c58f1dc2a3855487bf3bedc2edf074123ad433f1d98fb7f451f56790e87b5c9f` (identical on pro and work; pinned as `PINNED_RUNSC_SHA256`) |
| gVisor signing key | `6F1DF85E3A71C24918E727D56FC6D554E32BD943` (downloaded key equals the pro keyring) |
| Debian snapshot | `20261114T000000Z` (`debian` and `debian-security`); `systemd 257.13-1~deb13u1`, `python3 3.13.5-1`, `git 1:2.47.3-0+deb13u1`, `ca-certificates 20250419+deb13u1` verified present in that snapshot and already installed |
| Service user | `godseye` uid 994 (uid 1000 is `jenkins-agent`; gid auto-assigned because 994 is `sgx`), lingering, delegated `cpu memory pids` |
| Pinned CLIs | `codex-cli 0.167.0-alpha.4.1`, `claude 2.1.215`, fetched from npm with the sha512 integrity already pinned in `coding_cli_install.py` (`--version` only run) |
| Host tools in the sandbox | Debian `/usr` read-only: node 24.22.3, git 2.47.3 |

Jenkins agent, its user, home, sshd settings and system apt sources were not touched. One early gVisor probe
coincided with a global OOM event caused by a running Jenkins browser test; all later runs waited for an idle
agent (the harness polls for `vitest`/`chrome-headless`/`playwright`).

## Sandbox runner (task 2)

New: `coding_sandbox_{policy,service,runner,worker,proxy,adversary,qualify}`, `coding_work_vm_{control,gate,install}`.
Sandbox: `runsc --platform=systrap --network=none --ignore-cgroups` in fresh rootless namespaces, read-only
`/usr`, CLI, worker and source mounts, tmpfs for writable paths, hard unit ceilings (2048 MiB, no swap, 1 CPU,
512 tasks, 180 s) re-verified before start, release only after the controller's final authorization.
Unit tests: `tests/coding-sandbox-policy.test.ts` (policy allowlist, gate, readiness evidence, runner helpers,
verdict logic) and `tests/coding-work-vm.test.ts`.

## Qualification gates, fixture model, final run

Per runner (codex and claude-code), all passed in the final run on the committed sources:

| Gate | codex | claude-code |
| --- | --- | --- |
| cli-chain (real CLI: edit, node test, patch, 2 expected commands, physical stop) | passed | passed |
| adversarial-index / test-mutation / background / attributes | passed | passed |
| adversarial-escape (no host path visible, no write outside tmpfs, no privilege op, uid 1000) | passed | passed |
| adversarial-egress (only `lo`, no route, 9 TCP targets, 4 unix sockets and DNS all unreachable) | passed | passed |
| adversarial-exhaustion: memory (cgroup OOM at about 1.9-2.0 GiB), tasks (spawn refused at the 512-task cap), disk (`ENOSPC` at 128 MiB), deadline kill | passed | passed |
| stop-revocation-cleanup (second process stops a hung task; no unit, cgroup process, runsc process or bundle left) | passed | passed |

Shared gates **not passed**: `vm-egress-allowlist` (the work VM itself still reaches the internet; the strict
allowlist belongs to the Proxmox firewall) and `owner-acceptance` (no owner-signed
`artifacts/work-vm/owner-acceptance.json`). Through the real pinned-host-key SSH gate from the pro VM,
`readiness` reports `available:false` with reason `Work-VM qualification gate not passed: vm-egress-allowlist`.

Defects found and fixed while qualifying: zombie orphans counted as live processes, the nested source path,
fixture attributes being applied when the fixture repository was created, an intermittent empty
`git rev-parse` read in gVisor tmpfs (retried for ref reads only, roughly 1 in 12 sandboxes before the fix;
15 consecutive claude-code `background` runs and the full matrix passed afterwards). The OCI pids limit is not
enforced under `--ignore-cgroups`; the host unit's `TasksMax` is the real task ceiling (about 2 host tasks per
sandbox process).

## Private configuration (task 4)

- Control API SSH identity generated on godseye-pro; the private key exists only in OpenBao
  `godseye/bindings/coding` (field `work_vm_ssh_key`) and, once rendered, on tmpfs
  `/run/godseye-bindings/work-vm-ssh-key` (0600). Nothing is in the repository.
- Document `transport`: host `10.20.3.10`, user `godseye`, pinned ed25519 host key with fingerprint
  `SHA256:A8Ip69FLTNWM79BtMsQIROm9CQKEDfhqu3708hK1z+c`, workspace `/opt/godseye`. Its single binding is an explicit
  placeholder (nil UUIDs, placeholder broker key): the owner must register real identities and key.
- Work VM `authorized_keys` entry is `restrict,from="10.20.1.10",command=<gate>`; verified: production actions
  work, the lab action and a shell are refused (exit 126), a wrong host key is refused.
- `godseye-bindings-render.service` is installed on pro and started once (not enabled): it rendered
  `coding-bindings.json` and the key to tmpfs; the absent Hermes document is skipped. The AppRole used is the
  control API's own (no dedicated read-only renderer role exists; the owner should create one).
- `godseye-control-api` was **not** restarted and has **no** `GODSEYE_CODING_BINDINGS_FILE`: the deployed
  `/opt/godseye` on pro is `feat/server-integration` (160 commits behind develop) and cannot parse the work-VM
  document. Wiring is: deploy develop, add the drop-in env var, restart once.

## Owner inputs still needed

1. Proxmox firewall allowing the work VM only the broker endpoint, then re-run `qualify` (gate `vm-egress-allowlist`).
2. Signed `artifacts/work-vm/owner-acceptance.json` (`{"accepted": true, "boundary": "disposable-vm-container"}`).
3. Real project/environment/repository registration, source directory on the work VM, and the broker API key
   (OpenBao `bindings/coding`, replacing the placeholder).
4. A dedicated read-only OpenBao AppRole for the renderer; deployment of develop to godseye-pro.
