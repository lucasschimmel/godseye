#!/usr/bin/env bash
# TEMPLATE - reviewed but NOT executed. Installs Trivy on the isolated BUILD agent (not on the controller).
set -euo pipefail

TRIVY_VERSION="${TRIVY_VERSION:-0.76.2}"            # verified latest on 2026-11-15; re-check before running
ARCHIVE="trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz"
BASE_URL="https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}"
CACHE_DIR="${TRIVY_CACHE_DIR:-/var/cache/godseye-trivy}"

cd /tmp
curl -fsSLO "${BASE_URL}/${ARCHIVE}"
curl -fsSLO "${BASE_URL}/trivy_${TRIVY_VERSION}_checksums.txt"
grep " ${ARCHIVE}\$" "trivy_${TRIVY_VERSION}_checksums.txt" | sha256sum -c -
tar -xzf "${ARCHIVE}" trivy
install -m 0755 trivy /usr/local/bin/trivy
rm -f trivy "${ARCHIVE}" "trivy_${TRIVY_VERSION}_checksums.txt"

install -d -m 0750 -o jenkins -g jenkins "${CACHE_DIR}"
sudo -u jenkins trivy --cache-dir "${CACHE_DIR}" image --download-db-only
trivy --version
# build-app.sh hashes ${CACHE_DIR}/db/trivy.db into the evidence document as the scanner database digest.
echo "[p10-trivy] installed ${TRIVY_VERSION}; schedule 'trivy image --download-db-only' (e.g. daily) as the jenkins user"
