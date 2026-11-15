#!/usr/bin/env bash
# Run as root ON godseye-pro (idempotent): installs the OpenBao -> tmpfs bindings renderer from the reviewed
# templates and starts it once. It does NOT enable it at boot and does NOT touch godseye-control-api: the
# control API only reads the rendered files after the owner adds the drop-in and restarts it, which must
# wait until a control API build that understands the work-VM transport is deployed here.
#   install-bindings-render.sh <directory containing the *.tmpl files>
#
# The AppRole credential is read from the existing root-only file and written, never printed, to two
# root-owned credential files. The control API's own AppRole is reused only because no dedicated read-only
# renderer AppRole exists yet; the owner should replace it (see docs/operations/evidence/work-vm-coding.md).
set -euo pipefail
umask 077

templates="${1:?template directory required}"
approle_env="/etc/godseye/openbao-approle.env"
libexec="/usr/local/libexec/godseye"
unit="/etc/systemd/system/godseye-bindings-render.service"

set -a; . "${approle_env}"; set +a
install -d -m 0755 "${libexec}"
install -m 0755 "${templates}/render-bindings.sh.tmpl" "${libexec}/render-bindings.sh"
sed -e "s#@@OPENBAO_ADDR@@#${OPENBAO_ADDR}#" -e "s#@@OPENBAO_CACERT@@#${OPENBAO_CACERT}#" \
  "${templates}/godseye-bindings-render.service.tmpl" > "${unit}"
chmod 0644 "${unit}"
printf '%s' "${OPENBAO_ROLE_ID}" > /etc/godseye/openbao-role-id
chown root:godseye /etc/godseye/openbao-role-id; chmod 0640 /etc/godseye/openbao-role-id
printf '%s' "${OPENBAO_SECRET_ID}" > /etc/godseye/openbao-secret-id
chown root:root /etc/godseye/openbao-secret-id; chmod 0600 /etc/godseye/openbao-secret-id
unset OPENBAO_ROLE_ID OPENBAO_SECRET_ID

runuser -u godseye -- test -r "${OPENBAO_CACERT}" || { echo "the service user cannot read the OpenBao CA file" >&2; exit 1; }
systemctl daemon-reload
systemctl restart godseye-bindings-render.service
echo "render service state: $(systemctl is-active godseye-bindings-render.service)"
ls -l /run/godseye-bindings | awk 'NR>1{print $1, $3, $NF}'
