#!/usr/bin/env bash
# Repository template for the edge Caddyfile (run on the edge guest as root; not executed by CI).
#
# Exposure model (owner decision):
#   * PUBLIC listener (GODSEYE_PUBLIC_BIND, port 80/443): ONLY the signed GitHub webhook
#     (POST /hooks/github, small body) and /healthz. Everything else is a 404. Project applications
#     are separate site blocks added by the delivery layer; they are not the console or the API.
#   * PRIVATE listener (GODSEYE_WG_BIND = this guest's WireGuard address): the owner console and API.
#     The same hostname resolves to the WireGuard address for the owner (split-horizon DNS or a
#     hosts entry on the owner devices), so the WebAuthn rpID/origin (GODSEYE_PUBLIC_ORIGIN) is one
#     value for both. Nothing here is reachable from the Internet because Caddy does not bind it
#     on the public address.
#   * /api/v1/owner/local-command is same-host administration and is refused on every Caddy path;
#     the API additionally refuses any proxied or non-loopback caller.
set -euo pipefail

SITE_HOST="${GODSEYE_SITE_HOST:-godseye.lucasschimmel.fr}"
PUBLIC_BIND="${GODSEYE_PUBLIC_BIND:-10.20.1.10}"
: "${GODSEYE_WG_BIND:?Set GODSEYE_WG_BIND to the WireGuard interface address of this guest (for example 10.99.0.1)}"
WG_UNIT="${GODSEYE_WG_UNIT:-wg-quick@wg0.service}"
CONSOLE_UPSTREAM="${GODSEYE_CONSOLE_UPSTREAM:-127.0.0.1:4300}"
API_UPSTREAM="${GODSEYE_API_UPSTREAM:-127.0.0.1:4301}"
# Matches LOCAL_DEFAULTS.bodyLimitBytes in packages/contracts (256 KiB).
WEBHOOK_MAX_BODY="${GODSEYE_WEBHOOK_MAX_BODY:-256KB}"

# Caddy must not start before the WireGuard address exists, or the private bind fails.
install -d /etc/systemd/system/caddy.service.d
cat >/etc/systemd/system/caddy.service.d/10-godseye-wireguard.conf <<DROPIN
[Unit]
After=${WG_UNIT}
Requires=${WG_UNIT}
DROPIN
systemctl daemon-reload

cat >/etc/caddy/Caddyfile <<CADDYEOF
{
	admin off
}

# --- PUBLIC: signed webhook + health only ---------------------------------------------------
https://${SITE_HOST} {
	bind ${PUBLIC_BIND}

	@webhook {
		method POST
		path /hooks/github
	}
	handle @webhook {
		request_body {
			max_size ${WEBHOOK_MAX_BODY}
		}
		reverse_proxy ${API_UPSTREAM}
	}
	handle /healthz {
		respond "godseye-edge-ok" 200
	}
	handle {
		respond "Not found" 404
	}
}

# --- PRIVATE (WireGuard only): owner console and API ----------------------------------------
https://${SITE_HOST} {
	bind ${GODSEYE_WG_BIND}

	handle /healthz {
		respond "godseye-edge-ok" 200
	}
	# Same-host administration is never reachable through the proxy.
	handle /api/v1/owner/local-command {
		respond "Not found" 404
	}
	handle {
		# The console preview server proxies /api to the API; Host and Origin pass through unchanged.
		reverse_proxy ${CONSOLE_UPSTREAM}
	}
}
CADDYEOF

caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy
sleep 5
curl -fsS --resolve "${SITE_HOST}:443:${PUBLIC_BIND}" "https://${SITE_HOST}/healthz" || true
echo ""
echo "Public listener must refuse the console:"
curl -sS -o /dev/null -w "%{http_code}\n" --resolve "${SITE_HOST}:443:${PUBLIC_BIND}" "https://${SITE_HOST}/" || true
