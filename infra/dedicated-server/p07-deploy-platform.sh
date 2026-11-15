#!/usr/bin/env bash
set -euo pipefail

if ! id godseye >/dev/null 2>&1; then
  useradd -r -m -d /var/lib/godseye -s /usr/sbin/nologin godseye
fi
install -d -m 0700 -o godseye -g godseye /var/lib/godseye /var/lib/godseye/data /var/lib/godseye/state

# Branch to deploy (default: released code on `main`; override to test another branch).
REF="${GODSEYE_DEPLOY_REF:-main}"
export GIT_SSH_COMMAND="ssh -i /var/lib/jenkins/.ssh/id_ed25519_github -o UserKnownHostsFile=/var/lib/jenkins/.ssh/known_hosts"
if [ ! -d /opt/godseye/.git ]; then
  git clone --branch "$REF" --single-branch git@github.com:lucasschimmel/godseye.git /opt/godseye
else
  # The clone is single-branch, so fetch with an explicit refspec to get a remote-tracking ref.
  git -c safe.directory=/opt/godseye -C /opt/godseye fetch origin "+refs/heads/${REF}:refs/remotes/origin/${REF}"
  git -c safe.directory=/opt/godseye -C /opt/godseye checkout -B "$REF" "origin/${REF}"
fi

cd /opt/godseye
bun install --frozen-lockfile
bun run build
chown -R godseye:godseye /opt/godseye

# Rebuild control-api.env from validated server-mode settings without printing secrets.
# Unused legacy variables (REDIS_URL, GODSEYE_SESSION_SECRET, GODSEYE_INTERNAL_TOKEN) are dropped.
ENV_FILE=/etc/godseye/control-api.env
read_existing() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- || true; }
DB_URL="$(read_existing GODSEYE_DATABASE_URL)"
[ -n "$DB_URL" ] || DB_URL="$(read_existing DATABASE_URL)"
[ -n "$DB_URL" ] || { echo "No PostgreSQL URL found in $ENV_FILE" >&2; exit 1; }
WEBHOOK_KEY="$(read_existing GODSEYE_GITHUB_WEBHOOK_KEY)"
: "${GODSEYE_PUBLIC_ORIGIN:=https://console.godseye.lucasschimmel.fr}"

# Keep the previous environment (0600, root-readable only) so a failed switch can be rolled back.
[ ! -f "$ENV_FILE" ] || cp -p "$ENV_FILE" "$ENV_FILE.bak-pre-server-mode"

{
  cat <<ENVEOF
GODSEYE_MODE=server
NODE_ENV=production
GODSEYE_PUBLIC_ORIGIN=${GODSEYE_PUBLIC_ORIGIN}
GODSEYE_API_HOST=127.0.0.1
GODSEYE_API_PORT=4301
GODSEYE_CONSOLE_PORT=4300
GODSEYE_TRUSTED_PROXIES=127.0.0.1,::1
GODSEYE_DATABASE_URL=${DB_URL}
GODSEYE_BAO_ADDRESS=https://127.0.0.1:8200
GODSEYE_BAO_MOUNT=godseye
NODE_EXTRA_CA_CERTS=/etc/openbao/bao.crt
GODSEYE_DATA_DIR=/var/lib/godseye/data
GODSEYE_STATE_DIR=/var/lib/godseye/state
ENVEOF
  # Signed webhook intake stays disabled until the owner provisions the key out of band.
  [ -z "$WEBHOOK_KEY" ] || echo "GODSEYE_GITHUB_WEBHOOK_KEY=${WEBHOOK_KEY}"
} >"$ENV_FILE.new"
chown godseye:godseye "$ENV_FILE.new"
chmod 0600 "$ENV_FILE.new"
mv "$ENV_FILE.new" "$ENV_FILE"

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
