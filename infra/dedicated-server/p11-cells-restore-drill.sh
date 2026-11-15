#!/usr/bin/env bash
# P11: restore drill for one cell. Restores the newest backup of <source-allocation> from the off-host
# repository into a NEW quota-bound location (a fresh allocation), starts a throwaway PostgreSQL on a
# private socket only (no TCP, archiving off), compares row count and an md5 over all rows with the
# expected values from the source, then removes the drill allocation. Never prints secrets.
# Usage (root): p11-cells-restore-drill.sh <source-allocation> <database> <table> <expected-rows> <expected-md5>
# The restore goes through the same fixed root-helper verb the control plane uses.
set -euo pipefail
SRC="${1:?source allocation required}"
DB="${2:?database required}"
TABLE="${3:?table required}"
EXPECT_ROWS="${4:?expected row count required}"
EXPECT_MD5="${5:?expected md5 required}"
[[ "${SRC}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "invalid allocation" >&2; exit 64; }
[[ "${DB}" =~ ^[a-z0-9_]+$ && "${TABLE}" =~ ^[a-z0-9_]+$ ]] || { echo "invalid identifier" >&2; exit 64; }
HELPER=(/usr/bin/node /usr/local/lib/godseye/cell-helper.mjs)
HOST=/etc/godseye/pg/host.json
MOUNT="$(jq -r .mountRoot "${HOST}")"
PGBIN="/usr/lib/postgresql/18/bin"
DEST="$(cat /proc/sys/kernel/random/uuid)"
SUFFIX="${SRC//-/}"
CONF="/etc/godseye/pg/${SRC}"
SOCK="/run/godseye-pg/drill-${DEST}"
PORT=55999
BASE=("--config=${CONF}/pgbackrest.conf" "--config-include-path=${CONF}/pgbackrest.conf.d"
  "--stanza=g_${SUFFIX}" "--repo=1" "--log-level-console=off" "--log-level-file=off")
cleanup() {
  runuser -u postgres -- "${PGBIN}/pg_ctl" -D "${MOUNT}/${DEST}/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "${SOCK}"
  "${HELPER[@]}" destroy "${DEST}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[drill] newest backup of ${SRC}"
LABEL="$("${HELPER[@]}" pgbackrest "${SRC}" "${BASE[@]}" --output=json info | jq -r '.[0].backup | last | .label')"
[[ "${LABEL}" =~ ^[0-9]{8}-[0-9]{6}F ]] || { echo "no backup found" >&2; exit 1; }
echo "[drill] backup label ${LABEL}; new allocation ${DEST}"
DATA_GIB="$(grep '^QUOTA_DATA_GIB=' "${CONF}/cell.env" | cut -d= -f2)"
WAL_GIB="$(grep '^QUOTA_WAL_GIB=' "${CONF}/cell.env" | cut -d= -f2)"
"${HELPER[@]}" storage-create "${DEST}" "${DATA_GIB}" "${WAL_GIB}" 0
"${HELPER[@]}" storage-empty "${DEST}" >/dev/null
START="$(date +%s)"
"${HELPER[@]}" pgbackrest "${SRC}" "${BASE[@]}" "--set=${LABEL}" "--pg1-path=${MOUNT}/${DEST}/data" \
  "--link-map=pg_wal=${MOUNT}/${DEST}/wal" --archive-mode=off restore
echo "[drill] restore finished in $(($(date +%s) - START))s into ${MOUNT}/${DEST} (quota-bound)"
test -L "${MOUNT}/${DEST}/data/pg_wal" || { echo "WAL link missing" >&2; exit 1; }

echo "[drill] starting a throwaway server (private socket only, archiving off)"
install -d -m 0700 -o postgres -g postgres "${SOCK}"
set -a
# shellcheck disable=SC1091
. /etc/godseye/pg/b2.env
# shellcheck disable=SC1090
. "${CONF}/archive.env"
set +a
export PGPASSWORD
PGPASSWORD="$(tr -d '\n' <"${CONF}/admin.pass")"
runuser -u postgres -- env "PGBACKREST_REPO1_CIPHER_PASS=${PGBACKREST_REPO1_CIPHER_PASS}" \
  "PGBACKREST_REPO1_S3_KEY=${PGBACKREST_REPO1_S3_KEY}" \
  "PGBACKREST_REPO1_S3_KEY_SECRET=${PGBACKREST_REPO1_S3_KEY_SECRET}" \
  "${PGBIN}/pg_ctl" -D "${MOUNT}/${DEST}/data" -w -t 600 \
  -o "-p ${PORT} -c listen_addresses= -c unix_socket_directories=${SOCK} -c archive_mode=off -c archive_command=/bin/true -c max_connections=64 -c shared_buffers=64MB" \
  -l "${SOCK}/pg.log" start >/dev/null || { tail -25 "${SOCK}/pg.log" >&2; exit 3; }
# Connections are accepted as soon as the server is consistent; wait until WAL replay has finished.
for _ in $(seq 1 120); do
  [ "$("${PGBIN}/psql" -X -At -h "${SOCK}" -p "${PORT}" -U "g_${SUFFIX}_admin" -d postgres -c 'SELECT pg_is_in_recovery()')" = f ] && break
  sleep 1
done
# The application roles own a schema of their own; resolve the table without assuming a search path.
LOOKUP="SELECT format('%I.%I', schemaname, tablename) FROM pg_tables WHERE tablename = '${TABLE}' LIMIT 1"
QUALIFIED="$("${PGBIN}/psql" -X -At -h "${SOCK}" -p "${PORT}" -U "g_${SUFFIX}_admin" -d "${DB}" -c "${LOOKUP}")"
[ -n "${QUALIFIED}" ] || { echo "table ${TABLE} not found in the restored database" >&2; exit 4; }
SQL="SELECT count(*)::text || ' ' || coalesce(md5(string_agg(id || marker || payload, ',' ORDER BY id)), '') FROM ${QUALIFIED}"
GOT="$("${PGBIN}/psql" -X -At -h "${SOCK}" -p "${PORT}" -U "g_${SUFFIX}_admin" -d "${DB}" -c "${SQL}")"
IN_RECOVERY="$("${PGBIN}/psql" -X -At -h "${SOCK}" -p "${PORT}" -U "g_${SUFFIX}_admin" -d "${DB}" -c 'SELECT pg_is_in_recovery()')"
echo "[drill] restored: ${GOT}; in_recovery=${IN_RECOVERY}"
echo "[drill] expected: ${EXPECT_ROWS} ${EXPECT_MD5}"
if [ "${GOT}" = "${EXPECT_ROWS} ${EXPECT_MD5}" ]; then
  echo "[drill] RESULT PASS: row-level verification matches the source"
else
  echo "[drill] RESULT FAIL: restored data differs from the source" >&2
  exit 2
fi
