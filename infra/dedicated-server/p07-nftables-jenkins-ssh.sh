#!/usr/bin/env bash
set -euo pipefail

CONF="/etc/nftables.conf"
RULE='iifname "vmbr1" ip saddr 10.20.1.10 oifname "vmbr3" ip daddr 10.20.3.10 tcp dport 22 accept'

if grep -Fq "$RULE" "$CONF"; then
  echo "Rule already present in $CONF"
else
  cp "$CONF" "${CONF}.bak.$(date +%Y%m%d%H%M%S)"
  python3 - "$CONF" "$RULE" <<'PYEOF'
import sys
conf_path, rule = sys.argv[1], sys.argv[2]
with open(conf_path, "r", encoding="utf-8") as f:
    text = f.read()
marker = 'iifname { "vmbr1", "vmbr2", "vmbr3" } oifname "enp5s0" accept'
if marker not in text:
    raise SystemExit(f"Marker not found in {conf_path}")
updated = text.replace(marker, f"{marker}\n        {rule}", 1)
with open(conf_path, "w", encoding="utf-8") as f:
    f.write(updated)
PYEOF
fi

nft -c -f "$CONF"
systemctl reload nftables
nft list table inet godseye_filter
