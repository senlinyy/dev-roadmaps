```groovy
pipeline {
  agent any

  parameters {
    choice(name: 'DEPLOY_ENV', choices: ['staging', 'production'], description: 'Target deployment environment')
    booleanParam(name: 'RUN_INTEGRATION_TESTS', defaultValue: true, description: 'Run the integration suite')
  }

  stages {
    stage('Build') {
      steps {
        sh 'mvn -B package'
      }
    }
    stage('Deploy') {
      when {
        allOf {
          branch 'main'
          expression { params.DEPLOY_ENV == 'production' }
        }
      }
      steps {
        sh './deploy.sh'
      }
    }
  }
}
```

The `when { allOf { ... } }` block makes both conditions hold before the stage runs: pull requests skip Deploy, and a `staging` build on `main` also skips it. `branch` is a built-in `when` directive; `expression` lets you embed any Groovy boolean (here, the user's selected parameter).
