#!/usr/bin/env bash
# g01-guest-firewall.sh - in-guest inbound firewall for the three VMs (DS04, N04), rollback-safe.
#
#   bash g01-guest-firewall.sh apply    pro|games|work   load the table live + arm a 5-minute auto-rollback
#   bash g01-guest-firewall.sh commit   pro|games|work   after a NEW SSH session worked: disarm, persist
#   bash g01-guest-firewall.sh rollback pro|games|work   remove the table now and the persistence unit
#   bash g01-guest-firewall.sh status   pro|games|work   print the loaded table
#
# Adds ONE table `inet godseye_guest` with an input chain whose policy is drop. It never flushes the
# ruleset (Docker keeps its own iptables-nft tables on pro and games) and never edits
# /etc/nftables.conf (the distribution file starts with `flush ruleset`; the nftables service stays
# disabled). Forwarded traffic (published container ports) does not pass the input hook.
# Inbound allowed per role (everything else is dropped):
#   all   loopback, established/related, ICMP/ICMPv6 essentials, SSH from the WireGuard peers and the
#         host gateway of the guest subnet
#   pro   TCP 8080 (Jenkins UI) from the WireGuard peers; TCP 4300/4301 from the edge bridge
#   games UDP 30000 (Luanti) from anywhere
#   work  SSH from the Jenkins controller (pro)
# Rollback copy of the previous ruleset: /var/lib/godseye/rollback/g01-<timestamp>/.
set -euo pipefail
umask 022

MODE="${1:-}"
ROLE="${2:-}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
RB="/var/lib/godseye/rollback/g01-$TS"
CONF=/etc/godseye/guest-fw.nft
UNIT=/etc/systemd/system/godseye-guest-fw.service
ROLLBACK_UNIT=g01-fw-rollback
WAIT="${GODSEYE_ROLLBACK_SECONDS:-300}"
WG_V4="${GODSEYE_WG_V4:-10.20.0.0/24}"
WG_V6="${GODSEYE_WG_V6:-fd47:6f64:7365::/64}"
EDGE_SUBNET="${GODSEYE_EDGE_SUBNET:-172.30.0.0/24}"

case "$ROLE" in
  pro)   GATEWAY=10.20.1.1 ;;
  games) GATEWAY=10.20.2.1 ;;
  work)  GATEWAY=10.20.3.1 ;;
  *) echo "usage: $0 apply|commit|rollback|status pro|games|work" >&2; exit 64 ;;
esac

render() {
  local ssh_v4="${WG_V4}, ${GATEWAY}"
  local extra=""
  case "$ROLE" in
    pro)
      extra="
		ip saddr ${WG_V4} tcp dport 8080 accept comment \"Jenkins UI from WireGuard peers\"
		ip saddr ${EDGE_SUBNET} ip daddr 172.30.0.1 tcp dport { 4300, 4301 } accept comment \"edge to console/API forwards\""
      ;;
    games)
      extra="
		udp dport 30000 accept comment \"Luanti game server\""
      ;;
    work)
      ssh_v4="${ssh_v4}, 10.20.1.10"
      ;;
  esac
  cat <<NFT
add table inet godseye_guest
delete table inet godseye_guest
table inet godseye_guest {
	chain input {
		type filter hook input priority filter; policy drop;
		iif "lo" accept
		ct state established,related accept
		ct state invalid drop
		ip protocol icmp icmp type { destination-unreachable, time-exceeded, parameter-problem } accept
		ip protocol icmp icmp type echo-request limit rate 10/second accept
		meta l4proto ipv6-icmp icmpv6 type { destination-unreachable, packet-too-big, time-exceeded, parameter-problem, nd-neighbor-solicit, nd-neighbor-advert, nd-router-advert } accept
		meta l4proto ipv6-icmp icmpv6 type echo-request limit rate 10/second accept
		udp sport 67 udp dport 68 accept comment "DHCPv4 client replies"
		ip saddr { ${ssh_v4} } tcp dport 22 accept comment "SSH from WireGuard peers and the subnet gateway"
		ip6 saddr ${WG_V6} tcp dport 22 accept comment "SSH from WireGuard peers over IPv6"${extra}
		counter drop
	}
}
NFT
}

arm_rollback() {
  systemctl stop "$ROLLBACK_UNIT.timer" "$ROLLBACK_UNIT.service" 2>/dev/null || true
  # Armed BEFORE the change: if nothing disarms it, the table disappears again.
  systemd-run --quiet --unit="$ROLLBACK_UNIT" --on-active="$WAIT" /usr/sbin/nft delete table inet godseye_guest
}

ensure_nft() {
  command -v nft >/dev/null 2>&1 || { DEBIAN_FRONTEND=noninteractive apt-get install -y nftables; systemctl disable --now nftables.service 2>/dev/null || true; }
}

case "$MODE" in
  apply)
    ensure_nft
    mkdir -p "$RB" /etc/godseye
    nft list ruleset >"$RB/ruleset-before.nft"
    render >"$RB/new.nft"
    nft -c -f "$RB/new.nft"
    install -m 0644 "$RB/new.nft" "$CONF"
    arm_rollback
    nft -f "$CONF"
    echo "GUEST_FW_APPLIED role=$ROLE rollback armed in ${WAIT}s ($ROLLBACK_UNIT.timer); verify from a NEW SSH session, then: $0 commit $ROLE"
    nft list table inet godseye_guest
    ;;
  commit)
    nft list table inet godseye_guest >/dev/null
    systemctl stop "$ROLLBACK_UNIT.timer" "$ROLLBACK_UNIT.service" 2>/dev/null || true
    cat >"$UNIT" <<'EOF'
[Unit]
Description=G.O.D.S.E.Y.E guest inbound firewall (table inet godseye_guest)
DefaultDependencies=no
Before=network-pre.target
Wants=network-pre.target
After=local-fs.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/nft -f /etc/godseye/guest-fw.nft
ExecStop=-/usr/sbin/nft delete table inet godseye_guest

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable godseye-guest-fw.service
    echo "GUEST_FW_COMMITTED role=$ROLE (persistent via godseye-guest-fw.service)"
    ;;
  rollback)
    systemctl stop "$ROLLBACK_UNIT.timer" "$ROLLBACK_UNIT.service" 2>/dev/null || true
    nft delete table inet godseye_guest 2>/dev/null || true
    systemctl disable godseye-guest-fw.service 2>/dev/null || true
    echo "GUEST_FW_ROLLED_BACK role=$ROLE"
    ;;
  status)
    nft list table inet godseye_guest
    systemctl is-enabled godseye-guest-fw.service 2>&1 || true
    ;;
  *)
    echo "usage: $0 apply|commit|rollback|status pro|games|work" >&2
    exit 64
    ;;
esac
