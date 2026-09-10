---
id: article-cicd-jenkins-production-workshop
title: "Jenkins Production Workshop"
description: "Worked production delivery patterns, complete reference files and explicit operational verification."
order: 6
tags: ["cicd", "jenkins", "production-workflows"]
---

## Table of Contents

1. [Repair artifacts and evidence across Jenkins agents](#repair-artifacts-and-evidence-across-jenkins-agents)
2. [Diagnose an unschedulable release](#diagnose-an-unschedulable-release)
3. [Scope Jenkins deployment authority to a trusted agent](#scope-jenkins-deployment-authority-to-a-trusted-agent)
4. [Version a Shared Library used by two services](#version-a-shared-library-used-by-two-services)
5. [Recreate a secured Jenkins controller](#recreate-a-secured-jenkins-controller)
6. [Recover a failed controller upgrade from a matched snapshot](#recover-a-failed-controller-upgrade-from-a-matched-snapshot)
7. [Separate untrusted multibranch builds from release authority](#separate-untrusted-multibranch-builds-from-release-authority)
8. [Check Your Answers](#check-your-answers)
9. [References](#references)

This chapter puts the Jenkins architecture, Pipeline, Shared Library, configuration and security lessons together. Controller configuration, plugin compatibility, agent tooling and Pipeline code must agree. The examples use a small Node application and distinguish an untrusted build system from a protected release system. A Jenkinsfile alone cannot create that security boundary.

This chapter answers four connected questions:

- Which state crosses an agent boundary?
- What makes a Shared Library safe to change?
- What must controller recovery restore?
- Why do trusted release jobs need isolation?

### Before running the examples

The linked editor workspaces contain full independent starting snapshots and reference solutions. Local editing and self-review create no infrastructure. Use disposable repositories and isolated training accounts for optional live verification; configure credentials outside source control, budget for cloud resources, and remove only resources you created after collecting evidence. Do not run recovery scripts against an existing production system.

Use a disposable authenticated Jenkins controller and independently provisioned agents. Agent labels do not install software. Keep controller secrets outside the repository, verify host keys, and never mount a host Docker socket into an untrusted controller.

Action references are immutable reviewed commits in the challenge fixtures. Container and tool versions remain explicit operating assumptions: resolve approved digests and test compatibility before deployment rather than copying mutable tags into a production policy.

## Repair artifacts and evidence across Jenkins agents

A Jenkins workspace belongs to an allocated agent. agent none makes ownership visible and avoids holding an executor during unrelated stages. checkout scm materializes source; stash transfers small files within the same run. Archive the final package for later retrieval. Put JUnit publication in the producing stage's post block while its workspace is still available.

The operational question is whether the repaired system can demonstrate all of the following:

- Each agent starts without relying on leftovers.
- The consumer receives the producer's archive without recompiling.
- Failed tests publish JUnit evidence and block the consumer.

Here is the central implementation file, `Jenkinsfile`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```groovy
pipeline {
  agent none
  options { skipDefaultCheckout(true); timestamps(); timeout(time: 20, unit: 'MINUTES') }
  stages {
    stage('Validate') {
      parallel {
        stage('Lint') {
          agent { label 'node22' }
          steps {
            deleteDir()
            checkout scm
            sh 'npm ci && npm run lint'
          }
        }
        stage('Tests') {
          agent { label 'node22' }
          steps {
            deleteDir()
            checkout scm
            sh 'npm ci'
            sh 'mkdir -p reports && node --test --test-reporter=junit --test-reporter-destination=reports/junit.xml test/unit.test.mjs'
          }
          post { always { junit testResults: 'reports/junit.xml', allowEmptyResults: false } }
        }
      }
    }
    stage('Package') {
      agent { label 'node22' }
      steps {
        deleteDir()
        checkout scm
        sh 'npm ci && npm run build && tar -czf orders.tar.gz dist'
        stash name: 'orders-package', includes: 'orders.tar.gz'
      }
    }
    stage('Inspect package') {
      agent { label 'package-tools' }
      steps {
        deleteDir()
        unstash 'orders-package'
        sh "tar -tzf orders.tar.gz | grep -Fx 'dist/server.js'"
        archiveArtifacts artifacts: 'orders.tar.gz', fingerprint: true
      }
    }
  }
}
```

Run on two agents with disjoint filesystems and the required Node 22/npm/tar tooling. Run a failing assertion and confirm JUnit publication without package inspection. Archived fingerprints aid traceability; they do not replace cryptographic release verification.

[Open the repair artifacts and evidence across jenkins agents challenge](/challenges/cicd/jenkins-production-workshop?step=j1-multi-agent).

## Diagnose an unschedulable release

Labels are scheduling promises about tooling and trust, not installations. Diagnose queue reasons before adjusting executor counts. An expression can be impossible even when total capacity is idle. Match the pipeline's actual needs to a verified agent and leave controller executors at zero. A changed SSH key needs investigation, not a verification bypass.

The operational question is whether the repaired system can demonstrate all of the following:

- The queued label expression is satisfiable by a healthy suitable agent.
- No unnecessary Docker requirement remains.
- Controller execution and insecure SSH host-key bypass are not introduced.

Here is the central implementation file, `Jenkinsfile`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```groovy
pipeline {
  agent none
  options { skipDefaultCheckout(true); timestamps(); timeout(time: 20, unit: 'MINUTES') }
  stages {
    stage('Validate') {
      parallel {
        stage('Lint') {
          agent { label 'node22' }
          steps {
            deleteDir()
            checkout scm
            sh 'npm ci && npm run lint'
          }
        }
        stage('Tests') {
          agent { label 'node22' }
          steps {
            deleteDir()
            checkout scm
            sh 'npm ci'
            sh 'mkdir -p reports && node --test --test-reporter=junit --test-reporter-destination=reports/junit.xml test/unit.test.mjs'
          }
          post { always { junit testResults: 'reports/junit.xml', allowEmptyResults: false } }
        }
      }
    }
    stage('Package') {
      agent { label 'node22' }
      steps {
        deleteDir()
        checkout scm
        sh 'npm ci && npm run build && tar -czf orders.tar.gz dist'
        stash name: 'orders-package', includes: 'orders.tar.gz'
      }
    }
    stage('Inspect package') {
      agent { label 'package-tools' }
      steps {
        deleteDir()
        unstash 'orders-package'
        sh "tar -tzf orders.tar.gz | grep -Fx 'dist/server.js'"
        archiveArtifacts artifacts: 'orders.tar.gz', fingerprint: true
      }
    }
  }
}
```

Validate the JCasC configuration against the pinned controller, establish the node22 agent using the expected SSH host key, and observe the queue item transition to that agent. If Docker becomes required later, repair/provision a genuine Docker-capable agent; do not merely add a false label.

[Open the diagnose an unschedulable release challenge](/challenges/cicd/jenkins-production-workshop?step=j2-queue-capacity).

## Scope Jenkins deployment authority to a trusted agent

Jenkins does not inherit GitHub's OIDC identity system. This design uses an explicit EC2 instance role and scoped STS role assumption. IAM trust identifies who may assume; the agent policy authorizes the request; the target role controls ECS operations. Process environment isolation requires a trusted dedicated host/controller boundary, not only log masking.

The operational question is whether the repaired system can demonstrate all of the following:

- No static AWS key or credential dump remains.
- Only the named instance role can assume orders-deploy.
- Temporary credentials exist only around deployment and are never archived.

Here is the central implementation file, `Jenkinsfile`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```groovy
pipeline {
  agent { label 'trusted-aws-deploy' }
  options { disableConcurrentBuilds(); timeout(time: 20, unit: 'MINUTES') }
  stages {
    stage('Deploy approved candidate') {
      steps {
        sh '''
          set +x
          set -eu
          credentials=$(aws sts assume-role --role-arn arn:aws:iam::222222222222:role/orders-deploy --role-session-name "jenkins-$BUILD_NUMBER" --query Credentials --output json)
          export AWS_ACCESS_KEY_ID=$(printf '%s' "$credentials" | jq -r .AccessKeyId)
          export AWS_SECRET_ACCESS_KEY=$(printf '%s' "$credentials" | jq -r .SecretAccessKey)
          export AWS_SESSION_TOKEN=$(printf '%s' "$credentials" | jq -r .SessionToken)
          unset credentials
          bash scripts/deploy.sh
        '''
      }
    }
  }
}
```

Attach the scoped deployment permission policy from the AWS authorization lesson to orders-deploy. Verify role assumption on the dedicated trusted agent, then denial from a normal build identity. Disable shell tracing around credential handling and inspect archived outputs for accidental exposure. A shared executor host would still expose credentials to other processes.

[Open the scope jenkins deployment authority to a trusted agent challenge](/challenges/cicd/jenkins-production-workshop?step=j3-workload-identity).

## Version a Shared Library used by two services

A Shared Library can own a whole Declarative pipeline when called once. vars exposes its public entrypoint; src and resources are useful when implementation needs classes or embedded files, not mandatory ceremony. Pin consumers, test the candidate through representative repositories, and avoid turning arbitrary input into shell code. A breaking contract belongs in a new version.

The operational question is whether the repaired system can demonstrate all of the following:

- Both consumers select a reviewed library version and retain their artifact identity.
- Library input cannot inject shell commands or change the build recipe.
- A test consumer exercises the interface before an organization-wide upgrade.

Here is the central implementation file, `vars/nodePackage.groovy`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```groovy
def call(Map config = [:]) {
  String artifact = config.artifact ?: 'application'
  if (!(artifact ==~ /[a-z][a-z0-9-]{0,40}/)) error('Invalid artifact name')
  pipeline {
    agent { label 'node22' }
    options { timeout(time: 20, unit: 'MINUTES') }
    stages {
      stage('Check and package') {
        steps {
          sh 'npm ci && npm run lint && npm test && npm run build'
          withEnv(["PACKAGE_NAME=${artifact}"]) {
            sh 'tar -czf "$PACKAGE_NAME.tar.gz" dist'
            archiveArtifacts artifacts: "${artifact}.tar.gz", fingerprint: true
          }
        }
      }
    }
  }
}
```

Configure a folder-scoped library named delivery with its SCM URL. Run test/Jenkinsfile against a protected candidate ref in a disposable consumer containing the supplied Node fixture. After testing both artifact names, publish an immutable reviewed 1.0.0 tag or use its commit SHA. Test a malicious artifact input and confirm it is rejected. Keep the previous consumer pin for rollback.

[Open the version a shared library used by two services challenge](/challenges/cicd/jenkins-production-workshop?step=j4-shared-library).

## Recreate a secured Jenkins controller

Reproducibility includes core, plugin versions, configuration and secret injection. JCasC describes configuration but does not install plugins or provision the remote agent OS. Pin both the base image and the plugin graph, then test actual startup: a syntactically valid YAML file does not prove plugin compatibility. Provision authentication before opening network access and preserve the controller's persistent state separately from its image.

The operational question is whether the repaired system can demonstrate all of the following:

- Controller image and plugin inventory are explicit reviewable inputs.
- Authentication is enabled; only the named administrator receives administrative access.
- An independently provisioned Node 22 agent connects with host-key verification and runs the representative Jenkinsfile.

Here is the central implementation file, `Dockerfile`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```dockerfile
FROM jenkins/jenkins:lts-jdk21@sha256:c1e4c349365f6d16d88595b2c5f7e8ff39b8ae1d061f62420bac193b4b9616d0
COPY plugins.lock /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --latest=false --plugin-file /usr/share/jenkins/ref/plugins.txt
COPY jenkins.yaml /usr/share/jenkins/ref/jenkins.yaml
ENV CASC_JENKINS_CONFIG=/usr/share/jenkins/ref/jenkins.yaml
```

Build the image in an isolated environment and start it with a fresh named volume and supplied secrets. Validate the plugin dependency graph and JCasC against this exact image; then verify login, zero controller executors, agent connection and the multi-agent sample pipeline. Freeze the built image digest and resolved plugin inventory after successful boot. Keep bootstrap UI enabled until initial configuration succeeds.

[Open the recreate a secured jenkins controller challenge](/challenges/cicd/jenkins-production-workshop?step=j5-controller-as-code).

## Recover a failed controller upgrade from a matched snapshot

Controller rollback is a restoration of a compatible image/plugin/state set. Take a consistent backup while Jenkins is stopped or using a documented consistent snapshot mechanism. Restore into a separate volume so failure evidence survives. Rehearse with a non-production controller and a harmless representative pipeline; do not enable release jobs until external effects and credentials have been reviewed.

The operational question is whether the repaired system can demonstrate all of the following:

- Recovery uses the prior image and a matched pre-upgrade state archive.
- The failed volume remains intact for investigation.
- An existing recovery volume or container causes a stop rather than destructive overwrite.

Here is the central implementation file, `scripts/recover.sh`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${PREVIOUS_IMAGE:?Set the approved previous image@sha256}"
[[ "$PREVIOUS_IMAGE" =~ @sha256:[a-f0-9]{64}$ ]]
(cd backup && shasum -a 256 -c jenkins-home.tar.sha256)
if docker volume inspect orders-jenkins-recovery >/dev/null 2>&1; then
  echo 'Recovery volume already exists; inspect it manually.' >&2
  exit 1
fi
if docker container inspect orders-jenkins-recovery >/dev/null 2>&1; then
  echo 'Recovery container already exists; inspect it manually.' >&2
  exit 1
fi
docker volume create orders-jenkins-recovery >/dev/null
docker run --rm --user root --entrypoint sh \
  --mount type=volume,src=orders-jenkins-recovery,dst=/restore \
  --mount "type=bind,src=$PWD/backup,dst=/backup,readonly" \
  "$PREVIOUS_IMAGE" -c 'tar -xpf /backup/jenkins-home.tar -C /restore'
docker run -d --name orders-jenkins-recovery -p 127.0.0.1:18080:8080 \
  --env-file recovery-secrets.env \
  --mount type=volume,src=orders-jenkins-recovery,dst=/var/jenkins_home \
  "$PREVIOUS_IMAGE"
docker logs orders-jenkins-recovery
```

Use a disposable backup whose archive paths are relative to JENKINS_HOME and whose credentials/key material is included securely. Supply protected recovery-secrets.env and the previous immutable image. Confirm startup, administrator login, plugin load and a non-deploying sample job before switching traffic. Verify the failed controller volume still exists. A checksum proves archive integrity, not that the backup was trustworthy.

[Open the recover a failed controller upgrade from a matched snapshot challenge](/challenges/cicd/jenkins-production-workshop?step=j6-upgrade-recovery).

## Separate untrusted multibranch builds from release authority

Untrusted Jenkinsfile code can choose labels, so labels alone are not an authorization system. Separate scheduling and credential domains prevent contributor-controlled pipelines from asking the trusted controller for work. Keep release automation in protected SCM; move only an immutable, verified artifact identity across the boundary. Distinct containers on one privileged host are insufficient against host compromise.

The operational question is whether the repaired system can demonstrate all of the following:

- Untrusted jobs cannot schedule release agents or read release credentials.
- CI and release controllers do not share JENKINS_HOME or host Docker access.
- The release job executes protected automation, not the contributor's Jenkinsfile or archived scripts.

Here is the central implementation file, `compose.yaml`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```yaml
services:
  ci:
    image: ${CI_CONTROLLER_IMAGE:?Set pinned configured CI image}
    ports: ['127.0.0.1:18080:8080']
    volumes: ['ci-home:/var/jenkins_home']
    env_file: ci-secrets.env
    networks: [ci]
  release:
    image: ${RELEASE_CONTROLLER_IMAGE:?Set pinned configured release image}
    ports: ['127.0.0.1:18081:8080']
    volumes: ['release-home:/var/jenkins_home']
    env_file: release-secrets.env
    networks: [release]
volumes:
  ci-home: {}
  release-home: {}
networks:
  ci: {}
  release: {}
```

Configure release SCM and credentials only on the release controller; supply the complete verified deploy/provenance helpers from the AWS lessons in that protected repository. Restrict management access with firewall/TLS and identity policy. The compose networks are a local rehearsal, not a hostile-host security boundary: production controllers and agents must use separate hosts/accounts or equivalent isolation. Attempt to select trusted-aws-deploy from CI and confirm no such capacity exists.

[Open the separate untrusted multibranch builds from release authority challenge](/challenges/cicd/jenkins-production-workshop?step=j7-untrusted-isolation).

## Check Your Answers

:::expand[Which state crosses an agent boundary?]{kind="recap"}

Only deliberately checked-out, stashed or archived inputs; an agent label does not provide files from another workspace.

:::

:::expand[What makes a Shared Library safe to change?]{kind="recap"}

A small validated interface, versioned consumers and representative compatibility tests before adoption.

:::

:::expand[What must controller recovery restore?]{kind="recap"}

A compatible pinned image, plugin set, configuration and consistent persistent-state snapshot, with secrets handled separately.

:::

:::expand[Why do trusted release jobs need isolation?]{kind="recap"}

Contributor-controlled Pipeline code can choose labels and execute commands; separate scheduling and credential domains restrict access to release authority.

:::

## References

- [Official implementation reference 1](https://www.jenkins.io/doc/book/pipeline/jenkinsfile/)
- [Official implementation reference 2](https://www.jenkins.io/doc/book/managing/nodes/)
- [Official implementation reference 3](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_switch-role-ec2.html)
- [Official implementation reference 4](https://www.jenkins.io/doc/pipeline/steps/credentials-binding/)
- [Official implementation reference 5](https://www.jenkins.io/doc/book/pipeline/shared-libraries/)
- [Official implementation reference 6](https://www.jenkins.io/doc/book/managing/casc/)
- [Official implementation reference 7](https://github.com/jenkinsci/docker)
- [Official implementation reference 8](https://www.jenkins.io/doc/book/system-administration/backing-up/)
- [Official implementation reference 9](https://www.jenkins.io/doc/book/upgrade-guide/)
- [Official implementation reference 10](https://www.jenkins.io/doc/book/security/controller-isolation/)
