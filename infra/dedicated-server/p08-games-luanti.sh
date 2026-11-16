#!/usr/bin/env bash
set -euo pipefail

# Pinned by manifest-list digest (the :latest tag resolved to this digest on 2026-11-15). Change it only
# after a fresh backup and a restore check; an unpinned reference is refused.
LUANTI_IMAGE="${GODSEYE_LUANTI_IMAGE:-lscr.io/linuxserver/luanti@sha256:49f780ef18334e7ad22b9bcc25f68a7a3dddd7259c8d48b0671cce2622cc2fec}"
case "$LUANTI_IMAGE" in
  *@sha256:????????????????????????????????????????????????????????????????) ;;
  *) echo "LUANTI_IMAGE must be pinned by sha256 digest" >&2; exit 1 ;;
esac

install -d -m 0755 /var/lib/godseye-games/luanti /var/backups/godseye-games

docker rm -f godseye-luanti >/dev/null 2>&1 || true
docker run -d \
  --name godseye-luanti \
  --restart unless-stopped \
  -p 10.20.2.10:30000:30000/udp \
  -e PUID=1000 \
  -e PGID=1000 \
  -e TZ=UTC \
  -v /var/lib/godseye-games/luanti:/config/.minetest \
  --memory=1024m \
  --cpus=1.5 \
  "${LUANTI_IMAGE}"

sleep 8
docker ps --filter "name=godseye-luanti" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
ls -la /var/lib/godseye-games/luanti/
