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

### library-settings.yaml

```yaml
name: company-pipeline
defaultVersion: v1.4.2
allowVersionOverride: true
```

Both checks and the archive succeed using v1.4.2 even when main resolves to v2.0.0. A unit regression blocks packaging.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins shared libraries](https://www.jenkins.io/doc/book/pipeline/shared-libraries/).
