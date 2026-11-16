#!/usr/bin/env bash
# h05-guest-network-tests.sh - outbound + guest-isolation matrix, run INSIDE a guest (N04/N06/N07/N08, DS04).
#
#   bash h05-guest-network-tests.sh pro|games|work
#
# Prints one "PASS|FAIL name detail" line per check. Read-only apart from short-lived outbound
# connection attempts (no payload data). A FAIL means the effective policy differs from the intended one.
set -uo pipefail

ROLE="${1:?role pro|games|work}"
HOST_PUBLIC4=65.108.38.218
case "$ROLE" in
  pro) SELF=10.20.1.10 HOSTBR=10.20.1.1 SELF6=2a01:4f9:3080:344e::100 EXPECT_V6=yes ;;
  games) SELF=10.20.2.10 HOSTBR=10.20.2.1 SELF6=2a01:4f9:3080:344e::200 EXPECT_V6=yes ;;
  work) SELF=10.20.3.10 HOSTBR=10.20.3.1 SELF6=none EXPECT_V6=no ;;
  *) echo "bad role" >&2; exit 64 ;;
esac
FAILS=0

check() { # name expected(open|blocked) cmd...
  local name="$1" expect="$2"
  shift 2
  if [ "$1" = tcp_probe ]; then
    "$@" >/dev/null 2>&1 && got=open || got=blocked
  elif timeout 10 "$@" >/dev/null 2>&1; then got=open; else got=blocked; fi
  if [ "$got" = "$expect" ]; then echo "PASS $name expected=$expect got=$got"; else echo "FAIL $name expected=$expect got=$got"; FAILS=$((FAILS + 1)); fi
}
# timeout cannot run shell functions, so TCP probes go through an explicit bash -c.
tcp_probe() { timeout 4 bash -c 'exec 3<>/dev/tcp/$0/$1' "$1" "$2" 2>/dev/null; }

echo "## egress (positive)"
check "v4 icmp 1.1.1.1" open ping -4 -c 2 -W 3 1.1.1.1
check "v4-only destination (ipv4.google.com https)" open curl -4 -sS -m 8 -o /dev/null https://ipv4.google.com
check "dual-stack destination via IPv4" open curl -4 -sS -m 8 -o /dev/null https://one.one.one.one
if [ "$EXPECT_V6" = yes ]; then
  check "v6 icmp 2606:4700:4700::1111" open ping -6 -c 2 -W 3 2606:4700:4700::1111
  check "v6-only destination (ipv6.google.com https)" open curl -6 -sS -m 8 -o /dev/null https://ipv6.google.com
  check "dual-stack destination via IPv6" open curl -6 -sS -m 8 -o /dev/null https://one.one.one.one
  check "v6 source address is the routed /128" open bash -c "ip -6 addr show scope global | grep -q ${SELF6}"
else
  check "v6 egress blocked for ULA-only guest" blocked curl -6 -sS -m 6 -o /dev/null https://ipv6.google.com
fi
echo "## default family preference (N06)"
getent ahosts one.one.one.one | awk '{print $1}' | sort -u | head -3 | sed 's/^/  resolver order: /'
curl -sS -m 8 https://one.one.one.one/cdn-cgi/trace 2>/dev/null | grep -E '^ip=' | sed 's/^/  default-path source: /'
echo "## path MTU (full 1500 byte packets, DF set)"
check "v4 1472-byte DF ping" open ping -4 -M do -s 1472 -c 2 -W 3 1.1.1.1
if [ "$EXPECT_V6" = yes ]; then
  check "v6 1452-byte DF ping" open ping -6 -M do -s 1452 -c 2 -W 3 2606:4700:4700::1111
fi
echo "## guest -> host and guest -> guest must be blocked"
for p in 22 111 3128 8006; do
  check "host bridge $HOSTBR:$p" blocked tcp_probe "$HOSTBR" "$p"
  check "host public $HOST_PUBLIC4:$p" blocked tcp_probe "$HOST_PUBLIC4" "$p"
done
check "host wg address 10.20.0.1:22" blocked tcp_probe 10.20.0.1 22
check "host wg ULA fd47:6f64:7365::1:22" blocked tcp_probe fd47:6f64:7365::1 22
for peer in 10.20.1.10 10.20.2.10 10.20.3.10; do
  [ "$peer" = "$SELF" ] && continue
  exp=blocked
  # Intended single exception: pro (Jenkins controller) -> work :22.
  [ "$ROLE" = pro ] && [ "$peer" = 10.20.3.10 ] && exp=open
  check "guest $peer:22" "$exp" tcp_probe "$peer" 22
done
for peer6 in 2a01:4f9:3080:344e::100 2a01:4f9:3080:344e::200; do
  [ "$peer6" = "$SELF6" ] && continue
  check "guest $peer6:22 (IPv6)" blocked tcp_probe "$peer6" 22
done
echo "RESULT role=$ROLE failures=$FAILS"
exit "$FAILS"
