### Jenkinsfile

```groovy
@Library('company-pipeline@v1.4.2') _
pipeline {
  agent none

  stages {
stage('Quality') {
  agent { label 'linux && node' }
  steps {
    standardCheck(command: 'npm run lint')
    standardCheck(command: 'npm test')
  }

}
stage('Package') {
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

### library/v1/vars/standardCheck.groovy

```groovy
def call(Map config) {
  checkout scm
  sh 'npm ci'
  sh config.command
}
```

Two shared calls run the requested checks, followed by one archived application build. A unit regression stops at its failing check. Unknown or missing API options fail explicitly.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins shared libraries](https://www.jenkins.io/doc/book/pipeline/shared-libraries/).
