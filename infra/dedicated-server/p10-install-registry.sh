#!/usr/bin/env bash
# TEMPLATE - reviewed but NOT executed. Installs a private Zot OCI registry on the pro VM.
# Run as root on godseye-pro after owner review. Binds only to a private address.
set -euo pipefail

ZOT_VERSION="${ZOT_VERSION:-2.1.23}"                 # verified latest on 2026-11-15; re-check before running
REGISTRY_BIND="${REGISTRY_BIND:-10.20.1.10}"         # private address only; never 0.0.0.0
REGISTRY_PORT="${REGISTRY_PORT:-5000}"
BASE_URL="https://github.com/project-zot/zot/releases/download/v${ZOT_VERSION}"

cd /tmp
curl -fsSLO "${BASE_URL}/zot-linux-amd64"
curl -fsSLO "${BASE_URL}/checksums.sha256.txt"
# The upstream file marks entries as binary ("<hash> *<name>"), so match the optional asterisk.
grep -E ' \*?zot-linux-amd64$' checksums.sha256.txt | sha256sum -c -
install -m 0755 zot-linux-amd64 /usr/local/bin/zot
rm -f zot-linux-amd64 checksums.sha256.txt

id -u zot >/dev/null 2>&1 || useradd --system --home /var/lib/zot --shell /usr/sbin/nologin zot
install -d -m 0750 -o zot -g zot /var/lib/zot /etc/zot

# Credentials are OWNER INPUT: create /etc/zot/htpasswd (bcrypt, `htpasswd -bBn user pass`) out of band,
# then render the same user/password into the OpenBao-managed registry binding file. Never commit them.
test -s /etc/zot/htpasswd || { echo "missing /etc/zot/htpasswd (owner input)"; exit 64; }

cat >/etc/zot/config.json <<JSON
{
  "distSpecVersion": "1.1.0",
  "storage": { "rootDirectory": "/var/lib/zot", "gc": true, "gcDelay": "1h", "gcInterval": "6h" },
  "http": {
    "address": "${REGISTRY_BIND}",
    "port": "${REGISTRY_PORT}",
    "auth": { "htpasswd": { "path": "/etc/zot/htpasswd" } },
    "accessControl": { "repositories": { "apps/**": { "defaultPolicy": ["read", "create", "update"] } } }
  },
  "log": { "level": "info" }
}
JSON
chown root:zot /etc/zot/config.json && chmod 0640 /etc/zot/config.json
chown root:zot /etc/zot/htpasswd && chmod 0640 /etc/zot/htpasswd

cat >/etc/systemd/system/zot.service <<'UNIT'
[Unit]
Description=Zot private OCI registry
After=network-online.target
[Service]
User=zot
ExecStart=/usr/local/bin/zot serve /etc/zot/config.json
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/zot
PrivateTmp=true
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now zot

# Rollback retention: the Jenkins job pushes a tag per build (build-<runId>), and Zot GC only removes
# UNTAGGED manifests, so previously released digests stay pullable. Do not add tag-pruning without
# keeping every digest referenced by a retained delivery artifact.
# Docker daemons on the pro and work VMs must trust this private http endpoint (OWNER DECISION):
#   /etc/docker/daemon.json  { "insecure-registries": ["${REGISTRY_BIND}:${REGISTRY_PORT}"] }
# or front it with a private-CA TLS listener instead.
echo "[p10-registry] zot listening on ${REGISTRY_BIND}:${REGISTRY_PORT}"
