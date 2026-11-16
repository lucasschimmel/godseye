#!/usr/bin/env bash
# p13-b2-retention-check.sh - read-only retention and orphan check for the Backblaze repository (root, godseye-pro).
#
# Reports, without printing any secret:
#   - per top-level prefix: keys, stored versions, bytes (all versions, hidden ones included);
#   - hidden-version overhead: versions beyond keys mean deleted objects still occupy storage because the
#     bucket has no "keep only the last version" lifecycle rule (the application key may not read or set
#     lifecycle rules: that is a Backblaze console step, see the ledger);
#   - control stanza: number of full backups must be <= 2 (repo1-retention-full=2);
#   - orphan cell prefixes: any cells/<uuid>/ without a configuration directory in /etc/godseye/pg.
# Exit 0 when every check passes, 1 otherwise. Usage: p13-b2-retention-check.sh [path to p13-b2-prefix-tool.mjs]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TOOL="${1:-$HERE/p13-b2-prefix-tool.mjs}"
status=0

set -a
# shellcheck disable=SC1091
. /etc/godseye/pg/b2.env
set +a

echo "== storage per prefix (keys / stored versions / bytes)"
node "$TOOL" usage
overhead="$(node "$TOOL" usage | awk '
  /^[a-z]/ { match($0, /"keys":[0-9]+/); k = substr($0, RSTART + 7, RLENGTH - 7);
             match($0, /"versions":[0-9]+/); v = substr($0, RSTART + 11, RLENGTH - 11);
             if (v > k) over += v - k }
  END { print over + 0 }')"
echo "hidden or superseded versions: $overhead"

echo "== control stanza full backups (retention 2)"
fulls="$(runuser -u postgres -- pgbackrest --stanza=main info --output=json |
  jq '[.[0].backup[] | select(.type=="full")] | length')"
echo "control fulls: $fulls"
[ "$fulls" -le 2 ] || {
  echo "FAIL: more than two full backups kept for the control stanza" >&2
  status=1
}
runuser -u postgres -- pgbackrest --stanza=main check >/dev/null 2>&1 \
  && echo "control stanza check: pass" \
  || {
    echo "FAIL: control stanza check" >&2
    status=1
  }

echo "== orphan cell prefixes"
for p in $(node "$TOOL" prefixes cells/); do
  id="${p#cells/}"
  id="${id%/}"
  if [ ! -d "/etc/godseye/pg/$id" ]; then
    echo "ORPHAN: $p (no configuration directory)"
    status=1
  fi
done
[ "$status" -ne 0 ] || echo "RETENTION_CHECK_PASS"
exit "$status"
