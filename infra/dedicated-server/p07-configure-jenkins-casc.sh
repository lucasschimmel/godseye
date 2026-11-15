#!/usr/bin/env bash
set -euo pipefail

sed -i 's|CASC_JENKINS_CONFIG=/var/lib/jenkins/casc_configs/jenkins.yaml|CASC_JENKINS_CONFIG=/var/lib/jenkins/casc_configs|' /etc/systemd/system/jenkins.service.d/override.conf
systemctl daemon-reload

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

chown -R jenkins:jenkins /var/lib/jenkins/casc_configs
chmod 0640 /var/lib/jenkins/casc_configs/*.yaml

systemctl enable --now jenkins
sleep 5
systemctl is-active jenkins
ss -tlnp | grep -E '8080|8200|6379|:80' || true
