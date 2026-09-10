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
    withCredentials([string(credentialsId: 'registry-publish', variable: 'PUBLISH_TOKEN')]) {
  sh './scripts/publish.sh'
}
  }
when { allOf { branch 'main'
 not { changeRequest() } } }
}
  }
}
```

Healthy main publishes the validated bytes and removes the binding. PRs validate without credential access. Missing credentials fail closed. No sensitive exposure or active binding remains.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins Pipeline syntax](https://www.jenkins.io/doc/book/pipeline/syntax/).
