#!/usr/bin/env bash
# TEMPLATE - reviewed but NOT executed. Run by the OWNER interactively on godseye-pro as root
# (`ssh -t <host> sudo ./p10-store-edge-credentials.sh`). It is the only place the OVH values and a
# short-lived OpenBao admin token are typed. Nothing is accepted from argv, the environment or a
# file; prompts are silent (read -s); values never reach argv, shell history or the repository.
#
# Effects (OpenBao KV v2 mount `godseye`):
#   * writes godseye/edge/ovh = {application_key, application_secret, consumer_key}
#   * policy `godseye-edge-read`: read on godseye/data/edge/ovh and nothing else
#   * AppRole `godseye-edge`: that policy only, token TTL 5m (max 10m), secret_id and tokens bound
#     to 127.0.0.1/32; role_id/secret_id are written ONLY to ${APPROLE_DIR} (0600 root)
# Afterwards revoke the admin token. Re-running rotates the OVH values and the AppRole secret_id.
set -euo pipefail
umask 077

BAO_ADDR="${GODSEYE_BAO_ADDR:-https://127.0.0.1:8200}"
BAO_CACERT="${GODSEYE_BAO_CACERT:-/etc/openbao/bao.crt}"
MOUNT="${GODSEYE_BAO_MOUNT:-godseye}"
SECRET_PATH="edge/ovh"
POLICY="godseye-edge-read"
ROLE="godseye-edge"
APPROLE_DIR="${GODSEYE_EDGE_APPROLE_DIR:-/etc/godseye/edge-approle}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
[ -t 0 ] || { echo "Interactive terminal required (ssh -t)." >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required." >&2; exit 1; }

cleanup() { unset OVH_APPLICATION_KEY OVH_APPLICATION_SECRET OVH_CONSUMER_KEY BAO_ADMIN_TOKEN ROLE_ID SECRET_ID PAYLOAD; }
trap cleanup EXIT

prompt_secret() { # prompt_secret <variable name> <label>
  local value
  read -rs -p "$2: " value
  echo >&2
  [ -n "$value" ] || { echo "Empty value refused." >&2; exit 1; }
  printf -v "$1" '%s' "$value"
}
prompt_secret OVH_APPLICATION_KEY "OVH application key"
prompt_secret OVH_APPLICATION_SECRET "OVH application secret"
prompt_secret OVH_CONSUMER_KEY "OVH consumer key"
prompt_secret BAO_ADMIN_TOKEN "Short-lived OpenBao admin token"

# bao_get <path> / bao_send <METHOD> <path> (JSON body on stdin). The token reaches curl through a
# process-substitution config (printf is a builtin), so it is never in any argv.
bao_get() {
  curl -fsS --cacert "$BAO_CACERT" -K <(printf 'header = "X-Vault-Token: %s"\n' "$BAO_ADMIN_TOKEN") \
    "${BAO_ADDR}/v1/$1"
}
bao_send() {
  curl -fsS --cacert "$BAO_CACERT" -K <(printf 'header = "X-Vault-Token: %s"\n' "$BAO_ADMIN_TOKEN") \
    -X "$1" --data @- "${BAO_ADDR}/v1/$2"
}

curl -fsS --cacert "$BAO_CACERT" "${BAO_ADDR}/v1/sys/seal-status" | jq -e '.sealed == false' >/dev/null \
  || { echo "OpenBao is sealed or unreachable; unseal it first." >&2; exit 75; }

# 1. Secret (KV v2).
jq -n --arg k "$OVH_APPLICATION_KEY" --arg s "$OVH_APPLICATION_SECRET" --arg c "$OVH_CONSUMER_KEY" \
  '{data:{application_key:$k,application_secret:$s,consumer_key:$c}}' \
  | bao_send POST "${MOUNT}/data/${SECRET_PATH}" >/dev/null

# 2. Least-privilege policy: read this single path.
jq -n --arg p "path \"${MOUNT}/data/${SECRET_PATH}\" { capabilities = [\"read\"] }" '{policy:$p}' \
  | bao_send PUT "sys/policies/acl/${POLICY}" >/dev/null

# 3. AppRole auth (enabled if missing), bound to that policy and to loopback.
bao_get "sys/auth" | jq -e 'has("approle/")' >/dev/null \
  || echo '{"type":"approle"}' | bao_send POST "sys/auth/approle" >/dev/null
jq -n --arg p "$POLICY" '{token_policies:[$p],token_ttl:"5m",token_max_ttl:"10m",secret_id_bound_cidrs:["127.0.0.1/32"],token_bound_cidrs:["127.0.0.1/32"]}' \
  | bao_send POST "auth/approle/role/${ROLE}" >/dev/null
ROLE_ID="$(bao_get "auth/approle/role/${ROLE}/role-id" | jq -r '.data.role_id')"
SECRET_ID="$(echo '{}' | bao_send POST "auth/approle/role/${ROLE}/secret-id" | jq -r '.data.secret_id')"
{ [ -n "$ROLE_ID" ] && [ "$ROLE_ID" != null ] && [ -n "$SECRET_ID" ] && [ "$SECRET_ID" != null ]; } \
  || { echo "AppRole credentials missing." >&2; exit 1; }

install -d -m 0700 -o root -g root "$APPROLE_DIR"
printf '%s' "$ROLE_ID" >"${APPROLE_DIR}/role_id.tmp"
printf '%s' "$SECRET_ID" >"${APPROLE_DIR}/secret_id.tmp"
chmod 0600 "${APPROLE_DIR}/role_id.tmp" "${APPROLE_DIR}/secret_id.tmp"
mv -f "${APPROLE_DIR}/role_id.tmp" "${APPROLE_DIR}/role_id"
mv -f "${APPROLE_DIR}/secret_id.tmp" "${APPROLE_DIR}/secret_id"

cleanup
echo "Stored ${MOUNT}/${SECRET_PATH}, policy ${POLICY}, AppRole ${ROLE}; AppRole files in ${APPROLE_DIR} (0600 root)."
echo "Now revoke the admin token you used."
