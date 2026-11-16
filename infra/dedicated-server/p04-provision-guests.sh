#!/usr/bin/env bash
set -euo pipefail

IMAGE_PATH="/var/lib/vz/template/iso/debian-13-genericcloud-amd64.qcow2"
echo "[p04] Verifying image digest..."
sha256sum "${IMAGE_PATH}"

# Ensure link-local fe80::1/64 exists on vmbr1 and vmbr2 for clean /128 IPv6 guest routing
if ! grep -q "fe80::1/64" /etc/network/interfaces; then
  sed -i '/address 2a01:4f9:3080:344e::1:1\/128/a \    post-up ip -6 addr replace fe80::1/64 dev vmbr1' /etc/network/interfaces
  sed -i '/address 2a01:4f9:3080:344e::2:1\/128/a \    post-up ip -6 addr replace fe80::1/64 dev vmbr2' /etc/network/interfaces
  ifreload -a
fi

# Enable snippets on local storage
pvesm set local --content iso,vztmpl,backup,snippets

mkdir -p /var/lib/vz/snippets
cat > /var/lib/vz/snippets/godseye-guest-vendor.yaml <<'EOF'
#cloud-config
package_update: true
packages:
  - qemu-guest-agent
  - curl
  - ca-certificates
  - gnupg
  - chrony
runcmd:
  - systemctl enable --now qemu-guest-agent
  - systemctl enable --now chrony
  - sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
  - sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  - systemctl reload ssh || systemctl reload sshd || true
EOF

# Write public SSH keys file for cloud-init
cat > /tmp/godseye-authorized.pub <<'EOF'
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFg+MorwPCB4BioMyEJHEyyEVIhATolpLS4FPpSAXi3P godseye-workstation-admin
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBNaiuY8q8BfBmMZ9MnYuSwAG/CSNuSJk/NMPvHE5g9F godseye-emergency-rescue
EOF

create_vm() {
  local vmid="$1"
  local name="$2"
  local memory="$3"
  local cores="$4"
  local cpulimit="$5"
  local disk_size="$6"
  local bridge="$7"
  local ipconfig="$8"
  local onboot="$9"
  local startup="${10}"

  if qm status "${vmid}" >/dev/null 2>&1; then
    echo "[p04] VM ${vmid} (${name}) already exists, skipping creation."
    return 0
  fi

  echo "[p04] Creating VM ${vmid} (${name})..."
  qm create "${vmid}" \
    --name "${name}" \
    --memory "${memory}" \
    --balloon 0 \
    --cores "${cores}" \
    --cpulimit "${cpulimit}" \
    --cpu host \
    --ostype l26 \
    --scsihw virtio-scsi-single \
    --net0 "virtio,bridge=${bridge}" \
    --serial0 socket \
    --vga serial0 \
    --agent enabled=1 \
    --onboot "${onboot}" \
    --startup "${startup}"

  qm importdisk "${vmid}" "${IMAGE_PATH}" local-zfs --format raw
  qm set "${vmid}" \
    --scsi0 "local-zfs:vm-${vmid}-disk-0,discard=on,ssd=1" \
    --boot order=scsi0 \
    --ide2 local-zfs:cloudinit \
    --ciuser root \
    --sshkeys /tmp/godseye-authorized.pub \
    --nameserver "185.12.64.1 185.12.64.2" \
    --ipconfig0 "${ipconfig}" \
    --cicustom "vendor=local:snippets/godseye-guest-vendor.yaml"

  qm disk resize "${vmid}" scsi0 "${disk_size}"
}

create_vm 100 "godseye-pro"   32768 6 3   "200G" "vmbr1" "ip=10.20.1.10/24,gw=10.20.1.1,ip6=2a01:4f9:3080:344e::100/128,gw6=fe80::1" 1 "order=1,up=10"
create_vm 200 "godseye-games" 16384 4 2   "80G"  "vmbr2" "ip=10.20.2.10/24,gw=10.20.2.1,ip6=2a01:4f9:3080:344e::200/128,gw6=fe80::1" 1 "order=2,up=10"
create_vm 300 "godseye-work"  6144  2 0.5 "20G"  "vmbr3" "ip=10.20.3.10/24,gw=10.20.3.1,ip6=fd47:6f64:7365:3::10/64,gw6=fd47:6f64:7365:3::1" 0 "order=3,up=10"

rm -f /tmp/godseye-authorized.pub

echo "[p04] Starting VMs 100, 200, and 300 for P04 qualification..."
qm start 100 || true
qm start 200 || true
qm start 300 || true

qm list
zfs list
