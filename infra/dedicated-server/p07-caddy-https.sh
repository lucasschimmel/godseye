#!/usr/bin/env bash
# SUPERSEDED. The host-systemd Caddy that this script installed (and that served the P07 evidence in
# docs/operations/evidence/p07-delivery-and-platform.txt) cannot join the per-environment --internal
# Docker networks of the delivery runtime. The edge now runs as the container `godseye-edge`;
# use infra/dedicated-server/p10-install-edge-caddy.sh (template, not executed) instead.
echo "p07-caddy-https.sh is superseded by p10-install-edge-caddy.sh (container edge)." >&2
exit 1
