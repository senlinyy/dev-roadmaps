```groovy
pipeline {
  agent any

  stages {
    stage('Build') {
      steps {
        sh 'mvn -B package'
      }
    }
    stage('Deploy') {
      steps {
        withCredentials([
          [$class: 'AmazonWebServicesCredentialsBinding',
           credentialsId: 'polaris-aws-deploy',
           accessKeyVariable: 'AWS_ACCESS_KEY_ID',
           secretKeyVariable: 'AWS_SECRET_ACCESS_KEY'],
          string(credentialsId: 'polaris-slack-webhook', variable: 'SLACK_WEBHOOK')
        ]) {
          sh '''
            aws s3 cp target/orders.jar s3://polaris-artifacts/
            curl -X POST -d 'deployed' $SLACK_WEBHOOK
          '''
        }
      }
    }
  }
}
```

The two credentials are bound for the duration of the closure, exposed as env vars, and masked in the build log. Once the closure exits, the variables go out of scope. The `environment { ... }` block is gone because anything inside it is dumped to stdout at startup, which would defeat the masking.
