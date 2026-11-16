#!/usr/bin/env bash
set -euo pipefail

install -d -m 0700 -o jenkins -g jenkins /var/lib/jenkins/.ssh
if [ ! -f /var/lib/jenkins/.ssh/id_ed25519_work ]; then
  ssh-keygen -t ed25519 -N "" -C "jenkins@godseye-pro" -f /var/lib/jenkins/.ssh/id_ed25519_work
fi
chown jenkins:jenkins /var/lib/jenkins/.ssh/id_ed25519_work /var/lib/jenkins/.ssh/id_ed25519_work.pub
chmod 0600 /var/lib/jenkins/.ssh/id_ed25519_work
chmod 0644 /var/lib/jenkins/.ssh/id_ed25519_work.pub
install -d -m 0755 -o jenkins -g jenkins /var/lib/jenkins/casc_configs
systemctl daemon-reload
cat /var/lib/jenkins/.ssh/id_ed25519_work.pub
