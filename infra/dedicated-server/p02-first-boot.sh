#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="/var/log/godseye-p02-firstboot.log"
exec > >(tee -a "${LOG_FILE}") 2>&1

echo "[godseye-p02-firstboot] Starting at $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 1. Detect physical uplink NIC by hardware MAC address (fallback to enp5s0)
UPLINK_MAC="c8:7f:54:70:5b:fe"
UPLINK_IF="$(ip -o link show | awk -F': ' -v mac="${UPLINK_MAC}" 'tolower($0) ~ mac {print $2; exit}' | cut -d@ -f1)"
if [[ -z "${UPLINK_IF}" ]]; then
  UPLINK_IF="enp5s0"
fi
echo "[godseye-p02-firstboot] Detected uplink interface: ${UPLINK_IF}"

# 2. Configure Hetzner dual-stack routed networking (before-network hook)
cat > /etc/network/interfaces <<EOF
auto lo
iface lo inet loopback

auto ${UPLINK_IF}
iface ${UPLINK_IF} inet static
    address 65.108.38.218/32
    pointopop 65.108.38.193
    gateway 65.108.38.193
    mtu 1500

iface ${UPLINK_IF} inet6 static
    address 2a01:4f9:3080:344e::2/128
    gateway fe80::1
    mtu 1500
EOF

cat > /etc/resolv.conf <<'EOF'
nameserver 185.12.64.1
nameserver 185.12.64.2
nameserver 2a01:4ff:ff00::add:1
nameserver 2a01:4ff:ff00::add:2
EOF

# 3. Ensure /etc/hosts resolves pve.godseye.internal cleanly
cat > /etc/hosts <<'EOF'
127.0.0.1 localhost.localdomain localhost
65.108.38.218 pve.godseye.internal pve
2a01:4f9:3080:344e::2 pve.godseye.internal pve

::1 ip6-localhost ip6-loopback
fe00::0 ip6-localnet
ff00::0 ip6-mcastprefix
ff02::1 ip6-allnodes
ff02::2 ip6-allrouters
ff02::3 ip6-allhosts
EOF

# 4. Enforce ZFS ARC ceiling (4 GiB) and enable autotrim on rpool
mkdir -p /etc/modprobe.d
cat > /etc/modprobe.d/zfs.conf <<'EOF'
options zfs zfs_arc_max=4294967296
EOF

if [[ -w /sys/module/zfs/parameters/zfs_arc_max ]]; then
  echo 4294967296 > /sys/module/zfs/parameters/zfs_arc_max || true
fi

zpool set autotrim=on rpool || true

# 5. Configure Proxmox no-subscription repository and disable enterprise repos
for f in /etc/apt/sources.list.d/pve-enterprise.sources /etc/apt/sources.list.d/ceph.sources; do
  if [[ -f "${f}" ]]; then
    if ! grep -q '^Enabled:' "${f}"; then
      echo 'Enabled: false' >> "${f}"
    else
      sed -i 's/^Enabled:.*/Enabled: false/' "${f}"
    fi
  fi
done

for f in /etc/apt/sources.list.d/pve-enterprise.list /etc/apt/sources.list.d/ceph.list; do
  if [[ -f "${f}" ]]; then
    sed -i 's/^[[:space:]]*deb /# deb /' "${f}"
  fi
done

cat > /etc/apt/sources.list.d/pve-no-subscription.sources <<'EOF'
Types: deb
URIs: http://download.proxmox.com/debian/pve
Suites: trixie
Components: pve-no-subscription
Signed-By: /usr/share/keyrings/proxmox-archive-keyring.gpg
EOF

# 6. Harden SSH (key-only root login, no password auth)
mkdir -p /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/99-godseye-hardening.conf <<'EOF'
PermitRootLogin prohibit-password
PubkeyAuthentication yes
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
EOF

chmod 700 /root/.ssh
chmod 600 /root/.ssh/authorized_keys

# 7. Sync dual-ESP UEFI bootloaders and register bare-metal UEFI NVRAM entries
proxmox-boot-tool refresh || true

echo "[godseye-p02-firstboot] Completed successfully at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
