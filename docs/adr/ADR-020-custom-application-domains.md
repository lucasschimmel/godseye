# ADR-020: Custom application domains

Status: accepted (control logic, API, edge template and tests implemented; no live DNS/TLS qualification)
Scope: delivery edge, owner API 1.16.0; extends ADR-009 (application delivery) and the dedicated-server edge Caddy.

## Context

Delivered applications are reachable at `<environmentId>.<app domain>` through one Caddy block per
environment (file-per-route store, per-host HTTP-01, no wildcard). The owner also wants an application on
its own domain, as on Vercel, without ever serving a name that was not proven to be theirs and without
letting Caddy obtain certificates for arbitrary hosts that merely point at the public IP.

## Decision

1. **Binding.** A custom hostname belongs to exactly one project environment, in addition to its platform
   host. States: `pending_verification`, `verified`, `active`, `failed`, `removed`. A live hostname is unique
   platform-wide (partial unique index); removed rows are history. A project holds at most five live domains.
2. **Ownership by DNS.** Method `dns`: a CNAME chain reaching the platform host, or A records that all belong
   to the public IPv4 set. Method `txt`: `_godseye-challenge.<host>` carries `godseye-verify=<token>` with a
   per-binding random token, which allows verifying before the DNS switch. Resolution goes through an injected
   `DomainResolver`; a resolver outage is a 503, never a verdict. A name with no record stays pending; a name
   that resolves elsewhere (including a mix) fails and can be re-verified. An apex (registrable domain, with a
   small multi-label suffix list) that already points elsewhere is refused at add time. Platform hostnames,
   wildcards, IPs, ports and reserved suffixes are refused.
3. **Authority.** Add and remove require a fresh owner passkey session and `Idempotency-Key`; verify is a
   read of DNS and needs only the owner session. Every command is revision-checked and audited.
4. **Nothing is served before verification.** The edge Caddyfile uses `on_demand_tls { ask ... }` and the
   per-domain route blocks carry `tls { on_demand }`. The control API answers `GET /api/v1/domains/ask?domain=`
   with 200 only for verified or active bindings (a single indexed lookup, no DNS, no secret), else 404. The
   route file for an environment (`<environmentId>.domains.caddy`) lists exactly the verified set, so a
   verified-then-removed or failed name loses both its route and its certificate permission. The ask path is
   exempt from the Host allowlist because Caddy calls it by its private gateway address; it carries no
   authority and the socket proxy exposes it only on the edge bridge.
5. **Publication and rollback.** The engine serializes publishes per environment and always writes the full
   verified set. The Docker runtime writes the domain file atomically, validates and reloads Caddy, and
   restores the previous bytes on any failure. A failed publish leaves the binding `verified` with failure
   `PUBLISH_FAILED` (not served) and a failed unpublish blocks removal (502) so a route is never silently
   orphaned. A promotion or rollback retargets the domain file to the new upstream in the same reload; before
   the first deployment, verified hosts answer 503.
6. **Unknown hosts.** The public listener answers 404 for any host no block claims.

## Consequences

- Without a `domains` entry in the delivery binding (public CNAME target and IPv4 set) the capability is
  honestly unconfigured: listing works, adding returns 503.
- Revoking a certificate is not performed; removal only stops serving and future issuance.
- The apex heuristic does not embed the public suffix list; a misclassified name only changes the add-time
  refusal, not the verification rules.
- Environment cleanup keeps the domain file with a 503 body; domains of a purged project must be removed
  first (the lifecycle residual check does not yet list them).
