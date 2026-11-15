#!/usr/bin/env bash
set -euo pipefail

cat >/etc/systemd/system/godseye-console.service <<'EOF'
[Unit]
Description=G.O.D.S.E.Y.E Web Console
After=network-online.target godseye-control-api.service
Wants=network-online.target

[Service]
Type=simple
User=godseye
Group=godseye
WorkingDirectory=/opt/godseye/apps/console
Environment=GODSEYE_MODE=local
Environment=GODSEYE_API_PORT=4301
Environment=GODSEYE_CONSOLE_PORT=4300
ExecStart=/usr/bin/node /opt/godseye/node_modules/vite/bin/vite.js preview --config /opt/godseye/apps/console/vite.config.ts --host 127.0.0.1 --port 4300
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now godseye-console
sleep 3
systemctl is-active godseye-console
curl -s -o /dev/null -w "CONSOLE_HTTP=%{http_code}\n" http://127.0.0.1:4300/
