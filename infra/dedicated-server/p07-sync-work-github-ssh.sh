#!/usr/bin/env bash
set -euo pipefail

# Copy read-only github key and ssh config from jenkins on godseye-pro to jenkins-agent on godseye-work
scp -o BatchMode=yes -o UserKnownHostsFile=/var/lib/jenkins/.ssh/known_hosts -i /var/lib/jenkins/.ssh/id_ed25519_work \
  /var/lib/jenkins/.ssh/id_ed25519_github \
  /var/lib/jenkins/.ssh/config \
  jenkins-agent@10.20.3.10:/home/jenkins-agent/.ssh/

ssh -o BatchMode=yes -o UserKnownHostsFile=/var/lib/jenkins/.ssh/known_hosts -i /var/lib/jenkins/.ssh/id_ed25519_work jenkins-agent@10.20.3.10 \
  "chmod 0600 /home/jenkins-agent/.ssh/id_ed25519_github /home/jenkins-agent/.ssh/config && sed -i 's|/var/lib/jenkins/.ssh|/home/jenkins-agent/.ssh|g' /home/jenkins-agent/.ssh/config"

# Trigger build #3
source /etc/jenkins/casc.env
CRUMB=$(curl -fsS -c /tmp/jcookie -u "${JENKINS_OWNER_ID}:${JENKINS_OWNER_PASSWORD}" \
  'http://10.20.1.10:8080/crumbIssuer/api/xml?xpath=concat(//crumbRequestField,":",//crumb)')
curl -fsS -b /tmp/jcookie -X POST -H "$CRUMB" -u "${JENKINS_OWNER_ID}:${JENKINS_OWNER_PASSWORD}" \
  'http://10.20.1.10:8080/job/godseye-platform/build'
rm -f /tmp/jcookie
echo "BUILD_3_TRIGGERED"
