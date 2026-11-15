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

## Server mode (dedicated server)

`GODSEYE_MODE=server` is admitted only when the configuration validates; it is never a label. Required variables: `GODSEYE_PUBLIC_ORIGIN` (bare `https://` DNS origin), `GODSEYE_DATABASE_URL` (PostgreSQL), `GODSEYE_TRUSTED_PROXIES` (fixed comma-separated loopback/private IPs, no wildcard), `GODSEYE_API_HOST` (loopback or private-bridge IP, never `0.0.0.0`), `GODSEYE_BAO_ADDRESS` (https) and `GODSEYE_BAO_MOUNT`. Local mode refuses `NODE_ENV=production`.

`GODSEYE_PUBLIC_ORIGIN` is the single owner origin. The WebAuthn rpID and origin, the `__Host-godseye-owner.*` cookies (Secure, SameSite=Strict, Path=/, no Domain), the allowed Host/Origin headers and the `owner:setup`/`owner:recover` enrollment link base all derive from it. Changing its hostname invalidates every enrolled passkey (the rpID changes), so fix the domain before enrolling.

The owner origin is `GODSEYE_PUBLIC_ORIGIN=https://console.godseye.lucasschimmel.fr`; its DNS A record points to the private WireGuard-reachable address, never the public IP. Exposure: console and API are reachable only over WireGuard. The edge is the container `godseye-edge` (`infra/dedicated-server/p10-install-edge-caddy.sh`, template): container port 8443 is published only as `<WireGuard address>:443` (no host network, no `0.0.0.0`), and 80/443 only on the guest private address behind the unchanged host DNAT. Because Let's Encrypt cannot validate a private address with HTTP-01, the console certificate is a real Let's Encrypt certificate obtained with DNS-01 through the OVH API (`caddy-dns/ovh`, endpoint `ovh-eu`), so owner devices need no private root; `GODSEYE_CONSOLE_TLS_DIRECTIVE=tls internal` remains an override. The image is built on the server by `p10-build-edge-caddy-image.sh` (digest-pinned `caddy:builder` and base, xcaddy, `github.com/caddy-dns/ovh@v1.1.0`) and referenced by its local image ID. Credentials: create an OVH API application restricted to `/domain/zone/lucasschimmel.fr/*` (GET/POST/PUT/DELETE as the module requires), then run `ssh -t godseye-pro sudo ./p10-store-edge-credentials.sh` and type the application key, application secret, consumer key and a short-lived OpenBao admin token at the silent prompts. They are stored in OpenBao `godseye/edge/ovh`; policy `godseye-edge-read` and AppRole `godseye-edge` can read only that path, and the AppRole files live in `/etc/godseye/edge-approle` (0600 root). At each start `godseye-edge.service` runs `p10-render-edge-env.sh`, which writes `/run/godseye/edge.env` (tmpfs, 0600) for `docker --env-file`; if OpenBao is sealed it exits 75 and systemd retries, so unseal OpenBao after a reboot. Docker keeps the container environment in its root-only config, so treat the Docker host as the trust boundary. Never put these values in chat, the repository or shell arguments; revoke the admin token afterwards. Only the signed `POST /hooks/github` (configure the GitHub webhook content type as `application/json`) and `/healthz` are public. `/api/v1/owner/local-command` is refused for any proxied or non-loopback caller, so run `owner:setup`/`owner:recover` on the server itself, as the service user, with the service environment loaded.

### Backup requirement

`identity.key` (in `<GODSEYE_STATE_DIR>/owner/`) derives the session secret and the local-administration proof key and is not stored in PostgreSQL. Back up the whole state directory (including `owner/identity.key` and `owner/bao.auth`) together with the database, protected at rest and off-host, and restore both together. A restored database with a lost or regenerated key invalidates all owner sessions and requires `owner:recover --offline`.

The instance lock records the PID plus the boot id and process start time, so a PID recycled after a crash or reboot no longer blocks startup. Locks written by older versions (PID only) still require the recorded process to be absent.
