#!/usr/bin/env bash
# h04-host-health.sh - replace the 15-minute host health check with the status-file version (DS11).
# Run as root on godseye-wg from the staged directory. Idempotent.
#
# Result: /var/lib/godseye/status/host-health.json (0644, atomic, no secrets) is rewritten every
# 15 minutes and is what the external observer should fetch over WireGuard SSH:
#   ssh godseye-wg cat /var/lib/godseye/status/host-health.json
# The old entry point /usr/local/sbin/godseye-host-health.sh keeps working (symlink), so the
# existing godseye-host-health.service/timer need no change.
#
# ZFS scrub: Debian's zfsutils cron job (/etc/cron.d/zfsutils-linux) scrubs rpool on the second
# Sunday of every month; this script verifies that job is present and the health check alerts
# when the last completed scrub is older than 45 days. Pass --scrub-now to start one immediately.
#
# Rollback: copy the saved godseye-host-health.sh back from /var/lib/godseye/rollback/h04-*/.
set -euo pipefail
umask 022

HERE="$(cd "$(dirname "$0")" && pwd)"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
RB="/var/lib/godseye/rollback/h04-$TS"
mkdir -p "$RB" /var/lib/godseye/status
chmod 755 /var/lib/godseye /var/lib/godseye/status

if [ -f /usr/local/sbin/godseye-host-health.sh ] && [ ! -L /usr/local/sbin/godseye-host-health.sh ]; then
  cp -a /usr/local/sbin/godseye-host-health.sh "$RB/godseye-host-health.sh"
fi
install -m 0755 "$HERE/bin/godseye-host-health" /usr/local/sbin/godseye-host-health
ln -sfn /usr/local/sbin/godseye-host-health /usr/local/sbin/godseye-host-health.sh

echo "== logrotate (bounded history)"
cat >/etc/logrotate.d/godseye-host-health <<'EOF'
/var/log/godseye-host-health.jsonl {
    weekly
    rotate 8
    maxsize 20M
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
EOF

echo "== scrub schedule"
if grep -q 'zfs-linux/scrub' /etc/cron.d/zfsutils-linux 2>/dev/null && systemctl is-enabled cron >/dev/null 2>&1; then
  echo "SCRUB_SCHEDULE_OK: $(grep zfs-linux/scrub /etc/cron.d/zfsutils-linux | cut -c1-60)"
else
  echo "FAIL: monthly scrub cron missing" >&2
  exit 1
fi
if [ "${1:-}" = "--scrub-now" ]; then
  zpool scrub rpool
  echo "scrub started"
fi

echo "== first run"
/usr/local/sbin/godseye-host-health.sh >/dev/null || echo "health exited non-zero (critical alert active, see status file)"
python3 -c 'import json; d=json.load(open("/var/lib/godseye/status/host-health.json")); print({k: d[k] for k in ("status","overall_ok","alerts")}); print("pool", d["pool"].get("capacity_pct"), "% arc", d["arc"]); print("scrub", d["scrub"])'
systemctl restart godseye-host-health.timer
systemctl list-timers godseye-host-health.timer --no-pager | head -3
echo H04_DONE
