#!/usr/bin/env bash
set -euo pipefail

cat >/var/lib/jenkins/.ssh/config <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile /var/lib/jenkins/.ssh/id_ed25519_github
  IdentitiesOnly yes
EOF
chown jenkins:jenkins /var/lib/jenkins/.ssh/config
chmod 0600 /var/lib/jenkins/.ssh/config

# Trigger build #2
source /etc/jenkins/casc.env
CRUMB=$(curl -fsS -c /tmp/jcookie -u "${JENKINS_OWNER_ID}:${JENKINS_OWNER_PASSWORD}" \
  'http://10.20.1.10:8080/crumbIssuer/api/xml?xpath=concat(//crumbRequestField,":",//crumb)')
curl -fsS -b /tmp/jcookie -X POST -H "$CRUMB" -u "${JENKINS_OWNER_ID}:${JENKINS_OWNER_PASSWORD}" \
  'http://10.20.1.10:8080/job/godseye-platform/build'
rm -f /tmp/jcookie
sleep 6
curl -fsS -u "${JENKINS_OWNER_ID}:${JENKINS_OWNER_PASSWORD}" \
  "http://10.20.1.10:8080/job/godseye-platform/lastBuild/api/json?tree=number,building,result"
echo ""
curl -fsS -u "${JENKINS_OWNER_ID}:${JENKINS_OWNER_PASSWORD}" \
  "http://10.20.1.10:8080/job/godseye-platform/lastBuild/consoleText" | head -n 30
