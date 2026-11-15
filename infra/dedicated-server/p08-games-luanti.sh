#!/usr/bin/env bash
set -euo pipefail

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
  lscr.io/linuxserver/luanti:latest

sleep 8
docker ps --filter "name=godseye-luanti" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
ls -la /var/lib/godseye-games/luanti/
