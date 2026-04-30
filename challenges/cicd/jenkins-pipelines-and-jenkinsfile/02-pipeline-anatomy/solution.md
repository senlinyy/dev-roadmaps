```groovy
pipeline {
  agent {
    label 'linux-jdk21'
  }

  environment {
    MAVEN_OPTS = "-Xmx1g"
  }

  options {
    timeout(time: 30, unit: 'MINUTES')
    disableConcurrentBuilds()
  }

  stages {
    stage('Verify') {
      steps {
        sh 'mvn -B verify'
      }
    }
  }
}
```

`agent`, `environment`, and `options` are the three blocks that anchor a declarative pipeline. The label keeps the build off the controller and off mismatched JDK hosts; `MAVEN_OPTS` caps Maven's heap so a runaway test does not exhaust the agent; `timeout` and `disableConcurrentBuilds` together prevent a stuck or duplicate build from blocking the queue.
