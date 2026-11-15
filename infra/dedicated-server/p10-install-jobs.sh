#!/usr/bin/env bash
# P10: Inngest engine binary, per-cell Redis unit template and the autonomous jobs service.
# TEMPLATE ONLY: committed for review, never executed by the repository or CI.
#
# Per-cell Redis instances are rendered by `render_redis_cell` below (one call per cell, run by the
# owner or the control transport after review); this script installs the pieces, it does not create
# any cell, secret or listener.
set -euo pipefail

INNGEST_VERSION="1.52.0"
ARCHIVE="inngest_${INNGEST_VERSION}_linux_amd64.tar.gz"
# GitHub release asset digest observed 2026-11-15 for v1.52.0 (api.github.com releases/tags/v1.52.0).
INNGEST_SHA256="9a4e96eb9b509da2840e9b1c7db35f651860dae45d0d757c324d59aa1415f3d1"
SRC="$(cd "$(dirname "$0")" && pwd)"
INSTALL_ROOT="/opt/godseye"
TOOL_DIR="${INSTALL_ROOT}/artifacts/tools/inngest-${INNGEST_VERSION}"

echo "[p10-jobs] Inngest ${INNGEST_VERSION}: download, verify against the pinned and the published digest"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
curl -fsSL -o "${work}/${ARCHIVE}" \
  "https://github.com/inngest/inngest/releases/download/v${INNGEST_VERSION}/${ARCHIVE}"
echo "${INNGEST_SHA256}  ${work}/${ARCHIVE}" | sha256sum -c -
published="$(curl -fsSL "https://api.github.com/repos/inngest/inngest/releases/tags/v${INNGEST_VERSION}" |
  jq -r --arg name "${ARCHIVE}" '.assets[] | select(.name == $name) | .digest' | sed 's/^sha256://')"
[ "${published}" = "${INNGEST_SHA256}" ] || { echo "pinned digest differs from the published digest" >&2; exit 1; }
tar -xzf "${work}/${ARCHIVE}" -C "${work}" inngest
install -d -m 0755 -o root -g root "${TOOL_DIR}"
# Root-owned, world-executable, not writable by the service user (the control process starts it).
install -m 0755 -o root -g root "${work}/inngest" "${TOOL_DIR}/inngest"
"${TOOL_DIR}/inngest" version

echo "[p10-jobs] Redis (server only; the packaged default instance is NOT used)"
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq redis-server redis-tools
# Per-cell instances replace the shared loopback instance for workflow state.
id -u godseye-redis >/dev/null 2>&1 || useradd --system --home /var/lib/godseye-redis --shell /usr/sbin/nologin godseye-redis
install -d -m 0711 /etc/godseye/redis
install -d -m 0711 -o godseye-redis -g godseye-redis /var/lib/godseye-redis

echo "[p10-jobs] Units"
install -m 0644 "${SRC}/units/godseye-redis@.service" /etc/systemd/system/godseye-redis@.service
install -m 0644 "${SRC}/units/godseye-jobs.service" /etc/systemd/system/godseye-jobs.service
install -d -m 0750 -o godseye -g godseye /etc/godseye/jobs
systemctl daemon-reload
# Deliberately not enabled or started: bindings (control/storage JSON, cells, platform cell) are
# owner inputs, and the service refuses to start without them.

# render_redis_cell <environment-uuid> <private-bridge-address> <tls-port> <memory-mib>
# Creates one authenticated, persistent, non-evicting Redis behind TLS. The AUTH secret is generated
# here, written only to the root-owned include and to the private storage binding by the owner.
render_redis_cell() {
  local cell="$1" address="$2" port="$3" memory="$4" dir secret
  [[ "${cell}" =~ ^[0-9a-f-]{36}$ && "${address}" =~ ^[0-9a-fA-F:.]+$ && "${port}" =~ ^[0-9]+$ && "${memory}" =~ ^[0-9]+$ ]] || return 64
  dir="/etc/godseye/redis/${cell}"
  install -d -m 0750 -o root -g godseye-redis "${dir}" "${dir}/tls"
  install -d -m 0700 -o godseye-redis -g godseye-redis "/var/lib/godseye-redis/${cell}"
  secret="$(openssl rand -base64 36 | tr -d '\n=+/')"
  ( umask 077; printf 'requirepass %s\n' "${secret}" >"${dir}/auth.conf" )
  chown root:godseye-redis "${dir}/auth.conf"; chmod 0640 "${dir}/auth.conf"
  # Server certificate with an IP SAN so clients verify the bridge address (reuses the PG cell CA).
  /usr/local/sbin/godseye-pg-issue-cert "${cell}" "redis.cells.internal" "${dir}/tls" godseye-redis
  cat >"${dir}/redis.conf" <<EOF
include ${dir}/auth.conf
bind ${address}
protected-mode yes
port 0
tls-port ${port}
tls-cert-file ${dir}/tls/server.crt
tls-key-file ${dir}/tls/server.key
tls-ca-cert-file ${dir}/tls/ca.crt
tls-auth-clients no
tls-protocols "TLSv1.2 TLSv1.3"
dir /var/lib/godseye-redis/${cell}
appendonly yes
appendfsync always
maxmemory ${memory}mb
maxmemory-policy noeviction
save ""
rename-command FLUSHALL ""
rename-command FLUSHDB ""
EOF
  chmod 0640 "${dir}/redis.conf"; chown root:godseye-redis "${dir}/redis.conf"
  echo "[p10-jobs] rendered Redis cell ${cell} on ${address}:${port}; start with: systemctl enable --now godseye-redis@${cell}"
}
# Open item (docs/development/dedicated-cells.md): the jobs runtime verifies AOF/noeviction with
# CONFIG GET and INFO using the cell AUTH identity; a read-only ACL user would narrow that.
