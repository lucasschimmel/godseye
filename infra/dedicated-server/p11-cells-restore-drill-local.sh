#!/usr/bin/env bash
# P11: offline restore drill with a throwaway LOCAL repository, for use when the off-host repository is
# unavailable (for example the object-store daily transaction cap is exhausted). It proves the same
# restore mechanics as p11-cells-restore-drill.sh (pgBackRest restore into a NEW quota-bound allocation,
# throwaway server, row-level comparison) without WAL replay from the off-host archive.
# The SOURCE CELL IS STOPPED for the duration (clean shutdown, then an offline backup) and started again.
# Use only on disposable cells. Usage (root):
#   p11-cells-restore-drill-local.sh <source-allocation> <database> <table> <expected-rows> <expected-md5>
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
BIN="$(jq -r .pgBackRestExecutable "${HOST}")"
PGBIN="/usr/lib/postgresql/18/bin"
DEST="$(cat /proc/sys/kernel/random/uuid)"
SUFFIX="${SRC//-/}"
CONF="/etc/godseye/pg/${SRC}"
WORK="/var/lib/godseye/drill-${DEST}"
SOCK="/run/godseye-pg/drill-${DEST}"
PORT=55998
SRC_STARTED=0
cleanup() {
  runuser -u postgres -- "${PGBIN}/pg_ctl" -D "${MOUNT}/${DEST}/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "${SOCK}" "${WORK}"
  "${HELPER[@]}" destroy "${DEST}" >/dev/null 2>&1 || true
  if [ "${SRC_STARTED}" = 0 ]; then "${HELPER[@]}" unit "${SRC}" start >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

install -d -m 0700 -o postgres -g postgres "${WORK}" "${WORK}/repo" "${WORK}/lock" "${WORK}/log"
cat >"${WORK}/pgbackrest.conf" <<EOF
[global]
repo1-path=${WORK}/repo
lock-path=${WORK}/lock
log-path=${WORK}/log
log-level-file=off
log-level-console=warn
archive-check=n
[drill]
pg1-path=${MOUNT}/${SRC}/data
EOF
chown postgres:postgres "${WORK}/pgbackrest.conf"
PGBR=(runuser -u postgres -- "${BIN}" "--config=${WORK}/pgbackrest.conf" --stanza=drill)

echo "[drill-local] stopping the disposable source cell ${SRC} for a consistent offline backup"
"${HELPER[@]}" unit "${SRC}" stop
"${PGBR[@]}" --no-online stanza-create
"${PGBR[@]}" --no-online --force --type=full backup
LABEL="$("${PGBR[@]}" --output=json info | jq -r '.[0].backup | last | .label')"
echo "[drill-local] backup ${LABEL} taken; restarting the source cell"
"${HELPER[@]}" unit "${SRC}" start
SRC_STARTED=1

DATA_GIB="$(grep '^QUOTA_DATA_GIB=' "${CONF}/cell.env" | cut -d= -f2)"
WAL_GIB="$(grep '^QUOTA_WAL_GIB=' "${CONF}/cell.env" | cut -d= -f2)"
"${HELPER[@]}" storage-create "${DEST}" "${DATA_GIB}" "${WAL_GIB}" 0
"${HELPER[@]}" storage-empty "${DEST}" >/dev/null
START="$(date +%s)"
"${PGBR[@]}" "--set=${LABEL}" "--pg1-path=${MOUNT}/${DEST}/data" "--link-map=pg_wal=${MOUNT}/${DEST}/wal" \
  --archive-mode=off restore
echo "[drill-local] restore finished in $(($(date +%s) - START))s into ${MOUNT}/${DEST} (quota-bound)"
xfs_quota -x -c 'report -p -b -h' "${MOUNT}" | grep -E "pg(data|wal)-${DEST//-/}" || true

install -d -m 0700 -o postgres -g postgres "${SOCK}"
runuser -u postgres -- "${PGBIN}/pg_ctl" -D "${MOUNT}/${DEST}/data" -w -t 300 \
  -o "-p ${PORT} -c listen_addresses= -c unix_socket_directories=${SOCK} -c archive_mode=off -c archive_command=/bin/true -c max_connections=64 -c shared_buffers=64MB" \
  -l "${SOCK}/pg.log" start >/dev/null || { tail -25 "${SOCK}/pg.log" >&2; exit 3; }
export PGPASSWORD
PGPASSWORD="$(tr -d '\n' <"${CONF}/admin.pass")"
PSQL=("${PGBIN}/psql" -X -At -h "${SOCK}" -p "${PORT}" -U "g_${SUFFIX}_admin")
LOOKUP="SELECT format('%I.%I', schemaname, tablename) FROM pg_tables WHERE tablename = '${TABLE}' LIMIT 1"
QUALIFIED="$("${PSQL[@]}" -d "${DB}" -c "${LOOKUP}")"
[ -n "${QUALIFIED}" ] || { echo "table ${TABLE} not found in the restored database" >&2; exit 4; }
GOT="$("${PSQL[@]}" -d "${DB}" -c "SELECT count(*)::text || ' ' || coalesce(md5(string_agg(id || marker || payload, ',' ORDER BY id)), '') FROM ${QUALIFIED}")"
echo "[drill-local] restored: ${GOT}"
echo "[drill-local] expected: ${EXPECT_ROWS} ${EXPECT_MD5}"
if [ "${GOT}" = "${EXPECT_ROWS} ${EXPECT_MD5}" ]; then
  echo "[drill-local] RESULT PASS: row-level verification matches the source"
else
  echo "[drill-local] RESULT FAIL: restored data differs from the source" >&2
  exit 2
fi
