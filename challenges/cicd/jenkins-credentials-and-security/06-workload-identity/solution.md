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
  post {
    always { junit 'reports/*.xml' }
    cleanup { deleteDir() }
  }
}
stage('Deploy') {
  agent { label 'linux && release' }
  steps {
    unstash 'application'
    withCredentials([file(credentialsId: 'aws-workload-token', variable: 'AWS_WEB_IDENTITY_TOKEN_FILE')]) {
  sh 'aws sts get-caller-identity'
  sh './scripts/deploy.sh production'
}
  }
when { allOf { branch 'main'
 not { changeRequest() } } }
environment { AWS_ROLE_ARN = 'arn:aws:iam::123456789012:role/checkout-deploy' }
}
  }
}
```

### role-trust.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/jenkins.example.com/oidc"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "jenkins.example.com/oidc:aud": "sts.amazonaws.com",
          "jenkins.example.com/oidc:sub": "https://jenkins.example.com/job/checkout/job/main/"
        }
      }
    }
  ]
}
```

### role-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ecs:UpdateService",
      "Resource": "arn:aws:ecs:us-east-1:123456789012:service/shop/checkout"
    }
  ]
}
```

The authorized main job deploys production once. Other-job and wrong-audience cases reach role evaluation and are denied without production deployment. PRs never bind the token. All temporary bindings are removed.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins Pipeline syntax](https://www.jenkins.io/doc/book/pipeline/syntax/).
