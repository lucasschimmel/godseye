#!/usr/bin/env bash
set -euo pipefail

# Ensure isolated bridge networks exist for prod and dev cells
docker network inspect godseye_prod_net >/dev/null 2>&1 || \
  docker network create --driver bridge --internal godseye_prod_net
docker network inspect godseye_dev_net >/dev/null 2>&1 || \
  docker network create --driver bridge --internal godseye_dev_net

docker pull -q alpine:3.21@sha256:bc21487101ae47172509130ee1092cc273a831968d64b617776d1f69c81e42ab

for CELL in prod dev; do
  NAME="godseye-cell-${CELL}-app"
  NET="godseye_${CELL}_net"
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d \
    --name "$NAME" \
    --restart unless-stopped \
    --runtime=runsc \
    --network "$NET" \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=32m \
    --cap-drop=ALL \
    --security-opt=no-new-privileges \
    --pids-limit=64 \
    --memory=128m \
    --cpus=0.25 \
    alpine:3.21@sha256:bc21487101ae47172509130ee1092cc273a831968d64b617776d1f69c81e42ab \
    sh -c "while true; do sleep 30; done"
done

sleep 2
docker ps --filter "name=godseye-cell-" --format "table {{.Names}}\t{{.Status}}\t{{.Networks}}"
docker exec godseye-cell-prod-app uname -r
docker exec godseye-cell-dev-app uname -r
