#!/usr/bin/env bash
# TEMPLATE - reviewed but NOT executed. Installs the edge Caddy as the CONTAINER `godseye-edge`
# (run as root on the pro guest). It replaces the host-systemd Caddy of p07-caddy-https.sh, because
# the delivery runtime (apps/control-api/src/delivery/docker-runtime.ts) must attach the edge to each
# per-environment `--internal` Docker network and swap upstreams by file.
#
# Contract with the delivery runtime (keep in sync with tests/edge-caddy-templates.test.ts):
#   container name      godseye-edge          (binding.runtime.caddyContainer)
#   route directory     ${ROUTE_DIR}          (binding.runtime.routeDirectory) -> /etc/caddy/apps.d (ro)
#   route file          <environmentId>.caddy, a COMPLETE site block, imported at top level of the Caddyfile
#   validate / reload   docker exec godseye-edge caddy validate|reload --config /etc/caddy/Caddyfile
#   network joins       `docker network connect gdy-env-<environmentId> godseye-edge` by the control API
#
# Exposure (owner decisions):
#   * PUBLIC listener  = container ports 80/443 published ONLY on ${PUBLIC_BIND}; the existing host
#     nftables DNAT of public 80/443 to ${PUBLIC_BIND} is unchanged. Serves POST /hooks/github,
#     /healthz and the app hosts <app>.${SITE_HOST} (per-host HTTP-01 certificates, no DNS token).
#   * PRIVATE listener = container port 8443 published ONLY on ${GODSEYE_WG_BIND} as port 443, so the
#     console and API exist solely on the WireGuard address. Nothing is bound on 0.0.0.0 or host network.
#   * ${CONSOLE_HOST} must resolve to the PRIVATE WireGuard address (never the public IP). Let's
#     Encrypt cannot validate a private address with HTTP-01, so the console certificate is issued by
#     Let's Encrypt via DNS-01 with the OVH API (caddy-dns/ovh, endpoint ovh-eu). The image therefore
#     must be built by p10-build-edge-caddy-image.sh and is referenced by its local image ID. The OVH
#     credentials come from OpenBao (p10-store-edge-credentials.sh stores them, p10-render-edge-env.sh
#     renders /run/godseye/edge.env, godseye-edge.service orders everything after OpenBao is unsealed).
#     The same credentials permit a later wildcard (*.${SITE_HOST}); app route files keep per-host HTTP-01.
#     GODSEYE_CONSOLE_TLS_DIRECTIVE overrides the whole tls directive (for example `tls internal`).
#   * Host services stay on 127.0.0.1 (the API keeps its loopback-only owner/local-command). Two
#     systemd socket proxies expose them on the edge bridge gateway ${EDGE_GATEWAY} only; the API then
#     sees a loopback peer, and Caddy's X-Forwarded-For header still makes local-command refuse it.
#     The host firewall must allow ${EDGE_SUBNET} -> ${EDGE_GATEWAY}:4300,4301 (input chain).
set -euo pipefail

SITE_HOST="${GODSEYE_SITE_HOST:-godseye.lucasschimmel.fr}"
CONSOLE_HOST="${GODSEYE_CONSOLE_HOST:-console.godseye.lucasschimmel.fr}"
PUBLIC_BIND="${GODSEYE_PUBLIC_BIND:-10.20.1.10}"
: "${GODSEYE_WG_BIND:?Set GODSEYE_WG_BIND to the WireGuard interface address of this guest (for example 10.99.0.1)}"
: "${GODSEYE_CADDY_IMAGE:?Set GODSEYE_CADDY_IMAGE to the sha256:<image id> printed by p10-build-edge-caddy-image.sh (or a registry digest reference that already contains the DNS module)}"
case "$GODSEYE_CADDY_IMAGE" in
  *REPLACE_ME*) echo "Replace the image digest placeholder first" >&2; exit 1 ;;
  *@sha256:????????????????????????????????????????????????????????????????) ;;
  sha256:????????????????????????????????????????????????????????????????)
    # Locally built image pinned by image ID: it must exist locally and carry the build labels.
    docker image inspect --format '{{ index .Config.Labels "godseye.edge.dns-module" }}' "$GODSEYE_CADDY_IMAGE" | grep -q . \
      || { echo "GODSEYE_CADDY_IMAGE is not an image built by p10-build-edge-caddy-image.sh" >&2; exit 1; } ;;
  *) echo "GODSEYE_CADDY_IMAGE must be pinned by sha256 digest or local image id" >&2; exit 1 ;;
esac
WG_UNIT="${GODSEYE_WG_UNIT:-wg-quick@wg0.service}"
EDGE_CONTAINER="${GODSEYE_EDGE_CONTAINER:-godseye-edge}"
EDGE_NETWORK="${GODSEYE_EDGE_NETWORK:-godseye-edge-net}"
EDGE_SUBNET="${GODSEYE_EDGE_SUBNET:-172.30.0.0/24}"
EDGE_GATEWAY="${GODSEYE_EDGE_GATEWAY:-172.30.0.1}"
CADDYFILE_DIR="${CADDYFILE_DIR:-/etc/godseye/caddy}"
ROUTE_DIR="${ROUTE_DIR:-/etc/godseye/caddy/apps.d}"
DATA_VOLUME="${GODSEYE_EDGE_DATA_VOLUME:-godseye-edge-data}"     # Let's Encrypt account, certificates, internal CA
CONFIG_VOLUME="${GODSEYE_EDGE_CONFIG_VOLUME:-godseye-edge-config}"
# Default: Let's Encrypt DNS-01 through OVH EU. The credentials reach Caddy only as container
# environment (docker --env-file ${ENV_FILE}), never in the Caddyfile. Optional tuning inside the tls
# block (see docs/development/application-delivery.md): `resolvers 1.1.1.1 9.9.9.9`,
# `propagation_delay 30s`, `propagation_timeout 5m`, `dns_challenge_override_domain <domain>`.
# Override via GODSEYE_CONSOLE_TLS_DIRECTIVE (may be multi-line); `tls internal` restores the internal CA.
DEFAULT_TLS_DIRECTIVE='tls {
		dns ovh {
			endpoint ovh-eu
			application_key {env.OVH_APPLICATION_KEY}
			application_secret {env.OVH_APPLICATION_SECRET}
			consumer_key {env.OVH_CONSUMER_KEY}
		}
	}'
CONSOLE_TLS_DIRECTIVE="${GODSEYE_CONSOLE_TLS_DIRECTIVE:-$DEFAULT_TLS_DIRECTIVE}"
ENV_FILE="${GODSEYE_EDGE_ENV_FILE:-/run/godseye/edge.env}"
LIB_DIR="${GODSEYE_LIB_DIR:-/usr/local/lib/godseye}"
BAO_UNIT="${GODSEYE_BAO_UNIT:-openbao.service}"
WEBHOOK_MAX_BODY="${GODSEYE_WEBHOOK_MAX_BODY:-256KB}"            # LOCAL_DEFAULTS.bodyLimitBytes (256 KiB)
SERVICE_USER="${GODSEYE_SERVICE_USER:-godseye}"
SERVICE_UID="$(id -u "$SERVICE_USER")"
SERVICE_GID="$(id -g "$SERVICE_USER")"

# Route files are written by the control API (service user) and read by Caddy as the same uid.
install -d -m 0755 "${CADDYFILE_DIR}"
install -d -m 0750 -o "$SERVICE_UID" -g "$SERVICE_GID" "${ROUTE_DIR}"

cat >"${CADDYFILE_DIR}/Caddyfile" <<CADDYEOF
{
	# The admin API stays on the container-internal localhost:2019 and is never published; the
	# control API reaches it only through \`docker exec ${EDGE_CONTAINER} caddy reload\`.
}

# --- PUBLIC (published on ${PUBLIC_BIND}:443): signed webhook + health only ---------------------
https://${SITE_HOST} {
	@webhook {
		method POST
		path /hooks/github
	}
	handle @webhook {
		request_body {
			max_size ${WEBHOOK_MAX_BODY}
		}
		reverse_proxy ${EDGE_GATEWAY}:4301
	}
	handle /healthz {
		respond "godseye-edge-ok" 200
	}
	handle {
		respond "Not found" 404
	}
}

# --- PRIVATE (container :8443, published only on ${GODSEYE_WG_BIND}:443): owner console + API ----
https://${CONSOLE_HOST}:8443 {
	${CONSOLE_TLS_DIRECTIVE}
	handle /healthz {
		respond "godseye-edge-ok" 200
	}
	# Same-host administration is never reachable through the proxy.
	handle /api/v1/owner/local-command {
		respond "Not found" 404
	}
	handle {
		# The console preview server proxies /api to the API; Host and Origin pass through unchanged.
		reverse_proxy ${EDGE_GATEWAY}:4300
	}
}

# --- APP HOSTS: one complete site block per environment, written atomically by the control API ---
import /etc/caddy/apps.d/*.caddy
CADDYEOF
chmod 0644 "${CADDYFILE_DIR}/Caddyfile"

# Edge bridge (non-internal: ACME and published ports need it). Fixed subnet so the gateway is known.
docker network inspect "${EDGE_NETWORK}" >/dev/null 2>&1 || docker network create --driver bridge \
  --subnet "${EDGE_SUBNET}" --gateway "${EDGE_GATEWAY}" "${EDGE_NETWORK}"

# Host services stay on loopback; expose them on the edge gateway only (peer seen by the API = loopback).
for port in 4300 4301; do
  cat >"/etc/systemd/system/godseye-edge-forward-${port}.socket" <<UNIT
[Unit]
Description=G.O.D.S.E.Y.E edge forward ${EDGE_GATEWAY}:${port} -> 127.0.0.1:${port}

[Socket]
ListenStream=${EDGE_GATEWAY}:${port}
FreeBind=true

[Install]
WantedBy=sockets.target
UNIT
  cat >"/etc/systemd/system/godseye-edge-forward-${port}.service" <<UNIT
[Unit]
Description=G.O.D.S.E.Y.E edge forward worker ${port}
Requires=godseye-edge-forward-${port}.socket
After=godseye-edge-forward-${port}.socket

[Service]
ExecStart=/usr/lib/systemd/systemd-socket-proxyd 127.0.0.1:${port}
DynamicUser=yes
PrivateTmp=yes
NoNewPrivileges=yes
UNIT
done

# Docker must not start before the WireGuard address exists, or publishing on it fails.
install -d /etc/systemd/system/docker.service.d
cat >/etc/systemd/system/docker.service.d/10-godseye-wireguard.conf <<DROPIN
[Unit]
After=${WG_UNIT}
Requires=${WG_UNIT}
DROPIN
systemctl daemon-reload
systemctl enable --now godseye-edge-forward-4300.socket godseye-edge-forward-4301.socket

# Persistent Let's Encrypt storage (account key, certificates, internal CA root) in named volumes.
docker volume create "${DATA_VOLUME}" >/dev/null
docker volume create "${CONFIG_VOLUME}" >/dev/null
docker run --rm --user 0 --entrypoint chown -v "${DATA_VOLUME}:/data" -v "${CONFIG_VOLUME}:/config" \
  "${GODSEYE_CADDY_IMAGE}" "${SERVICE_UID}:${SERVICE_GID}" /data /config

# Credential rendering (root, before every container start): OpenBao AppRole -> ENV_FILE on tmpfs.
install -d -m 0755 "${LIB_DIR}"
install -m 0750 -o root -g root "$(dirname "$0")/p10-render-edge-env.sh" "${LIB_DIR}/render-edge-env.sh"

# Start script: recreates the edge with --env-file. Runs unprivileged: no capabilities, read-only
# rootfs, ports < 1024 allowed only inside the container network namespace. 80/443 are published on
# the private guest address only. `--restart on-failure:5` (not unless-stopped) so a reboot never
# starts the edge ahead of OpenBao: godseye-edge.service orders it after OpenBao is unsealed.
cat >"${LIB_DIR}/start-edge.sh" <<STARTEOF
#!/usr/bin/env bash
set -euo pipefail
docker rm -f "${EDGE_CONTAINER}" >/dev/null 2>&1 || true
docker run -d --name "${EDGE_CONTAINER}" --restart on-failure:5 \\
  --network "${EDGE_NETWORK}" \\
  --env-file "${ENV_FILE}" \\
  --user "${SERVICE_UID}:${SERVICE_GID}" \\
  --cap-drop ALL --security-opt no-new-privileges --read-only --tmpfs /tmp \\
  --sysctl net.ipv4.ip_unprivileged_port_start=0 \\
  -p "${PUBLIC_BIND}:80:80" -p "${PUBLIC_BIND}:443:443" -p "${GODSEYE_WG_BIND}:443:8443" \\
  -v "${CADDYFILE_DIR}:/etc/caddy:ro" -v "${ROUTE_DIR}:/etc/caddy/apps.d:ro" \\
  -v "${DATA_VOLUME}:/data" -v "${CONFIG_VOLUME}:/config" \\
  "${GODSEYE_CADDY_IMAGE}" caddy run --config /etc/caddy/Caddyfile
# A recreated edge loses its environment attachments; re-join every managed environment network.
for network in \$(docker network ls --filter label=godseye.environment --format '{{.Name}}'); do
  docker network connect "\$network" "${EDGE_CONTAINER}" 2>/dev/null || true
done
STARTEOF
chmod 0750 "${LIB_DIR}/start-edge.sh"

# Ordered after WireGuard, Docker and an UNSEALED OpenBao: the render step exits 75 while OpenBao is
# sealed and systemd retries, so the edge never starts without its DNS credentials.
cat >/etc/systemd/system/godseye-edge.service <<UNIT
[Unit]
Description=G.O.D.S.E.Y.E edge Caddy container (credentials from OpenBao)
After=${WG_UNIT} docker.service ${BAO_UNIT}
Requires=docker.service
Wants=${BAO_UNIT}
StartLimitIntervalSec=0

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStartPre=${LIB_DIR}/render-edge-env.sh
ExecStart=${LIB_DIR}/start-edge.sh
ExecStop=/usr/bin/docker stop ${EDGE_CONTAINER}
Restart=on-failure
RestartSec=15s

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable godseye-edge.service
systemctl restart godseye-edge.service

docker exec "${EDGE_CONTAINER}" caddy validate --config /etc/caddy/Caddyfile
echo "Public listener (must serve webhook/health only):"
curl -fsS --resolve "${SITE_HOST}:443:${PUBLIC_BIND}" "https://${SITE_HOST}/healthz" || true
echo ""
echo "Public listener must NOT serve the console certificate/host:"
curl -sS -o /dev/null -w "%{http_code}\n" --resolve "${CONSOLE_HOST}:443:${PUBLIC_BIND}" "https://${CONSOLE_HOST}/" || true
echo "Retire the host Caddy once verified: systemctl disable --now caddy"
