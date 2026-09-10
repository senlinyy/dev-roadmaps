### Jenkinsfile

```groovy
@Library('company-pipeline@v1.4.2') _
pipeline {
  agent none

  stages {
stage('Existing consumer') {
  agent { label 'linux && node' }
  steps {
    standardCheck(command: 'npm run lint')
  }

}
stage('Migrating consumer') {
  agent { label 'linux && node' }
  steps {
    standardCheck(task: 'npm test')
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
  sh config.task ?: config.command
}
```

Old and new consumers work, including after main advances to incompatible v2. The unit regression still blocks packaging. Evidence reports v1.4.2 and two calls.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins shared libraries](https://www.jenkins.io/doc/book/pipeline/shared-libraries/).
