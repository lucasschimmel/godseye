#!/usr/bin/env bash
# Executed on godseye-pro on 2026-11-15 (ledger entry 016). Runs as ROOT before the edge container starts (called by
# godseye-edge-env.service, see p10-install-edge-caddy.sh). Logs in to OpenBao with the AppRole
# `godseye-edge` (files written by p10-store-edge-credentials.sh) and writes the OVH DNS-01
# credentials to ${ENV_FILE} (tmpfs under /run, 0600 root) for `docker run --env-file`.
#
# Exit codes: 0 rendered; 75 (EX_TEMPFAIL) OpenBao sealed/unreachable - retry after unsealing;
# 1 any other failure. The secret never appears in argv, stdout or the repository.
set -euo pipefail
umask 077

BAO_ADDR="${GODSEYE_BAO_ADDR:-https://127.0.0.1:8200}"
BAO_CACERT="${GODSEYE_BAO_CACERT:-/etc/openbao/bao.crt}"
MOUNT="${GODSEYE_BAO_MOUNT:-godseye}"
APPROLE_DIR="${GODSEYE_EDGE_APPROLE_DIR:-/etc/godseye/edge-approle}"
ENV_FILE="${GODSEYE_EDGE_ENV_FILE:-/run/godseye/edge.env}"
EX_TEMPFAIL=75

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required." >&2; exit 1; }
for f in role_id secret_id; do
  [ -f "${APPROLE_DIR}/${f}" ] || { echo "Missing ${APPROLE_DIR}/${f}; run p10-store-edge-credentials.sh first." >&2; exit 1; }
  [ "$(stat -c '%a %U' "${APPROLE_DIR}/${f}")" = "600 root" ] || { echo "${APPROLE_DIR}/${f} must be 0600 root." >&2; exit 1; }
done

unavailable() {
  echo "OpenBao is sealed or unreachable at ${BAO_ADDR}; the edge env was NOT rendered. Unseal OpenBao, then restart godseye-edge-env.service." >&2
  exit "$EX_TEMPFAIL"
}

# 200 = active, 429 = unsealed standby. 503 sealed, 501 uninitialized, 000 unreachable.
HEALTH="$(curl -sS -o /dev/null -w '%{http_code}' --cacert "$BAO_CACERT" "${BAO_ADDR}/v1/sys/health" 2>/dev/null || true)"
case "$HEALTH" in 200 | 429) ;; *) unavailable ;; esac

TOKEN="$(jq -n --rawfile r "${APPROLE_DIR}/role_id" --rawfile s "${APPROLE_DIR}/secret_id" '{role_id:$r,secret_id:$s}' \
  | curl -fsS --cacert "$BAO_CACERT" --data @- "${BAO_ADDR}/v1/auth/approle/login" | jq -r '.auth.client_token')" || unavailable
{ [ -n "$TOKEN" ] && [ "$TOKEN" != null ]; } || { echo "AppRole login failed." >&2; exit 1; }

# The token travels through a process-substitution curl config, never argv.
SECRET_JSON="$(curl -fsS --cacert "$BAO_CACERT" -K <(printf 'header = "X-Vault-Token: %s"\n' "$TOKEN") \
  "${BAO_ADDR}/v1/${MOUNT}/data/edge/ovh")" || { echo "Reading ${MOUNT}/edge/ovh failed." >&2; exit 1; }
unset TOKEN

install -d -m 0700 -o root -g root "$(dirname "$ENV_FILE")"
TMP_FILE="$(mktemp "${ENV_FILE}.XXXXXX")"
trap 'rm -f "$TMP_FILE"' EXIT
# docker --env-file takes KEY=value lines verbatim (no quoting); refuse values containing newlines.
printf '%s' "$SECRET_JSON" | jq -er '
  .data.data as $d
  | [$d.application_key, $d.application_secret, $d.consumer_key]
  | if all(.[]; type == "string" and length > 0 and (test("[\\n\\r]") | not))
    then "OVH_APPLICATION_KEY=\($d.application_key)\nOVH_APPLICATION_SECRET=\($d.application_secret)\nOVH_CONSUMER_KEY=\($d.consumer_key)"
    else error("invalid OVH credential values") end' >"$TMP_FILE"
unset SECRET_JSON
chmod 0600 "$TMP_FILE"
mv -f "$TMP_FILE" "$ENV_FILE"
trap - EXIT
echo "Rendered ${ENV_FILE} (0600, tmpfs)."
