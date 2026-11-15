# Local coding runners

The `/agents` owner console prepares repository tasks for Codex or Claude Code and
retains task/worktree history, patches and independently labeled test evidence.
This is the local E07.S05 continuation under
[ADR-017](../adr/ADR-017-local-coding-runners.md), with control API `1.13.0` and
migration `0021_coding.sql`. E07 and V1 remain partial.

**Qualification checkpoint, 2026-11-14:** both pinned vendor CLIs completed real
edit/shell/test/patch chains inside disposable KVM, with a scripted local model
fixture and physical stop/revocation evidence. Codex preserved `workspace-write`
and its bundled bubblewrap. Three actual Foundation → private provider → native
controller → production broker → KVM composition cases also passed, with only
upstream HTTPS replaced by a trusted fixture. No paid request or account entitlement
was tested. Final unchanged-deadline idle built smoke passed. Default startup has no configured coding provider; E07/V1 remain partial.

## Prepare and admit a task

Configure the project's repository through its existing owner settings. In
**Codex et Claude Code**, select that project, an environment and the runner; enter
the exact 40-character lowercase commit SHA, a bounded request and an optional
`typecheck` or `test` package script. Prepare first, then admit the exact retained
preparation/hash with current owner confirmation. A preparation is immutable and
can exist while execution is unavailable. A requested SHA alone is insufficient:
the private source adapter independently verifies the registered repository/commit
before admission and again before physical dispatch.

Preparations freeze project/environment revisions, complete repository binding,
runner, input and limits. Coding tasks reuse the actual Foundation queue, grants,
epochs, budget reservation and heavy-work admission. Recovery hold, expired scope,
stale source or missing qualification prevents launch. A separately configured
coding resource pool includes VMM overhead and remains occupied while cleanup is
uncertain. There is no second scheduler or permission inherited from a Hermes role.

The console proposes a $0.50 Codex ceiling or a $0.10 Claude Code ceiling. The
proposal follows runner selection only until the owner edits it; a manual ceiling
is preserved. The owner sees and can edit the exact ceiling before preparing and
admitting a fresh task. The shared contract fallback is $0.10. These are
conservative reservation proposals, not a promise of task completion or invoice
cost; the full admitted ceiling may be charged conservatively. They neither
authorize automatic spending nor raise the project budget. Hermes defaults are
unchanged.

Other defaults are 300 seconds, 8,192 UTF-8 input bytes, 131,072 patch
bytes and 32,768 output bytes. Owner limits may select 5–900 seconds and
$0.001–$1.00; increasing a task ceiling does not increase the project's budget or
guarantee a broker request fits its conservative debit. Missing price evidence,
capacity, source proof or current runtime qualification is an unavailable state.

## Install local assets explicitly

Use Node.js 24 and Bun 1.4.4. The physically qualified execution adapter is
Windows with the existing x86_64 Ubuntu WSL2 distribution. Private configuration
accepts only literal `Ubuntu`; other distributions are refused. Python installer
portability does not qualify native Linux or Proxmox execution. Those deployment
adapters remain E00/dedicated-server work. No global installation, persistent
service, device/group permission change or system configuration is created by
these setup commands.

```sh
bun run coding:kvm:install
bun run coding:cli:install
bun run coding:qualify codex
bun run coding:qualify claude-code
```

The optional final distribution argument must remain `Ubuntu`, for example
`bun run coding:qualify codex Ubuntu`. Qualification uses a scripted local
model fixture, not a paid vendor completion, and does not enable the provider.
Read the command's result; a generated qualification file is not itself proof of
current readiness. Guest RAM/headroom checks and missing KVM/systemd/cgroup access
must fail closed. On the Windows/WSL2 KVM profile there is no host, TCG, container or
gVisor fallback for repository commands; the only other isolation profile is the
explicitly weaker server work-VM profile below, which is never selected implicitly.

## Isolation profiles

The capability `isolation` field is one of two literals, and the console labels them
differently:

| Literal | Boundary | Where | Strength |
| --- | --- | --- | --- |
| `disposable-kvm` | One QEMU/KVM microVM per task | Windows host driving x86_64 Ubuntu WSL2 | Qualified locally (2026-11-14) |
| `disposable-vm-container` | The disposable work VM `godseye-work` (VM 300, `10.20.3.10`, Debian, **no nested KVM**) plus a per-task gVisor (`runsc --platform=systrap`) or rootless-container sandbox | Dedicated server | **Weaker than KVM; not qualified; `available: false`** |

`disposable-vm-container` is an owner decision, not an equivalence claim. Tasks share the
work VM's Linux kernel; gVisor interposes a user-space kernel and rootless containers rely
on namespaces/seccomp, so a sandbox escape reaches the work VM rather than a per-task
kernel. The outer containment is the VM itself: no production secrets, a strict
NAT/proxy allowlist, ephemeral workspace and reset between uses. A qualification receipt
must carry the same isolation literal as the adapter, otherwise preflight refuses it.

**Linux with no transport.** A Linux control API without a private work-VM transport (no
`GODSEYE_CODING_BINDINGS_FILE`, an absent rendered file while OpenBao is sealed, or a
WSL-only configuration) reports `unavailable: not-configured-for-profile` for both
runners and performs no probing. Owner administration, preparations and Hermes are
unaffected.

### Work-VM private configuration

`CodingPrivateConfiguration` is a union. The WSL form keeps `workspace` and
`distro: "Ubuntu"`. The work-VM form replaces them with a `transport` object:

```json
{ "version": 1, "capacity": { "...": "as before" }, "bindings": [ "..." ],
  "transport": { "kind": "work-vm", "host": "10.20.3.10", "port": 22, "user": "godseye",
    "hostKey": "ssh-ed25519 AAAA...", "hostKeyFingerprint": "SHA256:...",
    "remoteWorkspace": "/opt/godseye", "identityFile": "/run/godseye-bindings/work-vm-ssh-key" } }
```

The host key is **pinned**, never trusted on first use: the fingerprint must match the
supplied public key at parse time and the SSH client runs with `StrictHostKeyChecking=yes`,
key-only auth, no agent/port forwarding and a fixed remote argv. `identityFile` must be an
absolute path outside the repository (the renderer places it on tmpfs). The same JSON-line
control protocol, authorization frames and attempt accounting run over SSH stdio; tests
inject the spawner and never open a connection.

### Debian guest profile and install template

`scripts/coding_guest_profile.py` replaces the KVM/WSL probes when the SSH transport sets
`GODSEYE_CODING_PROFILE=work-vm`: Debian 12/13, x86_64, systemd as init, unified cgroup v2
with `cpu memory pids`, unprivileged user, and a `runsc` binary matching the pinned digest
(or user namespaces for the rootless sandbox). It never reports availability by itself:
readiness stays `false` until a sandbox runner and qualification evidence exist, and `run`
is refused in this profile. `infra/dedicated-server/templates/work-vm-coding-host-install.sh.tmpl`
is an **unexecuted** template with pinned runsc provenance (the tarball digest from
`scripts/install-runsc.mjs`) and `@@PLACEHOLDER@@` values for the extracted-binary digest,
the Debian snapshot timestamp and package versions, which the owner fills after verifying them.

### Bindings from OpenBao

`render-bindings.sh.tmpl` and `godseye-bindings-render.service.tmpl` render the Hermes and
coding binding documents (and the work-VM SSH key) from OpenBao onto tmpfs
(`/run/godseye-bindings`, directory `0700`, files `0600`) using a credential-delivered
AppRole secret-id. A sealed or unreachable OpenBao removes any previous files and exits
`75`; the control API then starts with both providers unavailable. Restart the control API
after an unseal. Nothing is written to persistent disk and no value is printed.

### Qualification still required before `available: true`

1. Implement the sandbox task runner (runsc systrap / rootless) in the work-VM profile.
2. Record runsc binary digest, Debian snapshot and package versions from the install run.
3. Real CLI chains for both runners with a scripted model, plus the five adversarial cases
   and physical stop/revocation evidence inside the sandbox.
4. Egress proof that only the broker endpoint is reachable from `godseye-work`.
5. Owner acceptance of the weaker boundary; real vendor CLI egress/auth stays off until then.

Pinned assets are Codex `0.167.0-alpha.4.1`, Claude Code `2.1.215`, Node `24.22.1`,
Git `2.53.0`, QEMU `10.2.1` and Linux `7.0.0-30`. The 19 CLI assets include signed
Ubuntu Bash `5.3-2ubuntu1` (observed
`5.3.9`), its libtinfo dependency and Codex’s integrity-matched bundled bubblewrap.
Provenance, hashes and upstream notices are retained in ignored project-local
tool assets. Installation is distinct from actual CLI execution in the guest,
physical isolation proof and paid account
entitlement. See [third-party notices](../../THIRD_PARTY_NOTICES.md).

## Private source and provider configuration

Only the operator's private configuration accepts source paths and API material.
The owner HTTP API accepts neither keys, host paths, arbitrary argv, provider URLs
nor upstream session IDs. Register an independent local Git source for the exact
project/environment/repository hash and runner. A configured GitHub repository is
a binding identity; it does not trigger a remote clone or grant GitHub access.
The source backend copies registered local Git objects as inert bytes. The fixed
host source parser verifies bounded loose commit/tree/blob
object headers, sizes and SHA hashes. All Git commands, checkout and
repository-controlled execution occur inside the disposable guest using a trusted
worker and a task-private worktree. The initial
source backend requires the complete requested loose-object closure; packed-only
closure is explicitly unavailable. Trusted fixed source refs are generated for
the staged copy; source hooks/config/filters are omitted. Exact blob
materialization and trusted attributes preserve tracked ignored files, export
attributes, encoding declarations and nested paths without changing source bytes.
Shared writable Git metadata, host mounts,
ambient desktop homes and production administration credentials are excluded.

Create a bounded nonsecret JSON metadata file following
`CodingPrivateConfiguration` in `apps/control-api/src/coding-provider.ts`, omitting
every `broker.apiKey`. It declares `version: 1`, the absolute workspace, WSL
distribution (`Ubuntu` only), a finite resource `capacity` including
`vmmOverheadMiB`, and exact
bindings with project/environment UUIDs, repository hash, Linux source directory,
runner and finite broker limits. Paths and identities are operator supplied;
copying sample identities would not establish source authority.

Provide `GODSEYE_CODEX_API_KEY` and/or `GODSEYE_CLAUDE_CODE_API_KEY` privately in
the helper process environment for the selected bindings. Never paste keys into
chat, task text, metadata, command arguments or browser forms. The helper injects
only the selected variables, checks the strict schema and publishes a protected
file through a flushed stage and atomic rename.

```sh
bun run coding:bind write --metadata NONSECRET_JSON
bun run coding:bind status
```

`NONSECRET_JSON` is a placeholder for your metadata file. The default dedicated
directory is `.local/coding-access`; `--directory .local/CUSTOM_DIRECTORY` selects
another dedicated workspace-local directory. `status` prints only presence and
validity. A successful write reports `enabled: false` and makes no model call.
Do not print or inspect the resulting private binding file in chat.

Explicitly set `GODSEYE_CODING_BINDINGS_FILE` to that protected `bindings.json`
absolute path in the process launching the API, then restart it. This environment
value is a path; the file contains private API material. Binding changes require
a restart. No global vendor home, desktop login, subscription OAuth session or
subscription allowance is reused. Missing bindings preserve metadata/preparation
access while execution stays unavailable.

## Billing, results and lifecycle

The API broker fixes Codex to `gpt-5.4-mini` and Claude Code to
`claude-haiku-5-5`. Its reviewed model/price catalog is dated 2026-11-14 and expires
at `2026-11-21T00:00:00Z`; renewed source review is required after expiry. Review
sources are the [OpenAI model page](https://developers.openai.com/api/docs/models/gpt-5.4-mini),
[Claude model page](https://platform.claude.com/docs/en/models/haiku-5-5/overview)
and [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing).
These are the broker's dated source references, not independently verified account
prices. The broker debits a conservative upper bound durably before each possible
HTTP effect and obtains fresh Foundation authorization. It bounds requests,
bytes, output tokens and duration, with no hidden retry, premium fallback or
unknown-as-free refund. Reservation/debit accounting is not a provider invoice.

Readiness checks stable kernel/architecture/machine/KVM-device/cgroup-policy
identity and fresh KVM access. An idle WSL reboot can preserve unchanged software
qualification; each allocation's inspect/stop authority remains strictly bound
to its own boot, task, systemd InvocationID, image and cgroup. Cheap owner polling
does not repeatedly hash the full image; physical dispatch independently verifies
all executable/image bytes and current controls before final authorization.
The measured profile is 4,096 MiB guest RAM, 5,120 MiB outer VMM memory,
1,000 millicores, outer TasksMax 64 and separate guest CLI/test pids.max 64.
The physical service lifetime is at most 180 seconds and the controller deadline
at most 175 seconds, even when the public task ceiling is longer. Capacity and
observed host headroom must support that profile.

The owner sees logical worktree identity and disposition, task state, summary,
patch, observed test exit/log and usage as separate evidence. Tests may be
`not-run`, `passed` or `failed`; a CLI's prose does not establish test success.
Downloaded patch and test logs use fixed `.txt` filenames and inert UTF-8 MIME
types. Review the patch before applying it. No automatic commit, push, merge,
deployment or publication occurs. A preview is `not-requested` or `unavailable`;
a CLI-emitted URL is never a verified delivery preview.

Cancellation revokes logical authority before requesting protective stop. An
acknowledged stop is not physical stopped proof. Unknown submission/cleanup
retains correlation, resources and quarantined worktree state. Reconcile the
retained task read-only; it does not repeat submission or grant fresh execution.
Epoch, cancellation, scope, lease and deadline changes fence late result
publication. The live worktree and CLI home are ephemeral guest RAM and die with allocation.
`retained` records frozen starting source/image, patch, logs and lifecycle evidence;
it does not promise a reattachable guest, persistent modified disk or resumable CLI
home. Persistent vendor CLI resume is research-only and unsupported.

## Verification boundary

Both normal KVM chains passed using real vendor CLIs and actual edit/shell/test
execution with a scripted model. Five adversarial case IDs passed: failed guest
PID setup, mutable Git index, test-side mutation, lingering descendants and exact
registered-source attributes/paths. Candidate-specific earlier proofs retain
explicit source bounds; they do not qualify later runtime changes automatically.
The current normal chains were requalified after readiness changes.

Separate mechanism checks passed 31 broker cases using fake HTTPS, 10 actual
Linux source-staging cases and 13 readiness/stop cases. Three curated mutations were
killed; this is not a global mutation score. Two strengthened owner browser
journeys passed in 32.9 seconds, including inert downloads, and actual mobile
screenshots were inspected after fixing descendant clipping/padding. Completed
browser result content is an explicitly labeled UI fixture, not native proof.

The existing ordinary suite passed 1,426 cases (1,424 across 131 files in
1,242.80 seconds plus two serialized builder cases in 17.47 seconds), with 28
legacy default-native skips. The new focused suite passed 87/87, giving 1,513 ordinary passes across the
disjoint existing/new groups. Three opt-in actual native Foundation composition
cases passed separately in 123.946 seconds and are excluded from that total. Do not add overlapping focused or
mechanism subsets to global totals. Four source security findings are closed;
the final normal receipts match all 13 runtime sources in native freeze v7.

The real composition cases cover Claude success (38.397 seconds), Codex success
(46.656 seconds) and epoch revocation after actual work (38.892 seconds), with
zero failures/errors. They use the actual Foundation journal, private provider,
native controller, production broker and KVM guest; only HTTPS is fake. Earlier
composition failures exposed Windows launch, readiness, authorization-pipe, broker
compatibility and stopped-worktree-state defects; their evidence remains history,
and the final rerun passed without weakening assertions. Freeze v7 binds 13
runtime sources, including broker `353857c2…` and runner helper `f451cdc1…`, to
both current normal qualification receipts.

Canonical builds and full static checks passed. The unchanged original 15-second built smoke failed
twice while overlapping image work, then passed when truly idle; neither deadline
nor assertions were changed. The final idle rerun after the latest source delta
also passed with the original 15-second deadline: health reachable, remote server
disconnected, exit 0. Cleanup observed zero owned transient units, broker socket
directories and controllers. Public-path Gitleaks inspection covered 758 paths
with zero new findings and one known synthetic placeholder; Node dependency audit
reported zero and no Node dependencies were added. Semgrep/SBOM coverage is
unavailable. Binary integrity/provenance and targeted source review do not claim
an OS/binary CVE audit, paid billing, dedicated-host qualification or all of E07.
