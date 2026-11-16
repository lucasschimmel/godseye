#!/usr/bin/env bash
# Apply infra/jenkins/jenkins.yaml (Configuration as Code) to the private Jenkins on godseye-pro.
# Run as root. Keeps the previous file and restores it if Jenkins does not come back with the expected
# jobs. Restarting Jenkins aborts a running build, so run it between builds.
#
#   bash p07-update-jenkins-jobs.sh [path/to/jenkins.yaml]
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }

SRC="${1:-$(dirname "$0")/../jenkins/jenkins.yaml}"
CASC_DIR=/var/lib/jenkins/casc_configs
TARGET="${CASC_DIR}/01-base.yaml"
BACKUP="${TARGET}.bak-before-main"
JENKINS_URL="${GODSEYE_JENKINS_URL:-http://10.20.1.10:8080}"
EXPECTED_JOBS="${GODSEYE_EXPECTED_JOBS:-godseye-platform godseye-platform-candidate}"

[ -f "$SRC" ] || { echo "Missing $SRC" >&2; exit 1; }
[ -f "$TARGET" ] || { echo "Missing $TARGET (is this the Jenkins guest?)" >&2; exit 1; }

wait_ready() {
  local i
  for i in $(seq 1 40); do
    case "$(curl -s -o /dev/null -w '%{http_code}' "${JENKINS_URL}/login" || true)" in
      200|403) return 0 ;;
    esac
    sleep 3
  done
  return 1
}

jobs_present() {
  local job
  for job in $EXPECTED_JOBS; do
    [ -d "/var/lib/jenkins/jobs/${job}" ] || { echo "Job missing: ${job}" >&2; return 1; }
  done
}

cp -p "$TARGET" "$BACKUP"
install -o jenkins -g jenkins -m 0640 "$SRC" "$TARGET"
systemctl restart jenkins

if wait_ready && jobs_present; then
  echo "JENKINS_JOBS_UPDATED"
else
  echo "Jenkins did not come back with the expected jobs; restoring the previous configuration." >&2
  install -o jenkins -g jenkins -m 0640 "$BACKUP" "$TARGET"
  systemctl restart jenkins
  wait_ready || echo "WARNING: Jenkins is not answering after the rollback" >&2
  echo "JENKINS_ROLLED_BACK"
  exit 1
fi
