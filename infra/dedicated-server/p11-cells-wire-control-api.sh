#!/usr/bin/env bash
# P11: wires the per-cell PostgreSQL providers into the control API (one controlled restart).
# Root-only, idempotent, reversible. Steps: back up the service environment, write the private cell
# binding (0600, owned by the service user), add GODSEYE_PG_CELLS_FILE, restart once, verify health and
# the provider log line; on any failure the previous environment is restored and the service restarted.
#
# The installed control API build must already contain the helper-socket cell providers (a build of
# develop at or after the cells-deploy change); an older build cannot parse the binding and is refused here.
set -euo pipefail

ENV_FILE=/etc/godseye/control-api.env
BINDING=/etc/godseye/pg-cells.json
SECRETS=/var/lib/godseye/cells-secrets
SERVICE=godseye-control-api.service
HEALTH_URL="${GODSEYE_HEALTH_URL:-http://127.0.0.1:4301/api/v1/health}"
BACKUP="${ENV_FILE}.bak-pre-cells-$(date -u +%Y%m%dT%H%M%SZ)"

grep -q 'Private PostgreSQL cell providers are configured' /opt/godseye/dist/control-api/server.mjs \
  || { echo "installed control API build does not contain the helper-socket cell providers" >&2; exit 70; }
[ -f /etc/godseye/pg/host.json ] || { echo "run p10-install-pg-cells.sh first" >&2; exit 71; }
systemctl is-active godseye-cell-helper.socket >/dev/null || { echo "cell helper socket is not active" >&2; exit 72; }

cp -p "${ENV_FILE}" "${BACKUP}"
echo "[p11] environment backed up to ${BACKUP}"
install -d -m 0700 -o godseye -g godseye "${SECRETS}"
TARGET_ID="$(jq -r '.targetId // empty' "${BINDING}" 2>/dev/null || true)"
[ -n "${TARGET_ID}" ] || TARGET_ID="$(cat /proc/sys/kernel/random/uuid)"
jq -n --arg target "${TARGET_ID}" --arg secrets "${SECRETS}" --slurpfile host /etc/godseye/pg/host.json \
  '{providerId:"cells-xfs-pg18", targetId:$target, generation:"g1", secretsDirectory:$secrets, host:$host[0]}' \
  >"${BINDING}.new"
chown godseye:godseye "${BINDING}.new"
chmod 0600 "${BINDING}.new"
mv -f "${BINDING}.new" "${BINDING}"
if grep -q '^GODSEYE_PG_CELLS_FILE=' "${ENV_FILE}"; then
  sed -i "s#^GODSEYE_PG_CELLS_FILE=.*#GODSEYE_PG_CELLS_FILE=${BINDING}#" "${ENV_FILE}"
else
  printf 'GODSEYE_PG_CELLS_FILE=%s\n' "${BINDING}" >>"${ENV_FILE}"
fi

rollback() {
  echo "[p11] verification failed; restoring ${BACKUP}" >&2
  cp -p "${BACKUP}" "${ENV_FILE}"
  rm -f "${BINDING}"
  systemctl restart "${SERVICE}"
  exit 1
}
SINCE="$(date -u '+%Y-%m-%d %H:%M:%S')"
systemctl restart "${SERVICE}"
for _ in $(seq 1 40); do
  curl -fsS --max-time 3 "${HEALTH_URL}" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS --max-time 3 "${HEALTH_URL}" | jq -c . || rollback
journalctl -u "${SERVICE}" --since "${SINCE}" --no-pager -o cat | grep -q 'Private PostgreSQL cell providers are configured' || rollback
systemctl is-active "${SERVICE}" >/dev/null || rollback
echo "[p11] control API restarted once; cell providers configured; rollback copy: ${BACKUP}"
