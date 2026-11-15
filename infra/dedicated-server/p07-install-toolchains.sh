#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg unzip git jq

# Install Node.js 24.x (Nodesource)
if ! node --version 2>/dev/null | grep -q '^v24\.'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

# Install pinned Bun 1.4.4
if [ ! -x /usr/local/bin/bun ] || [ "$(/usr/local/bin/bun --version 2>/dev/null || true)" != "1.4.4" ]; then
  curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s "bun-v1.4.4"
fi

echo "Node: $(node --version)"
echo "Bun:  $(bun --version)"
