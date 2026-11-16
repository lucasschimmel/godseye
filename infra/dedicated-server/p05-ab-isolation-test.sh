#!/usr/bin/env bash
set -euo pipefail

BASE="/srv/godseye/fixtures"
rm -rf "${BASE}"
mkdir -p "${BASE}/cell-a/data" "${BASE}/cell-b/data"
chown 10001:10001 "${BASE}/cell-a/data"
chown 10002:10002 "${BASE}/cell-b/data"
chmod 700 "${BASE}/cell-a/data" "${BASE}/cell-b/data"

echo "CELL_A_ISOLATION_TOKEN_ONLY" > "${BASE}/cell-a/data/token.txt"
echo "CELL_B_ISOLATION_TOKEN_ONLY" > "${BASE}/cell-b/data/token.txt"
chown 10001:10001 "${BASE}/cell-a/data/token.txt"
chown 10002:10002 "${BASE}/cell-b/data/token.txt"
chmod 600 "${BASE}/cell-a/data/token.txt" "${BASE}/cell-b/data/token.txt"

cat > "${BASE}/compose.yaml" <<'EOF'
networks:
  cell_a_net:
    driver: bridge
    internal: true
  cell_b_net:
    driver: bridge
    internal: true

services:
  cell-a-app:
    image: alpine:3.21@sha256:bc21487101ae47172509130ee1092cc273a831968d64b617776d1f69c81e42ab
    runtime: runsc
    user: "10001:10001"
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    mem_limit: 128m
    cpus: 0.5
    pids_limit: 32
    volumes:
      - /srv/godseye/fixtures/cell-a/data:/cell:ro
    networks:
      - cell_a_net
    command: ["sh", "-c", "sleep 120"]

  cell-b-app:
    image: alpine:3.21@sha256:bc21487101ae47172509130ee1092cc273a831968d64b617776d1f69c81e42ab
    runtime: runsc
    user: "10002:10002"
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    mem_limit: 128m
    cpus: 0.5
    pids_limit: 32
    volumes:
      - /srv/godseye/fixtures/cell-b/data:/cell:ro
    networks:
      - cell_b_net
    command: ["sh", "-c", "nc -lk -p 8080 -e /bin/true || sleep 120"]
EOF

docker compose -f "${BASE}/compose.yaml" up -d
sleep 2

CELL_B_IP="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' fixtures-cell-b-app-1)"
echo "[p05] cell-a kernel: $(docker exec fixtures-cell-a-app-1 uname -r)"
echo "[p05] cell-a uid: $(docker exec fixtures-cell-a-app-1 id)"
echo "[p05] cell-a own token: $(docker exec fixtures-cell-a-app-1 cat /cell/token.txt)"
echo "[p05] cell-b running: $(docker inspect -f '{{.State.Running}}' fixtures-cell-b-app-1) ip=${CELL_B_IP}"

if docker exec fixtures-cell-a-app-1 test -e /var/run/docker.sock; then
  echo "FAIL_DOCKER_SOCKET_VISIBLE"
  exit 1
else
  echo "PASS_NO_DOCKER_SOCKET"
fi

if docker exec fixtures-cell-a-app-1 nc -z -w 2 "${CELL_B_IP}" 8080 2>/dev/null; then
  echo "FAIL_CROSS_CELL_NET_REACHABLE"
  exit 1
else
  echo "PASS_CROSS_CELL_NET_BLOCKED (${CELL_B_IP}:8080)"
fi

echo "[p05] Testing PID limit containment in disposable runsc container (pids-limit=64)..."
docker run --rm --runtime=runsc --pids-limit=64 --memory=64m alpine:3.21@sha256:bc21487101ae47172509130ee1092cc273a831968d64b617776d1f69c81e42ab sh -c '
  i=0
  while [ $i -lt 90 ]; do
    sleep 2 &
    i=$((i+1))
  done
  wait
' 2>&1 | head -n 5 || true
echo "PASS_PID_LIMIT_CONTAINED_AND_CELL_B_ALIVE: $(docker inspect -f '{{.State.Running}}' fixtures-cell-b-app-1)"

echo "[p05] Cleaning up disposable A/B fixtures..."
docker compose -f "${BASE}/compose.yaml" down -v
rm -rf "${BASE}"
