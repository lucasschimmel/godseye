#!/usr/bin/env bash
# G.O.D.S.E.Y.E — P00 Read-Only Dedicated Server Inventory
# Strictly non-destructive, read-only hardware, storage, network, account and service inspection.
# Never reads private keys, password hashes, tokens or application secret files.

set -euo pipefail

export LC_ALL=C

section() {
  printf '\n=== [%s] ===\n' "$1"
}

section "TIMESTAMP_AND_OS"
date -u +"%Y-%m-%dT%H:%M:%SZ"
uname -a
if [ -f /etc/os-release ]; then
  grep -E '^(NAME|VERSION|ID|VERSION_ID|PRETTY_NAME)=' /etc/os-release || true
fi
if [ -d /sys/firmware/efi ]; then
  echo "BOOT_MODE=UEFI"
else
  echo "BOOT_MODE=BIOS_LEGACY"
fi
efibootmgr 2>/dev/null || true
uptime || true

section "CPU_AND_VIRTUALIZATION"
lscpu || true
echo "--- lscpu -e ---"
lscpu -e || true
grep -E -c '(vmx|svm)' /proc/cpuinfo | awk '{print "VIRT_FLAGS_COUNT=" $1}'
if [ -e /dev/kvm ]; then
  ls -la /dev/kvm
else
  echo "DEV_KVM=absent"
fi

section "MEMORY_AND_SWAP"
free -b
grep -E '^(MemTotal|MemFree|MemAvailable|SwapTotal|SwapFree|HugePages_Total):' /proc/meminfo || true

section "BLOCK_DEVICES_AND_LAYOUT"
lsblk -b -o NAME,KNAME,PATH,TYPE,SIZE,MODEL,SERIAL,WWN,ROTA,DISC-GRAN,FSTYPE,MOUNTPOINTS
echo "--- /dev/disk/by-id ---"
ls -la /dev/disk/by-id/ || true
echo "--- df -B1 ---"
df -B1 -T -x tmpfs -x devtmpfs || true
echo "--- /proc/mdstat ---"
cat /proc/mdstat 2>/dev/null || true
if command -v zpool >/dev/null 2>&1; then
  echo "--- zpool status ---"
  zpool status || true
fi
if command -v pvs >/dev/null 2>&1; then
  echo "--- LVM pvs/vgs/lvs ---"
  pvs || true
  vgs || true
  lvs || true
fi

section "SMART_AND_NVME_HEALTH"
python3 - <<'PYEOF'
import ctypes, fcntl, glob, json, os, struct

class NvmeAdminCmd(ctypes.Structure):
    _fields_ = [
        ("opcode", ctypes.c_uint8), ("flags", ctypes.c_uint8), ("rsvd1", ctypes.c_uint16),
        ("nsid", ctypes.c_uint32), ("cdw2", ctypes.c_uint32), ("cdw3", ctypes.c_uint32),
        ("metadata", ctypes.c_uint64), ("addr", ctypes.c_uint64),
        ("metadata_len", ctypes.c_uint32), ("data_len", ctypes.c_uint32),
        ("cdw10", ctypes.c_uint32), ("cdw11", ctypes.c_uint32), ("cdw12", ctypes.c_uint32),
        ("cdw13", ctypes.c_uint32), ("cdw14", ctypes.c_uint32), ("cdw15", ctypes.c_uint32),
        ("timeout_ms", ctypes.c_uint32), ("result", ctypes.c_uint32)
    ]

NVME_IOCTL_ADMIN_CMD = 0xC0484E41
out = {}
for sys_dev in sorted(glob.glob("/sys/class/nvme/nvme*")):
    name = os.path.basename(sys_dev)
    dev = f"/dev/{name}"
    info = {}
    for attr in ["model", "serial", "firmware_rev", "state"]:
        p = os.path.join(sys_dev, attr)
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8", errors="replace") as fh:
                info[attr] = fh.read().strip()
    if os.path.exists(dev):
        buf = ctypes.create_string_buffer(512)
        cmd = NvmeAdminCmd(opcode=0x02, nsid=0xFFFFFFFF, addr=ctypes.addressof(buf), data_len=512, cdw10=0x007F0002)
        with open(dev, "rb") as f:
            fcntl.ioctl(f.fileno(), NVME_IOCTL_ADMIN_CMD, cmd)
        raw = buf.raw
        temp_k = struct.unpack_from("<H", raw, 1)[0]
        info["smart"] = {
            "critical_warning": raw[0],
            "temperature_c": round(temp_k - 273.15, 1),
            "available_spare_pct": raw[3],
            "spare_threshold_pct": raw[4],
            "percentage_used": raw[5],
            "data_units_read": int.from_bytes(raw[32:48], "little"),
            "data_units_written": int.from_bytes(raw[48:64], "little"),
            "power_on_hours": int.from_bytes(raw[128:144], "little"),
            "unsafe_shutdowns": int.from_bytes(raw[144:160], "little"),
            "media_errors": int.from_bytes(raw[160:176], "little"),
            "num_err_log_entries": int.from_bytes(raw[176:192], "little")
        }
    out[dev] = info
print(json.dumps(out, indent=2))
PYEOF

section "NETWORK_INTERFACES_AND_ROUTES"
ip -d link show
ip -br addr show
echo "--- IPv4 routes ---"
ip -4 route show table all
echo "--- IPv6 routes ---"
ip -6 route show table all
echo "--- Neighbor / Gateway table ---"
ip neigh show || true
echo "--- Resolver configuration ---"
grep -E -v '^\s*(#|$)' /etc/resolv.conf 2>/dev/null || true

section "FIREWALL_AND_PACKET_FILTER_BACKEND"
if command -v nft >/dev/null 2>&1; then
  nft --version || true
  nft list tables 2>/dev/null || true
fi
if command -v iptables >/dev/null 2>&1; then
  iptables --version || true
  iptables -S 2>/dev/null || true
fi
if command -v ip6tables >/dev/null 2>&1; then
  ip6tables -S 2>/dev/null || true
fi

section "ACCOUNTS_AND_SSH_PUBLIC_KEYS"
awk -F: '($3 == 0 || $3 >= 1000) {print $1 ":" $3 ":" $6 ":" $7}' /etc/passwd
if command -v sshd >/dev/null 2>&1; then
  sshd -T 2>/dev/null | grep -E '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication|kbdinteractiveauthentication|allowusers|allowgroups)' || true
fi
for auth_file in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
  if [ -f "$auth_file" ] && [ -r "$auth_file" ]; then
    echo "--- Fingerprints in $auth_file ---"
    ssh-keygen -lf "$auth_file" 2>/dev/null || true
  fi
done

section "RUNNING_SERVICES_AND_LISTENERS"
ss -tulnp || true
if command -v systemctl >/dev/null 2>&1; then
  systemctl list-units --type=service --state=running --no-pager --no-legend || true
fi
if command -v docker >/dev/null 2>&1; then
  docker ps -a 2>/dev/null || true
fi

section "CANDIDATE_DATA_DIRECTORIES"
ls -la /root /home /srv /opt /var/lib 2>/dev/null || true
du -sh /home/* /srv/* /opt/* /var/lib/* 2>/dev/null | head -n 60 || true
