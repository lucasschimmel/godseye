# OpenBao ACL policy `godseye-bindings-render`: read-only access to the provider binding documents that
# render-bindings.sh writes to tmpfs. It cannot list, write or read any other path (the control API's
# own AppRole keeps its wider policy).
path "godseye/data/bindings/*" {
  capabilities = ["read"]
}
