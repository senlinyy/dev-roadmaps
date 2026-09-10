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
stage('Release') {
  agent { label 'linux && release' }
  steps {
    unstash 'application'
    withCredentials([string(credentialsId: 'registry-publish', variable: 'PUBLISH_TOKEN')]) {
  sh './scripts/publish.sh'
}
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

Healthy main publishes and deploys one build. A PR has neither access nor release events. Failed tests never release. An unauthorized workload can reach cloud-role evaluation but cannot deploy production. No exposure or live binding remains.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins Pipeline syntax](https://www.jenkins.io/doc/book/pipeline/syntax/).
