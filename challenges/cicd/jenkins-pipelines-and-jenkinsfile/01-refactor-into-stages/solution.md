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

Separating checkout, build, test, and package work into named stages makes failures and timing visible in Jenkins. The commands stay unchanged, but the pipeline now exposes clear operational boundaries for retries, review, and later policy gates.
