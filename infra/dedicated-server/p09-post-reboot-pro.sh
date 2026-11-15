#!/usr/bin/env bash
set -euo pipefail

uptime
for s in postgresql openbao redis-server caddy jenkins godseye-control-api godseye-console docker; do
  echo "${s}=$(systemctl is-active "$s")"
done

export BAO_ADDR="https://127.0.0.1:8200"
export BAO_CACERT="/etc/openbao/bao.crt"

# Unseal OpenBao post-reboot using 2 of 3 threshold keys without printing secrets
python3 - <<'PYEOF'
import json, subprocess
keys = json.load(open("/root/openbao-init-DO-NOT-COMMIT.json"))["unseal_keys_b64"][:2]
for k in keys:
    subprocess.run(["bao", "operator", "unseal", k], check=True, stdout=subprocess.DEVNULL)
PYEOF

bao status | grep -E 'Sealed|HA Enabled|Storage Type'
docker ps --filter "name=godseye-cell-" --format "{{.Names}}|{{.Status}}|{{.Networks}}"
echo "CONSOLE_HTTP=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4300/)"
echo "JENKINS_HTTP=$(curl -s -o /dev/null -w '%{http_code}' http://10.20.1.10:8080/login)"
