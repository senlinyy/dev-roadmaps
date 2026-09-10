### Jenkinsfile

```groovy
pipeline {
  agent none

  stages {
stage('Quality') {
  parallel {
stage('Lint') {
  agent { label 'linux && node' }
  steps {
    checkout scm
    sh 'npm ci'
    sh 'npm run lint'
  }

}
stage('Tests') {
  agent { label 'linux && node' }
  steps {
    checkout scm
    sh 'npm ci'
    sh 'npm test'
  }
  post {
    always { junit 'reports/*.xml' }
    cleanup { deleteDir() }
  }
}
  }
}
stage('Build') {
  agent { label 'linux && node' }
  steps {
    checkout scm
    sh 'npm ci'
    sh 'npm run build'
    archiveArtifacts 'dist/app.json'
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

Healthy checks genuinely overlap and the archived build finishes within 35 seconds. The regression case still publishes reports and never builds. Neither controller execution nor counts above safeExecutors are accepted.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins Pipeline syntax](https://www.jenkins.io/doc/book/pipeline/syntax/).
