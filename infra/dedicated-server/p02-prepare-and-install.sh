#!/usr/bin/env bash
set -euo pipefail

echo "[p02-install] Wiping existing partition tables and signatures on nvme0n1 and nvme1n1..."
wipefs -af /dev/nvme0n1 /dev/nvme1n1 || true
sgdisk --zap-all /dev/nvme0n1
sgdisk --zap-all /dev/nvme1n1
partprobe /dev/nvme0n1 /dev/nvme1n1 || true

echo "[p02-install] Generating ephemeral high-entropy root password hash..."
ROOT_HASH="$(openssl rand -base64 32 | openssl passwd -6 -stdin)"

cat > /tmp/answer.toml <<EOF
[global]
keyboard = "en-us"
country = "fr"
fqdn = "pve.godseye.internal"
mailto = "admin@godseye.internal"
timezone = "UTC"
root-password-hashed = "${ROOT_HASH}"
root-ssh-keys = [
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFg+MorwPCB4BioMyEJHEyyEVIhATolpLS4FPpSAXi3P godseye-workstation-admin",
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBNaiuY8q8BfBmMZ9MnYuSwAG/CSNuSJk/NMPvHE5g9F godseye-emergency-rescue"
]
reboot-on-error = false
reboot-mode = "power-off"

[network]
source = "from-dhcp"

[disk-setup]
filesystem = "zfs"
zfs.raid = "raid1"
zfs.ashift = 12
zfs.compress = "lz4"
disk-list = ["nvme0n1", "nvme1n1"]

[first-boot]
source = "from-iso"
ordering = "before-network"
EOF
unset ROOT_HASH

echo "[p02-install] Validating answer.toml..."
proxmox-auto-install-assistant validate-answer /tmp/answer.toml

chmod +x /tmp/p02-first-boot.sh

echo "[p02-install] Preparing automated Proxmox VE 9.2-1 ISO..."
rm -f /tmp/proxmox-ve_9.2-1-auto.iso
proxmox-auto-install-assistant prepare-iso /tmp/proxmox-ve_9.2-1.iso \
  --fetch-from iso \
  --answer-file /tmp/answer.toml \
  --on-first-boot /tmp/p02-first-boot.sh \
  --output /tmp/proxmox-ve_9.2-1-auto.iso

rm -f /tmp/answer.toml

echo "[p02-install] Launching unattended QEMU/KVM UEFI install onto bare-metal NVMe drives..."
qemu-system-x86_64 \
  -enable-kvm \
  -cpu host \
  -smp 6 \
  -m 4096 \
  -bios /usr/share/ovmf/OVMF.fd \
  -cdrom /tmp/proxmox-ve_9.2-1-auto.iso \
  -boot d \
  -drive file=/dev/nvme0n1,format=raw,if=none,id=nvme0,cache=none,aio=native \
  -device nvme,serial=S675NU0W263145,drive=nvme0 \
  -drive file=/dev/nvme1n1,format=raw,if=none,id=nvme1,cache=none,aio=native \
  -device nvme,serial=S675NX0T801950,drive=nvme1 \
  -nic user,model=virtio-net-pci \
  -display none \
  -no-reboot

echo "[p02-install] QEMU exited cleanly. Verifying partition tables on both NVMe drives..."
sgdisk -p /dev/nvme0n1
sgdisk -p /dev/nvme1n1
