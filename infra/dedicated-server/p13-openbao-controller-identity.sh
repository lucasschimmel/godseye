#!/usr/bin/env bash
# P13 - OWNER-RUN, interactive, root on godseye-pro.
#   identity      ssh -t godseye-pro sudo /opt/godseye/infra/dedicated-server/p13-openbao-controller-identity.sh identity
#   revoke-admin  ssh -t godseye-pro sudo /opt/godseye/infra/dedicated-server/p13-openbao-controller-identity.sh revoke-admin
#
# identity: gives the control API its own limited OpenBao identity (the "badge").
#   1. writes the compiled broker policy `godseye-broker-v1` (printed by the repository CLI, never hand written);
#   2. creates an orphan, periodic token whose ONLY policy is that one (no default policy);
#   3. stops the controller, installs the token as <identityDir>/bao.auth through the repository CLI
#      (which refuses anything but the exact compiled policy), starts the controller again;
#   4. installs a weekly timer that renews the token so it never expires while the platform runs.
# revoke-admin: revokes the short-lived admin (root) token typed at the prompt and proves it is dead.
#
# The only input is a short-lived OpenBao admin token typed at a silent prompt (generate it with two unseal
# shares: `bao operator generate-root`). Nothing enters argv, the environment of another process, shell
# history or the repository. The new controller token is piped over stdin and never printed.
set -euo pipefail
umask 077

COMMAND="${1:?usage: $0 identity|revoke-admin}"
BAO_ADDR="${GODSEYE_BAO_ADDR:-https://127.0.0.1:8200}"
BAO_CACERT="${GODSEYE_BAO_CACERT:-/etc/openbao/bao.crt}"
BAO_MOUNT="${GODSEYE_BAO_MOUNT:-godseye}"
STATE_DIR="${GODSEYE_STATE_DIR:-/var/lib/godseye/state}"
DATA_DIR="${GODSEYE_DATA_DIR:-/var/lib/godseye/data}"
IDENTITY_DIR="${STATE_DIR}/owner"
SERVICE=godseye-control-api.service
TOKEN_PERIOD="${GODSEYE_CONTROLLER_TOKEN_PERIOD:-720h}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }
[ -t 0 ] || { echo "Interactive terminal required (ssh -t)." >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required." >&2; exit 1; }
trap 'unset BAO_ADMIN_TOKEN CONTROLLER_TOKEN POLICY' EXIT

# The owner session script (p13-openbao-owner-session.sh) hands the token over in BAO_ADMIN_TOKEN so it is typed once.
if [ -z "${BAO_ADMIN_TOKEN:-}" ]; then
  read -rs -p "Short-lived OpenBao admin token: " BAO_ADMIN_TOKEN
  echo >&2
fi
[ -n "$BAO_ADMIN_TOKEN" ] || { echo "Empty value refused." >&2; exit 1; }

bao_send() { curl -fsS --cacert "$BAO_CACERT" -K <(printf 'header = "X-Vault-Token: %s"\n' "$BAO_ADMIN_TOKEN") -X "$1" --data @- "${BAO_ADDR}/v1/$2"; }
bao_status() { curl -s -o /dev/null -w '%{http_code}' --cacert "$BAO_CACERT" -K <(printf 'header = "X-Vault-Token: %s"\n' "$BAO_ADMIN_TOKEN") "${BAO_ADDR}/v1/auth/token/lookup-self"; }

curl -fsS --cacert "$BAO_CACERT" "${BAO_ADDR}/v1/sys/seal-status" | jq -e '.sealed == false' >/dev/null \
  || { echo "OpenBao is sealed or unreachable; unseal it first." >&2; exit 75; }

# Run the repository access CLI as the controller user with only the variables it needs. The full
# controller environment file is deliberately not used: it carries server-only keys the CLI rejects.
access_cli() {
  systemd-run --quiet --wait --pipe --collect \
    -p User=godseye -p Group=godseye -p WorkingDirectory=/opt/godseye \
    -p "Environment=PATH=/usr/local/bin:/usr/bin:/bin" \
    -p "Environment=GODSEYE_STATE_DIR=${STATE_DIR}" \
    -p "Environment=GODSEYE_DATA_DIR=${DATA_DIR}" \
    -p "Environment=GODSEYE_BAO_ADDRESS=${BAO_ADDR}" \
    -p "Environment=GODSEYE_BAO_MOUNT=${BAO_MOUNT}" \
    -p "Environment=NODE_EXTRA_CA_CERTS=${BAO_CACERT}" \
    /usr/local/bin/bun run --silent "$@"
}

case "$COMMAND" in
  revoke-admin)
    [ "$(bao_status)" = 200 ] || { echo "That token is not valid (already revoked?)." >&2; exit 1; }
    echo '{}' | bao_send POST auth/token/revoke-self >/dev/null
    if [ "$(bao_status)" = 200 ]; then echo "The token still works: revocation failed." >&2; exit 1; fi
    echo "ADMIN_TOKEN_REVOKED_AND_VERIFIED (the token is now refused by OpenBao)."
    ;;
  identity)
    POLICY="$(access_cli access:policy)"
    [ -n "$POLICY" ] || { echo "The compiled broker policy is empty." >&2; exit 1; }
    jq -n --arg p "$POLICY" '{policy:$p}' | bao_send PUT sys/policies/acl/godseye-broker-v1 >/dev/null
    CONTROLLER_TOKEN="$(jq -n --arg period "$TOKEN_PERIOD" \
      '{policies:["godseye-broker-v1"],no_default_policy:true,no_parent:true,renewable:true,period:$period,display_name:"godseye-controller"}' \
      | bao_send POST auth/token/create | jq -r '.auth.client_token')"
    { [ -n "$CONTROLLER_TOKEN" ] && [ "$CONTROLLER_TOKEN" != null ]; } || { echo "Token creation failed." >&2; exit 1; }

    REPLACE=()
    [ -e "${IDENTITY_DIR}/bao.auth" ] && REPLACE=(--replace)
    systemctl stop "$SERVICE"
    restart() { systemctl start "$SERVICE" || true; }
    trap 'restart; unset BAO_ADMIN_TOKEN CONTROLLER_TOKEN POLICY' EXIT
    printf '%s' "$CONTROLLER_TOKEN" | access_cli access:provider-auth "${REPLACE[@]}"
    unset CONTROLLER_TOKEN

    install -d -m 0755 /usr/local/sbin
    cat >/usr/local/sbin/godseye-bao-renew.sh <<RENEW
#!/usr/bin/env bash
# Renews the controller's OpenBao token. Runs as the godseye user (weekly timer).
set -euo pipefail
curl -fsS --cacert ${BAO_CACERT} -K <(printf 'header = "X-Vault-Token: %s"\n' "\$(cat ${IDENTITY_DIR}/bao.auth)") \\
  -X POST ${BAO_ADDR}/v1/auth/token/renew-self -o /dev/null
RENEW
    chmod 0755 /usr/local/sbin/godseye-bao-renew.sh
    cat >/etc/systemd/system/godseye-bao-renew.service <<'UNIT'
[Unit]
Description=Renew the GODSEYE controller OpenBao token
After=openbao.service

[Service]
Type=oneshot
User=godseye
Group=godseye
ExecStart=/usr/local/sbin/godseye-bao-renew.sh
UNIT
    cat >/etc/systemd/system/godseye-bao-renew.timer <<'UNIT'
[Unit]
Description=Weekly renewal of the GODSEYE controller OpenBao token

[Timer]
OnCalendar=weekly
Persistent=true
RandomizedDelaySec=1h

[Install]
WantedBy=timers.target
UNIT
    systemctl daemon-reload
    systemctl enable --now godseye-bao-renew.timer >/dev/null
    systemctl start godseye-bao-renew.service
    echo "CONTROLLER_IDENTITY_INSTALLED. Next: revoke the admin token with the revoke-admin command."
    ;;
  *)
    echo "usage: $0 identity|revoke-admin" >&2
    exit 2
    ;;
esac
