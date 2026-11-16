pipeline {
  agent { label 'godseye-isolated-node24-bun144' }
  options {
    skipDefaultCheckout(true)
    disableConcurrentBuilds(abortPrevious: true)
    timeout(time: 30, unit: 'MINUTES')
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
        sh 'bun audit --audit-level=high'
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
    stage('Independent PostgreSQL laboratory') {
      agent { label 'godseye-ubuntu2604-amd64-node24-bun144' }
      steps {
        checkout scm
        sh 'test "$(uname -s)" = "Linux" && test "$(uname -m)" = "x86_64" && node --version && test "$(bun --version)" = "1.4.4"'
        sh 'bun install --frozen-lockfile && bun run postgres:install && bun run test:database:lab'
      }
      post {
        always {
          junit allowEmptyResults: false, testResults: 'artifacts/test-results/pg-lab.xml'
          archiveArtifacts allowEmptyArchive: false, artifacts: 'artifacts/test-results/pg-lab.xml,artifacts/test-results/pg-lab-report.json'
        }
      }
    }
    stage('Paused PostgreSQL recovery laboratory') {
      agent { label 'godseye-ubuntu2604-amd64-node24-bun144' }
      steps {
        checkout scm
        sh 'test "$(uname -s)" = "Linux" && test "$(uname -m)" = "x86_64" && node --version && test "$(bun --version)" = "1.4.4"'
        sh 'bun install --frozen-lockfile && bun run postgres:install && bun run postgres:recovery:install && bun run test:recovery:lab'
      }
      post {
        always {
          junit allowEmptyResults: false, testResults: 'artifacts/test-results/recovery-lab.xml'
          archiveArtifacts allowEmptyArchive: false, artifacts: 'artifacts/test-results/recovery-lab.xml,artifacts/test-results/recovery-lab-observation.json'
        }
      }
    }
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
