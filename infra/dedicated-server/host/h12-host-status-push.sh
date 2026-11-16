#!/usr/bin/env bash
# h12-host-status-push.sh - install the host->pro status push (root on godseye-wg, from the staged directory).
#
#   h12-host-status-push.sh keygen                    create the restricted identity, print the PUBLIC key
#   h12-host-status-push.sh install <fingerprint>     pin pro's SSH host key (SHA256:... must match what
#                                                     the caller read on the VM itself), install the sender
#                                                     and a systemd drop-in that pushes after each health run
# Rollback: rm /etc/godseye/status-push.{key,key.pub,known_hosts} /usr/local/sbin/godseye-host-status-push
# and /etc/systemd/system/godseye-host-health.service.d/50-status-push.conf, then systemctl daemon-reload.
set -euo pipefail
umask 077

HERE="$(cd "$(dirname "$0")" && pwd)"
CONF=/etc/godseye
KEY="$CONF/status-push.key"
KNOWN="$CONF/status-push.known_hosts"
PRO="${GODSEYE_STATUS_PRO_ADDRESS:-10.20.1.10}"

case "${1:-}" in
  keygen)
    mkdir -p "$CONF"
    chmod 700 "$CONF"
    [ -s "$KEY" ] || ssh-keygen -q -t ed25519 -N "" -C "godseye-host-status-push" -f "$KEY"
    cat "$KEY.pub"
    ;;
  install)
    WANT="${2:?expected the SHA256 fingerprint of the VM ssh host key}"
    [ -s "$KEY" ] || { echo "run keygen first" >&2; exit 1; }
    SCAN="$(ssh-keyscan -t ed25519 "$PRO" 2>/dev/null)"
    [ -n "$SCAN" ] || { echo "ssh-keyscan returned nothing" >&2; exit 1; }
    GOT="$(printf '%s\n' "$SCAN" | ssh-keygen -lf - | awk '{print $2}')"
    if [ "$GOT" != "$WANT" ]; then
      echo "host key fingerprint mismatch: refusing to pin" >&2
      exit 1
    fi
    printf '%s\n' "$SCAN" >"$KNOWN"
    install -m 0750 "$HERE/bin/godseye-host-status-push" /usr/local/sbin/godseye-host-status-push
    install -d -m 0755 /etc/systemd/system/godseye-host-health.service.d
    printf '[Service]\nExecStartPost=-/usr/local/sbin/godseye-host-status-push\n' \
      >/etc/systemd/system/godseye-host-health.service.d/50-status-push.conf
    systemctl daemon-reload
    /usr/local/sbin/godseye-host-status-push
    echo "HOST_STATUS_PUSH_INSTALLED"
    ;;
  *)
    echo "usage: $0 keygen | install <fingerprint>" >&2
    exit 64
    ;;
esac
