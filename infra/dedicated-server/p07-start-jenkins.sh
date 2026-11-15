#!/usr/bin/env bash
set -euo pipefail

install -d -m 0700 -o jenkins -g jenkins /etc/jenkins
if [ ! -f /etc/jenkins/casc.env ]; then
  PW="$(openssl rand -hex 24)"
  cat >/etc/jenkins/casc.env <<EOF
JENKINS_OWNER_ID=godseye-admin
JENKINS_OWNER_PASSWORD=${PW}
EOF
fi
chown jenkins:jenkins /etc/jenkins/casc.env
chmod 0600 /etc/jenkins/casc.env

if ! grep -q 'EnvironmentFile=/etc/jenkins/casc.env' /etc/systemd/system/jenkins.service.d/override.conf; then
  echo 'EnvironmentFile=/etc/jenkins/casc.env' >> /etc/systemd/system/jenkins.service.d/override.conf
fi

chown jenkins:jenkins /var/lib/jenkins/casc_configs/01-base.yaml
chmod 0640 /var/lib/jenkins/casc_configs/01-base.yaml

systemctl daemon-reload
systemctl reset-failed jenkins || true
systemctl start jenkins
sleep 5
systemctl is-active jenkins
ss -tlnp | grep -E '8080|8200|6379|:80' || true
