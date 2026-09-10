### Jenkinsfile

```groovy
pipeline {
  agent none
options { skipDefaultCheckout() }
  stages {
stage('Validate and package') {
  agent { label 'linux && node' }
  steps {
    deleteDir()
    checkout scm
    sh 'npm ci'
    sh 'npm run lint'
    sh 'npm test'
    sh 'npm run build'
    archiveArtifacts 'dist/app.json'
  }
  post {
    always { junit 'reports/*.xml' }
    cleanup { deleteDir() }
  }
}
  }
}
```

Lint and tests run against clean state. The healthy run archives the new application; the failed-test run retains its report but does not build. Both runs finish with clean workspaces.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins Pipeline syntax](https://www.jenkins.io/doc/book/pipeline/syntax/).
