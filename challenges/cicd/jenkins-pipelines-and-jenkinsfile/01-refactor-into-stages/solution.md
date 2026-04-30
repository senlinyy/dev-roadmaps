```groovy
pipeline {
  agent any

  stages {
    stage('Build') {
      steps {
        sh 'mvn -B -DskipTests package'
      }
    }
    stage('Test') {
      steps {
        sh 'mvn -B test'
      }
    }
    stage('Package') {
      steps {
        sh 'docker build -t polaris-orders:${BUILD_NUMBER} .'
      }
    }
  }
}
```

Three named stages give the Blue Ocean view three checkpoints, so a failure in test no longer hides behind a passing build.
