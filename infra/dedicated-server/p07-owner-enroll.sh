#!/usr/bin/env bash
# Run by the OWNER on godseye-pro as root, interactively:
#   ssh -t <host> "bash /opt/godseye-edge-staging/infra/dedicated-server/p07-owner-enroll.sh"
# Prints a single-use passkey enrollment link (valid ten minutes). The link must only be shown to the
# owner's terminal: do not run this through an automated agent and do not paste the link anywhere.
#
# `owner-cli setup` talks to the RUNNING control API over loopback (signed local command), so the API
# must stay up. Only `owner:recover --offline` needs it stopped.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
[ -t 1 ] || { echo "Interactive terminal required (ssh -t)." >&2; exit 1; }

ENV_FILE=/etc/godseye/control-api.env
[ -r "$ENV_FILE" ] || { echo "Missing $ENV_FILE" >&2; exit 1; }
systemctl is-active --quiet godseye-control-api || { echo "The control API is not running." >&2; exit 1; }

cd /opt/godseye
# Same environment as the service (server mode, public origin, state directory) without printing it.
# The config directory is root-only (systemd reads it as root), so root loads the file and hands the
# variables to the CLI, which then runs as the service user (`runuser -m` keeps the environment).
(
  set -a
  . "$ENV_FILE"
  set +a
  exec runuser -u godseye -m -- node --import tsx apps/control-api/src/owner-cli.ts setup
)
