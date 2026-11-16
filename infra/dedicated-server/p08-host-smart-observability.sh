#!/usr/bin/env bash
set -euo pipefail

cat >/usr/local/sbin/godseye-host-health.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PYEOF'
import json
import subprocess
import datetime

zpool_out = subprocess.check_output(["zpool", "status", "-x"], text=True).strip()
pool_ok = (zpool_out == "all pools are healthy")

drives = []
overall_ok = pool_ok
for dev in ["/dev/nvme0n1", "/dev/nvme1n1"]:
    res = subprocess.run(["smartctl", "-j", "-a", dev], capture_output=True, text=True)
    data = json.loads(res.stdout)
    nvme = data.get("nvme_smart_health_information_log", {})
    cw = nvme.get("critical_warning", 0)
    spare = nvme.get("available_spare", 100)
    spare_thresh = nvme.get("available_spare_threshold", 10)
    media_err = nvme.get("media_errors", 0)
    temp = nvme.get("temperature", 0)
    pct_used = nvme.get("percentage_used", 0)
    serial = data.get("serial_number", "")
    # Samsung PM9A1 0x04 is warranty-threshold-only (Hetzner Ticket #2026111403017785)
    non_warranty_cw = (cw & ~0x04)
    drive_ok = (non_warranty_cw == 0) and (spare >= spare_thresh) and (media_err == 0) and (temp < 78)
    if not drive_ok:
        overall_ok = False
    drives.append({
        "dev": dev,
        "serial": serial,
        "critical_warning_hex": hex(cw),
        "warranty_only_0x04": bool(cw & 0x04),
        "available_spare": spare,
        "media_errors": media_err,
        "percentage_used": pct_used,
        "temperature_c": temp,
        "ok": drive_ok,
    })

report = {
    "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "zpool": zpool_out,
    "zpool_ok": pool_ok,
    "drives": drives,
    "overall_ok": overall_ok,
}
line = json.dumps(report)
with open("/var/log/godseye-host-health.jsonl", "a", encoding="utf-8") as f:
    f.write(line + "\n")
print(line)
if not overall_ok:
    raise SystemExit(1)
PYEOF
EOF
chmod 0755 /usr/local/sbin/godseye-host-health.sh

cat >/etc/systemd/system/godseye-host-health.service <<'EOF'
[Unit]
Description=G.O.D.S.E.Y.E Host ZFS and NVMe SMART Policy Check

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/godseye-host-health.sh
EOF

cat >/etc/systemd/system/godseye-host-health.timer <<'EOF'
[Unit]
Description=Run G.O.D.S.E.Y.E Host Health Check every 15 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now godseye-host-health.timer
/usr/local/sbin/godseye-host-health.sh
