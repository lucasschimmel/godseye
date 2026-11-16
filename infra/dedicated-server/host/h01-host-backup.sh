#!/usr/bin/env bash
# h01-host-backup.sh - install scheduled VM + host-config backups on the Proxmox host.
# Run as root on godseye-wg from the staged directory. Idempotent; every changed
# file is first copied to /var/lib/godseye/rollback/h01-<ts>/ (rollback notes below).
#
# Layout (all on the local ZFS pool, capped so backups can never exhaust it):
#   rpool/backup                quota 60G, lz4
#   rpool/backup/vzdump         PVE storage "local-backup" (vzdump archives)
#   rpool/backup/host-config    host configuration archives (root-only)
# Schedule (UTC): 01:30 host config, 02:00 vzdump 100/200/300, 05:15 off-host
# config copy, Sunday 05:30 off-host VM archives. pgBackRest runs 03:30 and the
# games backup 04:00, so nothing overlaps.
#
# Rollback: pvesh delete /cluster/backup/godseye-vms; pvesm remove local-backup;
# systemctl disable --now godseye-host-config-backup.timer godseye-offhost-backup-*.timer;
# restore /etc/vzdump.conf from the rollback directory; zfs destroy -r rpool/backup.
set -euo pipefail
umask 022

HERE="$(cd "$(dirname "$0")" && pwd)"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
RB="/var/lib/godseye/rollback/h01-$TS"
QUOTA="${GODSEYE_BACKUP_QUOTA:-60G}"
mkdir -p "$RB" /var/lib/godseye/status /etc/godseye
chmod 755 /var/lib/godseye /var/lib/godseye/status
chmod 700 /etc/godseye /var/lib/godseye/rollback

echo "== packages"
if ! command -v restic >/dev/null; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends restic
fi
restic version

echo "== dataset"
if ! zfs list -H rpool/backup >/dev/null 2>&1; then
  zfs create -o quota="$QUOTA" -o compression=lz4 -o atime=off rpool/backup
fi
zfs set quota="$QUOTA" rpool/backup
mkdir -p /rpool/backup/vzdump /rpool/backup/host-config
chmod 700 /rpool/backup/host-config

echo "== PVE storage local-backup"
if ! pvesm status 2>/dev/null | awk '{print $1}' | grep -qx local-backup; then
  pvesm add dir local-backup --path /rpool/backup/vzdump --content backup \
    --prune-backups keep-last=2,keep-weekly=1
fi

echo "== vzdump.conf (bounded CPU and I/O)"
[ -f /etc/vzdump.conf ] && cp -a /etc/vzdump.conf "$RB/vzdump.conf"
for kv in "zstd: 2" "bwlimit: 262144"; do
  key="${kv%%:*}"
  grep -q "^$key:" /etc/vzdump.conf || echo "$kv" >>/etc/vzdump.conf
done

echo "== vzdump job (snapshot mode, guest agent fsfreeze, zstd)"
if pvesh get /cluster/backup/godseye-vms >/dev/null 2>&1; then
  pvesh set /cluster/backup/godseye-vms --schedule 02:00 --vmid 100,200,300 \
    --storage local-backup --mode snapshot --compress zstd \
    --prune-backups keep-last=2,keep-weekly=1 --enabled 1 >/dev/null
else
  pvesh create /cluster/backup --id godseye-vms --schedule 02:00 --vmid 100,200,300 \
    --storage local-backup --mode snapshot --compress zstd \
    --prune-backups keep-last=2,keep-weekly=1 --enabled 1 \
    --comment "G.O.D.S.E.Y.E nightly VM backup (DS09)" >/dev/null
fi

echo "== scripts and units"
install -m 0750 "$HERE/bin/godseye-host-config-backup" /usr/local/sbin/godseye-host-config-backup
install -m 0750 "$HERE/bin/godseye-offhost-backup" /usr/local/sbin/godseye-offhost-backup
for u in godseye-host-config-backup.service godseye-host-config-backup.timer \
  'godseye-offhost-backup@.service' godseye-offhost-backup-config.timer godseye-offhost-backup-vms.timer; do
  [ -f "/etc/systemd/system/$u" ] && cp -a "/etc/systemd/system/$u" "$RB/$u"
  install -m 0644 "$HERE/units/$u" "/etc/systemd/system/$u"
done
systemctl daemon-reload
systemctl enable --now godseye-host-config-backup.timer godseye-offhost-backup-config.timer godseye-offhost-backup-vms.timer

echo "== first host-config backup"
/usr/local/sbin/godseye-host-config-backup

echo "== off-host state"
/usr/local/sbin/godseye-offhost-backup config || true
cat /var/lib/godseye/status/offhost-backup.json

echo "== summary"
zfs list -o name,used,avail,quota rpool/backup
pvesh get /cluster/backup --output-format json
systemctl list-timers 'godseye-*' --no-pager
echo H01_DONE
