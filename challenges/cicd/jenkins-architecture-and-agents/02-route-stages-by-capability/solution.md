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

}
stage('Package') {
  agent { label 'linux && docker' }
  steps {
    unstash 'application'
    sh './scripts/package.sh'
    archiveArtifacts artifacts: 'dist/image.json', fingerprint: true
  }

}
  }
}
```

Both checks pass, one application build is transferred and packaged, and dist/image.json is archived. A unit regression blocks both builds. No workload uses the controller.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins Pipeline syntax](https://www.jenkins.io/doc/book/pipeline/syntax/).
