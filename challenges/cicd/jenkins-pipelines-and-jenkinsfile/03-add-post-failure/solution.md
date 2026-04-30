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

  post {
    failure {
      slackSend channel: '#orders-ci', message: "polaris-orders ${env.BUILD_NUMBER} failed"
    }
  }
}
```

The `post` block is a peer of `stages`, not a child. Putting `failure` here means the Slack notification fires only when the overall pipeline result is a failure, not on warnings or successful builds.
