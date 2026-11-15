#!/usr/bin/env bash
set -euo pipefail

cat >/usr/local/sbin/godseye-games-backup.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/var/backups/godseye-games"
DATA_DIR="/var/lib/godseye-games/luanti"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="${BACKUP_DIR}/luanti-world-${TS}.tar.gz"

mkdir -p "$BACKUP_DIR"

# App-consistent quiesce: clean SIGTERM stop flushes world DB before archive
docker stop -t 15 godseye-luanti >/dev/null
trap 'docker start godseye-luanti >/dev/null || true' EXIT

tar -C "$DATA_DIR" -czf "$ARCHIVE" worlds main-config
sha256sum "$ARCHIVE" > "${ARCHIVE}.sha256"

docker start godseye-luanti >/dev/null
trap - EXIT

# Keep last 7 local archives
ls -1t "${BACKUP_DIR}"/luanti-world-*.tar.gz 2>/dev/null | tail -n +8 | xargs -r rm -f
ls -1t "${BACKUP_DIR}"/luanti-world-*.tar.gz.sha256 2>/dev/null | tail -n +8 | xargs -r rm -f

echo "BACKUP_OK:${ARCHIVE}"
EOF
chmod 0755 /usr/local/sbin/godseye-games-backup.sh

cat >/etc/systemd/system/godseye-games-backup.service <<'EOF'
[Unit]
Description=G.O.D.S.E.Y.E App-Consistent Game World Backup
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/godseye-games-backup.sh
EOF

cat >/etc/systemd/system/godseye-games-backup.timer <<'EOF'
[Unit]
Description=Daily G.O.D.S.E.Y.E Game World Backup

[Timer]
OnCalendar=*-*-* 04:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now godseye-games-backup.timer

# Execute backup + destructive restore drill
OUT="$(/usr/local/sbin/godseye-games-backup.sh)"
echo "$OUT"
ARCHIVE="${OUT#BACKUP_OK:}"
sha256sum -c "${ARCHIVE}.sha256"

docker stop -t 15 godseye-luanti >/dev/null
rm -rf /var/lib/godseye-games/luanti/worlds.drill_bak
mv /var/lib/godseye-games/luanti/worlds /var/lib/godseye-games/luanti/worlds.drill_bak
tar -C /var/lib/godseye-games/luanti -xzf "$ARCHIVE" worlds
rm -rf /var/lib/godseye-games/luanti/worlds.drill_bak
docker start godseye-luanti >/dev/null
sleep 3
docker ps --filter "name=godseye-luanti" --format "RESTORE_DRILL_OK:{{.Names}}:{{.Status}}"
