# OpenBao ACL policy `godseye-raft-snapshot`: take a raft snapshot and nothing else.
path "sys/storage/raft/snapshot" {
  capabilities = ["read"]
}
