#!/usr/bin/env bash
set -euo pipefail

BAO_VERSION="2.7.2"
ARCHIVE="openbao_${BAO_VERSION}_linux_amd64.tar.gz"
BASE_URL="https://github.com/openbao/openbao/releases/download/v${BAO_VERSION}"

echo "[p07-bao] Downloading OpenBao v${BAO_VERSION} and verifying SHA256 digest..."
cd /tmp
EXPECTED_SHA="$(curl -fsSL "https://api.github.com/repos/openbao/openbao/releases/tags/v${BAO_VERSION}" | jq -r --arg name "${ARCHIVE}" '.assets[] | select(.name == $name) | .digest' | sed 's/^sha256://')"
test -n "${EXPECTED_SHA}"
curl -fsSLO "${BASE_URL}/${ARCHIVE}"
echo "${EXPECTED_SHA}  ${ARCHIVE}" | sha256sum -c -

tar -xzf "${ARCHIVE}" bao
install -m 0755 bao /usr/local/bin/bao
rm -f bao "${ARCHIVE}"
bao version

if ! id -u openbao >/dev/null 2>&1; then
  useradd --system --home /var/lib/openbao --shell /usr/sbin/nologin openbao
fi

mkdir -p /etc/openbao /var/lib/openbao/data
chown -R openbao:openbao /var/lib/openbao
chmod 700 /var/lib/openbao /var/lib/openbao/data

# Generate self-signed internal TLS cert for 10.20.1.10 + 127.0.0.1
if [ ! -f /etc/openbao/bao.crt ]; then
  openssl req -x509 -newkey rsa:4096 -sha256 -days 825 -nodes \
    -keyout /etc/openbao/bao.key -out /etc/openbao/bao.crt \
    -subj "/CN=openbao.godseye.internal" \
    -addext "subjectAltName=DNS:openbao.godseye.internal,IP:127.0.0.1,IP:10.20.1.10"
  chown root:openbao /etc/openbao/bao.key /etc/openbao/bao.crt
  chmod 640 /etc/openbao/bao.key
  chmod 644 /etc/openbao/bao.crt
fi

cat > /etc/openbao/openbao.hcl <<'EOF'
ui = false
disable_mlock = true

storage "raft" {
  path    = "/var/lib/openbao/data"
  node_id = "godseye-pro-bao-1"
}

listener "tcp" {
  address       = "127.0.0.1:8200"
  tls_cert_file = "/etc/openbao/bao.crt"
  tls_key_file  = "/etc/openbao/bao.key"
}

listener "tcp" {
  address       = "10.20.1.10:8200"
  tls_cert_file = "/etc/openbao/bao.crt"
  tls_key_file  = "/etc/openbao/bao.key"
}

api_addr     = "https://10.20.1.10:8200"
cluster_addr = "https://10.20.1.10:8201"
EOF
chown root:openbao /etc/openbao/openbao.hcl
chmod 640 /etc/openbao/openbao.hcl

cat > /etc/systemd/system/openbao.service <<'EOF'
[Unit]
Description=OpenBao Private Secrets Controller
Documentation=https://openbao.org/docs/
Requires=network-online.target
After=network-online.target

[Service]
User=openbao
Group=openbao
ProtectSystem=full
ProtectHome=read-only
PrivateTmp=yes
PrivateDevices=yes
SecureBits=keep-caps
AmbientCapabilities=CAP_IPC_LOCK
NoNewPrivileges=yes
ExecStart=/usr/local/bin/bao server -config=/etc/openbao/openbao.hcl
ExecReload=/bin/kill -HUP $MAINPID
KillMode=process
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now openbao.service
sleep 2

export BAO_ADDR="https://127.0.0.1:8200"
export BAO_CACERT="/etc/openbao/bao.crt"

if [ ! -f /root/openbao-init-DO-NOT-COMMIT.json ]; then
  umask 077
  bao operator init -key-shares=3 -key-threshold=2 -format=json > /root/openbao-init-DO-NOT-COMMIT.json
  chmod 600 /root/openbao-init-DO-NOT-COMMIT.json
  echo "[p07-bao] Initialized OpenBao (3 shares, threshold 2). Recovery JSON stored ONLY at /root/openbao-init-DO-NOT-COMMIT.json"
fi

# Unseal using 2 of 3 shares without echoing keys
K1="$(jq -r '.unseal_keys_b64[0]' /root/openbao-init-DO-NOT-COMMIT.json)"
K2="$(jq -r '.unseal_keys_b64[1]' /root/openbao-init-DO-NOT-COMMIT.json)"
bao operator unseal "${K1}" >/dev/null
bao operator unseal "${K2}" >/dev/null
unset K1 K2

bao status
