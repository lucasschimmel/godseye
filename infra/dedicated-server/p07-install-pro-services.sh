#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

# 1. Redis + Java 21 + Caddy (from trixie-backports)
apt-get update -qq
apt-get install -y -qq redis-server openjdk-21-jre-headless curl gnupg2 fontconfig ca-certificates
apt-get install -y -qq -t trixie-backports caddy

# Ensure Redis binds only to localhost
if grep -qE '^bind ' /etc/redis/redis.conf; then
  sed -i 's/^bind .*/bind 127.0.0.1 -::1/' /etc/redis/redis.conf
fi
systemctl enable --now redis-server
redis-cli ping

# Configure Caddy privately on 10.20.1.10:80 until domain/HTTPS edge is ready
cat >/etc/caddy/Caddyfile <<'CADDYEOF'
{
	auto_https off
	admin off
}

http://10.20.1.10:80 {
	respond /healthz "godseye-caddy-private-ok" 200
	respond "godseye-pro private edge" 200
}
CADDYEOF
caddy validate --config /etc/caddy/Caddyfile
systemctl enable --now caddy

# 2. Jenkins LTS repository & installation
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://pkg.jenkins.io/debian-stable/jenkins.io-2026.key -o /etc/apt/keyrings/jenkins-keyring.asc
echo "deb [signed-by=/etc/apt/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian-stable binary/" >/etc/apt/sources.list.d/jenkins.list
apt-get update -qq
apt-get install -y -qq jenkins

systemctl stop jenkins || true

# 3. Jenkins systemd override: bind ONLY to 10.20.1.10:8080, disable setup wizard, enable JCasC
install -d -m 0755 /etc/systemd/system/jenkins.service.d
cat >/etc/systemd/system/jenkins.service.d/override.conf <<'EOF'
[Service]
Environment="JAVA_OPTS=-Djava.awt.headless=true -Djenkins.install.runSetupWizard=false"
Environment="JENKINS_OPTS=--httpListenAddress=10.20.1.10 --httpPort=8080"
Environment="CASC_JENKINS_CONFIG=/var/lib/jenkins/casc_configs/jenkins.yaml"
EOF

# 4. Install required Jenkins plugins
jenkins-plugin-cli --plugins \
  configuration-as-code \
  git \
  workflow-aggregator \
  ssh-slaves \
  junit \
  ws-cleanup \
  timestamper \
  credentials-binding \
  ansicolor

# 5. Prepare Jenkins SSH keypair for godseye-work agent
install -d -m 0700 -o jenkins -g jenkins /var/lib/jenkins/.ssh
if [ ! -f /var/lib/jenkins/.ssh/id_ed25519_work ]; then
  su -s /bin/bash jenkins -c 'ssh-keygen -t ed25519 -N "" -C "jenkins@godseye-pro" -f /var/lib/jenkins/.ssh/id_ed25519_work'
fi
chmod 0600 /var/lib/jenkins/.ssh/id_ed25519_work
chmod 0644 /var/lib/jenkins/.ssh/id_ed25519_work.pub
install -d -m 0755 -o jenkins -g jenkins /var/lib/jenkins/casc_configs

systemctl daemon-reload
echo "=== PUBKEY ==="
cat /var/lib/jenkins/.ssh/id_ed25519_work.pub
