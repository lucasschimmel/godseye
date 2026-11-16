#!/usr/bin/env bash
# P12: apply CPU and memory ceilings to one cell's units (root on godseye-pro). The control API does
# not set them yet (docs/development/dedicated-cells.md, remaining gaps), so the owner or the
# provisioning step runs this after a cell exists. Persistent (systemd --runtime is NOT used), so the
# values survive a reboot; reverting = `systemctl revert <unit>`.
#   p12-cell-ceilings.sh <allocation-uuid> <cpu-percent> <memory-max e.g. 1G> [tasks-max]
#   p12-cell-ceilings.sh --unit <unit-name> <cpu-percent> <memory-max> [tasks-max]   (any single unit)
# cpu-percent 100 = one full core. MemoryHigh is set to 90% of MemoryMax so reclaim starts before
# the OOM killer; swap is disallowed for the cell so a limit means RAM.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
if [ "${1:-}" = "--unit" ]; then
  UNITS=("${2:?unit name}"); shift 2
else
  ALLOCATION="${1:?allocation uuid}"; shift
  [[ "$ALLOCATION" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "invalid allocation" >&2; exit 64; }
  UNITS=("godseye-pg@${ALLOCATION}.service")
  systemctl cat "godseye-redis@${ALLOCATION}.service" >/dev/null 2>&1 && UNITS+=("godseye-redis@${ALLOCATION}.service")
fi
CPU="${1:?cpu percent}"
MEM="${2:?memory max (for example 1G)}"
TASKS="${3:-512}"
[[ "$CPU" =~ ^[0-9]+$ && "$CPU" -ge 10 && "$CPU" -le 1600 ]] || { echo "cpu percent must be 10-1600" >&2; exit 64; }
[[ "$MEM" =~ ^[0-9]+[MG]$ ]] || { echo "memory must look like 512M or 2G" >&2; exit 64; }
[[ "$TASKS" =~ ^[0-9]+$ ]] || { echo "invalid tasks" >&2; exit 64; }
case "$MEM" in
  *G) HIGH="$(( ${MEM%G} * 1024 * 9 / 10 ))M" ;;
  *M) HIGH="$(( ${MEM%M} * 9 / 10 ))M" ;;
esac

for unit in "${UNITS[@]}"; do
  systemctl set-property "$unit" CPUQuota="${CPU}%" MemoryMax="$MEM" MemoryHigh="$HIGH" MemorySwapMax=0 TasksMax="$TASKS"
  echo "[ceilings] $unit: $(systemctl show "$unit" -p CPUQuotaPerSecUSec -p MemoryMax -p MemoryHigh -p MemorySwapMax -p TasksMax | tr '\n' ' ')"
done
