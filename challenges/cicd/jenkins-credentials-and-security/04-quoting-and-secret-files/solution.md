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
  post {
    always { junit 'reports/*.xml' }
    cleanup { deleteDir() }
  }
}
stage('Publish') {
  agent { label 'linux && release' }
  steps {
    unstash 'application'
    withCredentials([file(credentialsId: 'registry-file', variable: 'PUBLISH_CONFIG')]) {
  dir('release') {
  sh './scripts/publish.sh "$PUBLISH_CONFIG"'
}
}
    archiveArtifacts 'dist/app.json'
  }
when { allOf { branch 'main'
 not { changeRequest() } } }
}
  }
}
```

Main publishes and archives the application without metadata/workspace exposure; the file binding is removed. A PR runs checks without any credential or publication. Failed tests never reach the publisher.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins Pipeline syntax](https://www.jenkins.io/doc/book/pipeline/syntax/).
