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

1. [Why Is a Jenkinsfile More than a Shell Script in Source Control?](#why-is-a-jenkinsfile-more-than-a-shell-script-in-source-control)
2. [How Is a Declarative Pipeline Structured?](#how-is-a-declarative-pipeline-structured)
3. [How Do Agents and Filesystems Affect Stages?](#how-do-agents-and-filesystems-affect-stages)
4. [How Should Stages Represent State Transitions?](#how-should-stages-represent-state-transitions)
5. [How Do Parallel Branches, Options, and post Change Execution?](#how-do-parallel-branches-options-and-post-change-execution)
6. [How Do Parameters, Environment, and when Select a Path?](#how-do-parameters-environment-and-when-select-a-path)
7. [How Do Multibranch Pipelines Discover Branches and Pull Requests?](#how-do-multibranch-pipelines-discover-branches-and-pull-requests)
8. [How Does Jenkins Execute a Jenkinsfile without Making It the Whole System?](#how-does-jenkins-execute-a-jenkinsfile-without-making-it-the-whole-system)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A **Jenkinsfile** is a text file that describes a Jenkins Pipeline. The file usually lives in the root of the application repository, next to the code it builds. Jenkins reads that file and turns it into stages, steps, logs, status checks, and deployment actions.

The team starts with a UI-created job for `service`. An operator opened the Jenkins web form months ago, pasted a shell script into a build step, added a deploy command, and clicked Save. The job works until someone changes the staging deploy command in the browser and forgets which line changed. The next release fails, and Git has no diff because the delivery process lived inside Jenkins instead of the repository.

Pipeline as Code fixes that workflow. The build definition is part of the same pull request as application changes. A reviewer can see that a test stage changed, a deploy target changed, or a credential binding appeared. A release branch can keep its older pipeline shape, while the main branch moves forward with newer tools.

Keep these questions in view as you work through the lesson:

1. **Why Is a Jenkinsfile More than a Shell Script in Source Control?**
2. **How Is a Declarative Pipeline Structured?**
3. **How Do Agents and Filesystems Affect Stages?**
4. **How Should Stages Represent State Transitions?**
5. **How Do Parallel Branches, Options, and post Change Execution?**
6. **How Do Parameters, Environment, and when Select a Path?**
7. **How Do Multibranch Pipelines Discover Branches and Pull Requests?**
8. **How Does Jenkins Execute a Jenkinsfile without Making It the Whole System?**

## Why Is a Jenkinsfile More than a Shell Script in Source Control?
<!-- section-summary: A Jenkinsfile moves the delivery process into Git so pipeline changes can be reviewed, versioned, and recovered. -->

Pipeline-as-code also changes disaster recovery. If a controller disappears and the team has a clean Jenkins configuration path, a multibranch project can scan repositories and recreate branch jobs from Jenkinsfiles. The pipeline definition comes from source control, so the controller no longer acts as the only memory of how delivery works.

The rest of this article uses one service, `service`, and follows the pipeline as it grows. First the team chooses the Pipeline syntax. Then they break one giant shell script into real stages. After that they add parallel checks, cleanup, parameters, branch gates, and multibranch behavior.

Pipeline exists because delivery is more than one process. A real run may wait in a queue, move between agents, pause for input, fan out independent checks, survive a controller restart, publish reports, and perform cleanup after failure. A UI job or long shell script can issue commands, but it cannot express these orchestration states as clearly as a Pipeline model Jenkins understands.

A committed Jenkinsfile therefore acts as application-orchestration code. It evolves with the repository, receives code review, can be linted, and records which delivery process belongs to a historical branch or release. This does not make every operational setting part of the Jenkinsfile—the controller still owns global security and platform configuration—but it removes hidden per-job delivery logic from browser forms.

<!-- section-summary: Declarative Pipeline gives most application teams a structured, reviewable Jenkinsfile, while Scripted Pipeline stays useful for narrow dynamic logic. -->

Jenkins Pipeline uses a Groovy-based domain-specific language. **Groovy** is a JVM language, and Jenkins uses it to express delivery steps such as `stage`, `sh`, `checkout`, `withCredentials`, and `archiveArtifacts`. Pipeline supports two styles: **Declarative** and **Scripted**.

A Jenkinsfile is not simply a shell script with Groovy punctuation. Some statements describe orchestration that Jenkins evaluates on the controller: stage structure, agent requirements, conditions, timeouts, post behavior, and durable Pipeline state. Other steps cause execution on an agent: `sh`, `bat`, checkout, compilers, tests, and deployment CLIs. Confusing these locations leads to large controller-side Groovy computations or assumptions that a local file exists everywhere.

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

For most application repositories, the team chooses Declarative. The structure gives junior engineers a readable file and gives reviewers familiar places to look. When the team needs dynamic behavior, they keep it small with a `script { ... }` block or move it into a shared library, which the next article covers in detail.

The deeper choice is constraint versus general programming power. Declarative is an opinionated language with a constrained grammar. That allows earlier validation, predictable visualization, and standard places for policy. Scripted exposes more of Groovy and Jenkins' runtime model, which can express dynamic graphs but also makes it easier to create hard-to-resume, hard-to-review orchestration. Declarative can escape into a small `script` block when one calculation truly needs ordinary Groovy; the escape should stay narrow.

A dynamic Pipeline may calculate a map of components and create parallel branches programmatically. That is a legitimate Scripted use when the graph truly comes from data. If the stage set is stable, explicit Declarative stages are easier to visualize, restart, approve, and review. Choose programming power only for variability the delivery model actually needs.

Whichever style is used, keep orchestration data small and serializable across suspension points. Large controller-side object graphs, open iterators, or complex library clients can make Pipeline persistence fragile. Put heavy computation and external processing into agent-side scripts, return a compact result, and let the Jenkinsfile coordinate the next state.

Declarative pipelines can also go through a linter before merge. Jenkins supports a command-line Declarative linter through the CLI or an HTTP endpoint. A fast pull-request check can catch a typo such as `paralel` before branch indexing discovers the broken Jenkinsfile.

```bash
ssh -p "$JENKINS_PORT" "$JENKINS_HOST" declarative-linter < Jenkinsfile
curl -X POST --user "$JENKINS_AUTH" -F "jenkinsfile=<Jenkinsfile" "$JENKINS_URL/pipeline-model-converter/validate"
```

The syntax choice now gives the team a foundation. The next problem is the shape inside the file, because one giant `sh` block still hides the real failure.

## How Is a Declarative Pipeline Structured?
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

![Declarative Jenkinsfile anatomy showing pipeline, agent, options, environment, stages, steps, post, and readable release contract](/content-assets/articles/article-cicd-jenkins-pipelines-and-jenkinsfile/declarative-jenkinsfile-anatomy.png)

*Reviewers can follow a Declarative Jenkinsfile more easily if its major blocks have clear jobs: choose runtime, set rules, name stages, run steps, and handle cleanup.*

Here is a small but production-shaped Jenkinsfile for `service`:

```groovy
pipeline {
    agent none
    options {
        timestamps()
        disableConcurrentBuilds()
        timeout(time: 30, unit: 'MINUTES')
    }
    environment {
        IMAGE = "registry.example.com/team/service:${env.BUILD_NUMBER}"
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

## How Do Agents and Filesystems Affect Stages?
<!-- section-summary: Agent directives bind abstract Pipeline stages to real execution capacity, and moving between agents also moves between local filesystems. -->

The `agent` directive is where an abstract Pipeline meets a real machine. `agent any` asks Jenkins for any eligible executor and normally keeps the whole Pipeline on that assigned node. A stage-level `agent { label 'linux && docker' }` asks the scheduler for a capability only while that stage runs.

Using top-level `agent none` avoids reserving one worker for stages that need different tools or may wait for a long time. Each stage then declares its own agent. A compile stage can use Maven capacity, an image stage can use Docker capacity, and a Windows packaging stage can use a Windows node. The tradeoff is that each allocation may be a different machine with a different workspace.

```groovy
pipeline {
    agent none
    stages {
        stage('Build') {
            agent { label 'linux && maven' }
            steps {
                checkout scm
                sh 'mvn -B package'
                stash name: 'application', includes: 'target/*.jar'
            }
        }
        stage('Image') {
            agent { label 'linux && docker' }
            steps {
                unstash 'application'
                sh 'docker build -t "$IMAGE" .'
            }
        }
    }
}
```

The `target` directory created on the Maven agent does not automatically appear on the Docker agent. `stash` copies a bounded set of files through Jenkins for later `unstash`; artifact repositories or object storage are better for large or long-lived outputs. Re-checkout can materialize source again, but it will not recreate generated binaries unless the stage rebuilds them.

`checkout scm` has special meaning in a multibranch job. Jenkins already knows the repository and exact branch, pull request, or revision represented by the current branch job, so this step checks out that discovered source context. A raw `git` command with a hard-coded branch can accidentally build something different from the revision Jenkins scheduled.

Controller code and agent code remain distinct even inside one Jenkinsfile. Keep heavy file traversal, network work, and command execution in agent steps. Let controller-side Pipeline logic coordinate the graph rather than becoming the build engine.

## How Should Stages Represent State Transitions?
<!-- section-summary: Real stages turn a hard-to-read shell script into visible checkpoints that match how engineers debug a failed release. -->

A **stage** is a named checkpoint in the delivery process. Stage names should describe a meaningful piece of work, such as `Compile`, `Unit Test`, `Package`, `Build Image`, `Scan Image`, and `Deploy Staging`. Good stage names help the UI, logs, alerts, and humans all talk about the same failure.

The team starts with this kind of script inside one stage:

```groovy
stage('Build') {
    steps {
        sh '''
            mvn -B clean package
            mvn -B test
            docker build -t registry.example.com/team/service:${BUILD_NUMBER} .
            docker push registry.example.com/team/service:${BUILD_NUMBER}
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

## How Do Parallel Branches, Options, and post Change Execution?
<!-- section-summary: Parallel branches speed up independent checks, while options and post blocks keep the run bounded and clean. -->

After the pipeline has useful stages, the next bottleneck is usually time. Unit tests, static analysis, and dependency checks often run independently. A **parallel branch** lets Jenkins run those independent checks at the same time on available executors, then combine the result before the pipeline continues.

The team runs unit tests, linting, and dependency checks in parallel after compilation:

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

Cleanup is part of execution semantics, not an optional final command. If a normal stage stops at the first failure, later sequential cleanup steps may never run. A `post` condition ties finalization to the result path. Use `always` for required reports and resource cleanup, then result-specific blocks for notifications or recovery. Cleanup itself should tolerate partial state and avoid hiding the original failure.

Pipeline options govern the orchestration, not merely commands. A timeout bounds how long Jenkins may hold agents or wait on stalled work. Disabling concurrent builds protects shared deployment state. Build retention limits durable controller history. Retry can repeat a bounded block, but it should wrap only idempotent work and should not turn a deterministic failure into repeated harm.

```groovy
post {
    always {
        junit allowEmptyResults: true, testResults: '**/target/surefire-reports/*.xml'
        archiveArtifacts artifacts: 'target/*.jar', fingerprint: true
        cleanWs()
    }
    failure {
        slackSend channel: '#delivery-alerts', message: "service build ${env.BUILD_URL} failed"
    }
}
```

The pipeline now has visible stages, bounded runtime, parallel checks, test reporting, artifacts, and cleanup. The next step is controlling which parts run for which branch, environment, and release intent.

![Parallel branches and post cleanup showing build stage, parallel unit tests, integration tests, security scan, joined results, post always, archived reports, and clean workspace](/content-assets/articles/article-cicd-jenkins-pipelines-and-jenkinsfile/parallel-branches-post-cleanup.png)

*Parallel branches speed up independent checks, while the `post` block keeps reports, notifications, and cleanup on a reliable path after every result.*

## How Do Parameters, Environment, and when Select a Path?
<!-- section-summary: Parameters, environment variables, and when conditions let one Jenkinsfile serve different branches and release paths safely. -->

Real pipelines need inputs. A **parameter** is a build-time value chosen by a user or API caller. An **environment variable** is a name-value pair exposed to steps during the run. A **when condition** decides whether a stage should run based on branch, tag, parameter, change request, or expression.

The team wants the same Jenkinsfile to build every branch, deploy to staging from `main`, and deploy to production only when a release manager starts a parameterized run. The pipeline needs enough flexibility for release work without giving every pull request a path to production credentials.

```groovy
parameters {
    choice(name: 'TARGET_ENV', choices: ['staging', 'production'], description: 'Deployment target')
    booleanParam(name: 'DEPLOY', defaultValue: false, description: 'Deploy after the image is built')
}

environment {
    SERVICE_NAME = 'service'
    REGISTRY = 'registry.example.com/team'
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

Parameters are inputs to the Pipeline function. They express caller intent at the start of a run and remain part of its record. Environment variables solve a different problem: they provide values to processes and may be scoped globally, per stage, or inside a credential block. Do not use a freely editable parameter where policy should make the decision, and do not expose a secret as an ordinary parameter.

A small gate test matrix keeps deploy logic honest after a Jenkinsfile change:

| Run shape | Expected deploy behavior |
|---|---|
| Pull request build | Compile, test, and scan run. Deploy stages skip. |
| `main` with `DEPLOY=false` | Build and publish can run. Deploy stages skip. |
| `main` with `DEPLOY=true` and `TARGET_ENV=staging` | Staging deploy runs with staging credentials only. |
| `main` with `DEPLOY=true` and `TARGET_ENV=production` | Production deploy waits for the protected job or environment rules. |

This matrix is small enough to check during review and concrete enough to catch risky edits before a release job receives credentials.

## How Do Multibranch Pipelines Discover Branches and Pull Requests?
<!-- section-summary: Multibranch Pipeline scans source control and creates branch or pull-request jobs from Jenkinsfiles. -->

A **Multibranch Pipeline** is a Jenkins project type that scans a source repository and creates jobs for branches or pull requests that contain a Jenkinsfile. Instead of one manually configured job per branch, Jenkins discovers branches and reads the Jenkinsfile from each one. This is the natural partner for Pipeline as Code.

The team enables a multibranch project for `service`. Jenkins scans the Git repository, finds `main`, `release/2026-06`, and a pull request branch, then creates separate branch jobs. Each branch job runs the Jenkinsfile from that branch, which means a release branch can keep older deployment steps while `main` moves to a new Kubernetes namespace.

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

Each discovered branch can evolve its Jenkinsfile beside its code, but that flexibility is also a trust decision. A pull request that edits the Jenkinsfile is proposing new executable orchestration. Low-trust change requests should not receive protected credentials or land on privileged agents merely because the proposed file asks for them. Configure the multibranch source trust model and design credential bindings so untrusted code can validate without inheriting release authority.

## How Does Jenkins Execute a Jenkinsfile without Making It the Whole System?
<!-- section-summary: Jenkins parses the Pipeline, records durable orchestration state, schedules agent work, and updates that state as steps finish. -->

When a multibranch scan finds a Jenkinsfile, Jenkins does more than start reading commands from top to bottom. It loads the Pipeline definition, validates Declarative structure, constructs execution state, evaluates stage conditions as their time arrives, and creates queue items for agent requirements. The controller records enough Pipeline state to coordinate pauses and resume supported work after interruptions.

An agent allocation creates or selects a workspace and binds steps to an executor. `checkout scm` materializes the discovered revision. An `sh` step starts a process on the agent and waits for its result. A parallel stage creates independent branches in the execution graph, but each branch still waits for real executor capacity. A `when` condition can skip a transition before allocating an agent when configured appropriately.

When a step finishes, its exit status and metadata return to the Pipeline engine. A nonzero command usually fails the step unless the Jenkinsfile handles it. Stage and pipeline `post` conditions then run according to the resulting state. Test and artifact steps convert files from an agent workspace into durable Jenkins records or external outputs before cleanup removes the workspace.

This is why Pipeline is a graph and state machine rather than a decorated script. Stages represent meaningful states, `needs`-like sequencing is expressed by their structure, parallel branches fan out and join, conditions select paths, and `post` defines result-dependent finalization.

<!-- section-summary: A production Jenkinsfile gives the team one reviewed, staged, bounded, and branch-aware description of delivery. -->

The team's `service` Jenkinsfile now has a clear shape. It uses Declarative Pipeline for structure, requests agents by label, splits the work into readable stages, runs independent quality checks in parallel, publishes test results, archives build artifacts, cleans workspaces, and gates deployment by branch and parameter.

The file also gives the team daily operating benefits. A failed stage names the failing part of the process. A linter can catch syntax errors before merge. A review can catch risky credential use before a pull request reaches Jenkins. A controller rebuild can recover jobs from Git instead of from somebody's memory of a web form.

Here is the important thread from the first two articles. The architecture article created the runtime boundary: controller for coordination, agents for execution. This article created the workflow boundary: Jenkinsfile for reviewed delivery logic, stages for readable execution, and branch rules for safe automation. Together they turn Jenkins from a manually adjusted server into an automation system that a team can reason about.

Keep the Jenkinsfile at the level of delivery intent. It should be easy to read statements such as “build,” “test,” “scan,” “publish,” and “deploy.” Large portable algorithms belong in versioned scripts or applications that engineers can run outside Jenkins. Shared organization mechanics belong in focused library functions. The Jenkinsfile should compose those units, choose agents and conditions, and make the delivery graph visible.

This boundary avoids turning Groovy into the organization's entire software system. Shell quoting, complex data transformations, business rules, and large API clients are harder to test when buried in controller-side Pipeline code. A thin orchestration layer plus tested executable tools gives Jenkins durable coordination without making every implementation detail depend on Jenkins.

![Operational Jenkinsfile checklist showing versioned Jenkinsfile, clear stages, parameters, when gates, multibranch pull requests, post cleanup, and readable failures](/content-assets/articles/article-cicd-jenkins-pipelines-and-jenkinsfile/operational-jenkinsfile-checklist.png)

*A production Jenkinsfile gives the team one reviewed delivery contract with readable stages, bounded inputs, branch gates, cleanup, and failure signals.*

## Check Your Answers

:::expand[Why Is a Jenkinsfile More than a Shell Script in Source Control?]{kind="recap"}
A Jenkinsfile makes delivery logic versioned, reviewable, lintable, and recoverable with the application revision it serves. It replaces hidden UI job commands with orchestration code while leaving controller-wide platform and security configuration in Jenkins administration.

A shell script runs commands in one process context. A Jenkinsfile describes durable orchestration: stages, queues, agents, conditions, parallel branches, pauses, results, and finalization. Controller-side Pipeline logic coordinates; agent-side steps perform the resource-heavy commands.
:::

:::expand[How Is a Declarative Pipeline Structured?]{kind="recap"}
Declarative Pipeline uses a constrained `pipeline` grammar with standard blocks for agents, options, parameters, environment, stages, and post behavior. Scripted Pipeline exposes more Groovy power. Prefer Declarative for predictable review and use narrow `script` escapes only when needed.
:::

:::expand[How Do Agents and Filesystems Affect Stages?]{kind="recap"}
An agent directive binds work to real execution capacity. With `agent none`, stages may use different machines, so local files do not follow automatically. Use checkout, stash and unstash, artifacts, or a registry to materialize the required inputs deliberately.
:::

:::expand[How Should Stages Represent State Transitions?]{kind="recap"}
Stages should name meaningful delivery states such as compile, test, package, scan, and deploy. Those boundaries improve visualization, failure diagnosis, and controlled restart. One stage per command is noisy; one stage for the entire release hides useful state.
:::

:::expand[How Do Parallel Branches, Options, and post Change Execution?]{kind="recap"}
Parallel branches create a graph of independent checks but still need real executor capacity. Options bound concurrency, time, timestamps, and retention. `post` defines result-dependent reporting, archiving, notification, and cleanup so finalization still happens after failures.
:::

:::expand[How Do Parameters, Environment, and when Select a Path?]{kind="recap"}
Parameters are build inputs, environment entries are values exposed to steps, and `when` decides whether a stage represents the current branch, change request, tag, or requested release path. Scope credentials to the smallest stage or block that requires them.
:::

:::expand[How Do Multibranch Pipelines Discover Branches and Pull Requests?]{kind="recap"}
A multibranch project scans source control and creates jobs for discovered revisions containing Jenkinsfiles. `checkout scm` materializes that exact context. Because a branch can modify its own Jenkinsfile, untrusted changes must not inherit privileged agents or credentials.
:::

:::expand[How Does Jenkins Execute a Jenkinsfile without Making It the Whole System?]{kind="recap"}
Jenkins validates and records Pipeline state, evaluates conditions, creates queue items, reserves executors, and sends executable steps to agents. Results update the graph; parallel branches join; post conditions run; reports and artifacts become durable before workspace cleanup.

Keep orchestration readable as build, test, scan, publish, and deploy. Put portable algorithms in tested scripts or programs and shared mechanisms in focused libraries. The Jenkinsfile should compose them, choose runtime and conditions, and expose the delivery graph.
:::

## References

- [Jenkins: Pipeline](https://www.jenkins.io/doc/book/pipeline/) - Defines Pipeline, Pipeline as Code, Jenkinsfile benefits, and Declarative versus Scripted Pipeline.
- [Jenkins: Using a Jenkinsfile](https://www.jenkins.io/doc/book/pipeline/jenkinsfile/) - Shows Jenkinsfile examples and common Pipeline sections.
- [Jenkins: Pipeline Syntax](https://www.jenkins.io/doc/book/pipeline/syntax/) - Documents Declarative sections, directives, `agent`, `options`, `parameters`, `environment`, `when`, `parallel`, and `post`.
- [Jenkins: Pipeline Development Tools](https://www.jenkins.io/doc/book/pipeline/development/) - Documents the Declarative Pipeline linter through CLI and HTTP.
- [Jenkins: Branches and Pull Requests](https://www.jenkins.io/doc/book/pipeline/multibranch/) - Explains Multibranch Pipeline discovery, branch jobs, pull requests, and branch environment variables.
- [Jenkins: Running Pipelines](https://www.jenkins.io/doc/book/pipeline/running-pipelines/) - Documents rerun and restart behavior, including Restart from Stage for Declarative pipelines.
