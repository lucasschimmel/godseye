#!/usr/bin/env bash
# Trigger or inspect a Jenkins job on the private controller (run as root on godseye-pro).
#   p07-jenkins-build.sh trigger <job> [PARAM=value ...]
#   p07-jenkins-build.sh status  <job>
# Credentials come from the controller's root-only environment file and are never printed.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
ACTION="${1:?trigger|status}"
JOB="${2:?job name}"
shift 2 || true

JENKINS_URL="${GODSEYE_JENKINS_URL:-http://10.20.1.10:8080}"
# shellcheck disable=SC1091
source /etc/jenkins/casc.env
AUTH="${JENKINS_OWNER_ID}:${JENKINS_OWNER_PASSWORD}"
COOKIES="$(mktemp)"
trap 'rm -f "$COOKIES"' EXIT

case "$ACTION" in
  trigger)
    CRUMB="$(curl -fsS -c "$COOKIES" -u "$AUTH" \
      "${JENKINS_URL}/crumbIssuer/api/xml?xpath=concat(//crumbRequestField,%22:%22,//crumb)")"
    if [ "$#" -gt 0 ]; then
      QUERY=""
      for pair in "$@"; do QUERY="${QUERY:+${QUERY}&}${pair}"; done
      ENDPOINT="${JENKINS_URL}/job/${JOB}/buildWithParameters?${QUERY}"
    else
      ENDPOINT="${JENKINS_URL}/job/${JOB}/build?delay=0sec"
    fi
    curl -fsS -b "$COOKIES" -X POST -H "$CRUMB" -u "$AUTH" "$ENDPOINT"
    echo "JENKINS_BUILD_TRIGGERED ${JOB}"
    ;;
  status)
    curl -fsS -u "$AUTH" \
      "${JENKINS_URL}/job/${JOB}/lastBuild/api/json?tree=number,building,result,timestamp,duration,url"
    echo ""
    ;;
  *) echo "Unknown action: $ACTION" >&2; exit 1 ;;
esac
