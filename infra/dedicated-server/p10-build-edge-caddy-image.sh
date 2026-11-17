#!/usr/bin/env bash
# Executed on godseye-pro on 2026-11-15 (ledger entry 016). Builds the edge Caddy image WITH the OVH DNS-01 module
# (run as root on the pro guest, or any Docker host). Stock caddy images contain no DNS provider.
#
# Supply chain: the builder and the runtime base are pinned by sha256 digest (caller-supplied,
# verified by the owner), and xcaddy builds Caddy ${CADDY_VERSION} with github.com/caddy-dns/ovh at an
# exact tag (module path and latest tag v1.1.0 verified 2026-11-15; it depends on
# github.com/libdns/ovh v1.1.0). The result is referenced by its local IMAGE ID (`sha256:<64 hex>`),
# which p10-install-edge-caddy.sh accepts as a pinned reference.
#
# Usage:
#   GODSEYE_CADDY_BUILDER_IMAGE=docker.io/library/caddy@sha256:<digest of caddy:<version>-builder> \
#   GODSEYE_CADDY_BASE_IMAGE=docker.io/library/caddy@sha256:<digest of caddy:<version>> \
#   ./p10-build-edge-caddy-image.sh
# The last line printed is `GODSEYE_CADDY_IMAGE=sha256:<image id>`.
set -euo pipefail

CADDY_VERSION="${GODSEYE_CADDY_VERSION:-2.11.9}"
OVH_MODULE="${GODSEYE_CADDY_OVH_MODULE:-github.com/caddy-dns/ovh}"
OVH_MODULE_VERSION="${GODSEYE_CADDY_OVH_VERSION:-v1.1.0}"
IMAGE_TAG="${GODSEYE_EDGE_IMAGE_TAG:-godseye-edge-caddy:${CADDY_VERSION}-ovh-${OVH_MODULE_VERSION}}"

: "${GODSEYE_CADDY_BUILDER_IMAGE:?Set GODSEYE_CADDY_BUILDER_IMAGE to a digest-pinned caddy:<version>-builder image}"
: "${GODSEYE_CADDY_BASE_IMAGE:?Set GODSEYE_CADDY_BASE_IMAGE to a digest-pinned caddy:<version> image}"
for ref in "$GODSEYE_CADDY_BUILDER_IMAGE" "$GODSEYE_CADDY_BASE_IMAGE"; do
  case "$ref" in
    *REPLACE_ME*) echo "Replace the image digest placeholder first" >&2; exit 1 ;;
    *@sha256:????????????????????????????????????????????????????????????????) ;;
    *) echo "Builder and base images must be pinned by sha256 digest: $ref" >&2; exit 1 ;;
  esac
done
case "$CADDY_VERSION" in [0-9]*.[0-9]*.[0-9]*) ;; *) echo "GODSEYE_CADDY_VERSION must be X.Y.Z" >&2; exit 1 ;; esac
case "$OVH_MODULE_VERSION" in v[0-9]*.[0-9]*.[0-9]*) ;; *) echo "GODSEYE_CADDY_OVH_VERSION must be an exact vX.Y.Z tag" >&2; exit 1 ;; esac

CONTEXT_DIR="$(mktemp -d)"
trap 'rm -rf "$CONTEXT_DIR"' EXIT
cat >"${CONTEXT_DIR}/Dockerfile" <<'DOCKERFILE'
ARG BUILDER_IMAGE
ARG BASE_IMAGE
FROM ${BUILDER_IMAGE} AS build
ARG CADDY_VERSION
ARG OVH_MODULE
ARG OVH_MODULE_VERSION
RUN xcaddy build "v${CADDY_VERSION}" --with "${OVH_MODULE}@${OVH_MODULE_VERSION}"

FROM ${BASE_IMAGE}
COPY --from=build /usr/bin/caddy /usr/bin/caddy
DOCKERFILE

docker build \
  --build-arg "BUILDER_IMAGE=${GODSEYE_CADDY_BUILDER_IMAGE}" \
  --build-arg "BASE_IMAGE=${GODSEYE_CADDY_BASE_IMAGE}" \
  --build-arg "CADDY_VERSION=${CADDY_VERSION}" \
  --build-arg "OVH_MODULE=${OVH_MODULE}" \
  --build-arg "OVH_MODULE_VERSION=${OVH_MODULE_VERSION}" \
  --label "org.opencontainers.image.title=godseye-edge-caddy" \
  --label "godseye.edge.caddy-version=${CADDY_VERSION}" \
  --label "godseye.edge.dns-module=${OVH_MODULE}@${OVH_MODULE_VERSION}" \
  --label "godseye.edge.builder-image=${GODSEYE_CADDY_BUILDER_IMAGE}" \
  --label "godseye.edge.base-image=${GODSEYE_CADDY_BASE_IMAGE}" \
  -t "${IMAGE_TAG}" "${CONTEXT_DIR}"

# The DNS module must be compiled in before the image is accepted.
docker run --rm --entrypoint caddy "${IMAGE_TAG}" list-modules | grep -qx 'dns.providers.ovh' \
  || { echo "dns.providers.ovh missing from the built image" >&2; exit 1; }

IMAGE_ID="$(docker image inspect --format '{{.Id}}' "${IMAGE_TAG}")"
case "$IMAGE_ID" in
  sha256:????????????????????????????????????????????????????????????????) ;;
  *) echo "Unexpected image id: $IMAGE_ID" >&2; exit 1 ;;
esac
echo "Built ${IMAGE_TAG} (Caddy ${CADDY_VERSION}, ${OVH_MODULE}@${OVH_MODULE_VERSION})"
echo "GODSEYE_CADDY_IMAGE=${IMAGE_ID}"
