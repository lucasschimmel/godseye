pipeline {
  agent { label 'godseye-isolated-node24-bun144' }
  options {
    skipDefaultCheckout(true)
    disableConcurrentBuilds(abortPrevious: true)
    timeout(time: 45, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '10'))
    timestamps()
  }
  // Schedules and SCM polling are defined on the `godseye-platform` job (infra/jenkins/jenkins.yaml),
  // so the manual `godseye-platform-candidate` job never inherits them.
  environment {
    CI = 'true'
    PLAYWRIGHT_BROWSERS_PATH = '0'
  }
  stages {
    stage('Checkout trusted source') {
      steps {
        deleteDir()
        checkout scm
        sh 'node --version && test "$(bun --version)" = "1.4.4"'
      }
    }
    stage('Install locked dependencies') {
      steps { sh 'bun install --frozen-lockfile' }
    }
    stage('Install pinned OpenBao laboratory') {
      steps { sh 'bun run bao:install' }
    }
    stage('Static checks') {
      steps { sh 'bun run lint && bun run contracts:check && bun run typecheck' }
    }
    stage('Security and integration') {
      steps {
        // GHSA-fc5q-39xc-vjpf (picomatch ReDoS, <=4.0.7) has no patched release yet (4.0.7 is the latest) and is
        // reachable only through build-time glob patterns from our own config. Waived until a fix ships;
        // remove the --ignore as soon as `bun audit` is clean without it.
        sh 'bun audit --audit-level=high --ignore=GHSA-fc5q-39xc-vjpf'
        sh 'bun run test'
      }
    }
    stage('Build') {
      steps { sh 'bun run build && bun run smoke:built' }
    }
    stage('Isolated Linux runsc laboratory') {
      agent { label 'godseye-linux-userns-node24-bun144' }
      steps {
        checkout scm
        sh 'test "$(uname -s)" = "Linux" && node --version && test "$(bun --version)" = "1.4.4"'
        sh 'bun install --frozen-lockfile && bun run runsc:install && bun run test:infra:lab'
      }
      post {
        always {
          junit allowEmptyResults: false, testResults: 'artifacts/test-results/infra-lab.xml'
          archiveArtifacts allowEmptyArchive: false, artifacts: 'artifacts/test-results/infra-lab.xml'
        }
      }
    }
    stage('Browser journeys') {
      steps {
        sh 'bun run playwright install chromium'
        // One isolated application at a time: the full parallel start-up exhausts the 6 GiB agent.
        sh 'bun run test:e2e:sequential'
      }
    }
    // The native PostgreSQL and recovery laboratories need an Ubuntu 26.04 amd64 agent and live in
    // `Jenkinsfile.ubuntu-labs`; waiting for a label no agent carries stalled the whole pipeline.
  }
  post {
    always {
      script {
        if (fileExists('scripts/ci-report.mjs')) { sh 'node scripts/ci-report.mjs' }
      }
      junit allowEmptyResults: true, testResults: 'artifacts/test-results/*.xml'
      archiveArtifacts allowEmptyArchive: true, artifacts: 'artifacts/playwright-results/**,artifacts/playwright/**,artifacts/ci/**'
      deleteDir()
    }
  }
}
