#!/usr/bin/env bash
# P13 - OWNER-RUN, interactive, root on godseye-pro. PLAN B when no admin token exists any more:
#   ssh -t godseye-pro "sudo bash /opt/godseye/infra/dedicated-server/p13-openbao-recover-admin.sh"
#
# OpenBao 2.7 only offers `generate-root` through an AUTHENTICATED endpoint, so with every token revoked the
# only way back is the legacy unauthenticated endpoint, which is disabled by default
# (`disable_unauthed_generate_root_endpoints`, listener "tcp"). This script:
#   1. backs up /etc/openbao/openbao.hcl and re-enables that endpoint on the LOOPBACK listener only
#      (the 10.20.1.10 listener keeps the secure default);
#   2. restarts OpenBao (it comes up sealed) and unseals it with two shares typed at silent prompts;
#   3. generates a short-lived root token with the same two shares (one-time-password protected);
#   4. restores the original configuration file;
#   5. hands the token to p13-openbao-owner-session.sh, which does the real work and revokes the token.
# The two shares and the token never reach argv, history, a file or the repository. The platform (edge,
# console, control API) is unavailable between step 2 and the end of the unseal, normally under a minute.
# Note: the running OpenBao process keeps the legacy loopback endpoint enabled until its next restart
# (the file is already restored); the reboot drill closes that, and ledger entry 028 records it.
set -euo pipefail
umask 077

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF=/etc/openbao/openbao.hcl
BACKUP=/etc/openbao/openbao.hcl.bak-recover
BAO_ADDR="${GODSEYE_BAO_ADDR:-https://127.0.0.1:8200}"
BAO_CACERT="${GODSEYE_BAO_CACERT:-/etc/openbao/bao.crt}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
[ -t 0 ] || { echo "Interactive terminal required (ssh -t)." >&2; exit 1; }
for tool in jq python3 curl; do command -v "$tool" >/dev/null || { echo "$tool is required." >&2; exit 1; }; done
[ ! -e "$BACKUP" ] || { echo "A previous backup exists ($BACKUP): restore or remove it first." >&2; exit 1; }

api() { # api <method> <path> [json body from stdin]
  curl -fsS --cacert "$BAO_CACERT" -X "$1" --data @- "${BAO_ADDR}/v1/$2"
}
restored=0
restore_conf() {
  if [ "$restored" = 0 ] && [ -e "$BACKUP" ]; then mv -f "$BACKUP" "$CONF"; restored=1; echo "openbao.hcl restored." >&2; fi
}
cleanup() {
  curl -s -o /dev/null --cacert "$BAO_CACERT" -X DELETE "${BAO_ADDR}/v1/sys/generate-root/attempt" || true
  restore_conf
  unset SHARE1 SHARE2 NONCE OTP ENCODED BAO_ADMIN_TOKEN
}
trap cleanup EXIT

read -rs -p "Unseal share 1: " SHARE1; echo >&2
read -rs -p "Unseal share 2 (a different one): " SHARE2; echo >&2
[ -n "$SHARE1" ] && [ -n "$SHARE2" ] && [ "$SHARE1" != "$SHARE2" ] || { echo "Two different non-empty shares are required." >&2; exit 1; }

echo "== 1/5 enable the legacy endpoint on the loopback listener =="
cp -a "$CONF" "$BACKUP"
grep -q 'disable_unauthed_generate_root_endpoints' "$CONF" && { echo "Option already present; refusing to edit." >&2; exit 1; }
awk '{print} /address[[:space:]]*=[[:space:]]*"127\.0\.0\.1:8200"/ {print "  disable_unauthed_generate_root_endpoints = false"}' "$BACKUP" >"$CONF"
grep -c 'disable_unauthed_generate_root_endpoints = false' "$CONF" | grep -qx 1 || { echo "Config edit did not apply exactly once." >&2; exit 1; }

echo "== 2/5 restart and unseal =="
systemctl restart openbao
for _ in $(seq 1 30); do
  curl -fsS --cacert "$BAO_CACERT" "${BAO_ADDR}/v1/sys/seal-status" >/dev/null 2>&1 && break
  sleep 1
done
for share in "$SHARE1" "$SHARE2"; do
  jq -n --arg k "$share" '{key:$k}' | api PUT sys/unseal >/dev/null
done
curl -fsS --cacert "$BAO_CACERT" "${BAO_ADDR}/v1/sys/seal-status" | jq -e '.sealed == false' >/dev/null || { echo "OpenBao is still sealed." >&2; exit 1; }
echo "OpenBao unsealed."

echo "== 3/5 generate a short-lived root token =="
START="$(echo '{}' | api PUT sys/generate-root/attempt)"
NONCE="$(echo "$START" | jq -r '.nonce')"
OTP="$(echo "$START" | jq -r '.otp')"
{ [ -n "$NONCE" ] && [ "$NONCE" != null ] && [ -n "$OTP" ] && [ "$OTP" != null ]; } || { echo "The legacy endpoint did not start an attempt." >&2; exit 1; }
ENCODED=""
for share in "$SHARE1" "$SHARE2"; do
  RESULT="$(jq -n --arg k "$share" --arg n "$NONCE" '{key:$k,nonce:$n}' | api PUT sys/generate-root/update)"
  ENCODED="$(echo "$RESULT" | jq -r '.encoded_token // empty')"
done
[ -n "$ENCODED" ] || { echo "No encoded token after two shares." >&2; exit 1; }
BAO_ADMIN_TOKEN="$(python3 - "$OTP" "$ENCODED" <<'PY'
import base64, sys
otp, enc = sys.argv[1], sys.argv[2]
raw = base64.b64decode(enc + "=" * (-len(enc) % 4))
key = otp.encode()
if len(raw) != len(key):
    sys.exit(2)
sys.stdout.write(bytes(a ^ b for a, b in zip(raw, key)).decode())
PY
)"
[ -n "$BAO_ADMIN_TOKEN" ] || { echo "Could not decode the root token." >&2; exit 1; }
unset SHARE1 SHARE2 OTP ENCODED

echo "== 4/5 restore the configuration file =="
restore_conf

echo "== 5/5 owner session =="
export BAO_ADMIN_TOKEN
bash "$DIR/p13-openbao-owner-session.sh"
