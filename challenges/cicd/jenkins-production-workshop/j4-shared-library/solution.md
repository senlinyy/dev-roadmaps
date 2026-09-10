## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### vars/nodePackage.groovy

```groovy
def call(Map config = [:]) {
  String artifact = config.artifact ?: 'application'
  if (!(artifact ==~ /[a-z][a-z0-9-]{0,40}/)) error('Invalid artifact name')
  pipeline {
    agent { label 'node22' }
    options { timeout(time: 20, unit: 'MINUTES') }
    stages {
      stage('Check and package') {
        steps {
          sh 'npm ci && npm run lint && npm test && npm run build'
          withEnv(["PACKAGE_NAME=${artifact}"]) {
            sh 'tar -czf "$PACKAGE_NAME.tar.gz" dist'
            archiveArtifacts artifacts: "${artifact}.tar.gz", fingerprint: true
          }
        }
      }
    }
  }
}
```

### orders/Jenkinsfile

```groovy
@Library('delivery@1.0.0') _
nodePackage(artifact: 'orders')
```

### billing/Jenkinsfile

```groovy
@Library('delivery@1.0.0') _
nodePackage(artifact: 'billing')
```

### test/Jenkinsfile

```groovy
@Library('delivery@candidate') _
nodePackage(artifact: 'library-smoke')
```

## Why this works

A Shared Library can own a whole Declarative pipeline when called once. vars exposes its public entrypoint; src and resources are useful when implementation needs classes or embedded files, not mandatory ceremony. Pin consumers, test the candidate through representative repositories, and avoid turning arbitrary input into shell code. A breaking contract belongs in a new version.

## Verification and expected evidence

Configure a folder-scoped library named delivery with its SCM URL. Run test/Jenkinsfile against a protected candidate ref in a disposable consumer containing the supplied Node fixture. After testing both artifact names, publish an immutable reviewed 1.0.0 tag or use its commit SHA. Test a malicious artifact input and confirm it is rejected. Keep the previous consumer pin for rollback.

## Self-review

- [ ] Both consumers select a reviewed library version and retain their artifact identity.
- [ ] Library input cannot inject shell commands or change the build recipe.
- [ ] A test consumer exercises the interface before an organization-wide upgrade.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://www.jenkins.io/doc/book/pipeline/shared-libraries/)
