#!/usr/bin/env bash
set -euo pipefail

echo "[p05] Installing prerequisites..."
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg lsb-release jq nftables

echo "[p05] Configuring official Docker apt repository (Debian trixie)..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

cat > /etc/apt/sources.list.d/docker.sources <<'EOF'
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: trixie
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF

echo "[p05] Configuring official gVisor (runsc) apt repository..."
curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" > /etc/apt/sources.list.d/gvisor.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin runsc

echo "[p05] Registering gVisor runsc (systrap) in /etc/docker/daemon.json..."
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "default-address-pools": [
    {
      "base": "10.21.0.0/16",
      "size": 24
    }
  ],
  "ipv6": true,
  "fixed-cidr-v6": "fd47:6f64:7365:1000::/64",
  "ip6tables": true,
  "experimental": false,
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "runtimes": {
    "runsc": {
      "path": "/usr/bin/runsc",
      "runtimeArgs": [
        "--platform=systrap"
      ]
    }
  }
}
EOF

systemctl enable --now docker
systemctl restart docker

echo "[p05] Versions:"
docker --version
docker compose version
runsc --version

echo "[p05] Qualifying gVisor (runsc systrap) container execution..."
docker run --rm --runtime=runsc alpine:3.21 uname -a
