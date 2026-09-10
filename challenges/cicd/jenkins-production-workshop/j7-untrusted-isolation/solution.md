## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### compose.yaml

```yaml
services:
  ci:
    image: ${CI_CONTROLLER_IMAGE:?Set pinned configured CI image}
    ports: ['127.0.0.1:18080:8080']
    volumes: ['ci-home:/var/jenkins_home']
    env_file: ci-secrets.env
    networks: [ci]
  release:
    image: ${RELEASE_CONTROLLER_IMAGE:?Set pinned configured release image}
    ports: ['127.0.0.1:18081:8080']
    volumes: ['release-home:/var/jenkins_home']
    env_file: release-secrets.env
    networks: [release]
volumes:
  ci-home: {}
  release-home: {}
networks:
  ci: {}
  release: {}
```

### release/Jenkinsfile

```groovy
pipeline {
  agent { label 'trusted-aws-deploy' }
  options { disableConcurrentBuilds(); timeout(time: 20, unit: 'MINUTES') }
  stages {
    stage('Verify candidate') {
      steps {
        sh 'bash scripts/verify-producer.sh'
      }
    }
    stage('Deploy') {
      steps {
        input message: 'Deploy this verified image to production?', submitter: 'release-managers'
        sh 'bash scripts/deploy.sh'
      }
    }
  }
}
```

## Why this works

Untrusted Jenkinsfile code can choose labels, so labels alone are not an authorization system. Separate scheduling and credential domains prevent contributor-controlled pipelines from asking the trusted controller for work. Keep release automation in protected SCM; move only an immutable, verified artifact identity across the boundary. Distinct containers on one privileged host are insufficient against host compromise.

## Verification and expected evidence

Configure release SCM and credentials only on the release controller; supply the complete verified deploy/provenance helpers from the AWS lessons in that protected repository. Restrict management access with firewall/TLS and identity policy. The compose networks are a local rehearsal, not a hostile-host security boundary: production controllers and agents must use separate hosts/accounts or equivalent isolation. Attempt to select trusted-aws-deploy from CI and confirm no such capacity exists.

## Self-review

- [ ] Untrusted jobs cannot schedule release agents or read release credentials.
- [ ] CI and release controllers do not share JENKINS_HOME or host Docker access.
- [ ] The release job executes protected automation, not the contributor's Jenkinsfile or archived scripts.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://www.jenkins.io/doc/book/security/controller-isolation/)
