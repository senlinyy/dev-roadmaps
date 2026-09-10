### Jenkinsfile

```groovy
pipeline {
  agent none
options { disableConcurrentBuilds() }
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
options { timeout(time: 40, unit: 'SECONDS') }
post { cleanup { deleteDir() } }
}
stage('Release') {
  agent { label 'linux && release' }
  steps {
    unstash 'application'
    sh './scripts/deploy.sh staging'
  }

}
  }
}
```

The healthy run waits for the previous build and deploys once. The stalled-test run times out, cleans up, and never builds or deploys. It ends within 65 seconds including the initial wait.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins Pipeline syntax](https://www.jenkins.io/doc/book/pipeline/syntax/).
