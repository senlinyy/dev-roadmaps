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

1. [Why Do Jenkins Shared Libraries Exist?](#why-do-jenkins-shared-libraries-exist)
2. [How Does Jenkins Configure and Load a Library?](#how-does-jenkins-configure-and-load-a-library)
3. [How Does vars Become the Pipeline-Facing API?](#how-does-vars-become-the-pipeline-facing-api)
4. [Why Are src and resources Separate from vars?](#why-are-src-and-resources-separate-from-vars)
5. [How Should a Library Be Versioned?](#how-should-a-library-be-versioned)
6. [Why Can One Library Change Break Many Pipelines?](#why-can-one-library-change-break-many-pipelines)
7. [How Does the Complete Shared-Library Lifecycle Fit Together?](#how-does-the-complete-shared-library-lifecycle-fit-together)
8. [Check Your Answers](#check-your-answers)
9. [References](#references)

A **Jenkins Shared Library** is a Git-backed library of Groovy pipeline code that Jenkins can load into many Jenkinsfiles. It gives a platform team one place to maintain repeated delivery logic, such as standard build stages, security scans, Docker image publishing, Slack notifications, Helm deploys, and release evidence collection.

The platform team now has good Jenkinsfiles for `service`, `service-b`, and `service-c`. After a few months, the team notices that all three files contain almost the same Maven build, Trivy scan, Docker push, and Kubernetes deploy stages. A vulnerability scanner flag changes, and the platform team opens the same pull request in three repositories. Next quarter, that turns into thirty repositories.

That is the point where Shared Libraries become useful. Each application repository can keep a small Jenkinsfile that names the service and chooses a few options. The shared library holds the repeated build mechanics. When the platform team improves the scanner command, the change lands in one library repository instead of thirty service repositories.

Keep these questions in view as you work through the lesson:

1. **Why Do Jenkins Shared Libraries Exist?**
2. **How Does Jenkins Configure and Load a Library?**
3. **How Does vars Become the Pipeline-Facing API?**
4. **Why Are src and resources Separate from vars?**
5. **How Should a Library Be Versioned?**
6. **Why Can One Library Change Break Many Pipelines?**
7. **How Does the Complete Shared-Library Lifecycle Fit Together?**

## Why Do Jenkins Shared Libraries Exist?
<!-- section-summary: Shared libraries move repeated Jenkinsfile logic into a versioned repository that many pipelines can call. -->

Central reuse gives the team leverage and creates responsibility. A shared library can break many pipelines at once. It can also run trusted Groovy code depending on how Jenkins configures it. The rest of this article builds the library carefully: first how Jenkins loads it, then how `vars/`, `src/`, and `resources/` split responsibility, then how versioning prevents a helpful refactor from becoming a production outage.

![Jenkins Shared Library structure showing Jenkinsfile using at Library, shared library repo, vars global step, src helper classes, and resources templates](/content-assets/articles/article-cicd-jenkins-shared-libraries/shared-library-structure.png)

*A shared library lets each application Jenkinsfile stay small while reusable steps, helper classes, and templates live in a versioned platform repository.*

## How Does Jenkins Configure and Load a Library?
<!-- section-summary: Jenkins loads shared libraries from configured source-control locations, and Jenkinsfiles request them by name and version. -->

Jenkins needs to know where a library lives before a Jenkinsfile can use it. An administrator can define a global shared library under Manage Jenkins, System, Global Trusted Pipeline Libraries or Global Untrusted Pipeline Libraries. A folder can also define a library for jobs inside that folder, which helps large companies scope library access by team or business unit.

The library configuration has three important parts. The **name** is the short identifier that Jenkinsfiles use. The **retrieval method** tells Jenkins how to fetch the library from source control, usually Git through the Modern SCM option. The **default version** is the branch, tag, or commit Jenkins loads when the Jenkinsfile asks for the library without an explicit version.

The platform team configures a library called `company-pipeline` with a Git URL like `git@github.com:example-org/jenkins-shared-library.git`. The platform team sets the default version to `v1` for stable consumers. Application repositories can then load it at the top of the Jenkinsfile:

```groovy
@Library('company-pipeline@v1.4.2') _

standardMavenService(
    serviceName: 'service',
    imageName: 'registry.example.com/company/service'
)
```

The underscore looks strange the first time you see it. In this pattern, the annotation needs something to attach to, and `_` acts as a small placeholder. The important part is `@Library('company-pipeline@v1.4.2')`, which tells Jenkins to load that library version before compiling the Jenkinsfile.

Jenkins can also load a library dynamically inside a pipeline with the `library` step. Teams usually reserve that for advanced cases, such as choosing a library ref from a parameter or matching a library branch to the application branch. Most application Jenkinsfiles stay clearer with the top-level `@Library` annotation.

The two forms load at different times. `@Library` is a Groovy annotation, so Jenkins resolves the library before compiling the Jenkinsfile. That lets the file import classes from `src/` and use them as types during compilation. The `_` is merely the expression to which the annotation attaches when there is no import statement or other convenient target.

The `library` step runs dynamically after execution has started. It can choose a ref from runtime data, but classes that did not exist during compilation cannot suddenly become ordinary statically imported types in already-compiled code. Dynamic loading is useful, but compile-time loading is the simpler default.

The trust setting matters. A **trusted global library** can call Jenkins internals and Java APIs with broad power, so only a tightly controlled platform repository should feed that kind of library. Folder-level libraries always run as untrusted libraries in the Groovy sandbox, which gives teams a scoped reuse path with a smaller administrative blast radius.

## How Does vars Become the Pipeline-Facing API?
<!-- section-summary: Files in vars become pipeline-callable global steps, and a call method makes the step feel like built-in Jenkins syntax. -->

The `vars/` directory is where most teams start. Each Groovy file under `vars/` gives Jenkins a global variable or step that a Jenkinsfile can call. If the file defines a `call` method, Jenkins lets the pipeline invoke the filename like a function.

The platform team creates this library file:

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

## Why Are src and resources Separate from vars?
<!-- section-summary: src holds reusable Groovy classes, while resources holds non-code files that library steps can load at runtime. -->

As the library grows, every helper should not live in `vars/`. The `src/` directory holds regular Groovy or Java-style classes using package directories. Jenkins adds this directory to the classpath when the library loads, so `vars/` steps can import helper classes and keep pipeline-facing code small.

The platform team wants one helper that validates semantic versions. The class belongs in `src/` because it is a normal reusable helper, and it can be unit-tested outside Jenkins more easily than a pipeline step.

`src/com/example/ci/Semver.groovy`

```groovy
package com.example.ci

class Semver implements Serializable {
    static boolean validReleaseTag(String value) {
        return value ==~ /^v\\d+\\.\\d+\\.\\d+$/
    }
}
```

A global step can import and use it:

`vars/releaseGuard.groovy`

```groovy
import com.example.ci.Semver

def call(String tagName) {
    if (!Semver.validReleaseTag(tagName)) {
        error "Release tag must look like v1.2.3"
    }
}
```

Classes under `src/` are ordinary library classes, not Pipeline script objects. They do not automatically own Jenkins steps such as `sh`, `echo`, or `writeFile`. Keep pure calculations pure, or explicitly pass the Pipeline script context or a small callable dependency into a class that must invoke a step. This boundary makes helper code easier to unit-test and keeps Jenkins runtime coupling visible.

`Serializable` appears often because Jenkins may suspend a Pipeline and serialize its reachable execution state so it can resume later. A helper instance retained across a suspension point must be serializable, and any fields it retains must also be compatible. Prefer small, stateless helpers and avoid holding live streams, complex clients, or other non-serializable runtime objects across Pipeline steps.

The `resources/` directory holds non-code files that the library loads with `libraryResource`. This is useful for small templates, JSON payloads, notification bodies, or default Helm values. Jenkins treats the path like a package path, so unique directories reduce naming collisions between libraries.

`resources/com/example/ci/deploy-values.yaml`

```yaml
replicaCount: 2
image:
  repository: registry.example.com/company/placeholder
  tag: latest
service:
  port: 8080
```

A library step can load that template, replace a few values, and write it into the workspace:

```groovy
def values = libraryResource 'com/example/ci/deploy-values.yaml'
values = values.replace('registry.example.com/company/placeholder', config.imageRepository)
values = values.replace('latest', config.imageTag)
writeFile file: 'generated-values.yaml', text: values
```

This folder split keeps the library understandable. `vars/` exposes the friendly pipeline interface. `src/` holds real helper code. `resources/` holds templates and static files. Once a library has that shape, versioning is the next big design choice.

In one sentence each: `vars/` is the Pipeline-facing API, `src/` is packaged helper code, and `resources/` is non-executable file content. A healthy library uses all three without asking callers to understand its internal directory layout.

![What the Jenkins Shared Library provides showing vars callable step, src helpers, resources templates, and a standard service pipeline](/content-assets/articles/article-cicd-jenkins-shared-libraries/library-provides-pipeline.png)

*The library interface stays friendly through `vars/`, while helper code and templates support the standard pipeline behind that small call.*

## How Should a Library Be Versioned?
<!-- section-summary: Pinning a library by branch, tag, or commit controls how quickly shared pipeline changes reach application repositories. -->

A Jenkins shared library version can be a Git branch, tag, or commit hash. That Git ref controls the rollout speed of platform changes. A branch moves whenever someone pushes to it. A tag should stay fixed by team policy. A commit hash points at one exact revision.

`@Library('company-pipeline@main') _` gives fast adoption. Every consumer that uses `main` receives the newest library code on the next build. This helps early experiments and internal sandbox jobs, but it gives the platform team a large blast radius because one merge can change many production pipelines.

`@Library('company-pipeline@v1.4.2') _` gives a stable release line. A service stays on that library version until its team changes the Jenkinsfile. This creates an explicit upgrade pull request, where reviewers can read the library changelog and run a staging build before production deployment jobs pick up the new behavior.

`@Library('company-pipeline@2f4c8a1') _` gives maximum reproducibility. Regulated or high-risk deployment pipelines sometimes pin to a commit hash because it names the exact library code. The cost is maintenance, because humans prefer release tags and changelogs over raw SHAs for day-to-day work.

The platform team uses three lanes:

| Lane | Example ref | Good fit |
|---|---|---|
| Sandbox | `main` | Testing library changes with low-risk jobs |
| Standard services | `v1.4.2` | Normal application pipelines with planned upgrades |
| Regulated deploys | `2f4c8a1` | Pipelines that need exact historical reproduction |

Versioning also needs release notes. A library release should explain changed stages, changed agent labels, new required parameters, credential behavior changes, and migration steps. The application pull request that bumps `v1.4.1` to `v1.4.2` should link to those notes and run the service pipeline in a non-production branch.

## Why Can One Library Change Break Many Pipelines?
<!-- section-summary: A shared library outage usually comes from unpinned consumers, missing compatibility tests, or a wide trusted-code blast radius. -->

Here is the failure that teaches the lesson. The platform team has twenty services loading `@Library('company-pipeline@main') _`. A platform engineer renames `standardMavenService` option `imageName` to `imageRepository` and updates two services. The code merges to `main`, and the next build for every other service fails before deployment because their Jenkinsfiles still pass the old key.

The incident feels like a Jenkins problem, but the root cause is release management. The shared library changed a public contract without a compatibility window. The services consumed a moving branch. The platform team had no compatibility test suite that ran sample Jenkinsfiles against the new library ref before merge.

The fix has several parts. First, the library restores backwards compatibility for one release by accepting both option names. Second, production services move from `main` to version tags. Third, the platform team adds a small library test suite with representative Jenkinsfiles for Maven, Node.js, and deploy-only services. Fourth, each library release gets notes that call out new parameters and deprecated ones.

The representative Jenkinsfiles do not need to deploy real systems. They need to compile the library API that service teams call and run the safe stages that prove the contract still works.

```groovy
@Library('company-pipeline@feature/image-repository-compat') _

standardMavenService(
    serviceName: 'service-smoke',
    imageName: 'registry.example.com/company/service-smoke',
    dryRun: true
)
```

Before a library tag moves to production, the platform team runs smoke jobs for old and new option names. The old shape proves compatibility, and the new shape proves the migration path. If either smoke job fails, the library release waits.

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

## How Does the Complete Shared-Library Lifecycle Fit Together?
<!-- section-summary: A healthy shared-library setup keeps Jenkinsfiles thin, library APIs stable, and production consumers pinned to reviewed releases. -->

The platform team ends with a clean pattern. Application repositories keep small Jenkinsfiles that load `company-pipeline` and pass service-specific values. The shared library owns reusable steps, helper classes, and templates. `vars/` exposes global steps, `src/` holds reusable classes, and `resources/` holds small files loaded at runtime.

The team also treats the shared library like a product. Changes land through review, test Jenkinsfiles run before merge, release tags get notes, and production services consume tags instead of a moving branch. Sandbox jobs can still follow `main`, because fast feedback belongs in low-risk places.

This is the natural next step after good Jenkinsfiles. Pipeline as Code gives each repository a reviewed delivery contract. Shared Libraries keep that contract small while giving the platform team one maintained implementation for the repeated parts.

![Safe shared library rollout showing library change, pin Git ref, test one service, stage rollout, watch failures, rollback tag, and many pipelines protected](/content-assets/articles/article-cicd-jenkins-shared-libraries/safe-shared-library-rollout.png)

*A safe library rollout treats the shared pipeline code like a product: version it, test it with representative services, expand slowly, and keep a rollback tag ready.*

## Check Your Answers

:::expand[Why Do Jenkins Shared Libraries Exist?]{kind="recap"}
Shared Libraries turn repeated Pipeline code into a versioned internal API. Application Jenkinsfiles retain service-specific intent, while one library owns common build, scan, publish, notification, and deployment mechanisms. Central reuse reduces drift but creates a wider change blast radius.
:::

:::expand[How Does Jenkins Configure and Load a Library?]{kind="recap"}
Jenkins maps a library name to source control and a default ref. `@Library` loads before Jenkinsfile compilation and supports ordinary class imports; `_` is an annotation target. The dynamic `library` step loads during execution and serves more advanced runtime selection.
:::

:::expand[How Does vars Become the Pipeline-Facing API?]{kind="recap"}
Each `vars/name.groovy` file exposes a global variable named `name`; a `call` method makes it callable like a step. Keep this public interface focused and mostly stateless, accept explicit inputs, invoke Jenkins steps, return useful results, and document it beside the file.
:::

:::expand[Why Are src and resources Separate from vars?]{kind="recap"}
`src/` holds packaged helper classes, while `resources/` holds templates and data loaded with `libraryResource`. `src` classes do not automatically own Pipeline steps. Small serializable or stateless helpers survive Jenkins' resumable execution model more safely.
:::

:::expand[How Should a Library Be Versioned?]{kind="recap"}
A branch moves automatically, a release tag gives a human-readable stable contract, and a commit SHA identifies exact code. Use moving refs for low-risk development, pin production consumers, publish compatibility notes, and upgrade through reviewed pull requests.
:::

:::expand[Why Can One Library Change Break Many Pipelines?]{kind="recap"}
Every Jenkinsfile calling a library function is an API consumer. A renamed option or changed stage can break all moving-ref consumers at once. Protect releases with reviews, compatibility tests, gradual rollout, backward-compatible transitions, and tightly controlled trusted-library repositories.
:::

:::expand[How Does the Complete Shared-Library Lifecycle Fit Together?]{kind="recap"}
Jenkins retrieves a selected ref, loads `vars`, compiles `src`, makes `resources` available, compiles the Jenkinsfile, and runs its calls through Pipeline execution. Teams test and release the library like a product, then consumers adopt that release intentionally.
:::

## References

- [Jenkins: Extending with Shared Libraries](https://www.jenkins.io/doc/book/pipeline/shared-libraries/) - Documents shared library configuration, directory structure, `vars`, `src`, `resources`, trusted libraries, library versions, and `@Library`.
- [Jenkins: Pipeline Syntax](https://www.jenkins.io/doc/book/pipeline/syntax/) - Provides the Pipeline syntax reference used by shared-library steps.
- [Jenkins: Pipeline Development Tools](https://www.jenkins.io/doc/book/pipeline/development/) - Covers tooling for Pipeline and shared-library development, including testing support and replay notes.
- [Jenkins: In-process Script Approval](https://www.jenkins.io/doc/book/managing/script-approval/) - Explains the Groovy sandbox and script approval model that affects untrusted pipeline code.
