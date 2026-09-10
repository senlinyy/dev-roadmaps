### Jenkinsfile

```groovy
@Library('company-pipeline@v1.4.2') _
pipeline {
  agent none

  stages {
stage('Quality and package') {
  agent { label 'linux && node' }
  steps {
    standardService()
    archiveArtifacts 'dist/app.json'
  }

}
  }
}
```

### library/v1/vars/standardService.groovy

```groovy
import com.acme.Commands

def call(Map config) {
  checkout scm
  sh 'npm ci'
  sh 'npm run lint'
  sh libraryResource('com/acme/unit.txt')
  sh Commands.build()
}
```

### library/v1/src/com/acme/Commands.groovy

```groovy
package com.acme
class Commands {
  static String build() { return 'npm run build' }
}
```

### library/v1/resources/com/acme/unit.txt

```text
npm test
```

One shared call executes lint and unit checks, then exactly one build and archive. A unit regression prevents the build. Helper and resource content come from the selected library snapshot.

The solution binds later work to the inputs and evidence it actually consumes. It preserves the negative cases instead of turning a failed check into a successful release.

Reference: [Jenkins shared libraries](https://www.jenkins.io/doc/book/pipeline/shared-libraries/).
