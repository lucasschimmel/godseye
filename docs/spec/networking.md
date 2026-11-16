# V1 IPv6-first and shared IPv4 network contract

Status: proposed, 2026-11-11. Authority: [ADR-002](../adr/ADR-002-professional-vm-and-dual-stack.md). No server configuration or live route has been tested. The goal is **one public IPv4**, with **two maximum** only if an owner-reviewed concrete need exists. IPv6 is preferred where compatible, not assumed universally available.

The local E02.S03 continuation prepares private IPv4/ULA allocations and collision checks, retaining separate desired/observed evidence and provider qualification. Its direct OCI/network-none laboratory uses only fixture-owned listeners; it does not verify this server routing, Docker forwarding or publication contract. See [ADR-006](../adr/ADR-006-local-inventory-and-cell-provisioning.md) and the [infrastructure guide](../development/infrastructure.md).

## Physical and guest layout

Proxmox is installed once on the physical server (a Hetzner EX44; first assumed AX41). It owns physical routing and outer firewall policy. The professional VM contains all ordinary pro projects and their container/data services; the games VM is separate. One optional disposable work VM is allocated directly by Proxmox for unsafe builds/tools. Nothing installs Proxmox inside the professional VM.

The host/public IPv4 is not allocated anew per VM or project. Both permanent VMs use private IPv4 routes and shared NAT44. Each can also have an address from the routed Hetzner IPv6 allocation. Prefer separate host-managed guest links and explicit static IPv6 `/128` routes if qualified; Hetzner's single internal `/64` bridge pattern is also documented but must not leave lateral access open. Record the selected route design before applying it, including upstream link-local gateway/interface scope.

Do not attach the same `/64` to unrelated links, invent extra `/64` SLAAC subnets, or assume proxy NDP is always required. Verify actual Robot assignment and the documented IP/MAC binding. A routed host design keeps VM MACs off the upstream physical network.

## Required behaviors

Every N control is required for V1 and inherits T02/T13/T36 as indicated. It elaborates F05/F07/F36/F42 and I02/I03/I15 rather than creating a new product scope.

| ID | Acceptance | Tests |
| --- | --- | --- |
| N01 | The address inventory contains one public IPv4 for baseline operation; provisioning another project creates no new public IPv4 allocation. Any second address has an approved protocol/port justification; a third is rejected. | T02, T05 |
| N02 | TCP 80/443 on the shared IPv4 reaches only the professional web ingress; registered domains route to the intended service and no default route exposes management. | T02, T13 |
| N03 | Games receive explicit unique TCP/UDP external-port allocations forwarded to the games VM; collisions fail before publication. No assumption that hostname routing can demultiplex arbitrary game protocols on the same fixed port. | T02, T32 |
| N04 | IPv6 routes to selected VM addresses survive reboot and follow host/VM firewall policy. Direct numeric-IPv6 probes cannot bypass professional, database or management isolation. | T02, T03 |
| N05 | Publish AAAA only after IPv6 listener/TLS/routing checks pass; retain A to shared IPv4 for compatibility. Broken IPv6 is visible and blocks a new AAAA change until repaired. | T13, T40 |
| N06 | Qualified endpoint selection prefers working IPv6; IPv4-only or failed-IPv6 destinations use the permitted IPv4 path without bypassing scope/egress policy. | T02, T36 |
| N07 | Each Docker cell network has unique private IPv4 and ULA IPv6 pools; app/worker sandboxes do not receive public database/admin listeners or a shared cross-project bridge. | T02, T04, T20 |
| N08 | Host and VM filters cover IPv4, IPv6, forwarding/NAT, Docker published ports and essential ICMPv6 behavior. Robot's optional IPv6 filter is defense-in-depth, not the sole precise policy. | T02, T13 |

## Traffic paths

| Traffic | Path |
| --- | --- |
| IPv4 web client | Shared public IPv4 -> host forwarding -> professional ingress -> selected app sandbox |
| IPv6 web client | Routed professional IPv6 -> professional ingress -> selected app sandbox |
| Private owner | VPN/private identity -> console/control, with owner authentication; no public admin route |
| Game client | Shared IPv4 + allocated port, or supported games IPv6 -> games VM |
| Outbound IPv6 | Scoped service/egress proxy -> professional VM IPv6 -> host route -> destination |
| Outbound IPv4 | Scoped service/egress proxy -> private IPv4 -> host NAT44 -> shared IPv4 |
| Internal app/data | Cell-specific Docker network, scoped database/file/job identities, explicit allowed paths |

Project-container ULA addresses are not automatically globally routed. The qualified Docker/egress proxy path supplies translation or controlled relaying as needed; do not publish internal ULAs in public DNS. Keep IPv4 in internal dual-stack networks where dependencies need it. This prevents a false claim that IPv6 alone eliminates IPv4-only integration requirements.

## Routing and access policy

TLS ingress owns hostname routing and the certificate lifecycle. Only it has the required web bindings across frontend networks; it cannot expose a management API through an arbitrary user Host/path. A compromised app cannot attach itself to another Docker network or change ingress policy because it has no daemon/control credentials. Provider rendering is inspected after every deployment.

The IPv6 `/64` must be configured as routed allocation, not copied into every Docker bridge. Use a generated private ULA aggregate with non-overlapping per-cell subnets. No extra paid public IPv4 is needed for private database, worker, agent or admin endpoints.

Validate source attribution/trusted forwarded headers, TLS and renewal from both IP families. Preserve essential IPv6 discovery/path-MTU functions instead of blocking all ICMPv6. A firewall rule that was tested only through an IPv4 domain is not proof of IPv6 policy.

## Failure and qualification

E00 records actual addresses, provider routes, guest links, IP/MAC constraints, private pools, ingress and game allocations, DNS providers and packet-filter backends. It tests the full allow/deny matrix and restart path before production networking is accepted. No real public/private addresses are hardcoded in this specification.

If an IPv4-only game requires a fixed port already in use and cannot change it, first report the collision. An additional IPv4 can resolve that demonstrated case within the two-address ceiling. If a third is required, the requested placement must be rejected or redesigned, not silently purchased.

If an application runtime or IPv6 dependency is incompatible, block deployment or use an explicitly qualified compatible path within the same scope. Do not bypass gVisor, attach a shared network, publish a database port or disable IPv6 filtering to make the test pass.

Primary evidence is listed in ADR-002: Hetzner's official routing/NAT tutorial and IP/firewall documentation; Docker IPv6/bridge documentation; and IETF dual-stack/prefix references. These establish mechanisms, not the tested configuration of this machine.
