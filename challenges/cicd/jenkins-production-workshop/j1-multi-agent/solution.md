## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### Jenkinsfile

```groovy
pipeline {
  agent none
  options { skipDefaultCheckout(true); timestamps(); timeout(time: 20, unit: 'MINUTES') }
  stages {
    stage('Validate') {
      parallel {
        stage('Lint') {
          agent { label 'node22' }
          steps {
            deleteDir()
            checkout scm
            sh 'npm ci && npm run lint'
          }
        }
        stage('Tests') {
          agent { label 'node22' }
          steps {
            deleteDir()
            checkout scm
            sh 'npm ci'
            sh 'mkdir -p reports && node --test --test-reporter=junit --test-reporter-destination=reports/junit.xml test/unit.test.mjs'
          }
          post { always { junit testResults: 'reports/junit.xml', allowEmptyResults: false } }
        }
      }
    }
    stage('Package') {
      agent { label 'node22' }
      steps {
        deleteDir()
        checkout scm
        sh 'npm ci && npm run build && tar -czf orders.tar.gz dist'
        stash name: 'orders-package', includes: 'orders.tar.gz'
      }
    }
    stage('Inspect package') {
      agent { label 'package-tools' }
      steps {
        deleteDir()
        unstash 'orders-package'
        sh "tar -tzf orders.tar.gz | grep -Fx 'dist/server.js'"
        archiveArtifacts artifacts: 'orders.tar.gz', fingerprint: true
      }
    }
  }
}
```

## Why this works

A Jenkins workspace belongs to an allocated agent. agent none makes ownership visible and avoids holding an executor during unrelated stages. checkout scm materializes source; stash transfers small files within the same run. Archive the final package for later retrieval. Put JUnit publication in the producing stage's post block while its workspace is still available.

## Verification and expected evidence

Run on two agents with disjoint filesystems and the required Node 22/npm/tar tooling. Run a failing assertion and confirm JUnit publication without package inspection. Archived fingerprints aid traceability; they do not replace cryptographic release verification.

## Self-review

- [ ] Each agent starts without relying on leftovers.
- [ ] The consumer receives the producer's archive without recompiling.
- [ ] Failed tests publish JUnit evidence and block the consumer.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://www.jenkins.io/doc/book/pipeline/jenkinsfile/)
