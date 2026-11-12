# Owner access and recovery

Status: implemented local owner boundary, 2026-11-11. Remote private networking and server/hardware qualification remain pending.

## First enrollment

Start `bun run dev`, then run this in a second terminal with the same data/state configuration:

```sh
bun run owner:setup
```

Open the link printed by the command before its ten-minute expiry. The fragment contains a single-use enrollment ticket. Choose **Enregistrer ma clé d’accès**, then confirm with your device's passkey mechanism or security key. The application's tests use virtual authenticators; only you can enroll your real device.

The CLI proves local filesystem authority to the loopback API using a timestamped HMAC and replay-protected nonce. It does not open the active PGlite database. Enrollment tickets are stored by digest, and only the latest prepared ticket remains valid. The verified registration, ticket consumption, passkey and session are committed in one Better Auth/Drizzle transaction. A rejected ceremony does not consume a valid ticket. Setup refuses to replace an owner who already has a passkey.

Do not commit, publish or add enrollment links to logs. A fresh command can prepare a replacement link if the earlier unused link expires.

## Routine access

The console uses Better Auth 1.7.20 with resident passkeys and required user verification. There is exactly one pre-created owner identity. Public signup, email/password/social login, identity editing and the native public session-value endpoints are denied. Application end-user identities remain a separate future service boundary.

Sessions use HttpOnly, SameSite Strict cookies, a server-side database lookup and no cookie cache. Sessions expire absolutely after eight hours. Public local status returns only configuration/authentication state; authenticated status and the security page expose selected metadata without raw session values.

Open **Accès propriétaire** in the sidebar to:

- Confirm your identity with a new passkey authentication.
- Add a second key on another device or a security key.
- Revoke a selected key or session and inspect session metadata.
- Sign out and clear private console query data.

Key enrollment, revocation and sensitive operation approval require passkey authentication from the preceding five minutes. The broker derives this timestamp/session identity server-side. Browser-supplied owner fields do not grant authority. The final remaining passkey cannot be revoked through the normal UI/API; use the explicit local recovery route to replace it.

Session/passkey database changes create durable audit-outbox events in the same commit. The controller exports these into its audit journal outside the authentication transaction, preserving pending events across a process interruption.

## Online recovery

With the API running and access to its private local state:

```sh
bun run owner:recover
```

Recovery revokes existing owner sessions and passkeys, clears outstanding challenges/tickets and prepares one replacement enrollment link. Open the link and enroll the replacement passkey. Recovery is serialized with authentication handling so an in-flight old ceremony cannot restore the prior authority after reset.

This command intentionally replaces the owner's access. It requires the local private signing material; a browser session alone cannot invoke the local recovery authority.

## Offline recovery

If the API cannot serve the browser recovery path, stop the local controller first:

```sh
bun run owner:recover --offline
```

The offline command acquires the same exclusive state-directory process lock, opens the control store directly, revokes prior access and prints a new enrollment link. Restart `bun run dev`, then use the link before expiry. Offline recovery refuses to share the local store with a live controller or another recovery process.

An ordinary stale process marker can be reclaimed only after its process is known to be absent. Invalid or interrupted guard state fails closed. Verify that no controller/recovery process owns the selected state directory before repairing a damaged lock; do not override a live lock.

## Local material and limits

The default database is `.local/control`; separate identity/process state is `.local/control-state`. Signing material lives beneath its private owner directory and is never included in committed configuration or ordinary server logs. On POSIX, controlled directories use mode 0700 and newly created signing material uses 0600. Windows replaces the private directory DACL with a protected grant for the current user while preserving the existing filesystem owner. Linked entries and shared-root aliases are refused before permission changes.

This recovery route depends on trusted local filesystem/database access. It does not repair a lost or corrupt control database, protect against the machine administrator, or demonstrate off-host recovery. Server deployment must separately qualify private access, state/key backup protection, the management origin and the hardware authenticator/recovery procedure. A localhost passkey is not an automatic credential migration to a future server domain.

Service identities and their private proof files are a separate boundary from owner passkeys/sessions. The owner manages their metadata at `/access`; material import and proof issuance use the explicit offline procedures in [service access and OpenBao](service-access.md). A service proof cannot authenticate as the owner.
