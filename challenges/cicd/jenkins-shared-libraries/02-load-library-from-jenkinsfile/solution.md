```groovy
@Library('polaris-pipeline@v1.4.2') _

buildJavaService(
  service: 'orders',
  mavenGoals: ['package', 'verify', 'integration-test'],
  agentLabel: 'linux-jdk21'
)
```

Three lines. The `@Library` directive pins the library to a specific tag; the controller fetches that tag, compiles `vars/` and `src/`, and exposes `buildJavaService` as a callable. The Jenkinsfile becomes a configuration file: which library, which version, which service. All the actual pipeline logic lives in the library and is reviewed there.
