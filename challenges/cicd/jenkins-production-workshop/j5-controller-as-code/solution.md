## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### Dockerfile

```dockerfile
FROM jenkins/jenkins:lts-jdk21@sha256:c1e4c349365f6d16d88595b2c5f7e8ff39b8ae1d061f62420bac193b4b9616d0
COPY plugins.lock /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --latest=false --plugin-file /usr/share/jenkins/ref/plugins.txt
COPY jenkins.yaml /usr/share/jenkins/ref/jenkins.yaml
ENV CASC_JENKINS_CONFIG=/usr/share/jenkins/ref/jenkins.yaml
```

### plugins.lock

```text
antisamy-markup-formatter:173.v680e3a_b_69ff3
apache-httpcomponents-client-4-api:4.5.14-269.vfa_2321039a_83
asm-api:9.10.1-216.va_9256d3b_844b_
bootstrap5-api:5.3.8-1048.va_c299057e35c
bouncycastle-api:2.30.1.85.2-304.v4b_5b_62e59a_a_7
branch-api:2.1280.v0d4e5b_b_460ef
caffeine-api:3.2.4-208.v7e2da_a_7db_82b_
checks-api:422.vc7e8b_51488c6
cloudbees-folder:6.1106.v3a_d9a_6d2465e
commons-lang3-api:3.20.0-109.ve43756e2d2b_4
commons-text-api:1.15.0-218.va_61573470393
configuration-as-code:2121.v86fe99d4b_b_a_b_
credentials:1511.v2e3cb_0008ef0
credentials-binding:728.v902a_273b_8947
display-url-api:2.217.va_6b_de84cc74b_
durable-task:686.v80ff80875b_82
echarts-api:6.1.0-1321.v86c4c5114494
eddsa-api:0.3.0.1-29.v67e9a_1c969b_b_
font-awesome-api:7.3.1-1013.v0835a_879ec6d
git:5.10.1
git-client:6.6.1
gson-api:2.14.0-201.v8eefe5515533
instance-identity:203.v15e81a_1b_7a_38
ionicons-api:94.vcc3065403257
jackson-annotations2-api:2.22-19.v10a_a_582ea_26e
jackson2-api:2.22.2-445.vdc613f1d8012
jackson3-api:3.2.2-96.v599957900a_1a_
jakarta-activation-api:2.1.4-1
jakarta-mail-api:2.1.5-1
jakarta-xml-bind-api:4.0.9-19.v2b_a_5b_44d9a_1c
javax-activation-api:1.2.0-8
jaxb:2.3.9-143.v5979df3304e6
joda-time-api:2.14.3-200.v65623733c99f
jquery3-api:3.7.1-687.v68d468e40b_30
json-api:20260814-226.v20f9685d642c
junit:1425.v9c7318dca_96d
mailer:534.v1b_36f5864073
matrix-auth:3.3
mina-sshd-api-common:2.19.0-192.v2b_a_7b_2c1dc71
mina-sshd-api-core:2.19.0-192.v2b_a_7b_2c1dc71
pipeline-build-step:601.v6d4c6d1a_9dc7
pipeline-groovy-lib:805.va_fc79344957d
pipeline-input-step:560.v56198a_642157
pipeline-milestone-step:152.v6e22b_8cfc66c
pipeline-model-api:2.2293.v6e7193cec599
pipeline-model-definition:2.2293.v6e7193cec599
pipeline-model-extensions:2.2293.v6e7193cec599
pipeline-stage-step:345.va_96187909426
pipeline-stage-tags-metadata:2.2293.v6e7193cec599
plain-credentials:199.v9f8e1f741799
plugin-util-api:7.1341.v039f146993d9
prism-api:1.30.0-741.v034eb_0b_0a_a_fa_
scm-api:728.vc30dcf7a_0df5
script-security:1415.v9a_f9b_3a_c253d
snakeyaml-api:2.5-149.v72471e9c6371
snakeyaml-engine-api:3.1.1-12.v4320c7d6f89c
ssh-credentials:372.va_250881b_08cd
ssh-slaves:3.1097.v868116049892
structs:362.va_b_695ef4fdf9
trilead-api:2.284.v1974ea_324382
variant:70.va_d9f17f859e0
woodstox-core-api:7.2.2-10.vcb_629759b_2c2
workflow-aggregator:608.v67378e9d3db_1
workflow-api:1413.v2ff1a_5e720fa_
workflow-basic-steps:1098.v808b_fd7f8cf4
workflow-cps:4378.v7a_08f1b_b_f8f4
workflow-durable-task-step:1479.v56e587f413a_7
workflow-job:1600.v6f36ed83529d
workflow-multibranch:841.vec5b_9e1806ec
workflow-scm-step:487.v41313a_96b_65d
workflow-step-api:724.v538c2362b_dfb_
workflow-support:1015.v785e5a_b_b_8b_22
```

### jenkins.yaml

```yaml
jenkins:
  numExecutors: 0
  mode: EXCLUSIVE
  securityRealm:
    local:
      allowsSignup: false
      users:
        - id: admin
          password: "${JENKINS_ADMIN_PASSWORD}"
  authorizationStrategy:
    globalMatrix:
      entries:
        - user:
            name: admin
            permissions: ["Overall/Administer"]
  nodes:
    - permanent:
        name: node22-01
        remoteFS: /home/jenkins/agent
        numExecutors: 1
        mode: EXCLUSIVE
        labelString: node22 package-tools
        launcher:
          ssh:
            host: agent
            port: 22
            credentialsId: agent-key
            sshHostKeyVerificationStrategy:
              manuallyProvidedKeyVerificationStrategy:
                key: "${AGENT_HOST_PUBLIC_KEY}"
credentials:
  system:
    domainCredentials:
      - credentials:
          - basicSSHUserPrivateKey:
              scope: SYSTEM
              id: agent-key
              username: jenkins
              privateKeySource:
                directEntry:
                  privateKey: "${AGENT_SSH_PRIVATE_KEY}"
```

## Why this works

Reproducibility includes core, plugin versions, configuration and secret injection. JCasC describes configuration but does not install plugins or provision the remote agent OS. Pin both the base image and the plugin graph, then test actual startup: a syntactically valid YAML file does not prove plugin compatibility. Provision authentication before opening network access and preserve the controller's persistent state separately from its image.

## Verification and expected evidence

Build the image in an isolated environment and start it with a fresh named volume and supplied secrets. Validate the plugin dependency graph and JCasC against this exact image; then verify login, zero controller executors, agent connection and the multi-agent sample pipeline. Freeze the built image digest and resolved plugin inventory after successful boot. Keep bootstrap UI enabled until initial configuration succeeds.

## Self-review

- [ ] Controller image and plugin inventory are explicit reviewable inputs.
- [ ] Authentication is enabled; only the named administrator receives administrative access.
- [ ] An independently provisioned Node 22 agent connects with host-key verification and runs the representative Jenkinsfile.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://www.jenkins.io/doc/book/managing/casc/)
- [Official reference 2](https://github.com/jenkinsci/docker)
