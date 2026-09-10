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

### jenkins.yaml

```yaml
jenkins:
  numExecutors: 0
  mode: EXCLUSIVE
  securityRealm:
    local:
      allowsSignup: false
      users:
        - id: admin
          password: "${JENKINS_ADMIN_PASSWORD}"
  authorizationStrategy:
    globalMatrix:
      entries:
        - user:
            name: admin
            permissions: ["Overall/Administer"]
  nodes:
    - permanent:
        name: node22-01
        remoteFS: /home/jenkins/agent
        numExecutors: 1
        mode: EXCLUSIVE
        labelString: node22 package-tools
        launcher:
          ssh:
            host: agent
            port: 22
            credentialsId: agent-key
            sshHostKeyVerificationStrategy:
              manuallyProvidedKeyVerificationStrategy:
                key: "${AGENT_HOST_PUBLIC_KEY}"
credentials:
  system:
    domainCredentials:
      - credentials:
          - basicSSHUserPrivateKey:
              scope: SYSTEM
              id: agent-key
              username: jenkins
              privateKeySource:
                directEntry:
                  privateKey: "${AGENT_SSH_PRIVATE_KEY}"
```

## Why this works

Labels are scheduling promises about tooling and trust, not installations. Diagnose queue reasons before adjusting executor counts. An expression can be impossible even when total capacity is idle. Match the pipeline's actual needs to a verified agent and leave controller executors at zero. A changed SSH key needs investigation, not a verification bypass.

## Verification and expected evidence

Validate the JCasC configuration against the pinned controller, establish the node22 agent using the expected SSH host key, and observe the queue item transition to that agent. If Docker becomes required later, repair/provision a genuine Docker-capable agent; do not merely add a false label.

## Self-review

- [ ] The queued label expression is satisfiable by a healthy suitable agent.
- [ ] No unnecessary Docker requirement remains.
- [ ] Controller execution and insecure SSH host-key bypass are not introduced.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://www.jenkins.io/doc/book/managing/nodes/)
