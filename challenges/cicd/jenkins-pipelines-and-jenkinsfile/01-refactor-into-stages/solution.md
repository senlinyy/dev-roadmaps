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
        sh 'docker build -t devpolaris-orders:${BUILD_NUMBER} .'
      }
    }
  }
}
```
