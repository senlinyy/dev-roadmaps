```groovy
pipeline {
  agent none

  stages {
    stage('Test') {
      agent { label 'linux && maven' }
      steps {
        sh 'mvn test'
      }
    }
    stage('Build Image') {
      agent { label 'linux && docker' }
      steps {
        sh 'docker build -t registry.example.com/checkout-api:${BUILD_NUMBER} .'
      }
    }
  }
}
```

Stage-level capability labels keep Docker privileges away from the Maven-only pool and let Jenkins schedule work without binding the pipeline to named machines. `agent none` prevents Jenkins from holding an unnecessary top-level executor.
