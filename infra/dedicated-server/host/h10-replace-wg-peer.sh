#!/usr/bin/env bash
# Replace the public key of an existing WireGuard admin peer on the Proxmox host, so a device can generate its
# own private key locally and no private key ever travels. Run as root on the host (godseye-wg):
#   bash h10-replace-wg-peer.sh <peer tunnel address, e.g. 10.20.0.11> <new public key>
# The peer keeps its address; the old key is removed at runtime and in wg0.conf. A copy of the previous file
# stays in /var/lib/godseye/rollback/ (see docs/operations/break-glass.md section 4.1).
set -euo pipefail

ADDR="${1:?peer tunnel address, for example 10.20.0.11}"
NEW="${2:?new peer public key}"
CONF=/etc/wireguard/wg0.conf
ROLLBACK_DIR=/var/lib/godseye/rollback

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
[[ "$ADDR" =~ ^10\.20\.0\.([0-9]{1,3})$ ]] || { echo "Peer address must be 10.20.0.<n>." >&2; exit 1; }
N="${BASH_REMATCH[1]}"
[[ "$NEW" =~ ^[A-Za-z0-9+/]{43}=$ ]] || { echo "That is not a WireGuard public key (44 base64 characters ending in =)." >&2; exit 1; }
[ -f "$CONF" ] || { echo "Missing $CONF" >&2; exit 1; }

OLD="$(wg show wg0 allowed-ips | awk -v a="${ADDR}/32" '$2 == a { print $1 }')"
[ -n "$OLD" ] || { echo "No peer currently owns ${ADDR}/32." >&2; exit 1; }
[ "$OLD" != "$NEW" ] || { echo "The peer already uses that key; nothing to do."; exit 0; }
if wg show wg0 peers | grep -qxF "$NEW"; then
  echo "That public key already belongs to another peer." >&2
  exit 1
fi
grep -qF "PublicKey = ${OLD}" "$CONF" || { echo "The old key is not in $CONF; refusing to edit." >&2; exit 1; }

install -d -m 0700 "$ROLLBACK_DIR"
cp -p "$CONF" "${ROLLBACK_DIR}/wg0.conf.before-peer-${N}-$(date -u +%Y%m%dT%H%M%SZ)"

wg set wg0 peer "$NEW" allowed-ips "${ADDR}/32,fd47:6f64:7365::${N}/128"
wg set wg0 peer "$OLD" remove
sed -i "s|PublicKey = ${OLD}|PublicKey = ${NEW}|" "$CONF"

grep -qxF "PublicKey = ${NEW}" "$CONF" || { echo "wg0.conf was not updated as expected." >&2; exit 1; }
echo "PEER_REPLACED ${ADDR}"
wg show wg0 allowed-ips
