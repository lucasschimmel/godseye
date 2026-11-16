#!/usr/bin/env bash
# g02-disable-llmnr.sh - turn off LLMNR and mDNS in a guest (run as root on pro, games and work).
# systemd-resolved listens on TCP/UDP 5355 for LLMNR by default; nothing here uses it, and it is a
# spoofing surface on a shared subnet. Idempotent. Rollback: delete the drop-in, restart the resolver.
set -euo pipefail

DROPIN_DIR=/etc/systemd/resolved.conf.d
DROPIN="$DROPIN_DIR/10-godseye-no-llmnr.conf"

install -d -m 0755 "$DROPIN_DIR"
cat >"$DROPIN" <<'EOF'
[Resolve]
LLMNR=no
MulticastDNS=no
EOF
systemctl restart systemd-resolved.service
sleep 1
if ss -tulnH | awk '{print $5}' | grep -q ':5355$'; then
  echo "LLMNR still listening on 5355" >&2
  exit 1
fi
resolvectl status | grep -c '+LLMNR' | sed 's/^/links still advertising +LLMNR: /'
getent hosts deb.debian.org >/dev/null && echo "DNS_STILL_RESOLVES"
echo "LLMNR_DISABLED (rollback: rm $DROPIN && systemctl restart systemd-resolved)"
