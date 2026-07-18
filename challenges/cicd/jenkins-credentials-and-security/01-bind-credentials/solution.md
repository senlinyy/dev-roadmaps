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
           credentialsId: 'devpolaris-aws-deploy',
           accessKeyVariable: 'AWS_ACCESS_KEY_ID',
           secretKeyVariable: 'AWS_SECRET_ACCESS_KEY'],
          string(credentialsId: 'devpolaris-slack-webhook', variable: 'SLACK_WEBHOOK')
        ]) {
          sh '''
            aws s3 cp target/orders.jar s3://devpolaris-artifacts/
            curl -X POST -d 'deployed' $SLACK_WEBHOOK
          '''
        }
      }
    }
  }
}
```

The two credentials are bound only for the duration of the closure, exposed as environment variables, and eligible for Jenkins masking. Removing the literal values from the Jenkinsfile prevents source-control exposure, while keeping the binding around only the deploy command limits credential scope. Masking is a safety net, so deploy commands must still avoid intentionally printing secrets.
