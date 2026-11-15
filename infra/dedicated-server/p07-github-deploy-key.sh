#!/usr/bin/env bash
set -euo pipefail

if [ ! -f /var/lib/jenkins/.ssh/id_ed25519_github ]; then
  ssh-keygen -t ed25519 -N "" -C "jenkins-ro@godseye-pro" -f /var/lib/jenkins/.ssh/id_ed25519_github
fi
chown jenkins:jenkins /var/lib/jenkins/.ssh/id_ed25519_github /var/lib/jenkins/.ssh/id_ed25519_github.pub
chmod 0600 /var/lib/jenkins/.ssh/id_ed25519_github
chmod 0644 /var/lib/jenkins/.ssh/id_ed25519_github.pub

# Add github.com to known_hosts for jenkins
ssh-keyscan -H github.com >> /var/lib/jenkins/.ssh/known_hosts 2>/dev/null
sort -u /var/lib/jenkins/.ssh/known_hosts -o /var/lib/jenkins/.ssh/known_hosts
chown jenkins:jenkins /var/lib/jenkins/.ssh/known_hosts
chmod 0644 /var/lib/jenkins/.ssh/known_hosts

# Update /etc/jenkins/casc.env
grep -q '^GODSEYE_SOURCE_URL=' /etc/jenkins/casc.env || echo 'GODSEYE_SOURCE_URL=git@github.com:lucasschimmel/godseye.git' >> /etc/jenkins/casc.env
grep -q '^GODSEYE_SOURCE_CREDENTIALS_ID=' /etc/jenkins/casc.env || echo 'GODSEYE_SOURCE_CREDENTIALS_ID=godseye-github-ssh' >> /etc/jenkins/casc.env

cat >/var/lib/jenkins/casc_configs/02-work-agent.yaml <<'EOF'
credentials:
  system:
    domainCredentials:
      - credentials:
          - basicSSHUserPrivateKey:
              scope: SYSTEM
              id: "godseye-work-ssh"
              username: "jenkins-agent"
              description: "SSH key for isolated godseye-work build VM"
              privateKeySource:
                directEntry:
                  privateKey: "${readFile:/var/lib/jenkins/.ssh/id_ed25519_work}"
          - basicSSHUserPrivateKey:
              scope: SYSTEM
              id: "godseye-github-ssh"
              username: "git"
              description: "Read-only GitHub Deploy Key for lucasschimmel/godseye"
              privateKeySource:
                directEntry:
                  privateKey: "${readFile:/var/lib/jenkins/.ssh/id_ed25519_github}"

jenkins:
  nodes:
    - permanent:
        name: "godseye-work"
        nodeDescription: "Isolated build VM (10.20.3.10)"
        remoteFS: "/home/jenkins-agent/workspace"
        numExecutors: 2
        mode: EXCLUSIVE
        labelString: "godseye-isolated-node24-bun144 godseye-linux-userns-node24-bun144 godseye-ubuntu2604-amd64-node24-bun144"
        retentionStrategy: "always"
        launcher:
          ssh:
            host: "10.20.3.10"
            port: 22
            credentialsId: "godseye-work-ssh"
            sshHostKeyVerificationStrategy: "knownHostsFileKeyVerificationStrategy"
EOF

chown jenkins:jenkins /var/lib/jenkins/casc_configs/02-work-agent.yaml
chmod 0640 /var/lib/jenkins/casc_configs/02-work-agent.yaml

systemctl restart jenkins
sleep 5
systemctl is-active jenkins
echo "=== GITHUB_DEPLOY_PUBKEY ==="
cat /var/lib/jenkins/.ssh/id_ed25519_github.pub
