### Jenkinsfile

```groovy
pipeline {
  agent { label 'linux && node' }

  stages {
stage('Validate') {
  steps {
    sh 'npm ci'
    sh 'npm run lint'
    sh 'npm test'
  }

}
stage('Package') {
  steps {
    sh 'npm run build'
    archiveArtifacts 'dist/app.json'
  }

}
  }
}
```

Validation and packaging have distinct executed stages. Both checks precede exactly one build. Unit or lint regressions stop before any build or archive.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins Pipeline syntax](https://www.jenkins.io/doc/book/pipeline/syntax/).
