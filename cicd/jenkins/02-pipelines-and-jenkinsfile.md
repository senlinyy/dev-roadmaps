---
title: "Pipelines and Jenkinsfile"
description: "Author stable, version-controlled pipelines using declarative Groovy DSL syntax with stages, parallel branches, and post-cleanup conditions."
overview: "A Jenkinsfile is the committed contract between your repository and your automation server. Learn how Declarative and Scripted Pipeline differ, how stages make failures readable, and how parameters, conditions, post blocks, and multibranch projects make Jenkins pipelines safe to operate."
tags: ["jenkins", "jenkinsfile", "pipelines", "groovy"]
order: 2
id: article-cicd-jenkins-pipelines-and-jenkinsfile
aliases:
  - /cicd/jenkins/pipelines-and-jenkinsfile
---

## Table of Contents

1. [Why a Jenkinsfile Matters](#why-a-jenkinsfile-matters)
2. [Declarative vs Scripted: The Tradeoff](#declarative-vs-scripted-the-tradeoff)
3. [Anatomy of a Declarative Pipeline](#anatomy-of-a-declarative-pipeline)
4. [Refactoring Into Real Stages](#refactoring-into-real-stages)
5. [Parallel Branches, Post Conditions, and Options](#parallel-branches-post-conditions-and-options)
6. [Parameters, Environment, and When Gating](#parameters-environment-and-when-gating)
7. [Multibranch Pipelines, Branches, and Pull Requests](#multibranch-pipelines-branches-and-pull-requests)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## Why a Jenkinsfile Matters
<!-- section-summary: A Jenkinsfile moves the delivery process into Git so pipeline changes can be reviewed, versioned, and recovered. -->

A **Jenkinsfile** is a text file that describes a Jenkins Pipeline. The file usually lives in the root of the application repository, next to the code it builds. Jenkins reads that file and turns it into stages, steps, logs, status checks, and deployment actions.

Summit Retail starts with a UI-created job for `checkout-api`. An operator opened the Jenkins web form months ago, pasted a shell script into a build step, added a deploy command, and clicked Save. The job works until someone changes the staging deploy command in the browser and forgets which line changed. The next release fails, and Git has no diff because the delivery process lived inside Jenkins instead of the repository.

Pipeline as Code fixes that workflow. The build definition is part of the same pull request as application changes. A reviewer can see that a test stage changed, a deploy target changed, or a credential binding appeared. A release branch can keep its older pipeline shape, while the main branch moves forward with newer tools.

This also changes disaster recovery. If a controller disappears and the team has a clean Jenkins configuration path, a multibranch project can scan repositories and recreate branch jobs from Jenkinsfiles. The pipeline definition comes from source control, so the controller no longer acts as the only memory of how delivery works.

The rest of this article uses one service, `checkout-api`, and follows the pipeline as it grows. First the team chooses the Pipeline syntax. Then they break one giant shell script into real stages. After that they add parallel checks, cleanup, parameters, branch gates, and multibranch behavior.

## Declarative vs Scripted: The Tradeoff
<!-- section-summary: Declarative Pipeline gives most application teams a structured, reviewable Jenkinsfile, while Scripted Pipeline stays useful for narrow dynamic logic. -->

Jenkins Pipeline uses a Groovy-based domain-specific language. **Groovy** is a JVM language, and Jenkins uses it to express delivery steps such as `stage`, `sh`, `checkout`, `withCredentials`, and `archiveArtifacts`. Pipeline supports two styles: **Declarative** and **Scripted**.

**Declarative Pipeline** gives the Jenkinsfile a fixed outer shape. The file starts with `pipeline { ... }`, then uses named sections such as `agent`, `options`, `parameters`, `environment`, `stages`, and `post`. Jenkins can validate that structure before running the pipeline, and the UI can show clean stage boundaries because the file describes the workflow in a predictable way.

```groovy
pipeline {
    agent { label 'linux && maven' }
    stages {
        stage('Build') {
            steps {
                sh 'mvn -B clean package'
            }
        }
    }
    post {
        always {
            junit 'target/surefire-reports/*.xml'
        }
    }
}
```

**Scripted Pipeline** gives the author a more direct Groovy programming style. It uses blocks such as `node { ... }` and lets the author write loops, functions, maps, and conditionals with fewer structural guardrails. This helps when the pipeline must generate stages from data or handle a very dynamic flow, but it also makes review harder for teams that mostly need build, test, package, and deploy stages.

```groovy
node('linux && maven') {
    try {
        stage('Build') {
            sh 'mvn -B clean package'
        }
    } finally {
        junit 'target/surefire-reports/*.xml'
    }
}
```

For most application repositories, Summit Retail chooses Declarative. The structure gives junior engineers a readable file and gives reviewers familiar places to look. When the team needs dynamic behavior, they keep it small with a `script { ... }` block or move it into a shared library, which the next article covers in detail.

Declarative pipelines can also go through a linter before merge. Jenkins supports a command-line Declarative linter through the CLI or an HTTP endpoint. A fast pull-request check can catch a typo such as `paralel` before branch indexing discovers the broken Jenkinsfile.

```bash
ssh -p "$JENKINS_PORT" "$JENKINS_HOST" declarative-linter < Jenkinsfile
curl -X POST --user "$JENKINS_AUTH" -F "jenkinsfile=<Jenkinsfile" "$JENKINS_URL/pipeline-model-converter/validate"
```

The syntax choice now gives the team a foundation. The next problem is the shape inside the file, because one giant `sh` block still hides the real failure.

## Anatomy of a Declarative Pipeline
<!-- section-summary: A Declarative Pipeline is built from top-level sections that define runtime, settings, inputs, stages, and cleanup behavior. -->

A Declarative Jenkinsfile has a few important top-level sections. These sections give Jenkins enough information to schedule work, prepare inputs, run stages, and handle the result. Once a beginner recognizes these blocks, most Jenkinsfiles become much less intimidating.

| Block | What it answers | Common example |
|---|---|---|
| `agent` | Where should this pipeline or stage run? | `agent { label 'linux && maven' }` |
| `options` | What runtime rules should Jenkins enforce? | `timeout`, `disableConcurrentBuilds`, `timestamps` |
| `parameters` | What inputs can a user choose at build time? | target environment, version, dry-run flag |
| `environment` | What environment variables should steps receive? | image name, registry host, Java options |
| `stages` | What named work should happen? | Build, Test, Package, Deploy |
| `post` | What should happen after success, failure, or every run? | test reports, cleanup, notifications |

Here is a small but production-shaped Jenkinsfile for `checkout-api`:

```groovy
pipeline {
    agent none
    options {
        timestamps()
        disableConcurrentBuilds()
        timeout(time: 30, unit: 'MINUTES')
    }
    environment {
        IMAGE = "registry.summit.example/checkout-api:${env.BUILD_NUMBER}"
    }
    stages {
        stage('Build') {
            agent { label 'linux && maven' }
            steps {
                sh 'mvn -B clean package'
            }
        }
        stage('Test') {
            agent { label 'linux && maven' }
            steps {
                sh 'mvn -B test'
            }
        }
    }
    post {
        always {
            junit 'target/surefire-reports/*.xml'
            cleanWs()
        }
    }
}
```

The `agent none` line gives each stage the chance to choose its own runtime. The `options` block protects the controller and agents from runaway builds. The `environment` block creates a shared image name. The `post` block collects test reports and cleans the workspace even if a stage fails.

This structure already gives the team more than a UI shell script. Jenkins can show stages in the UI, reviewers can inspect the settings at the top, and the build produces test reports in a standard place. The next improvement is the one teams feel first during incidents: split work into stages that name the actual failure.

## Refactoring Into Real Stages
<!-- section-summary: Real stages turn a hard-to-read shell script into visible checkpoints that match how engineers debug a failed release. -->

A **stage** is a named checkpoint in the delivery process. Stage names should describe a meaningful piece of work, such as `Compile`, `Unit Test`, `Package`, `Build Image`, `Scan Image`, and `Deploy Staging`. Good stage names help the UI, logs, alerts, and humans all talk about the same failure.

Summit Retail starts with this kind of script inside one stage:

```groovy
stage('Build') {
    steps {
        sh '''
            mvn -B clean package
            mvn -B test
            docker build -t registry.summit.example/checkout-api:${BUILD_NUMBER} .
            docker push registry.summit.example/checkout-api:${BUILD_NUMBER}
        '''
    }
}
```

This script gives Jenkins one red box when anything fails. A broken unit test, a Docker login problem, and a registry outage all look like the same stage failure until someone reads the raw log. The better shape names the work the same way the team investigates it.

```groovy
stages {
    stage('Compile') {
        agent { label 'linux && maven' }
        steps {
            sh 'mvn -B -DskipTests package'
        }
    }
    stage('Unit Test') {
        agent { label 'linux && maven' }
        steps {
            sh 'mvn -B test'
        }
        post {
            always {
                junit 'target/surefire-reports/*.xml'
            }
        }
    }
    stage('Build Image') {
        agent { label 'linux && docker' }
        steps {
            sh 'docker build -t "$IMAGE" .'
        }
    }
    stage('Push Image') {
        agent { label 'linux && docker' }
        steps {
            sh 'docker push "$IMAGE"'
        }
    }
}
```

Now a failed test points at `Unit Test`, while a registry problem points at `Push Image`. Jenkins can also restart from a completed top-level Declarative stage, which helps when a transient environment problem hits after earlier stages already succeeded. The stage design gives the team a controlled retry point instead of a full rerun by habit.

Stage splitting should follow real debugging boundaries. A team should avoid turning every single shell command into its own stage because the UI gets noisy. The sweet spot is usually a small number of stages that match how the team says the pipeline out loud: build the code, test the code, package the artifact, scan it, deploy it, verify it.

## Parallel Branches, Post Conditions, and Options
<!-- section-summary: Parallel branches speed up independent checks, while options and post blocks keep the run bounded and clean. -->

After the pipeline has useful stages, the next bottleneck is usually time. Unit tests, static analysis, and dependency checks often run independently. A **parallel branch** lets Jenkins run those independent checks at the same time on available executors, then combine the result before the pipeline continues.

Summit Retail runs unit tests, linting, and dependency checks in parallel after compilation:

```groovy
stage('Quality Checks') {
    parallel {
        stage('Unit Tests') {
            agent { label 'linux && maven' }
            steps {
                sh 'mvn -B test'
            }
            post {
                always {
                    junit 'target/surefire-reports/*.xml'
                }
            }
        }
        stage('Lint') {
            agent { label 'linux && node' }
            steps {
                sh 'npm ci'
                sh 'npm run lint'
            }
        }
        stage('Dependency Scan') {
            agent { label 'linux && security-tools' }
            steps {
                sh 'trivy fs --exit-code 1 .'
            }
        }
    }
}
```

Parallel work needs enough agents to matter. If all three branches ask for the same single executor, the UI may show parallel branches while the queue still runs them one after another. The label design from the architecture article shows up here again: parallelism only helps when Jenkins has capacity for the requested labels.

The `options` block gives the pipeline runtime rules. `timeout` bounds total time, `disableConcurrentBuilds` protects deployments from overlapping, `timestamps` makes logs easier to read, and `buildDiscarder` limits retained build records. These rules keep a healthy controller from becoming a pile of old logs and abandoned runs.

```groovy
options {
    timestamps()
    disableConcurrentBuilds()
    timeout(time: 45, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '30'))
}
```

The `post` block gives the pipeline a reliable cleanup and reporting path. `always` runs for every result, `success` runs after a successful pipeline, `failure` runs after a failed pipeline, and `unstable` often captures test failures or quality gates that mark the build as risky. A production Jenkinsfile usually keeps reports and cleanup in `post` because those steps matter most after something goes wrong.

```groovy
post {
    always {
        junit allowEmptyResults: true, testResults: '**/target/surefire-reports/*.xml'
        archiveArtifacts artifacts: 'target/*.jar', fingerprint: true
        cleanWs()
    }
    failure {
        slackSend channel: '#delivery-alerts', message: "checkout-api build ${env.BUILD_URL} failed"
    }
}
```

The pipeline now has visible stages, bounded runtime, parallel checks, test reporting, artifacts, and cleanup. The next step is controlling which parts run for which branch, environment, and release intent.

## Parameters, Environment, and When Gating
<!-- section-summary: Parameters, environment variables, and when conditions let one Jenkinsfile serve different branches and release paths safely. -->

Real pipelines need inputs. A **parameter** is a build-time value chosen by a user or API caller. An **environment variable** is a name-value pair exposed to steps during the run. A **when condition** decides whether a stage should run based on branch, tag, parameter, change request, or expression.

Summit Retail wants the same Jenkinsfile to build every branch, deploy to staging from `main`, and deploy to production only when a release manager starts a parameterized run. The pipeline needs enough flexibility for release work without giving every pull request a path to production credentials.

```groovy
parameters {
    choice(name: 'TARGET_ENV', choices: ['staging', 'production'], description: 'Deployment target')
    booleanParam(name: 'DEPLOY', defaultValue: false, description: 'Deploy after the image is built')
}

environment {
    SERVICE_NAME = 'checkout-api'
    REGISTRY = 'registry.summit.example'
}
```

The parameters describe user intent. The environment block describes shared constants for this pipeline. The deploy stage can then combine both with branch data from Jenkins:

```groovy
stage('Deploy') {
    when {
        allOf {
            branch 'main'
            expression { return params.DEPLOY }
        }
    }
    agent { label 'linux && kubectl' }
    steps {
        sh './scripts/deploy.sh "$TARGET_ENV" "$REGISTRY/$SERVICE_NAME:$BUILD_NUMBER"'
    }
}
```

This gate says the deploy stage runs only from `main` and only when the build parameter asks for deployment. A pull request can still compile, test, lint, and build an image in a safe sandbox. The deploy stage stays quiet unless the code path and human intent match.

Environment scope deserves care. A top-level `environment` value reaches every stage. A stage-level `environment` value reaches only that stage. Credentials should use `withCredentials` or a credential-aware environment binding in the smallest block that needs the secret, because a secret exposed to one shell step has a smaller blast radius than a secret exposed to the entire pipeline.

Parameters and gates should also be visible in review. If a pull request adds `DEPLOY = true` by default, removes the branch gate, or moves a credential binding above a test command, the reviewer can catch the risk in Git. This is the practical value of Pipeline as Code: the delivery rules are code review material.

A small gate test matrix keeps deploy logic honest after a Jenkinsfile change:

| Run shape | Expected deploy behavior |
|---|---|
| Pull request build | Compile, test, and scan run. Deploy stages skip. |
| `main` with `DEPLOY=false` | Build and publish can run. Deploy stages skip. |
| `main` with `DEPLOY=true` and `TARGET_ENV=staging` | Staging deploy runs with staging credentials only. |
| `main` with `DEPLOY=true` and `TARGET_ENV=production` | Production deploy waits for the protected job or environment rules. |

This matrix is small enough to check during review and concrete enough to catch risky edits before a release job receives credentials.

## Multibranch Pipelines, Branches, and Pull Requests
<!-- section-summary: Multibranch Pipeline scans source control and creates branch or pull-request jobs from Jenkinsfiles. -->

A **Multibranch Pipeline** is a Jenkins project type that scans a source repository and creates jobs for branches or pull requests that contain a Jenkinsfile. Instead of one manually configured job per branch, Jenkins discovers branches and reads the Jenkinsfile from each one. This is the natural partner for Pipeline as Code.

Summit Retail enables a multibranch project for `checkout-api`. Jenkins scans the Git repository, finds `main`, `release/2026-06`, and a pull request branch, then creates separate branch jobs. Each branch job runs the Jenkinsfile from that branch, which means a release branch can keep older deployment steps while `main` moves to a new Kubernetes namespace.

Multibranch Pipeline also exposes useful environment variables. `BRANCH_NAME` names the branch being built. `CHANGE_ID` appears for many pull request builds. `CHANGE_TARGET` can identify the target branch for a change request. These values let one Jenkinsfile make safe choices without creating separate jobs for every branch.

```groovy
stage('PR Verification') {
    when {
        changeRequest()
    }
    steps {
        sh 'mvn -B verify'
    }
}

stage('Publish Release Candidate') {
    when {
        branch pattern: 'release/.+', comparator: 'REGEXP'
    }
    steps {
        sh './scripts/publish-rc.sh'
    }
}
```

There is one security lesson to carry into every multibranch setup. A Jenkinsfile from a branch is code that Jenkins may execute. If an untrusted fork can change that file and the job exposes deploy credentials, the fork can try to steal them. The credentials article later covers fork trust settings and credential scope in detail, but the pipeline design already helps by keeping secrets behind branch gates and tight scopes.

Multibranch also makes pipeline duplication visible. If ten repositories share the same 150-line Jenkinsfile, the team will eventually fix the same bug ten times. That is the bridge to the next article. A thin Jenkinsfile can keep branch discovery and local service settings, while shared libraries hold reusable build logic.

## Putting It All Together
<!-- section-summary: A production Jenkinsfile gives the team one reviewed, staged, bounded, and branch-aware description of delivery. -->

Summit Retail's `checkout-api` Jenkinsfile now has a clear shape. It uses Declarative Pipeline for structure, requests agents by label, splits the work into readable stages, runs independent quality checks in parallel, publishes test results, archives build artifacts, cleans workspaces, and gates deployment by branch and parameter.

The file also gives the team daily operating benefits. A failed stage names the failing part of the process. A linter can catch syntax errors before merge. A review can catch risky credential use before a pull request reaches Jenkins. A controller rebuild can recover jobs from Git instead of from somebody's memory of a web form.

Here is the important thread from the first two articles. The architecture article created the runtime boundary: controller for coordination, agents for execution. This article created the workflow boundary: Jenkinsfile for reviewed delivery logic, stages for readable execution, and branch rules for safe automation. Together they turn Jenkins from a manually adjusted server into an automation system that a team can reason about.

## What's Next
<!-- section-summary: The next article moves repeated Jenkinsfile logic into shared libraries so many repositories can reuse one tested delivery path. -->

One good Jenkinsfile helps one repository. A growing engineering group usually has many repositories with the same build, scan, package, notify, and deploy pattern. Copying the same Groovy into every service creates another maintenance problem.

The next article introduces Jenkins Shared Libraries. It shows how platform teams move repeated logic into a versioned library with `vars/`, `src/`, and `resources/`, while application repositories keep small Jenkinsfiles that stay easy to review.

---

**References**

- [Jenkins: Pipeline](https://www.jenkins.io/doc/book/pipeline/) - Defines Pipeline, Pipeline as Code, Jenkinsfile benefits, and Declarative versus Scripted Pipeline.
- [Jenkins: Using a Jenkinsfile](https://www.jenkins.io/doc/book/pipeline/jenkinsfile/) - Shows Jenkinsfile examples and common Pipeline sections.
- [Jenkins: Pipeline Syntax](https://www.jenkins.io/doc/book/pipeline/syntax/) - Documents Declarative sections, directives, `agent`, `options`, `parameters`, `environment`, `when`, `parallel`, and `post`.
- [Jenkins: Pipeline Development Tools](https://www.jenkins.io/doc/book/pipeline/development/) - Documents the Declarative Pipeline linter through CLI and HTTP.
- [Jenkins: Branches and Pull Requests](https://www.jenkins.io/doc/book/pipeline/multibranch/) - Explains Multibranch Pipeline discovery, branch jobs, pull requests, and branch environment variables.
- [Jenkins: Running Pipelines](https://www.jenkins.io/doc/book/pipeline/running-pipelines/) - Documents rerun and restart behavior, including Restart from Stage for Declarative pipelines.
