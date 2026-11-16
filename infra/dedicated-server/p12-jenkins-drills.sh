#!/usr/bin/env bash
# P12: Jenkins operational drills on the real controller and agent (run as root on godseye-pro).
# Uses throwaway jobs named gdy-drill-* (never the platform jobs) that only echo/sleep on the work
# agent, and deletes them at the end. Credentials come from the root-only /etc/jenkins/casc.env and
# are never printed.
#   p12-jenkins-drills.sh offline      agent offline: build waits in the queue, runs once the agent is back
#   p12-jenkins-drills.sh cancel       a running build is aborted, the agent is released, no process remains
#   p12-jenkins-drills.sh retention    buildDiscarder numToKeep=3 keeps only the three newest of six
#   p12-jenkins-drills.sh missed       controller stopped across schedule ticks: no catch-up burst afterwards
#   p12-jenkins-drills.sh cleanup      delete every gdy-drill-* job and bring the agent online
# The missed-schedule drill restarts Jenkins (about one minute): run it when no build is active.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
URL="${GODSEYE_JENKINS_URL:-http://10.20.1.10:8080}"
NODE="${GODSEYE_JENKINS_NODE:-godseye-work}"
# shellcheck disable=SC1091
source /etc/jenkins/casc.env
AUTH="${JENKINS_OWNER_ID}:${JENKINS_OWNER_PASSWORD}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

crumb() { curl -fsS -c "$JAR" -u "$AUTH" "${URL}/crumbIssuer/api/json" | jq -r '.crumbRequestField + ":" + .crumb'; }
post() { curl -fsS -b "$JAR" -H "$(crumb)" -u "$AUTH" -X POST "$@"; }
get() { curl -fsS -u "$AUTH" "${URL}/$1"; }

job_xml() { # job_xml <shell step> [extra properties/triggers xml]
  cat <<XML
<flow-definition plugin="workflow-job">
  <description>G.O.D.S.E.Y.E drill job (throwaway)</description>
  <keepDependencies>false</keepDependencies>
  <properties>${2:-}</properties>
  <definition class="org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition" plugin="workflow-cps">
    <script>node('${NODE}') { sh '$1' }</script>
    <sandbox>true</sandbox>
  </definition>
  <triggers>${3:-}</triggers>
  <disabled>false</disabled>
</flow-definition>
XML
}
create_job() { # create_job <name> <xml on stdin>
  get "job/$1/api/json" >/dev/null 2>&1 && post "${URL}/job/$1/doDelete" >/dev/null
  post -H 'Content-Type: application/xml' --data-binary @- "${URL}/createItem?name=$1" >/dev/null
}
trigger() { post "${URL}/job/$1/build?delay=0sec" >/dev/null; }
last_field() { get "job/$1/lastBuild/api/json?tree=$2" | jq -r ".$2"; }
wait_build() { # wait_build <job> <seconds> ; waits until lastBuild is not building
  local i
  for i in $(seq 1 "$2"); do
    [ "$(last_field "$1" building 2>/dev/null || echo true)" = "false" ] && return 0
    sleep 1
  done
  return 1
}
online() { [ "$(get "computer/${NODE}/api/json?tree=offline" | jq -r .offline)" = "false" ]; }

case "${1:-}" in
  offline)
    job_xml "echo drill-offline-ok" | create_job gdy-drill-offline
    post "${URL}/computer/${NODE}/toggleOffline?offlineMessage=gdy-drill" >/dev/null
    sleep 3
    ! online || { echo "DRILL_OFFLINE_FAIL node did not go offline" >&2; exit 1; }
    trigger gdy-drill-offline
    sleep 25
    # A pipeline build starts on the controller and then waits for an executor on the labelled agent.
    N="$(last_field gdy-drill-offline number)"
    STATE="$(last_field gdy-drill-offline building)"
    WAITING="$(curl -fsS -u "$AUTH" "${URL}/job/gdy-drill-offline/${N}/consoleText" | grep -c -E 'Still waiting|Running on|Waiting for next available executor|drill-offline-ok' || true)"
    RAN="$(curl -fsS -u "$AUTH" "${URL}/job/gdy-drill-offline/${N}/consoleText" | grep -c '^drill-offline-ok' || true)"
    if [ "$STATE" != "true" ] || [ "$RAN" != "0" ]; then
      echo "DRILL_OFFLINE_FAIL build ran or ended while the agent was offline (building=${STATE})" >&2
      post "${URL}/computer/${NODE}/toggleOffline" >/dev/null
      exit 1
    fi
    echo "build ${N} is waiting for an executor while the agent is offline (log lines about waiting: ${WAITING})"
    post "${URL}/computer/${NODE}/toggleOffline" >/dev/null
    sleep 5
    online || { echo "DRILL_OFFLINE_FAIL node did not return online" >&2; exit 1; }
    wait_build gdy-drill-offline 90 || { echo "DRILL_OFFLINE_FAIL build did not run after the agent returned" >&2; exit 1; }
    [ "$(last_field gdy-drill-offline result)" = "SUCCESS" ] && echo "DRILL_OFFLINE_PASS (queued while offline, ran and succeeded after the agent returned)"
    ;;
  cancel)
    job_xml "sleep 600" | create_job gdy-drill-cancel
    trigger gdy-drill-cancel
    for _ in $(seq 1 60); do [ "$(last_field gdy-drill-cancel building 2>/dev/null || echo false)" = "true" ] && break; sleep 1; done
    sleep 10
    N="$(last_field gdy-drill-cancel number)"
    post "${URL}/job/gdy-drill-cancel/${N}/stop" >/dev/null
    wait_build gdy-drill-cancel 60 || { echo "DRILL_CANCEL_FAIL build still running" >&2; exit 1; }
    R="$(last_field gdy-drill-cancel result)"
    [ "$R" = "ABORTED" ] || { echo "DRILL_CANCEL_FAIL result ${R}" >&2; exit 1; }
    sleep 5
    LEFT="$(get "computer/${NODE}/api/json?tree=executors%5Bidle%5D" | jq '[.executors[] | select(.idle==false)] | length')"
    echo "DRILL_CANCEL_PASS result=ABORTED busy executors afterwards=${LEFT} (check on the agent: no 'sleep 600' process)"
    ;;
  retention)
    job_xml "echo retention" '<jenkins.model.BuildDiscarderProperty><strategy class="hudson.tasks.LogRotator"><daysToKeep>-1</daysToKeep><numToKeep>3</numToKeep><artifactDaysToKeep>-1</artifactDaysToKeep><artifactNumToKeep>-1</artifactNumToKeep></strategy></jenkins.model.BuildDiscarderProperty>' | create_job gdy-drill-retention
    for _ in 1 2 3 4 5 6; do trigger gdy-drill-retention; sleep 12; done
    wait_build gdy-drill-retention 90 || true
    sleep 10
    KEPT="$(get 'job/gdy-drill-retention/api/json?tree=builds%5Bnumber%5D' | jq -r '[.builds[].number] | sort | join(",")')"
    COUNT="$(echo "$KEPT" | tr ',' '\n' | grep -c .)"
    [ "$COUNT" -le 3 ] || { echo "DRILL_RETENTION_FAIL kept ${KEPT}" >&2; exit 1; }
    echo "DRILL_RETENTION_PASS kept builds: ${KEPT} (numToKeep=3; the platform jobs keep 30)"
    ;;
  missed)
    job_xml "echo tick" '' '<hudson.triggers.TimerTrigger><spec>* * * * *</spec></hudson.triggers.TimerTrigger>' | create_job gdy-drill-missed
    for _ in $(seq 1 90); do [ "$(get 'job/gdy-drill-missed/api/json?tree=builds%5Bnumber%5D' | jq '.builds | length')" -ge 1 ] && break; sleep 2; done
    BEFORE="$(last_field gdy-drill-missed number)"
    echo "first scheduled tick ran as build ${BEFORE}; stopping Jenkins for 200 s (3 ticks missed)"
    systemctl stop jenkins
    sleep 200
    systemctl start jenkins
    RESTARTED="$(date +%s)"
    for _ in $(seq 1 90); do get 'login' >/dev/null 2>&1 && break; sleep 3; done
    sleep 100
    TICKS=$(( ($(date +%s) - RESTARTED) / 60 + 1 ))
    SINCE_MS=$((RESTARTED * 1000))
    ADDED="$(get 'job/gdy-drill-missed/api/json?tree=builds%5Bnumber,timestamp%5D' | jq --argjson s "$SINCE_MS" '[.builds[] | select(.timestamp >= $s)] | length')"
    echo "ticks since restart: ${TICKS}; builds started since restart: ${ADDED} (3 ticks fell into the downtime)"
    # Jenkins may fire one duplicate on the first tick after start; a replay of the missed ticks would exceed this.
    [ "$ADDED" -le $((TICKS + 1)) ] || { echo "DRILL_MISSED_FAIL catch-up burst" >&2; exit 1; }
    online || echo "note: agent not yet reconnected"
    echo "DRILL_MISSED_PASS (missed ticks are not replayed; Jenkins resumes at the next tick)"
    ;;
  cleanup)
    for j in $(get 'api/json?tree=jobs%5Bname%5D' | jq -r '.jobs[].name | select(startswith("gdy-drill-"))'); do
      post "${URL}/job/${j}/doDelete" >/dev/null && echo "deleted ${j}"
    done
    online || post "${URL}/computer/${NODE}/toggleOffline" >/dev/null
    echo "DRILL_CLEANUP_DONE agent online: $(online && echo yes || echo no)"
    ;;
  *)
    echo "usage: $0 offline|cancel|retention|missed|cleanup" >&2
    exit 64
    ;;
esac
