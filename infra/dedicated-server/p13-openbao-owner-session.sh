#!/usr/bin/env bash
# P13 - OWNER-RUN, interactive, root on godseye-pro. One command, one silent prompt:
#   ssh -t godseye-pro "sudo bash /opt/godseye/infra/dedicated-server/p13-openbao-owner-session.sh"
#
# With one OpenBao admin token (typed once at a silent prompt) it:
#   1. creates the two least-privilege AppRoles (p12-openbao-owner-setup.sh);
#   2. gives the control API its own limited identity (p13-openbao-controller-identity.sh identity);
#   3. enables the daily OpenBao raft snapshot timer (p12-install-snapshots.sh);
#   4. revokes the admin token and proves OpenBao now refuses it (revoke-admin).
# The token is revoked even when a step fails. Nothing is printed except step names and results.
set -euo pipefail
umask 077

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BAO_ADDR="${GODSEYE_BAO_ADDR:-https://127.0.0.1:8200}"
BAO_CACERT="${GODSEYE_BAO_CACERT:-/etc/openbao/bao.crt}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
[ -t 0 ] || [ "${GODSEYE_NONINTERACTIVE:-}" = 1 ] || { echo "Interactive terminal required (ssh -t), or GODSEYE_NONINTERACTIVE=1 with the secrets on stdin." >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required." >&2; exit 1; }

curl -fsS --cacert "$BAO_CACERT" "${BAO_ADDR}/v1/sys/seal-status" | jq -e '.sealed == false' >/dev/null \
  || { echo "OpenBao is sealed or unreachable; unseal it first." >&2; exit 75; }

# p13-openbao-recover-admin.sh hands over a freshly generated token in BAO_ADMIN_TOKEN; otherwise ask for one.
if [ -z "${BAO_ADMIN_TOKEN:-}" ]; then
  read -rs -p "OpenBao admin token (the initial root token from your init file): " BAO_ADMIN_TOKEN
  echo >&2
fi
[ -n "$BAO_ADMIN_TOKEN" ] || { echo "Empty value refused." >&2; exit 1; }

lookup_code() { curl -s -o /dev/null -w '%{http_code}' --cacert "$BAO_CACERT" -K <(printf 'header = "X-Vault-Token: %s"\n' "$BAO_ADMIN_TOKEN") "${BAO_ADDR}/v1/auth/token/lookup-self"; }
revoke_token() {
  [ -n "${BAO_ADMIN_TOKEN:-}" ] || return 0
  if [ "$(lookup_code)" = 200 ]; then
    echo '{}' | curl -fsS --cacert "$BAO_CACERT" -K <(printf 'header = "X-Vault-Token: %s"\n' "$BAO_ADMIN_TOKEN") -X POST --data @- "${BAO_ADDR}/v1/auth/token/revoke-self" >/dev/null || true
  fi
  if [ "$(lookup_code)" = 200 ]; then echo "WARNING: the admin token still works; revoke it manually." >&2; else echo "ADMIN_TOKEN_REVOKED_AND_VERIFIED"; fi
  unset BAO_ADMIN_TOKEN
}
trap revoke_token EXIT

[ "$(lookup_code)" = 200 ] || { echo "OpenBao refuses that token (revoked or mistyped). Nothing was changed." >&2; trap - EXIT; unset BAO_ADMIN_TOKEN; exit 1; }
export BAO_ADMIN_TOKEN

echo "== 0/3 stray root tokens =="
# Revoke every OPENBAO root token other than the one in use (for example one left by an interrupted attempt).
OWN_ACCESSOR="$(curl -fsS --cacert "$BAO_CACERT" -K <(printf 'header = "X-Vault-Token: %s"\n' "$BAO_ADMIN_TOKEN") "${BAO_ADDR}/v1/auth/token/lookup-self" | jq -r '.data.accessor')"
STRAY=0
while read -r accessor; do
  [ -n "$accessor" ] && [ "$accessor" != "$OWN_ACCESSOR" ] || continue
  policies="$(printf '{"accessor":"%s"}' "$accessor" | curl -fsS --cacert "$BAO_CACERT" -K <(printf 'header = "X-Vault-Token: %s"\n' "$BAO_ADMIN_TOKEN") -X POST --data @- "${BAO_ADDR}/v1/auth/token/lookup-accessor" 2>/dev/null | jq -r '.data.policies | join(",")' 2>/dev/null || true)"
  if [ "$policies" = root ]; then
    printf '{"accessor":"%s"}' "$accessor" | curl -fsS --cacert "$BAO_CACERT" -K <(printf 'header = "X-Vault-Token: %s"\n' "$BAO_ADMIN_TOKEN") -X POST --data @- "${BAO_ADDR}/v1/auth/token/revoke-accessor" >/dev/null && STRAY=$((STRAY + 1))
  fi
done < <(curl -fsS --cacert "$BAO_CACERT" -K <(printf 'header = "X-Vault-Token: %s"\n' "$BAO_ADMIN_TOKEN") -X LIST "${BAO_ADDR}/v1/auth/token/accessors" | jq -r '.data.keys[]?')
echo "stray root tokens revoked: $STRAY"
echo "== 1/3 AppRoles =="
bash "$DIR/p12-openbao-owner-setup.sh" "$DIR/templates"
echo "== 2/3 Controller identity =="
bash "$DIR/p13-openbao-controller-identity.sh" identity
echo "== 3/3 Raft snapshot timer =="
bash "$DIR/p12-install-snapshots.sh"
echo "OPENBAO_SESSION_DONE"
