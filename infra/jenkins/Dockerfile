FROM jenkins/jenkins:2.580.2-jdk21@sha256:74401de6a6f92e1afe1b02d1c8e3d0c33f263bfb5275dd8813f9150355f2367b

COPY --chown=jenkins:jenkins infra/jenkins/plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --latest=false --plugin-file /usr/share/jenkins/ref/plugins.txt
COPY --chown=jenkins:jenkins infra/jenkins/jenkins.yaml /usr/share/jenkins/ref/jenkins.yaml
ENV CASC_JENKINS_CONFIG=/usr/share/jenkins/ref/jenkins.yaml
ENV JAVA_OPTS=-Djenkins.install.runSetupWizard=false
