#!/usr/bin/env bash
# h13-offhost-restore-drill.sh - restore drill from the REAL Backblaze restic repository into a scratch location.
#
# Run as root on godseye-wg. Credentials come from /etc/godseye (never printed). Steps:
#   1. restore the newest host-config snapshot, verify its sha256 sidecar and list the PVE config entries;
#   2. restore the newest vzdump archive of one VM (default 200, the smallest useful one), compare its sha256
#      with the local archive when that still exists, and test the zstd stream end to end;
#   3. delete the scratch directory and record /var/lib/godseye/status/offhost-restore-drill.json.
# Download volume is roughly the size of the chosen archive, so mind the Backblaze daily download cap.
# Usage: h13-offhost-restore-drill.sh [vmid]
set -euo pipefail
umask 077

VMID="${1:-200}"
CONF=/etc/godseye
STATUS=/var/lib/godseye/status
VZDUMP_DIR="${GODSEYE_VZDUMP_DIR:-/rpool/backup/vzdump/dump}"
SCRATCH="$(mktemp -d /var/tmp/godseye-restore-drill.XXXXXX)"
trap 'rm -rf "$SCRATCH"' EXIT

set -a
# shellcheck disable=SC1091
. "$CONF/offhost-backup.env"
set +a
export RESTIC_PASSWORD_FILE="$CONF/restic-password"
export RESTIC_CACHE_DIR="${RESTIC_CACHE_DIR:-/var/cache/godseye-restic}"

record() {
  printf '{"ts":"%s","result":"%s","detail":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" \
    >"$STATUS/offhost-restore-drill.json.tmp"
  chmod 644 "$STATUS/offhost-restore-drill.json.tmp"
  mv "$STATUS/offhost-restore-drill.json.tmp" "$STATUS/offhost-restore-drill.json"
}
fail() {
  record "fail" "$1"
  echo "RESTORE_DRILL_FAIL: $1" >&2
  exit 1
}

restic snapshots --compact

echo "== 1. host-config snapshot"
restic restore latest --tag host-config --target "$SCRATCH/cfg" --quiet
ARCH="$(find "$SCRATCH/cfg" -name 'host-config-*.tar.zst' | head -n 1)"
[ -n "$ARCH" ] || fail "no host-config archive in the snapshot"
(cd "$(dirname "$ARCH")" && sha256sum -c "$(basename "$ARCH").sha256") || fail "host-config checksum mismatch"
ENTRIES="$(tar --zstd -tf "$ARCH" | grep -c '^etc/pve/' || true)"
[ "$ENTRIES" -gt 0 ] || fail "restored host-config has no PVE entries"
echo "host-config archive restored, $ENTRIES PVE config entries"

echo "== 2. vzdump archive of VM $VMID"
START="$(date +%s)"
restic restore latest --tag vzdump --include "*vzdump-qemu-${VMID}-*.vma.zst" --target "$SCRATCH/vm" --quiet
VMA="$(find "$SCRATCH/vm" -name "vzdump-qemu-${VMID}-*.vma.zst" | head -n 1)"
[ -n "$VMA" ] || fail "no archive for VM $VMID in the snapshot"
SECONDS_TAKEN="$(($(date +%s) - START))"
SIZE="$(stat -c %s "$VMA")"
zstd -t -q "$VMA" || fail "zstd stream test failed for VM $VMID"
LOCAL="$VZDUMP_DIR/$(basename "$VMA")"
if [ -f "$LOCAL" ]; then
  [ "$(sha256sum <"$VMA" | cut -d' ' -f1)" = "$(sha256sum <"$LOCAL" | cut -d' ' -f1)" ] \
    || fail "restored archive differs from the local archive"
  COMPARED="identical to the local archive"
else
  COMPARED="local archive already rotated, stream test only"
fi
echo "VM $VMID archive restored: $SIZE bytes in ${SECONDS_TAKEN}s, $COMPARED"

record "pass" "host-config ($ENTRIES PVE entries) and VM $VMID archive ($SIZE bytes, ${SECONDS_TAKEN}s) restored from B2; $COMPARED"
echo "OFFHOST_RESTORE_DRILL_PASS"
