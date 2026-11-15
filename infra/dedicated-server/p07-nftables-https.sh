#!/usr/bin/env bash
set -euo pipefail

CONF="/etc/nftables.conf"
cp "$CONF" "${CONF}.bak.$(date +%Y%m%d%H%M%S)"

python3 - "$CONF" <<'PYEOF'
import sys
conf_path = sys.argv[1]
with open(conf_path, "r", encoding="utf-8") as f:
    text = f.read()

fwd_rule = 'iifname "enp5s0" oifname "vmbr1" ip daddr 10.20.1.10 tcp dport { 80, 443 } accept'
if fwd_rule not in text:
    marker = 'iifname "vmbr1" ip saddr 10.20.1.10 oifname "vmbr3" ip daddr 10.20.3.10 tcp dport 22 accept'
    assert marker in text
    text = text.replace(marker, f"{marker}\n        {fwd_rule}", 1)

if "chain prerouting" not in text:
    nat_marker = "table ip godseye_nat {"
    assert nat_marker in text
    prerouting = """table ip godseye_nat {
    chain prerouting {
        type nat hook prerouting priority dstnat; policy accept;
        iifname "enp5s0" ip daddr 65.108.38.218 tcp dport { 80, 443 } dnat to 10.20.1.10
    }"""
    text = text.replace(nat_marker, prerouting, 1)

with open(conf_path, "w", encoding="utf-8") as f:
    f.write(text)
PYEOF

nft -c -f "$CONF"
systemctl reload nftables
nft list ruleset | grep -E '80, 443|dnat to 10.20.1.10'
