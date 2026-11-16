#!/usr/bin/env bash
# Give the control API a read-only Jenkins identity so the console can list the platform builds.
# Run as root on godseye-pro, between builds (applying the Jenkins configuration restarts the controller).
#
#   bash p14-platform-jenkins-reader.sh [path/to/jenkins.yaml]
#
# The reader password is generated here, stored only in root-only files and never printed:
#   /etc/jenkins/casc.env                      JENKINS_READER_ID / JENKINS_READER_PASSWORD (Jenkins reads them)
#   /etc/godseye/platform-jenkins.token        the same password, readable by the godseye user only
#   /etc/godseye/platform-jenkins.json         { baseUrl, user, tokenPath } binding for the control API
#   /etc/godseye/control-api.env               GODSEYE_PLATFORM_JENKINS_BINDING=<binding path>
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }

HERE="$(dirname "$0")"
CASC_ENV=/etc/jenkins/casc.env
CONF_DIR=/etc/godseye
TOKEN_FILE="${CONF_DIR}/platform-jenkins.token"
BINDING_FILE="${CONF_DIR}/platform-jenkins.json"
API_ENV="${CONF_DIR}/control-api.env"
READER_ID="${GODSEYE_JENKINS_READER_ID:-godseye-reader}"
JENKINS_URL="${GODSEYE_JENKINS_URL:-http://10.20.1.10:8080}"

[ -f "$CASC_ENV" ] || { echo "Missing $CASC_ENV (is this the Jenkins guest?)" >&2; exit 1; }

if ! grep -q '^JENKINS_READER_PASSWORD=' "$CASC_ENV"; then
  PASSWORD="$(head -c 32 /dev/urandom | base64 | tr -d '/+=\n' | head -c 40)"
  {
    echo "JENKINS_READER_ID=${READER_ID}"
    echo "JENKINS_READER_PASSWORD=${PASSWORD}"
  } >>"$CASC_ENV"
else
  PASSWORD="$(grep -m1 '^JENKINS_READER_PASSWORD=' "$CASC_ENV" | cut -d= -f2-)"
  READER_ID="$(grep -m1 '^JENKINS_READER_ID=' "$CASC_ENV" | cut -d= -f2-)"
fi

install -d -m 0750 -o root -g godseye "$CONF_DIR"
umask 077
printf '%s' "$PASSWORD" >"${TOKEN_FILE}.new"
chown godseye:godseye "${TOKEN_FILE}.new"
chmod 0600 "${TOKEN_FILE}.new"
mv "${TOKEN_FILE}.new" "$TOKEN_FILE"

printf '{"baseUrl":"%s","user":"%s","tokenPath":"%s"}\n' "$JENKINS_URL" "$READER_ID" "$TOKEN_FILE" >"${BINDING_FILE}.new"
chown godseye:godseye "${BINDING_FILE}.new"
chmod 0600 "${BINDING_FILE}.new"
mv "${BINDING_FILE}.new" "$BINDING_FILE"

if ! grep -q '^GODSEYE_PLATFORM_JENKINS_BINDING=' "$API_ENV"; then
  echo "GODSEYE_PLATFORM_JENKINS_BINDING=${BINDING_FILE}" >>"$API_ENV"
fi

bash "${HERE}/p07-update-jenkins-jobs.sh" "${1:-${HERE}/../jenkins/jenkins.yaml}"

# Prove the identity can read but not administer, without printing the password.
read_code="$(curl -s -o /dev/null -w '%{http_code}' -u "${READER_ID}:${PASSWORD}" "${JENKINS_URL}/job/godseye-platform/api/json")"
admin_code="$(curl -s -o /dev/null -w '%{http_code}' -u "${READER_ID}:${PASSWORD}" "${JENKINS_URL}/manage")"
echo "reader job-read=${read_code} manage=${admin_code} (expected 200 and 403)"
