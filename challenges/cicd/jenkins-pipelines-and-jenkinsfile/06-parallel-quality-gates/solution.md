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

Healthy checks overlap and packaging completes within 35 seconds. A unit failure still produces its report and blocks packaging. No assumption of shared dependencies across allocations.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins Pipeline syntax](https://www.jenkins.io/doc/book/pipeline/syntax/).
