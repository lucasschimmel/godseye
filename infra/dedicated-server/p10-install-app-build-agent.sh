#!/usr/bin/env bash
# TEMPLATE - reviewed but NOT executed. Installs the server-owned build script on the isolated build agent.
set -euo pipefail
SOURCE="${1:?path to infra/jenkins/app-build/build-app.sh}"
install -d -m 0755 /opt/godseye
install -m 0755 "${SOURCE}" /opt/godseye/build-app.sh
# Agent environment (OWNER INPUTS, rendered by OpenBao, never committed):
#   GODSEYE_REGISTRY            registry authority, e.g. 10.20.1.10:5000
#   GODSEYE_BASE_IMAGE_STATIC   digest-pinned static base image  (name@sha256:...)
#   GODSEYE_BASE_IMAGE_NODE     digest-pinned node base image    (name@sha256:...)
#   TRIVY_CACHE_DIR             defaults to /var/cache/godseye-trivy
# The agent must be a disposable guest that is NOT the pro VM production Docker daemon, and the
# `jenkins` user needs `docker login` credentials for the registry.
for tool in docker jq trivy sha256sum; do command -v "${tool}" >/dev/null; done
echo "[p10-agent] installed /opt/godseye/build-app.sh"
