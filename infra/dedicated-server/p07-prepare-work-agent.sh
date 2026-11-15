#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq openjdk-21-jre-headless git curl ca-certificates

if ! id jenkins-agent >/dev/null 2>&1; then
  useradd -m -s /bin/bash jenkins-agent
fi

install -d -m 0700 -o jenkins-agent -g jenkins-agent /home/jenkins-agent/.ssh
install -d -m 0755 -o jenkins-agent -g jenkins-agent /home/jenkins-agent/workspace
touch /home/jenkins-agent/.ssh/authorized_keys
chown jenkins-agent:jenkins-agent /home/jenkins-agent/.ssh/authorized_keys
chmod 0600 /home/jenkins-agent/.ssh/authorized_keys

java -version 2>&1 | head -n 2
node -v
bun -v
