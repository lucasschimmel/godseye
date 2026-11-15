#!/usr/bin/env bash
set -euo pipefail

# 1. Verify read-only GitHub Deploy Key works
su -s /bin/bash jenkins -c 'GIT_SSH_COMMAND="ssh -i /var/lib/jenkins/.ssh/id_ed25519_github -o UserKnownHostsFile=/var/lib/jenkins/.ssh/known_hosts" git ls-remote git@github.com:lucasschimmel/godseye.git refs/heads/develop'

# 2. Trigger godseye-platform build via Jenkins crumb + API
source /etc/jenkins/casc.env
CRUMB=$(curl -fsS -c /tmp/jcookie -u "${JENKINS_OWNER_ID}:${JENKINS_OWNER_PASSWORD}" \
  'http://10.20.1.10:8080/crumbIssuer/api/xml?xpath=concat(//crumbRequestField,":",//crumb)')
curl -fsS -b /tmp/jcookie -X POST -H "$CRUMB" -u "${JENKINS_OWNER_ID}:${JENKINS_OWNER_PASSWORD}" \
  'http://10.20.1.10:8080/job/godseye-platform/build?delay=0sec'
rm -f /tmp/jcookie
echo "JENKINS_BUILD_TRIGGERED"
sleep 8
curl -fsS -u "${JENKINS_OWNER_ID}:${JENKINS_OWNER_PASSWORD}" \
  "http://10.20.1.10:8080/job/godseye-platform/lastBuild/api/json?tree=number,building,result"
echo ""
curl -fsS -u "${JENKINS_OWNER_ID}:${JENKINS_OWNER_PASSWORD}" \
  "http://10.20.1.10:8080/job/godseye-platform/lastBuild/consoleText" | tail -n 30
