### maintenance.yaml

```yaml
operations:
  - build
  - boot
  - smoke
  - promote
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

### jenkins.yaml

```yaml
jenkins:
  systemMessage: Checkout controller managed by code
  numExecutors: 0
  mode: EXCLUSIVE
  securityRealm:
    local:
      allowsSignup: false
      users:
        - id: jenkins-admin
          password: '${JENKINS_ADMIN_PASSWORD}'
  authorizationStrategy:
    loggedInUsersCanDoAnything:
      allowAnonymousRead: false
unclassified:
  location:
    url: https://jenkins.example.com/
```

The exact candidate passes controller and agent smoke before promotion. Missing runtime secrets prevent startup and promotion. The lab-* versions are simulation labels, not installable releases.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins Configuration as Code](https://www.jenkins.io/doc/book/managing/casc/).
