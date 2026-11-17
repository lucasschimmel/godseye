#!/usr/bin/env bash
# P12 - OWNER-RUN, interactive, root on godseye-pro: `ssh -t godseye-pro sudo ./p12-openbao-owner-setup.sh <templates dir>`.
# Creates two least-privilege AppRoles in OpenBao and writes their credentials to root-only files:
#   godseye-bindings-render  read-only on godseye/data/bindings/*  -> /etc/godseye/openbao-role-id + openbao-secret-id
#                            (used only by godseye-bindings-render.service; replaces reuse of the control API role)
#   godseye-snapshot         read on sys/storage/raft/snapshot       -> /etc/godseye/bao-snapshot-approle/
# The only input is a short-lived OpenBao admin token typed at a silent prompt (generate it with two
# unseal shares: `bao operator generate-root`, then revoke it afterwards). Nothing enters argv, the
# environment of another process, shell history or the repository. Re-running rotates both secret ids.
set -euo pipefail
umask 077

TEMPLATES="${1:?directory containing godseye-bindings-render.hcl and godseye-raft-snapshot.hcl}"
BAO_ADDR="${GODSEYE_BAO_ADDR:-https://127.0.0.1:8200}"
BAO_CACERT="${GODSEYE_BAO_CACERT:-/etc/openbao/bao.crt}"
[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
[ -t 0 ] || [ "${GODSEYE_NONINTERACTIVE:-}" = 1 ] || { echo "Interactive terminal required (ssh -t), or GODSEYE_NONINTERACTIVE=1 with the secrets on stdin." >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required." >&2; exit 1; }
trap 'unset BAO_ADMIN_TOKEN ROLE_ID SECRET_ID' EXIT

# The owner session script (p13-openbao-owner-session.sh) hands the token over in BAO_ADMIN_TOKEN so it is typed once.
if [ -z "${BAO_ADMIN_TOKEN:-}" ]; then
  read -rs -p "Short-lived OpenBao admin token: " BAO_ADMIN_TOKEN
  echo >&2
fi
[ -n "$BAO_ADMIN_TOKEN" ] || { echo "Empty value refused." >&2; exit 1; }

bao_get() { curl -fsS --cacert "$BAO_CACERT" -K <(printf 'header = "X-Vault-Token: %s"\n' "$BAO_ADMIN_TOKEN") "${BAO_ADDR}/v1/$1"; }
bao_send() { curl -fsS --cacert "$BAO_CACERT" -K <(printf 'header = "X-Vault-Token: %s"\n' "$BAO_ADMIN_TOKEN") -X "$1" --data @- "${BAO_ADDR}/v1/$2"; }

curl -fsS --cacert "$BAO_CACERT" "${BAO_ADDR}/v1/sys/seal-status" | jq -e '.sealed == false' >/dev/null \
  || { echo "OpenBao is sealed or unreachable; unseal it first." >&2; exit 75; }

bao_get sys/auth | jq -e 'has("approle/")' >/dev/null || echo '{"type":"approle"}' | bao_send POST sys/auth/approle >/dev/null

provision() { # provision <role> <policy> <policy file> <credential dir or '-'>
  jq -n --rawfile p "$3" '{policy:$p}' | bao_send PUT "sys/policies/acl/$2" >/dev/null
  jq -n --arg p "$2" '{token_policies:[$p],token_ttl:"5m",token_max_ttl:"10m",secret_id_bound_cidrs:["127.0.0.1/32"],token_bound_cidrs:["127.0.0.1/32"]}' \
    | bao_send POST "auth/approle/role/$1" >/dev/null
  ROLE_ID="$(bao_get "auth/approle/role/$1/role-id" | jq -r '.data.role_id')"
  SECRET_ID="$(echo '{}' | bao_send POST "auth/approle/role/$1/secret-id" | jq -r '.data.secret_id')"
  { [ -n "$ROLE_ID" ] && [ "$ROLE_ID" != null ] && [ -n "$SECRET_ID" ] && [ "$SECRET_ID" != null ]; } || { echo "AppRole credentials missing for $1" >&2; exit 1; }
}

provision godseye-bindings-render godseye-bindings-render "${TEMPLATES}/godseye-bindings-render.hcl" -
printf '%s' "$ROLE_ID" >/etc/godseye/openbao-role-id.new
printf '%s' "$SECRET_ID" >/etc/godseye/openbao-secret-id.new
chown root:godseye /etc/godseye/openbao-role-id.new; chmod 0640 /etc/godseye/openbao-role-id.new
chown root:root /etc/godseye/openbao-secret-id.new; chmod 0600 /etc/godseye/openbao-secret-id.new
mv -f /etc/godseye/openbao-role-id.new /etc/godseye/openbao-role-id
mv -f /etc/godseye/openbao-secret-id.new /etc/godseye/openbao-secret-id

provision godseye-snapshot godseye-raft-snapshot "${TEMPLATES}/godseye-raft-snapshot.hcl" -
install -d -m 0700 -o root -g root /etc/godseye/bao-snapshot-approle
printf '%s' "$ROLE_ID" >/etc/godseye/bao-snapshot-approle/role_id
printf '%s' "$SECRET_ID" >/etc/godseye/bao-snapshot-approle/secret_id
chmod 0600 /etc/godseye/bao-snapshot-approle/role_id /etc/godseye/bao-snapshot-approle/secret_id

systemctl restart godseye-bindings-render.service || echo "renderer restart failed (check journalctl -u godseye-bindings-render)" >&2
echo "OPENBAO_ROLES_READY. Now: revoke the admin token, then run p12-install-snapshots.sh to enable the snapshot timer."
