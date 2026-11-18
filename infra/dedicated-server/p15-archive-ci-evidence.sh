#!/usr/bin/env bash
# Keep CI proof outside Jenkins (DS15 / L4): per finished build the metadata, console log, JUnit
# summary and archived artifacts, plus a fingerprint of the loaded Jenkins configuration. Run as root
# on godseye-pro. Idempotent: an archived build (it has a MANIFEST.sha256) is never rewritten.
#
#   bash p15-archive-ci-evidence.sh                 archive every finished build not yet archived
#   bash p15-archive-ci-evidence.sh --install-timer also install the daily systemd timer
#   bash p15-archive-ci-evidence.sh --config-only   only refresh the configuration fingerprint
#
# Output (root:godseye 0750, no secret is ever written; Jenkins credentials are only used in memory):
#   /var/lib/godseye/ci-evidence/<job>/<build>/{meta.json,console.log,test-report.json,artifacts.zip,MANIFEST.sha256}
#   /var/lib/godseye/ci-evidence/jenkins-config/<UTC stamp>.json
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
CASC_ENV=/etc/jenkins/casc.env
JENKINS_URL="${GODSEYE_JENKINS_URL:-http://10.20.1.10:8080}"
OUT="${GODSEYE_CI_EVIDENCE_DIR:-/var/lib/godseye/ci-evidence}"
JOBS="${GODSEYE_CI_EVIDENCE_JOBS:-godseye-platform godseye-platform-candidate godseye-app-build}"
WINDOW="${GODSEYE_CI_EVIDENCE_WINDOW:-60}"
MODE="${1:-}"

# shellcheck disable=SC1090
source "$CASC_ENV"
AUTH="${JENKINS_OWNER_ID}:${JENKINS_OWNER_PASSWORD}"
get() { curl -g -fsS -u "$AUTH" "$@"; }

install -d -m 0750 -o root -g godseye "$OUT" "$OUT/jenkins-config"

config_fingerprint() {
  local stamp file casc casc_hash="unknown" casc_files="[]"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  file="$OUT/jenkins-config/${stamp}.json"
  # Jenkins loads every *.yaml of this directory (see the service drop-in); backups (*.bak*) are not loaded.
  casc="${GODSEYE_CASC_DIR:-/var/lib/jenkins/casc_configs}"
  if [ -d "$casc" ]; then
    casc_files="$(cd "$casc" && sha256sum -- *.yaml | jq -R -s -c 'split("\n") | map(select(length > 0) | split("  ") | {sha256: .[0], file: .[1]})')"
    casc_hash="sha256:$(cd "$casc" && cat -- *.yaml | sha256sum | cut -d' ' -f1)"
  fi
  local crumb cookie runtime
  cookie="$(mktemp)"
  crumb="$(get -c "$cookie" "$JENKINS_URL/crumbIssuer/api/xml?xpath=concat(//crumbRequestField,%22:%22,//crumb)")"
  runtime="$(get -b "$cookie" -H "$crumb" --data-urlencode \
    'script=def j = jenkins.model.Jenkins.get(); println "numExecutors=" + j.getNumExecutors() + ";mode=" + j.getMode() + ";agentPort=" + j.getSlaveAgentPort() + ";securityRealm=" + j.getSecurityRealm().getClass().getSimpleName() + ";authz=" + j.getAuthorizationStrategy().getClass().getSimpleName()' \
    "$JENKINS_URL/scriptText")"
  rm -f "$cookie"
  local plugins version
  plugins="$(get "$JENKINS_URL/pluginManager/api/json?depth=1&tree=plugins[shortName,version]" |
    jq -c '[.plugins[] | {n: .shortName, v: .version}] | sort_by(.n)')"
  version="$(get -D - -o /dev/null "$JENKINS_URL/api/json" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-jenkins"{print $2}')"
  jq -n --arg at "$(date -u +%FT%TZ)" --arg version "$version" --arg casc "$casc_hash" \
    --arg runtime "$runtime" --argjson plugins "$plugins" --argjson files "$casc_files" \
    '{observedAt: $at, jenkinsVersion: $version, loadedConfigurationDigest: $casc, loadedConfigurationFiles: $files, runtime: $runtime, plugins: $plugins}' >"$file"
  chown root:godseye "$file" && chmod 0640 "$file"
  echo "[p15] configuration fingerprint: ${file##*/} ($runtime)"
}

archive_build() {
  local job="$1" number="$2" dir="$OUT/$1/$2"
  [ -f "$dir/MANIFEST.sha256" ] && return 0
  install -d -m 0750 -o root -g godseye "$OUT/$job" "$dir"
  get "$JENKINS_URL/job/$job/$number/api/json?tree=number,result,building,timestamp,duration,url,actions[causes[shortDescription],parameters[name,value],lastBuiltRevision[SHA1]]" >"$dir/meta.json"
  get "$JENKINS_URL/job/$job/$number/consoleText" >"$dir/console.log"
  if get "$JENKINS_URL/job/$job/$number/testReport/api/json?tree=passCount,failCount,skipCount,duration,suites[name,duration]" >"$dir/test-report.json" 2>/dev/null; then :; else rm -f "$dir/test-report.json"; fi
  if get "$JENKINS_URL/job/$job/$number/artifact/*zip*/archive.zip" -o "$dir/artifacts.zip" 2>/dev/null; then :; else rm -f "$dir/artifacts.zip"; fi
  (cd "$dir" && sha256sum -- * >MANIFEST.sha256.tmp && mv MANIFEST.sha256.tmp MANIFEST.sha256)
  chown -R root:godseye "$dir" && chmod 0640 "$dir"/*
  echo "[p15] archived $job #$number"
}

config_fingerprint
[ "$MODE" = "--config-only" ] && exit 0

for job in $JOBS; do
  list="$(get "$JENKINS_URL/job/$job/api/json?tree=allBuilds[number,building]%7B0,${WINDOW}%7D" 2>/dev/null |
    jq -r '.allBuilds[] | select(.building == false) | .number' || true)"
  for number in $list; do archive_build "$job" "$number"; done
done

if [ "$MODE" = "--install-timer" ]; then
  cat >/etc/systemd/system/godseye-ci-evidence.service <<'UNIT'
[Unit]
Description=Archive finished Jenkins builds outside Jenkins
After=jenkins.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/godseye-archive-ci-evidence.sh
UNIT
  cat >/etc/systemd/system/godseye-ci-evidence.timer <<'UNIT'
[Unit]
Description=Daily CI evidence archive (after the nightly build)
[Timer]
OnCalendar=*-*-* 06:30:00 UTC
Persistent=true
[Install]
WantedBy=timers.target
UNIT
  install -m 0750 "$0" /usr/local/sbin/godseye-archive-ci-evidence.sh
  systemctl daemon-reload
  systemctl enable --now godseye-ci-evidence.timer
  echo "[p15] timer installed (daily 06:30 UTC)"
fi
echo "[p15] done: $OUT"
