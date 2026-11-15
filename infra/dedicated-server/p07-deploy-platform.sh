#!/usr/bin/env bash
set -euo pipefail

if ! id godseye >/dev/null 2>&1; then
  useradd -r -m -d /var/lib/godseye -s /usr/sbin/nologin godseye
fi
install -d -m 0700 -o godseye -g godseye /var/lib/godseye /var/lib/godseye/data /var/lib/godseye/state

if [ ! -d /opt/godseye/.git ]; then
  GIT_SSH_COMMAND="ssh -i /var/lib/jenkins/.ssh/id_ed25519_github -o UserKnownHostsFile=/var/lib/jenkins/.ssh/known_hosts" \
    git clone --branch develop --single-branch git@github.com:lucasschimmel/godseye.git /opt/godseye
else
  GIT_SSH_COMMAND="ssh -i /var/lib/jenkins/.ssh/id_ed25519_github -o UserKnownHostsFile=/var/lib/jenkins/.ssh/known_hosts" \
    git -C /opt/godseye fetch origin develop && git -C /opt/godseye checkout develop && git -C /opt/godseye reset --hard origin/develop
fi

cd /opt/godseye
bun install --frozen-lockfile
bun run build
chown -R godseye:godseye /opt/godseye

# Build control-api.env cleanly from existing DB/secrets without printing them
DB_URL="$(grep '^DATABASE_URL=' /etc/godseye/control-api.env | cut -d= -f2-)"
SESSION_SEC="$(grep '^GODSEYE_SESSION_SECRET=' /etc/godseye/control-api.env | cut -d= -f2-)"
INTERNAL_TOK="$(grep '^GODSEYE_INTERNAL_TOKEN=' /etc/godseye/control-api.env | cut -d= -f2-)"

cat >/etc/godseye/control-api.env <<EOF
GODSEYE_MODE=local
GODSEYE_API_PORT=4301
GODSEYE_CONSOLE_PORT=4300
GODSEYE_DATABASE_URL=${DB_URL}
REDIS_URL=redis://127.0.0.1:6379
GODSEYE_BAO_ADDRESS=https://127.0.0.1:8200
GODSEYE_BAO_MOUNT=godseye
NODE_EXTRA_CA_CERTS=/etc/openbao/bao.crt
GODSEYE_DATA_DIR=/var/lib/godseye/data
GODSEYE_STATE_DIR=/var/lib/godseye/state
GODSEYE_SESSION_SECRET=${SESSION_SEC}
GODSEYE_INTERNAL_TOKEN=${INTERNAL_TOK}
EOF
chown godseye:godseye /etc/godseye/control-api.env
chmod 0600 /etc/godseye/control-api.env

cat >/etc/systemd/system/godseye-control-api.service <<'EOF'
[Unit]
Description=G.O.D.S.E.Y.E Control Plane API
After=network-online.target postgresql.service redis-server.service openbao.service
Wants=network-online.target

[Service]
Type=simple
User=godseye
Group=godseye
WorkingDirectory=/opt/godseye
EnvironmentFile=/etc/godseye/control-api.env
ExecStart=/usr/bin/node /opt/godseye/dist/control-api/server.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now godseye-control-api
sleep 3
systemctl is-active godseye-control-api
curl -fsS http://127.0.0.1:4301/api/v1/openapi.json | head -c 200
echo ""
