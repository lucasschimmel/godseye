#!/usr/bin/env bash
# P12: read-only check after a reboot of a guest or of the host. Run from the workstation (WireGuard
# up) with the SSH aliases godseye-wg, godseye-pro, godseye-games, godseye-work; it changes nothing.
# Prints PASS/FAIL per check and exits non-zero when any check fails. Takes no secrets.
set -uo pipefail

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10)
[ -n "${GODSEYE_SSH_CONFIG:-}" ] && SSH_OPTS+=(-F "$GODSEYE_SSH_CONFIG")
SITE="${GODSEYE_SITE_HOST:-godseye.lucasschimmel.fr}"
CONSOLE="${GODSEYE_CONSOLE_HOST:-console.godseye.lucasschimmel.fr}"
fail=0
check() { # check <label> <command...>
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "PASS $label"; else echo "FAIL $label"; fail=1; fi
}
remote() { local host="$1"; shift; ssh "${SSH_OPTS[@]}" "$host" "$@"; }

check "host: guard table loaded" remote godseye-wg 'nft list table inet godseye_guard'
check "host: filter and nat tables loaded" remote godseye-wg 'nft list table inet godseye_filter && nft list table ip godseye_nat'
check "host: every WireGuard peer listed" remote godseye-wg 'test "$(wg show wg0 peers | wc -l)" -ge 3'
check "host: pool online" remote godseye-wg 'zpool status -x | grep -q "all pools are healthy"'
check "host: guests running" remote godseye-wg 'qm status 100 | grep -q running && qm status 200 | grep -q running'
for guest in godseye-pro godseye-games godseye-work; do
  check "$guest: inbound firewall table with drop policy" remote "$guest" 'nft list chain inet godseye_guest input | grep -q "policy drop"'
  check "$guest: LLMNR not listening" remote "$guest" '! ss -tuln | grep -q ":5355"'
done
check "godseye-work: egress table and resolver" remote godseye-work 'nft list table inet godseye_egress && systemctl is-active --quiet godseye-egress-dns && getent hosts github.com'
check "godseye-work: egress still blocks" remote godseye-work '! timeout 6 bash -c "exec 3<>/dev/tcp/1.1.1.1/443"'
check "godseye-pro: OpenBao unsealed" remote godseye-pro 'BAO_ADDR=https://127.0.0.1:8200 BAO_SKIP_VERIFY=true bao status | grep -E "^Sealed +false"'
check "godseye-pro: platform units active" remote godseye-pro 'systemctl is-active --quiet godseye-control-api godseye-console godseye-edge postgresql docker jenkins'
check "godseye-pro: edge container running" remote godseye-pro 'docker ps --filter name=godseye-edge --format "{{.Status}}" | grep -q Up'
check "godseye-games: game container up" remote godseye-games 'docker ps --filter name=godseye-luanti --format "{{.Status}}" | grep -q Up'
check "public healthz" bash -c "test \"\$(curl -fsS -m 15 https://${SITE}/healthz)\" = godseye-edge-ok"
check "console healthz over WireGuard" curl -fsS -m 15 -o /dev/null "https://${CONSOLE}/healthz"
check "unknown host answers 404" bash -c "test \"\$(curl -s -o /dev/null -w '%{http_code}' -m 15 -H 'Host: observer-probe.invalid' http://${SITE}/)\" = 404"
check "Jenkins agent online" remote godseye-pro 'source /etc/jenkins/casc.env && curl -fsS -u "${JENKINS_OWNER_ID}:${JENKINS_OWNER_PASSWORD}" http://10.20.1.10:8080/computer/godseye-work/api/json?tree=offline | grep -q "\"offline\":false"'

[ "$fail" -eq 0 ] && echo "POST_REBOOT_CHECK_PASS" || { echo "POST_REBOOT_CHECK_FAIL" >&2; exit 1; }
