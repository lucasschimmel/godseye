#!/usr/bin/env bash
# TEMPLATE - reviewed but NOT executed. Renders the wildcard *.apps.<domain> edge for delivered apps.
#
# OWNER INPUTS REQUIRED (placeholders must be supplied; never commit real values):
#   APP_DOMAIN       e.g. apps.example.com  (a DNS zone served by a provider with an API)
#   DNS_PROVIDER     caddy-dns module name, e.g. cloudflare, ovh, gandi
#   DNS_API_TOKEN    scoped token (DNS edit on the single zone only) stored in OpenBao and rendered to
#                    /etc/godseye/caddy.env (0600, root) as CADDY_DNS_API_TOKEN=... ; supplied to the
#                    edge container with --env-file.  <-- OWNER INPUT: DNS provider token
#
# Why DNS-01: Let's Encrypt issues wildcard certificates only through the DNS challenge, and Caddy needs
# a build that includes the caddy-dns module for the chosen provider (build with xcaddy or the Caddy
# download page; the stock apt binary does not include it).
#
# Topology (OWNER DECISION, matches the delivery runtime): per-environment Docker networks are --internal,
# so the host cannot reach upstream containers. Run the edge as a CONTAINER (default name godseye-edge);
# the control API joins it to each environment network with `docker network connect` and swaps upstreams
# by atomically replacing /etc/caddy/apps.d/<environmentId>.caddy and running `caddy reload`.
set -euo pipefail

APP_DOMAIN="${APP_DOMAIN:?set APP_DOMAIN (owner input)}"
DNS_PROVIDER="${DNS_PROVIDER:?set DNS_PROVIDER (owner input)}"
ROUTE_DIR="${ROUTE_DIR:-/etc/godseye/caddy/apps.d}"
CADDYFILE_DIR="${CADDYFILE_DIR:-/etc/godseye/caddy}"

install -d -m 0755 "${ROUTE_DIR}" "${CADDYFILE_DIR}"
cat >"${CADDYFILE_DIR}/apps.Caddyfile" <<CADDY
*.${APP_DOMAIN} {
	tls {
		dns ${DNS_PROVIDER} {env.CADDY_DNS_API_TOKEN}
		propagation_timeout 5m
	}
	# One file per environment, written atomically by the control API.
	import /etc/caddy/apps.d/*.caddy
	handle {
		respond "no such app" 404
	}
}
CADDY
# Include from the main Caddyfile with: import /etc/caddy/apps.Caddyfile
# Example edge container (adapt the image to your xcaddy build, pinned by digest):
#   docker run -d --name godseye-edge --restart unless-stopped \
#     --env-file /etc/godseye/caddy.env -p 10.20.1.10:443:443 \
#     -v ${CADDYFILE_DIR}:/etc/caddy:ro -v ${ROUTE_DIR}:/etc/caddy/apps.d:ro <caddy-with-dns-plugin@sha256:...>
# The control API validates then reloads through `docker exec godseye-edge caddy ...`; the DNS record
# *.${APP_DOMAIN} -> the pro VM address is created by the owner at the DNS provider.
echo "[p10-wildcard] rendered ${CADDYFILE_DIR}/apps.Caddyfile for *.${APP_DOMAIN} (not applied)"
