#!/usr/bin/env bash
# Create the private registry credentials WITHOUT any human typing or pasting a password.
# Run as root on godseye-pro before p10-install-registry.sh. Idempotent; --rotate replaces the password.
#
#   /etc/zot/htpasswd                         bcrypt entry the registry authenticates against (root:zot 0640)
#   /etc/godseye/registry-credentials.json    { "user", "password" } for the control API (godseye 0600)
#   /etc/godseye/registry-agent.password      same password for `docker login` on the build agent (root 0600),
#                                             copied to the agent over SSH by the agent installer, never printed
#
# The password is generated from /dev/urandom here and is never echoed, logged or committed.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
REGISTRY_USER="${GODSEYE_REGISTRY_USER:-godseye-apps}"
HTPASSWD=/etc/zot/htpasswd
CREDENTIALS=/etc/godseye/registry-credentials.json
AGENT_PASSWORD=/etc/godseye/registry-agent.password
ROTATE="${1:-}"

if [ -s "$HTPASSWD" ] && [ -s "$CREDENTIALS" ] && [ "$ROTATE" != "--rotate" ]; then
  echo "[p15-registry] credentials already exist (use --rotate to replace); nothing changed"
  exit 0
fi
python3 -c 'import bcrypt' || { echo "python3-bcrypt is required" >&2; exit 1; }

umask 077
PASSWORD="$(head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | head -c 40)"
id -u zot >/dev/null 2>&1 || useradd --system --home /var/lib/zot --shell /usr/sbin/nologin zot
install -d -m 0750 -o root -g zot /etc/zot
install -d -m 0750 -o root -g godseye /etc/godseye

# The password reaches python on stdin only (never in argv, where `ps` could show it).
printf '%s' "$PASSWORD" | REGISTRY_USER="$REGISTRY_USER" python3 -c '
import bcrypt, os, sys
password = sys.stdin.buffer.read()
hashed = bcrypt.hashpw(password, bcrypt.gensalt(rounds=12)).decode()
sys.stdout.write(os.environ["REGISTRY_USER"] + ":" + hashed + "\n")
' >"${HTPASSWD}.new"
chown root:zot "${HTPASSWD}.new" && chmod 0640 "${HTPASSWD}.new" && mv "${HTPASSWD}.new" "$HTPASSWD"

printf '%s' "$PASSWORD" | REGISTRY_USER="$REGISTRY_USER" python3 -c '
import json, os, sys
sys.stdout.write(json.dumps({"user": os.environ["REGISTRY_USER"], "password": sys.stdin.read()}) + "\n")
' >"${CREDENTIALS}.new"
chown godseye:godseye "${CREDENTIALS}.new" && chmod 0600 "${CREDENTIALS}.new" && mv "${CREDENTIALS}.new" "$CREDENTIALS"

printf '%s' "$PASSWORD" >"${AGENT_PASSWORD}.new"
chown root:root "${AGENT_PASSWORD}.new" && chmod 0600 "${AGENT_PASSWORD}.new" && mv "${AGENT_PASSWORD}.new" "$AGENT_PASSWORD"
unset PASSWORD
echo "[p15-registry] credentials for '${REGISTRY_USER}' created (htpasswd, control-api JSON, agent password file); value never printed"
