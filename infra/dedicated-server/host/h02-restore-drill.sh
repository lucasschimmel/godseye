#!/usr/bin/env bash
# h02-restore-drill.sh - prove a vzdump archive restores and boots, without touching production.
#
#   bash h02-restore-drill.sh [SOURCE_VMID]     (default 200 = godseye-games)
#
# The newest archive of SOURCE_VMID is restored to the scratch VMID (9000 + SOURCE_VMID),
# re-created with a NEW MAC, attached to a throwaway bridge that has no uplink, no IP and
# no route (so it cannot answer on or reach any production network), booted with reduced
# memory, checked through the guest agent and destroyed again. A trap destroys the scratch
# VM and the bridge on any exit path. Production VMs and bridges are never modified.
set -euo pipefail

SRC="${1:-200}"
DRILL="$((9000 + SRC))"
BR="vmbr99"
STORE="${GODSEYE_RESTORE_STORAGE:-local-zfs}"
DUMPS="${GODSEYE_VZDUMP_DIR:-/rpool/backup/vzdump/dump}"

case "$SRC" in 100 | 200 | 300) ;; *)
  echo "source must be 100, 200 or 300" >&2
  exit 64
  ;;
esac
if qm status "$DRILL" >/dev/null 2>&1; then
  echo "scratch VMID $DRILL already exists; refusing to continue" >&2
  exit 1
fi

ARCHIVE="$(ls -1t "$DUMPS"/vzdump-qemu-"$SRC"-*.vma.zst | head -n 1)"
echo "ARCHIVE=$(basename "$ARCHIVE") bytes=$(stat -c %s "$ARCHIVE")"

cleanup() {
  set +e
  # RESTORING is set only after the pre-flight proved $DRILL did not exist, so this can
  # never destroy a pre-existing VM, whatever name the archive's config carried.
  if [ "${RESTORING:-0}" = 1 ] && qm config "$DRILL" >/dev/null 2>&1; then
    qm stop "$DRILL" --skiplock 1 >/dev/null 2>&1
    qm destroy "$DRILL" --purge 1 --destroy-unreferenced-disks 1 >/dev/null 2>&1
    echo "CLEANUP: scratch VM $DRILL destroyed"
  fi
  if ip link show "$BR" >/dev/null 2>&1; then
    ip link del "$BR"
    echo "CLEANUP: bridge $BR removed"
  fi
}
trap cleanup EXIT

echo "== isolated bridge (no uplink, no address)"
ip link add "$BR" type bridge
ip link set "$BR" up

echo "== restore to new VMID $DRILL with a new MAC"
T0="$(date +%s)"
RESTORING=1
qmrestore "$ARCHIVE" "$DRILL" --storage "$STORE" --unique 1 >/dev/null
echo "RESTORE_SECONDS=$(($(date +%s) - T0))"
qm set "$DRILL" --name "restore-drill-$SRC" --net0 "virtio,bridge=$BR" --onboot 0 \
  --memory 2048 --balloon 0 >/dev/null

echo "== isolation proof"
qm config "$DRILL" | grep -E '^(name|net0|onboot|memory):'
bridge link show master "$BR" || true
ip -br addr show "$BR"
if [ -n "$(ip route show dev "$BR")" ]; then
  echo "FAIL: routes exist on $BR" >&2
  exit 1
fi
echo "ISOLATED_OK"

echo "== boot check"
qm start "$DRILL"
OK=0
for _ in $(seq 1 60); do
  if qm agent "$DRILL" ping >/dev/null 2>&1; then
    OK=1
    break
  fi
  sleep 5
done
if [ "$OK" -ne 1 ]; then
  echo "FAIL: guest agent did not answer within 300 s" >&2
  exit 1
fi
echo "GUEST_AGENT_OK"
qm guest exec "$DRILL" -- /bin/sh -c 'hostname; uname -r; uptime -p; df -h / | tail -1; systemctl is-system-running; ls /var/backups 2>/dev/null | head -5' |
  python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("out-data","")); print("guest_exit", d.get("exitcode"))'
echo "RESTORE_DRILL_PASS source=$SRC scratch=$DRILL"
