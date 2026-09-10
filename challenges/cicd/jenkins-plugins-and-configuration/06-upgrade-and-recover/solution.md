### maintenance.yaml

```yaml
operations:
  - backup
  - build
  - boot
  - smoke
  - promote
  - restore
```

### Dockerfile

```dockerfile
FROM jenkins/jenkins:lab-core-2-jdk21
COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt
COPY jenkins.yaml /usr/share/jenkins/ref/jenkins.yaml
ENV CASC_JENKINS_CONFIG=/usr/share/jenkins/ref/jenkins.yaml
```

### plugins.txt

```text
configuration-as-code:lab-2
git:lab-2
git-client:lab-2
workflow-aggregator:lab-2
```

The healthy candidate is promoted without restoration. The migration-failure case restores the matching old image and state, leaves the controller running, and records no promotion. Removing backup or smoke cannot pass.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins Configuration as Code](https://www.jenkins.io/doc/book/managing/casc/).
