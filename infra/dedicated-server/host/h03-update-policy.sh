#!/usr/bin/env bash
# h03-update-policy.sh - unattended security updates, reboot windows, bounded logs (DS02/DS11/DS14).
#
#   bash h03-update-policy.sh host|pro|games|work
#
# Run as root on the target (host: godseye-wg; guests: over the workstation SSH config).
# Idempotent. Every file it replaces is copied to /var/lib/godseye/rollback/h03-<ts>/ first.
# Rollback: restore the copied files, remove /etc/apt/apt.conf.d/51godseye-policy,
# /etc/systemd/journald.conf.d/godseye.conf and the godseye-reboot-* units.
#
# Policy (also documented in docs/operations/host-update-policy.md):
#   host   Debian-Security only, unattended; Proxmox/ZFS/kernel packages are blacklisted and
#          applied by hand. Reboot: manual, window below.
#   pro    Debian + Debian-Security unattended; database/cache/proxy/container/CI/OpenBao
#          packages blacklisted (patched by hand). Reboot: manual only (OpenBao unseal).
#   games  Debian + Debian-Security unattended; guarded auto-reboot Monday 05:30 UTC.
#   work   Debian + Debian-Security unattended; guarded auto-reboot Tuesday 05:30 UTC.
# Reboot windows (UTC, never overlapping): games Mon 05:30, work Tue 05:30,
# host+pro Sun 09:00-11:00 attended (first Sunday of the month); a host reboot restarts every
# VM and therefore always is an attended pro window.
set -euo pipefail
umask 022

ROLE="${1:-}"
case "$ROLE" in host | pro | games | work) ;; *)
  echo "usage: $0 host|pro|games|work" >&2
  exit 64
  ;;
esac
HERE="$(cd "$(dirname "$0")" && pwd)"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
RB="/var/lib/godseye/rollback/h03-$TS"
mkdir -p "$RB" /var/lib/godseye/status
chmod 755 /var/lib/godseye /var/lib/godseye/status

backup() { [ -e "$1" ] && cp -a "$1" "$RB/$(echo "$1" | tr / _)" || true; }

echo "== packages"
if ! dpkg -s unattended-upgrades >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends unattended-upgrades
fi

echo "== apt periodic (daily list refresh + unattended run + weekly autoclean)"
backup /etc/apt/apt.conf.d/20auto-upgrades
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

echo "== unattended-upgrades policy for $ROLE"
case "$ROLE" in
  host)
    BLACKLIST='"pve-.*"; "proxmox-.*"; "qemu-server"; "libpve-.*"; "zfs.*"; "libzfs.*"; "libzpool.*"; "libnvpair.*"; "libuutil.*"; "spl.*"; "linux-image.*"; "linux-headers.*"; "pve-firmware"; "ceph.*"; "grub.*"; "systemd-boot.*"; "wireguard.*"; "nftables"; "libnftables.*"'
    ORIGINS='#clear Unattended-Upgrade::Origins-Pattern;
Unattended-Upgrade::Origins-Pattern {
        "origin=Debian,codename=${distro_codename}-security,label=Debian-Security";
};'
    ;;
  pro)
    BLACKLIST='"postgresql.*"; "redis.*"; "caddy.*"; "docker.*"; "containerd.*"; "runsc"; "openbao.*"; "jenkins.*"; "pgbackrest.*"'
    ORIGINS=''
    ;;
  games)
    BLACKLIST='"docker.*"; "containerd.*"'
    ORIGINS=''
    ;;
  work)
    BLACKLIST='"docker.*"; "containerd.*"; "jenkins.*"'
    ORIGINS=''
    ;;
esac
backup /etc/apt/apt.conf.d/51godseye-policy
{
  echo "// Managed by infra/dedicated-server/host/h03-update-policy.sh ($ROLE). Do not edit by hand."
  echo "$ORIGINS"
  echo 'Unattended-Upgrade::Automatic-Reboot "false";'
  echo 'Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";'
  echo 'Unattended-Upgrade::Remove-Unused-Dependencies "false";'
  echo 'Unattended-Upgrade::SyslogEnable "true";'
  echo 'Unattended-Upgrade::MinimalSteps "true";'
  echo "Unattended-Upgrade::Package-Blacklist { $BLACKLIST };"
} >/etc/apt/apt.conf.d/51godseye-policy
systemctl enable --now unattended-upgrades apt-daily.timer apt-daily-upgrade.timer >/dev/null 2>&1 || true

if [ "$ROLE" = host ]; then
  echo "== host: refuse unverified repositories"
  backup /etc/apt/apt.conf.d/52godseye-verify
  cat >/etc/apt/apt.conf.d/52godseye-verify <<'EOF'
Acquire::AllowInsecureRepositories "false";
Acquire::AllowDowngradeToInsecureRepositories "false";
Acquire::Check-Valid-Until "true";
EOF
  BAD=0
  for f in /etc/apt/sources.list.d/*.sources /etc/apt/sources.list; do
    [ -f "$f" ] || continue
    if grep -qiE 'trusted=yes|allow-insecure' "$f"; then
      echo "FAIL: $f disables signature checks" >&2
      BAD=1
    fi
  done
  for f in /etc/apt/sources.list.d/*.sources; do
    [ -f "$f" ] || continue
    grep -qi '^Enabled: *false' "$f" && continue
    grep -q '^Signed-By:' "$f" || {
      echo "FAIL: $f has no Signed-By keyring" >&2
      BAD=1
    }
  done
  [ "$BAD" -eq 0 ] && echo "REPOS_VERIFIED: every enabled source has a Signed-By keyring"
  apt-key list >/dev/null 2>&1 || true
  echo "keyring fingerprints in use:"
  for k in /usr/share/keyrings/debian-archive-keyring.gpg /usr/share/keyrings/proxmox-archive-keyring.gpg; do
    [ -f "$k" ] && { echo "  $k"; gpg --no-default-keyring --keyring "$k" --list-keys --with-colons 2>/dev/null | awk -F: '/^fpr/{print "    " $10}' | head -4; }
  done
fi

echo "== bounded journald (keeps free space, 1 month)"
mkdir -p /etc/systemd/journald.conf.d
backup /etc/systemd/journald.conf.d/godseye.conf
if [ "$ROLE" = host ]; then CAP=500M; else CAP=300M; fi
cat >/etc/systemd/journald.conf.d/godseye.conf <<EOF
[Journal]
Storage=persistent
SystemMaxUse=$CAP
SystemKeepFree=1G
MaxRetentionSec=1month
MaxFileSec=1week
ForwardToSyslog=no
EOF
systemctl restart systemd-journald

echo "== status helper"
install -m 0755 "$HERE/bin/godseye-update-status" /usr/local/sbin/godseye-update-status

if [ "$ROLE" = games ] || [ "$ROLE" = work ]; then
  echo "== guarded reboot window"
  install -m 0755 "$HERE/bin/godseye-reboot-if-required" /usr/local/sbin/godseye-reboot-if-required
  if [ "$ROLE" = games ]; then DAY=Mon; else DAY=Tue; fi
  cat >/etc/systemd/system/godseye-reboot-window.service <<EOF
[Unit]
Description=G.O.D.S.E.Y.E guarded reboot after kernel/libc updates ($ROLE)

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/godseye-reboot-if-required $ROLE
EOF
  cat >/etc/systemd/system/godseye-reboot-window.timer <<EOF
[Unit]
Description=Weekly reboot window ($ROLE, $DAY 05:30 UTC)

[Timer]
OnCalendar=$DAY *-*-* 05:30:00 UTC
RandomizedDelaySec=600
Persistent=false

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now godseye-reboot-window.timer
fi

echo "== verification (what is actually in effect)"
unattended-upgrade --dry-run -d 2>&1 | grep -E "Allowed origins|blacklist|No packages found|Packages that will be upgraded|Checking:" | head -20 || true
echo "-- apt-config"
apt-config dump | grep -E 'Unattended-Upgrade::(Automatic-Reboot|Package-Blacklist)|Periodic::(Update-Package-Lists|Unattended-Upgrade)' | head -20
echo "-- timers"
systemctl list-timers 'apt-daily*' 'godseye-reboot*' --no-pager | head -8
echo "-- journald"
journalctl --disk-usage
echo "-- status"
/usr/local/sbin/godseye-update-status
echo "H03_DONE role=$ROLE"
