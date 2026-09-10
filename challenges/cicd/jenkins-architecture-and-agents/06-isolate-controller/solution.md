### Jenkinsfile

```groovy
pipeline {
  agent none

  stages {
stage('Validate') {
  agent { label 'linux && node' }
  steps {
    checkout scm
    sh 'npm ci'
    sh 'npm run lint'
    sh 'npm test'
    sh 'npm run build'
    stash name: 'application', includes: 'dist/app.json'
  }

}
stage('Package') {
  agent { label 'linux && docker' }
  steps {
    unstash 'application'
    sh './scripts/package.sh'
    archiveArtifacts artifacts: 'dist/image.json', fingerprint: true
  }

}
  }
}
```

### agent-settings.yaml

```yaml
nodes:
  - name: built-in
    numExecutors: 0
    labelString: 'built-in'
    temporarilyOffline: false
  - name: node-a
    numExecutors: 1
    labelString: 'linux node'
    temporarilyOffline: false
  - name: node-b
    numExecutors: 1
    labelString: 'linux node'
    temporarilyOffline: false
  - name: image-a
    numExecutors: 1
    labelString: 'linux docker'
    temporarilyOffline: false
  - name: release-a
    numExecutors: 1
    labelString: 'linux release'
    temporarilyOffline: false
```

Validation, transfer, packaging, and archive succeed without controller work; a failed test prevents packaging. The declared built-in node retains zero executors.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins Pipeline syntax](https://www.jenkins.io/doc/book/pipeline/syntax/).
