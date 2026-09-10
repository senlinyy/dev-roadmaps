### Jenkinsfile

```groovy
pipeline {
  agent none
parameters {
 booleanParam(name: 'DEPLOY', defaultValue: false)
 string(name: 'TARGET_ENV', defaultValue: 'staging')
}
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

}
stage('Deploy') {
  agent { label 'linux && release' }
  steps {
    unstash 'application'
    sh './scripts/deploy.sh $TARGET_ENV'
  }
when { allOf { branch 'main'
 not { changeRequest() }
 expression { return params.DEPLOY } } }
}
  }
}
```

PR, feature, and main-without-intent cases pass validation but have no deployment. Requested main deployment promotes the built bytes to staging. A regression never deploys.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins Pipeline syntax](https://www.jenkins.io/doc/book/pipeline/syntax/).
