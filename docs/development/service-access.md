# Local service access and OpenBao

Status: local E02.S02 implementation verified by the combined 215-case unit/integration suite, 2026-11-11. The complete browser regression passed 16/16 cases in 53.8 seconds. The owner console provides **Secrets et identités de service** at `/access`. No dedicated server or personal OpenBao store was initialized by this stage.

## Ownership and visibility

Create a project first, then open **Secrets et identités de service**. Confirm the owner passkey before mutations. Create a service identity for an existing project/environment and its purpose, then register a named slot for that identity. The page shows identity revisions, proof-issuance state, slot versions, operation state and provider readiness. It has no material input or reveal control.

Each service identity belongs to exactly one project and one environment owned by that project. Runtime identities provide ordinary static application access. Migration, deploy and backup identities require a bound worker ID and a live authorized FoundationEngine task. Scope derives from the verified proof and registered identity; a caller-selected Actor or provider path cannot widen it. Service proofs cannot log into or administer the owner console.

OpenBao stores material. The control database retains references, revisions, keyed evidence fingerprints and pending/unknown effect state rather than plaintext material. Provider paths are compiled from registered cell/purpose/identity/slot IDs. The trusted controller has the exact limited `godseye-broker-v1` policy; it cannot write ACLs or mint provider identities. Compiled cell policies allow reads of exact registered slot paths, without broad listing or cross-purpose access. Policy installation remains an operator responsibility.

## Local provider configuration

Install the pinned local laboratory executable without a global installation:

```sh
bun run bao:install
```

The installer downloads the official OpenBao 2.7.2 archive, verifies its published SHA-256 checksum and places the executable under ignored `artifacts/tools/openbao/2.7.2/bin`. Release signatures were not verified. The installer has Windows/Linux/macOS x64/arm64 paths; only Windows was executed in this qualification. This installs tooling; it does not initialize a personal store, start a server, unseal it or create controller authority.

An operator must separately run and initialize/unseal a local OpenBao store, enable KV v2 at the selected mount, install the compiled limited broker policy and issue authority with that policy alone. Root, default/extra policies, inherited identity policies and altered policy text are refused by the broker's readiness check. Do not give the controller authority to edit its own policy or mint broader provider identities.

| Variable | Behavior |
| --- | --- |
| `GODSEYE_BAO_ADDRESS` | Explicit loopback origin only (`localhost`, `127.0.0.1` or `::1`), without user information, path, query or fragment. Local HTTP or HTTPS is accepted; the recorded native laboratory uses loopback HTTP. Unset means unconfigured. |
| `GODSEYE_BAO_MOUNT` | KV v2 mount, default `godseye`; one lowercase letter followed by up to 47 lowercase letters, digits or hyphens. |

Set configuration in the launching process, as with [local development](local.md). The application does not load dotenv files. Print the public HCL for the selected mount with:

```sh
bun run access:policy
```

This command is read-only and does not open the database. All other private access commands below require the controller to be stopped and acquire its existing exclusive state-directory lock. Run them with the same data/state/provider configuration as the controller.

## Provider authority and byte-preserving input

`access:provider-auth` accepts limited OpenBao authentication material through stdin and writes only the verified value to `<identityDir>/bao.auth`. It prints no authentication value. A conflicting existing file is not overwritten. Explicit `--replace` verifies the new limited authority before an atomic replacement, preserving the old file if verification fails; it does not revoke the old OpenBao authority upstream. The operator must manage that upstream lifecycle separately.

For material-bearing commands, use a private UTF-8 input file without a BOM. Do not put its contents in command-line arguments, shell history or environment variables. For Windows, avoid `Get-Content | ...`, which can alter line endings or add a newline. The following Node bridge opens the private input and streams directly to the child process, without a shell or text pipeline:

```powershell
$env:GODSEYE_PRIVATE_INPUT = 'C:\private\REPLACE_ME.input'
node --input-type=module -e '
import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
const child = spawn("bun", ["run", ...process.argv.slice(1)], {
  shell: false,
  stdio: ["pipe", "inherit", "inherit"],
});
const source = createReadStream(process.env.GODSEYE_PRIVATE_INPUT);
source.once("error", () => { child.stdin.destroy(); child.kill(); process.exitCode = 1; });
child.once("error", () => { source.destroy(); process.exitCode = 1; });
child.once("exit", code => { process.exitCode = code ?? 1; });
source.pipe(child.stdin);
' -- access:provider-auth
```

The example contains only a placeholder path. Prepare actual input using a trusted private channel with restrictive OS permissions; do not use a repository file. To renew existing provider authority, use the same bridge ending in `access:provider-auth --replace` after preparing the replacement input. Provider authentication input is trimmed and bounded to 4,096 bytes. Slot material input below is not trimmed: an existing trailing newline remains part of the value.

## Staging material and issuing service proof

Stop `bun run dev`. Use the input bridge above with the final command replaced by:

```text
access:stage --slot REPLACE_WITH_SLOT_UUID --revision REPLACE_WITH_CURRENT_REVISION --key REPLACE_WITH_16_TO_128_SAFE_CHARACTERS
```

`access:stage` reads at most 16,384 bytes of nonempty UTF-8 material from stdin. It emits only an operation ID and state. The slot UUID and positive expected revision come from console metadata. Idempotency keys contain 16–128 letters, digits, dots, underscores, colons or hyphens. Reuse the same key only for the same request; changed material or parameters conflict. A rejected or ambiguous provider result must be inspected/reconciled rather than bypassed with a new key.

Issue the identity's private proof without material input:

```sh
bun run access:issue --identity REPLACE_WITH_IDENTITY_UUID --revision REPLACE_WITH_CURRENT_REVISION --key REPLACE_WITH_16_TO_128_SAFE_CHARACTERS
```

The command writes the proof to `<identityDir>/handoffs/<identityId>.<expectedRevision+1>.proof` and prints its path rather than the value. The directory is private and the handoff is created exclusively; an idempotent replay can reuse only identical owned content. Read the updated identity revision before a subsequent issuance. Do not publish, commit or copy proof files into build contexts or agent environments. Issuance rotates broker proof authority; it does not rotate a target database password.

Restart `bun run dev` after offline commands. The same local owner state must be available for enrollment and access administration. A live-controller lock, unsafe linked path, conflicting handoff or unavailable provider stops the command rather than selecting weaker authority.

## Private consumption and task authority

Only trusted server-side consumers call the broker's private consumption API. `consumeStatic` requires an active runtime identity proof and an active slot. `consumeTask` additionally binds the proof to its worker, project/environment, purpose-compatible command, actual lease/grant, tool/destination, budget, epoch/fence, cancellation and expiry. It validates a detached snapshot of the task/use before asynchronous work, so caller mutation cannot switch the checked execution. The broker rechecks authority after provider I/O and linearizes the final synchronous in-memory handoff with revocation/cancellation. A private handoff is not an asynchronous network/disk callback or a general HTTP material response.

The broker commits a metadata-only handoff-attempt record before invoking the private callback. A thrown callback, a returned Promise or an uncertain later commit must not erase that attempt or be reported as successful delivery. Such outcomes retain unresolved/unknown evidence; a callback may already have copied the value, so an error does not prove that delivery never occurred. If the initial attempt cannot be committed, the broker does not invoke the handoff.

The service proof is authenticated on each use. Revoking it blocks new broker delivery immediately, including a revocation that occurs during provider I/O. Already mounted application material is not erased merely because OpenBao seals or becomes unreachable. Broker-proof revocation and old upstream credential revocation are separate states; the overview reports pending upstream revocation rather than claiming the target access is gone.

## Rotation and uncertainty

Staging creates a candidate version; it does not activate the candidate. Activation requires a registered, qualified trusted adapter that establishes the real connection transition and old upstream-access revocation. No transition adapter is registered by normal local startup, so the page explicitly reports that activation is unavailable. Merely writing a KV version or selecting a checkbox cannot certify D05.

A definitive readiness failure can preserve the prior active version only when the adapter supplies the required evidence. After reading candidate/previous material, the broker rechecks the identity revision, epoch, slot and operation before admitting transition dispatch; revocation during those reads prevents dispatch. Ambiguous writes and transition/revocation outcomes remain pending or unknown until reconciled. While activation is uncertain, private redemption is blocked; after a lost revocation receipt the old credential may already be invalid, so automatic fallback is unsafe. Idempotent replay cannot create an extra version or blindly redispatch the transition.

The owner HTTP surface exposes only overview, identity/slot creation, identity revocation, qualified activation and operation reconciliation under `/api/v1/access`. It requires the owner session, fresh sensitive-action authority, strict input and mutation idempotency keys. There is no HTTP stage, issue, material read, worker claim or provider-policy write route. The private typed control client shares those metadata-only contracts.

## Local evidence and server qualification

The final `bun run check` passed 215/215 cases across twenty files in 190.22 seconds, including eight real-provider cases against checksum-verified native OpenBao 2.7.2 and three private CLI cases. The provider cases use persistent one-node Raft storage and cover exact scoped policy denials, CAS, TTL/revocation, seal/unseal and cold restart. The fixture uses three Shamir shares with a two-share threshold; root/unseal material stayed in memory and out of reports. The CLI cases cover private provider installation/explicit replacement, stage/issue replay, private handoffs and process-lock exclusion. Build and built-API smoke also passed; complete browser regression passed 16/16 cases in 53.8 seconds.

These checks do not establish private server networking/TLS, multi-node availability, off-host recovery, real PostgreSQL credential transitions or isolation of deployed applications. No personal OpenBao initialization or production transition adapter was performed. See [ADR-005](../adr/ADR-005-bun-and-local-service-authority.md), the [development plan](../plan/v1-development.md) and [verification strategy](../../tests/STRATEGY.md) for the acceptance boundary.
