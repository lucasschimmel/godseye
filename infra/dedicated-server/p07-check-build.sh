#!/usr/bin/env bash
set -euo pipefail
source /etc/jenkins/casc.env
BUILD="${1:-3}"
curl -fsS -u "${JENKINS_OWNER_ID}:${JENKINS_OWNER_PASSWORD}" \
  "http://10.20.1.10:8080/job/godseye-platform/${BUILD}/api/json?tree=number,building,result,duration" || true
echo ""
curl -fsS -u "${JENKINS_OWNER_ID}:${JENKINS_OWNER_PASSWORD}" \
  "http://10.20.1.10:8080/job/godseye-platform/${BUILD}/consoleText" | tail -n "${2:-90}" || true
