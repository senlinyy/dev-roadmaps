### maintenance.yaml

```yaml
operations:
  - build
  - boot
  - smoke
  - promote
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

Smoke checks loaded settings and the Node job, not only YAML syntax. Missing secrets prevent boot and promotion. The one-admin realm is an isolated training fixture, not an organization-wide authorization design.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins Configuration as Code](https://www.jenkins.io/doc/book/managing/casc/).
