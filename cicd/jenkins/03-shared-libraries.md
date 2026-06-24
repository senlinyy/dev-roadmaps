---
title: "Shared Libraries"
description: "Centralize pipeline configurations, build standardized global steps, and enforce organization-wide compliance using Groovy Shared Libraries."
overview: "Duplicate pipelines across hundreds of repositories lead to configuration drift and maintenance deadlocks. Learn how to structure a Jenkins Shared Library repository, how to write global steps, how to use src and resources, and how to version library changes without breaking production."
tags: ["jenkins", "shared-libraries", "groovy", "devops"]
order: 3
id: article-cicd-jenkins-shared-libraries
aliases:
  - /cicd/jenkins/shared-libraries
---

## Table of Contents

1. [Why Shared Libraries Exist](#why-shared-libraries-exist)
2. [Configuring and Loading Libraries](#configuring-and-loading-libraries)
3. [The Global Step in vars](#the-global-step-in-vars)
4. [Helpers in src and Templates in resources](#helpers-in-src-and-templates-in-resources)
5. [Versioning by Git Ref](#versioning-by-git-ref)
6. [The Day the Library Broke Production](#the-day-the-library-broke-production)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## Why Shared Libraries Exist
<!-- section-summary: Shared libraries move repeated Jenkinsfile logic into a versioned repository that many pipelines can call. -->

A **Jenkins Shared Library** is a Git-backed library of Groovy pipeline code that Jenkins can load into many Jenkinsfiles. It gives a platform team one place to maintain repeated delivery logic, such as standard build stages, security scans, Docker image publishing, Slack notifications, Helm deploys, and release evidence collection.

Summit Retail now has good Jenkinsfiles for `checkout-api`, `inventory-api`, and `payments-api`. After a few months, the team notices that all three files contain almost the same Maven build, Trivy scan, Docker push, and Kubernetes deploy stages. A vulnerability scanner flag changes, and the platform team opens the same pull request in three repositories. Next quarter, that turns into thirty repositories.

That is the point where Shared Libraries become useful. Each application repository can keep a small Jenkinsfile that names the service and chooses a few options. The shared library holds the repeated build mechanics. When the platform team improves the scanner command, the change lands in one library repository instead of thirty service repositories.

This gives the team leverage, and it also creates responsibility. A shared library can break many pipelines at once. It can also run trusted Groovy code depending on how Jenkins configures it. The rest of this article builds the library carefully: first how Jenkins loads it, then how `vars/`, `src/`, and `resources/` split responsibility, then how versioning prevents a helpful refactor from becoming a production outage.

## Configuring and Loading Libraries
<!-- section-summary: Jenkins loads shared libraries from configured source-control locations, and Jenkinsfiles request them by name and version. -->

Jenkins needs to know where a library lives before a Jenkinsfile can use it. An administrator can define a global shared library under Manage Jenkins, System, Global Trusted Pipeline Libraries or Global Untrusted Pipeline Libraries. A folder can also define a library for jobs inside that folder, which helps large companies scope library access by team or business unit.

The library configuration has three important parts. The **name** is the short identifier that Jenkinsfiles use. The **retrieval method** tells Jenkins how to fetch the library from source control, usually Git through the Modern SCM option. The **default version** is the branch, tag, or commit Jenkins loads when the Jenkinsfile asks for the library without an explicit version.

Summit Retail configures a library called `summit-pipeline` with a Git URL like `git@github.com:summit/jenkins-shared-library.git`. The platform team sets the default version to `v1` for stable consumers. Application repositories can then load it at the top of the Jenkinsfile:

```groovy
@Library('summit-pipeline@v1.4.2') _

standardMavenService(
    serviceName: 'checkout-api',
    imageName: 'registry.summit.example/checkout-api'
)
```

The underscore looks strange the first time you see it. In this pattern, the annotation needs something to attach to, and `_` acts as a small placeholder. The important part is `@Library('summit-pipeline@v1.4.2')`, which tells Jenkins to load that library version before compiling the Jenkinsfile.

Jenkins can also load a library dynamically inside a pipeline with the `library` step. Teams usually reserve that for advanced cases, such as choosing a library ref from a parameter or matching a library branch to the application branch. Most application Jenkinsfiles stay clearer with the top-level `@Library` annotation.

The trust setting matters. A **trusted global library** can call Jenkins internals and Java APIs with broad power, so only a tightly controlled platform repository should feed that kind of library. Folder-level libraries always run as untrusted libraries in the Groovy sandbox, which gives teams a scoped reuse path with a smaller administrative blast radius.

## The Global Step in vars
<!-- section-summary: Files in vars become pipeline-callable global steps, and a call method makes the step feel like built-in Jenkins syntax. -->

The `vars/` directory is where most teams start. Each Groovy file under `vars/` gives Jenkins a global variable or step that a Jenkinsfile can call. If the file defines a `call` method, Jenkins lets the pipeline invoke the filename like a function.

Summit Retail creates this library file:

`vars/standardMavenService.groovy`

```groovy
def call(Map config = [:]) {
    String serviceName = config.serviceName
    String imageName = config.imageName

    pipeline {
        agent none
        options {
            timestamps()
            disableConcurrentBuilds()
            timeout(time: 45, unit: 'MINUTES')
        }
        environment {
            IMAGE = "${imageName}:${env.BUILD_NUMBER}"
        }
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
        }
        post {
            always {
                cleanWs()
            }
            failure {
                slackNotify(service: serviceName, result: 'failed')
            }
        }
    }
}
```

Now every Maven service can use a very small Jenkinsfile. The application repository still owns the service name and image name, while the library owns the standard stages. This is a good boundary because service teams can read the contract quickly, and the platform team can improve the common implementation.

`vars/` files should stay mostly stateless. Jenkins pipelines can survive controller restarts by serializing pipeline state, and global variables that store mutable state can surprise people after a restart. A `vars/` file works best as a collection of steps that receives inputs, calls Jenkins steps, and returns results.

Documentation can live beside the global step as `vars/standardMavenService.txt`. Jenkins can show that help in the Global Variable Reference for jobs that import the library. This small habit helps new service teams understand the accepted options without reading every line of Groovy.

## Helpers in src and Templates in resources
<!-- section-summary: src holds reusable Groovy classes, while resources holds non-code files that library steps can load at runtime. -->

As the library grows, every helper should not live in `vars/`. The `src/` directory holds regular Groovy or Java-style classes using package directories. Jenkins adds this directory to the classpath when the library loads, so `vars/` steps can import helper classes and keep pipeline-facing code small.

Summit Retail wants one helper that validates semantic versions. The class belongs in `src/` because it is a normal reusable helper, and it can be unit-tested outside Jenkins more easily than a pipeline step.

`src/com/summit/pipeline/Semver.groovy`

```groovy
package com.summit.pipeline

class Semver implements Serializable {
    static boolean validReleaseTag(String value) {
        return value ==~ /^v\\d+\\.\\d+\\.\\d+$/
    }
}
```

A global step can import and use it:

`vars/releaseGuard.groovy`

```groovy
import com.summit.pipeline.Semver

def call(String tagName) {
    if (!Semver.validReleaseTag(tagName)) {
        error "Release tag must look like v1.2.3"
    }
}
```

The `resources/` directory holds non-code files that the library loads with `libraryResource`. This is useful for small templates, JSON payloads, notification bodies, or default Helm values. Jenkins treats the path like a package path, so unique directories reduce naming collisions between libraries.

`resources/com/summit/pipeline/deploy-values.yaml`

```yaml
replicaCount: 2
image:
  repository: registry.summit.example/placeholder
  tag: latest
service:
  port: 8080
```

A library step can load that template, replace a few values, and write it into the workspace:

```groovy
def values = libraryResource 'com/summit/pipeline/deploy-values.yaml'
values = values.replace('registry.summit.example/placeholder', config.imageRepository)
values = values.replace('latest', config.imageTag)
writeFile file: 'generated-values.yaml', text: values
```

This folder split keeps the library understandable. `vars/` exposes the friendly pipeline interface. `src/` holds real helper code. `resources/` holds templates and static files. Once a library has that shape, versioning is the next big design choice.

## Versioning by Git Ref
<!-- section-summary: Pinning a library by branch, tag, or commit controls how quickly shared pipeline changes reach application repositories. -->

A Jenkins shared library version can be a Git branch, tag, or commit hash. That Git ref controls the rollout speed of platform changes. A branch moves whenever someone pushes to it. A tag should stay fixed by team policy. A commit hash points at one exact revision.

`@Library('summit-pipeline@main') _` gives fast adoption. Every consumer that uses `main` receives the newest library code on the next build. This helps early experiments and internal sandbox jobs, but it gives the platform team a large blast radius because one merge can change many production pipelines.

`@Library('summit-pipeline@v1.4.2') _` gives a stable release line. A service stays on that library version until its team changes the Jenkinsfile. This creates an explicit upgrade pull request, where reviewers can read the library changelog and run a staging build before production deployment jobs pick up the new behavior.

`@Library('summit-pipeline@2f4c8a1') _` gives maximum reproducibility. Regulated or high-risk deployment pipelines sometimes pin to a commit hash because it names the exact library code. The cost is maintenance, because humans prefer release tags and changelogs over raw SHAs for day-to-day work.

Summit Retail uses three lanes:

| Lane | Example ref | Good fit |
|---|---|---|
| Sandbox | `main` | Testing library changes with low-risk jobs |
| Standard services | `v1.4.2` | Normal application pipelines with planned upgrades |
| Regulated deploys | `2f4c8a1` | Pipelines that need exact historical reproduction |

Versioning also needs release notes. A library release should explain changed stages, changed agent labels, new required parameters, credential behavior changes, and migration steps. The application pull request that bumps `v1.4.1` to `v1.4.2` should link to those notes and run the service pipeline in a non-production branch.

## The Day the Library Broke Production
<!-- section-summary: A shared library outage usually comes from unpinned consumers, missing compatibility tests, or a wide trusted-code blast radius. -->

Here is the failure that teaches the lesson. Summit Retail has twenty services loading `@Library('summit-pipeline@main') _`. A platform engineer renames `standardMavenService` option `imageName` to `imageRepository` and updates two services. The code merges to `main`, and the next build for every other service fails before deployment because their Jenkinsfiles still pass the old key.

The incident feels like a Jenkins problem, but the root cause is release management. The shared library changed a public contract without a compatibility window. The services consumed a moving branch. The platform team had no compatibility test suite that ran sample Jenkinsfiles against the new library ref before merge.

The fix has several parts. First, the library restores backwards compatibility for one release by accepting both option names. Second, production services move from `main` to version tags. Third, the platform team adds a small library test suite with representative Jenkinsfiles for Maven, Node.js, and deploy-only services. Fourth, each library release gets notes that call out new parameters and deprecated ones.

The representative Jenkinsfiles do not need to deploy real systems. They need to compile the library API that service teams call and run the safe stages that prove the contract still works.

```groovy
@Library('summit-pipeline@feature/image-repository-compat') _

standardMavenService(
    serviceName: 'checkout-api-smoke',
    imageName: 'registry.summit.example/checkout-api-smoke',
    dryRun: true
)
```

Before a library tag moves to production, Summit Retail runs smoke jobs for old and new option names. The old shape proves compatibility, and the new shape proves the migration path. If either smoke job fails, the library release waits.

A safe replacement step might look like this:

```groovy
def call(Map config = [:]) {
    String imageRepository = config.imageRepository ?: config.imageName

    if (!imageRepository) {
        error 'standardMavenService requires imageRepository'
    }

    standardMavenPipeline(
        serviceName: config.serviceName,
        imageRepository: imageRepository
    )
}
```

This wrapper gives older consumers time to upgrade while new consumers use the clearer name. The team can then remove `imageName` support in the next major library version, after every service has moved. Shared libraries need the same compatibility discipline as any other internal API because a Jenkinsfile that calls `standardMavenService(...)` is a consumer of that API.

Trust also matters during an incident. If the library is trusted, a malicious or careless commit can call powerful Jenkins APIs from the controller. The right defense is repository protection: required reviews, protected tags, limited maintainers, branch protection, signed release tags where the organization supports them, and a small admin group that controls trusted library configuration.

## Putting It All Together
<!-- section-summary: A healthy shared-library setup keeps Jenkinsfiles thin, library APIs stable, and production consumers pinned to reviewed releases. -->

Summit Retail ends with a clean pattern. Application repositories keep small Jenkinsfiles that load `summit-pipeline` and pass service-specific values. The shared library owns reusable steps, helper classes, and templates. `vars/` exposes global steps, `src/` holds reusable classes, and `resources/` holds small files loaded at runtime.

The team also treats the shared library like a product. Changes land through review, test Jenkinsfiles run before merge, release tags get notes, and production services consume tags instead of a moving branch. Sandbox jobs can still follow `main`, because fast feedback belongs in low-risk places.

This is the natural next step after good Jenkinsfiles. Pipeline as Code gives each repository a reviewed delivery contract. Shared Libraries keep that contract small while giving the platform team one maintained implementation for the repeated parts.

## What's Next
<!-- section-summary: The next article moves from pipeline code to the controller itself: plugins, Configuration as Code, and repeatable Jenkins installations. -->

Shared libraries reduce duplication inside pipelines. The controller still has another kind of duplication risk: manually installed plugins, hand-edited settings, and configuration that exists only inside `$JENKINS_HOME`.

The next article moves to plugins and configuration. It shows how teams pin plugin versions, manage Jenkins Configuration as Code, separate reloads from restarts, and create an upgrade cadence that survives real production pressure.

---

**References**

- [Jenkins: Extending with Shared Libraries](https://www.jenkins.io/doc/book/pipeline/shared-libraries/) - Documents shared library configuration, directory structure, `vars`, `src`, `resources`, trusted libraries, library versions, and `@Library`.
- [Jenkins: Pipeline Syntax](https://www.jenkins.io/doc/book/pipeline/syntax/) - Provides the Pipeline syntax reference used by shared-library steps.
- [Jenkins: Pipeline Development Tools](https://www.jenkins.io/doc/book/pipeline/development/) - Covers tooling for Pipeline and shared-library development, including testing support and replay notes.
- [Jenkins: In-process Script Approval](https://www.jenkins.io/doc/book/managing/script-approval/) - Explains the Groovy sandbox and script approval model that affects untrusted pipeline code.
