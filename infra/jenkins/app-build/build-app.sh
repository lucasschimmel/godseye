#!/usr/bin/env bash
# Server-owned build script for delivered applications. Runs ONLY on the isolated build agent.
# It ignores any Dockerfile/script in the repository: the Dockerfile is generated from the recipe kind.
# Inputs are Jenkins job parameters exported as environment variables (validated below).
set -euo pipefail

re() { [[ "$2" =~ $1 ]] || { echo "invalid parameter: $3" >&2; exit 64; }; }
re '^[a-f0-9]{40}$' "${SOURCE_COMMIT:-}" SOURCE_COMMIT
re '^[a-z0-9]+([._-][a-z0-9]+)*$' "${IMAGE_NAME:-}" IMAGE_NAME
re '^(static|node)$' "${RECIPE_KIND:-}" RECIPE_KIND
re '^(\.|[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*)$' "${RECIPE_CONTEXT:-}" RECIPE_CONTEXT
re '^[a-f0-9-]{36}$' "${RUN_ID:-}" RUN_ID
re '^[0-9]{1,4}$' "${MAX_ARTIFACT_MIB:-}" MAX_ARTIFACT_MIB
: "${GODSEYE_REGISTRY:?}" "${GODSEYE_BASE_IMAGE_STATIC:?}" "${GODSEYE_BASE_IMAGE_NODE:?}"
CACHE="${TRIVY_CACHE_DIR:-/var/cache/godseye-trivy}"
OUT="${WORKSPACE:-$PWD}"
CONTEXT_DIR="${OUT}/${RECIPE_CONTEXT}"
test -d "${CONTEXT_DIR}" || { echo "context directory missing" >&2; exit 65; }

DOCKERFILE="${OUT}/.godseye.Dockerfile"
if [ "${RECIPE_KIND}" = static ]; then
  printf 'FROM %s\nCOPY . /usr/share/nginx/html\nEXPOSE 8080\n' "${GODSEYE_BASE_IMAGE_STATIC}" >"${DOCKERFILE}"
else
  printf 'FROM %s\nWORKDIR /app\nCOPY . .\nRUN npm ci --omit=dev --ignore-scripts\nUSER 65532:65532\nEXPOSE 8080\nCMD ["npm","start"]\n' \
    "${GODSEYE_BASE_IMAGE_NODE}" >"${DOCKERFILE}"
fi

REPO="${GODSEYE_REGISTRY}/apps/${IMAGE_NAME}"
TAG="build-${RUN_ID}"   # a tag keeps the digest alive under registry GC, which is what enables rollback
docker build --no-cache --pull=false -f "${DOCKERFILE}" -t "${REPO}:${TAG}" "${CONTEXT_DIR}"
docker push "${REPO}:${TAG}"
DIGEST="$(docker inspect --format '{{index .RepoDigests 0}}' "${REPO}:${TAG}")"
DIGEST="${DIGEST##*@}"
re '^sha256:[a-f0-9]{64}$' "${DIGEST}" DIGEST

trivy --cache-dir "${CACHE}" image --scanners vuln --format json --output "${OUT}/trivy.json" \
  --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL "${REPO}@${DIGEST}"
DB_DIGEST="sha256:$(sha256sum "${CACHE}/db/trivy.db" | cut -d' ' -f1)"
TRIVY_VERSION="$(trivy --version | head -n1 | sed 's/^Version: //')"

# The controller re-verifies digest and size against the registry; this document is only a claim.
# Only checks that actually ran are listed: a policy requiring any other check name fails closed.
jq -n --arg digest "${DIGEST}" --arg dbd "${DB_DIGEST}" --arg tv "${TRIVY_VERSION}" \
  --slurpfile report "${OUT}/trivy.json" '
  def count(s): [$report[0].Results[]?.Vulnerabilities[]? | select(.Severity == s)] | length;
  { version: 1,
    imageDigest: $digest,
    checks: [{name: "build", passed: true}, {name: "image-scan", passed: true}],
    scanner: { scannerId: "trivy", version: $tv, databaseDigest: $dbd, artifactDigest: $digest,
      findings: { critical: count("CRITICAL"), high: count("HIGH"), medium: count("MEDIUM"),
                  low: count("LOW"), unknown: count("UNKNOWN") } },
    migration: { class: "none", hash: ("0" * 64) },
    builderId: "jenkins:godseye-app-build" }' >"${OUT}/evidence.json"
echo "evidence written for ${DIGEST}"
