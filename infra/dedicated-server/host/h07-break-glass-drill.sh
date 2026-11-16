#!/usr/bin/env bash
# h07-break-glass-drill.sh - prove the WireGuard emergency path and peer revocation on the host (DS05/DS14).
#
# Run as root on godseye-wg. It simulates "another device with a second peer" entirely on the host:
# a throw-away peer key is generated in tmpfs, added to wg0 at runtime only (wg0.conf is never
# edited), a client WireGuard interface is moved into a network namespace, and from inside it the
# script checks host SSH, the Proxmox UI port and the pro VM SSH banner through the tunnel. It
# then REVOKES the peer and shows the tunnel no longer passes traffic. Nothing touches the real
# peers, the firewall or the guests; the temporary key never leaves /run and is wiped on exit.
#
# This proves the server side of the path (wg0 + nftables + sshd) and the revoke procedure. It does
# not prove an owner device's own config, so the owner must still run the manual drill in
# docs/operations/break-glass.md from each real device.
set -euo pipefail

NS=bgdrill
IF=wgbg0
PEER_IP=10.20.0.99
WORK="$(mktemp -d /run/godseye-bgdrill.XXXXXX)"
umask 077
PUB=""

cleanup() {
  set +e
  [ -n "$PUB" ] && wg set wg0 peer "$PUB" remove 2>/dev/null
  ip netns del "$NS" 2>/dev/null
  ip link del "$IF" 2>/dev/null
  shred -u "$WORK/key" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

SRV_PUB="$(wg show wg0 public-key)"
wg genkey >"$WORK/key"
PUB="$(wg pubkey <"$WORK/key")"
echo "drill peer public key prefix: ${PUB:0:8} (temporary)"

wg set wg0 peer "$PUB" allowed-ips "$PEER_IP/32"
ip netns add "$NS"
ip link add "$IF" type wireguard
wg set "$IF" private-key "$WORK/key" listen-port 51821 \
  peer "$SRV_PUB" endpoint 127.0.0.1:51820 allowed-ips 10.20.0.0/24,10.20.1.0/24 persistent-keepalive 2
ip link set "$IF" netns "$NS"
ip -n "$NS" addr add "$PEER_IP/24" dev "$IF"
ip -n "$NS" link set lo up
ip -n "$NS" link set "$IF" up
ip -n "$NS" route add 10.20.1.0/24 dev "$IF"

inns() { ip netns exec "$NS" "$@"; }
banner() { inns timeout 6 bash -c 'exec 3<>/dev/tcp/$0/$1; head -c 12 <&3' "$1" "$2" 2>/dev/null | tr -d '\r\n'; }
RESULT=0
verdict() { # name expected got
  if [ "$2" = "$3" ]; then echo "PASS $1 ($3)"; else echo "FAIL $1 expected=$2 got=$3"; RESULT=1; fi
}

sleep 3
echo "== second-peer path through wg0"
inns ping -c 2 -W 3 10.20.0.1 >/dev/null 2>&1 && g=reachable || g=unreachable
verdict "tunnel ping 10.20.0.1" reachable "$g"
HS="$(wg show wg0 latest-handshakes | awk -v p="$PUB" '$1==p{print $2}')"
[ -n "$HS" ] && [ "$HS" -gt 0 ] && g=handshake || g=none
verdict "wg0 handshake for drill peer" handshake "$g"
b="$(banner 10.20.0.1 22)"
case "$b" in SSH-2.0*) g=ssh_banner ;; *) g="none($b)" ;; esac
verdict "host SSH via tunnel" ssh_banner "$g"
inns timeout 5 bash -c 'exec 3<>/dev/tcp/10.20.0.1/8006' 2>/dev/null && g=open || g=closed
verdict "Proxmox UI 8006 via tunnel" open "$g"
b="$(banner 10.20.1.10 22)"
case "$b" in SSH-2.0*) g=ssh_banner ;; *) g="none($b)" ;; esac
verdict "pro VM SSH banner via tunnel" ssh_banner "$g"

echo "== revoke the peer"
wg set wg0 peer "$PUB" remove
sleep 4
if wg show wg0 peers | grep -qx "$PUB"; then g=still_listed; else g=removed; fi
verdict "peer removed from wg0" removed "$g"
inns ping -c 2 -W 3 10.20.0.1 >/dev/null 2>&1 && g=reachable || g=unreachable
verdict "revoked peer tunnel ping" unreachable "$g"
inns timeout 5 bash -c 'exec 3<>/dev/tcp/10.20.0.1/22' 2>/dev/null && g=open || g=closed
verdict "revoked peer SSH" closed "$g"

echo "== real peers untouched"
wg show wg0 peers | wc -l | sed 's/^/peers configured: /'
grep -c '^\[Peer\]' /etc/wireguard/wg0.conf | sed 's/^/peers persisted in wg0.conf: /'
echo "BREAK_GLASS_DRILL result=$RESULT"
exit "$RESULT"
