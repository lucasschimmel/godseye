#!/usr/bin/env bash
set -euo pipefail

echo "JENKINS_HTTP=$(curl -s -o /dev/null -w '%{http_code}' http://10.20.1.10:8080/login)"
echo "CADDY_HEALTHZ=$(curl -s http://10.20.1.10:80/healthz)"
source /etc/jenkins/casc.env
curl -fsS -u "${JENKINS_OWNER_ID}:${JENKINS_OWNER_PASSWORD}" \
  "http://10.20.1.10:8080/computer/godseye-work/api/json?tree=displayName,offline,temporarilyOffline,numExecutors"
echo ""
curl -fsS -u "${JENKINS_OWNER_ID}:${JENKINS_OWNER_PASSWORD}" \
  "http://10.20.1.10:8080/job/godseye-platform/api/json?tree=name,buildable"
echo ""
