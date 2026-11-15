#!/usr/bin/env bash
# h06-firewall-hardening.sh - rollback-safe firewall hardening for the Proxmox host (N04/N08, DS04/DS05).
#
#   bash h06-firewall-hardening.sh apply     load the guard table live + arm a 5-minute auto-rollback
#   bash h06-firewall-hardening.sh commit    after verifying from a NEW SSH session: disarm rollback, persist
#   bash h06-firewall-hardening.sh rollback  remove the guard table now and disable persistence
#
# What it changes: adds the drop-only table inet godseye_guard (templates/godseye-guard.nft),
# turns router-advertisement handling off on the uplink at runtime, and disables rpcbind (no NFS is
# used; it listened on public 0.0.0.0:111 behind the firewall). /etc/nftables.conf is NOT edited.
set -euo pipefail
umask 022

HERE="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
RB="/var/lib/godseye/rollback/h06-$TS"
GUARD=/etc/godseye/godseye-guard.nft
UNIT=/etc/systemd/system/godseye-nft-guard.service
ROLLBACK_UNIT=h06-fw-rollback
WAIT="${GODSEYE_ROLLBACK_SECONDS:-300}"

case "$MODE" in
  apply)
    mkdir -p "$RB" /etc/godseye
    nft list ruleset >"$RB/ruleset-before.nft"
    cp -a /etc/nftables.conf "$RB/nftables.conf"
    nft -c -f "$HERE/templates/godseye-guard.nft"
    install -m 0644 "$HERE/templates/godseye-guard.nft" "$GUARD"
    # Armed BEFORE the change: if nothing disarms it, the guard disappears again.
    systemctl stop "$ROLLBACK_UNIT.timer" "$ROLLBACK_UNIT.service" 2>/dev/null || true
    systemd-run --quiet --unit="$ROLLBACK_UNIT" --on-active="$WAIT" \
      /usr/sbin/nft delete table inet godseye_guard
    nft -f "$GUARD"
    sysctl -q -w net.ipv6.conf.enp5s0.accept_ra=0 net.ipv6.conf.all.accept_ra=0 net.ipv6.conf.default.accept_ra=0
    echo "GUARD_APPLIED rollback armed in ${WAIT}s (unit $ROLLBACK_UNIT.timer); verify from a new SSH session, then run: $0 commit"
    nft list table inet godseye_guard | head -40
    ;;
  commit)
    nft list table inet godseye_guard >/dev/null
    systemctl stop "$ROLLBACK_UNIT.timer" "$ROLLBACK_UNIT.service" 2>/dev/null || true
    cat >"$UNIT" <<'EOF'
[Unit]
Description=G.O.D.S.E.Y.E host firewall guard table (drop-only hardening)
After=nftables.service network-online.target
PartOf=nftables.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/nft -f /etc/godseye/godseye-guard.nft
ExecStart=/usr/sbin/sysctl -q -w net.ipv6.conf.enp5s0.accept_ra=0 net.ipv6.conf.all.accept_ra=0 net.ipv6.conf.default.accept_ra=0
ExecStop=-/usr/sbin/nft delete table inet godseye_guard

[Install]
WantedBy=multi-user.target nftables.service
EOF
    cat >/etc/sysctl.d/98-godseye-no-ra.conf <<'EOF'
net.ipv6.conf.all.accept_ra = 0
net.ipv6.conf.default.accept_ra = 0
EOF
    systemctl daemon-reload
    systemctl enable godseye-nft-guard.service
    systemctl disable --now rpcbind.service rpcbind.socket 2>/dev/null || true
    systemctl mask rpcbind.service rpcbind.socket 2>/dev/null || true
    echo "GUARD_COMMITTED (persistent via godseye-nft-guard.service; rpcbind disabled and masked)"
    ;;
  ssh-harden)
    # Key-only root SSH already holds; this removes unneeded forwarding and tightens brute-force limits.
    # Validate with sshd -t before reload; existing sessions survive a reload. Rollback: delete the file, reload.
    mkdir -p "$RB"
    [ -f /etc/ssh/sshd_config.d/50-godseye.conf ] && cp -a /etc/ssh/sshd_config.d/50-godseye.conf "$RB/"
    cat >/etc/ssh/sshd_config.d/50-godseye.conf <<'EOF'
X11Forwarding no
AllowAgentForwarding no
MaxAuthTries 3
LoginGraceTime 20
ClientAliveInterval 300
ClientAliveCountMax 2
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
    sshd -t
    systemctl reload ssh
    sshd -T | grep -E '^(x11forwarding|allowagentforwarding|maxauthtries|logingracetime|passwordauthentication|permitrootlogin) '
    echo "SSH_HARDENED (rollback: rm /etc/ssh/sshd_config.d/50-godseye.conf && systemctl reload ssh)"
    ;;
  rollback)
    systemctl stop "$ROLLBACK_UNIT.timer" "$ROLLBACK_UNIT.service" 2>/dev/null || true
    nft delete table inet godseye_guard 2>/dev/null || true
    systemctl disable godseye-nft-guard.service 2>/dev/null || true
    systemctl unmask rpcbind.service rpcbind.socket 2>/dev/null || true
    echo "GUARD_ROLLED_BACK"
    ;;
  *)
    echo "usage: $0 apply|commit|ssh-harden|rollback" >&2
    exit 64
    ;;
esac
