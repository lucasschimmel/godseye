#!/usr/bin/env bash
set -euo pipefail

cat >/etc/caddy/Caddyfile <<'CADDYEOF'
{
	admin off
}

godseye.lucasschimmel.fr {
	handle /healthz {
		respond "godseye-edge-ok" 200
	}
	handle {
		respond "G.O.D.S.E.Y.E edge online (P07 provisioning)" 200
	}
}
CADDYEOF

caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
sleep 5
curl -fsS --resolve godseye.lucasschimmel.fr:443:127.0.0.1 https://godseye.lucasschimmel.fr/healthz || true
echo ""
