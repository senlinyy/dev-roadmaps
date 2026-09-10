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
  }

}
stage('Build') {
  agent { label 'linux && node' }
  steps {
    checkout scm
    sh 'npm ci'
    sh 'npm run build'
    archiveArtifacts artifacts: 'dist/app.json', fingerprint: true
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

Lint, unit tests, application build, and archive finish within 45 simulated seconds on the normal fleet and when node-a loses its connection. A test regression prevents packaging. No controller work.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins Pipeline syntax](https://www.jenkins.io/doc/book/pipeline/syntax/).
