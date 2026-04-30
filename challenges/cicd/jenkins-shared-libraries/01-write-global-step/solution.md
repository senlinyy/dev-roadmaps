```groovy
def call(Map config = [:]) {
  pipeline {
    agent {
      label config.agentLabel ?: 'linux-jdk21'
    }
    stages {
      stage('Build') {
        steps {
          sh "mvn -B ${(config.mavenGoals ?: ['package', 'verify']).join(' ')}"
        }
      }
    }
    post {
      failure {
        error "${config.service} failed"
      }
    }
  }
}
```

`call` is the entry point Jenkins looks for. The Map default `[:]` lets callers pass nothing and still get a working build. The `?:` operator gives every key a defensible default. The single `Build` stage renders Maven goals from the caller's list (or the default pair). `post.failure` produces an `error` with the service name so Slack/email hooks downstream see exactly which service broke.
