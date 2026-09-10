### Jenkinsfile

```groovy
pipeline {
  agent none
options { skipDefaultCheckout() }
  stages {
stage('Validate and package') {
  agent { label 'linux && node' }
  steps {
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

The regression remains a failed pipeline while its test report is published. No build follows failed tests. Both healthy and failed runs leave a clean workspace, with reporting before final cleanup.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins Pipeline syntax](https://www.jenkins.io/doc/book/pipeline/syntax/).
