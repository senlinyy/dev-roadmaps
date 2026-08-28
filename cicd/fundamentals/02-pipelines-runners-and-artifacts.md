---
title: "Pipelines, Runners, and Artifacts"
description: "Understand how pipeline graphs define work, runners execute jobs, and artifacts carry tested outputs between isolated environments."
overview: "A CI/CD platform must decide what work happens, provide compute to perform it, and move useful results between separate jobs. This article connects pipelines, controllers, runners, workspaces, containers, artifacts, caches, provenance, and release evidence as parts of one distributed delivery system."
tags: ["pipelines", "runners", "artifacts", "caching", "ci-cd"]
order: 2
id: article-cicd-fundamentals-pipelines-runners-and-artifacts
aliases:
  - pipelines-and-runners
  - artifacts-and-caching
  - article-cicd-fundamentals-pipelines-and-runners
  - article-cicd-fundamentals-artifacts-and-caching
  - cicd/fundamentals/pipelines-and-runners.md
  - cicd/fundamentals/artifacts-and-caching.md
---

## Table of Contents

1. [Which Three Problems Does a CI/CD Platform Solve?](#which-three-problems-does-a-cicd-platform-solve)
2. [How Do Pipelines, Stages, Jobs, and Steps Describe the Work?](#how-do-pipelines-stages-jobs-and-steps-describe-the-work)
3. [How Do Controllers and Runners Divide Responsibility?](#how-do-controllers-and-runners-divide-responsibility)
4. [How Is a Job's Execution Environment Constructed?](#how-is-a-jobs-execution-environment-constructed)
5. [Why Do Artifacts Carry Outputs Between Jobs?](#why-do-artifacts-carry-outputs-between-jobs)
6. [How Do Caches Differ from Artifacts?](#how-do-caches-differ-from-artifacts)
7. [How Do Dependencies, Parallelism, and Evidence Shape the Pipeline Graph?](#how-do-dependencies-parallelism-and-evidence-shape-the-pipeline-graph)
8. [How Does the Complete Delivery Architecture Fit Together?](#how-does-the-complete-delivery-architecture-fit-together)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Turning source code into releasable software creates three separate problems. The team must define which work happens and in which order. Some machine must perform that work. Useful results must survive long enough to reach a later piece of work.

Those requirements lead to three foundational objects:

```text
Pipeline → describes the work and its dependencies
Runner   → provides the environment that executes a job
Artifact → retains an intentional output outside that job
```

Consider the manual path for a small application. A developer installs dependencies, lints the source, runs tests, compiles the program, packages it, and deploys it:

```bash
npm ci
npm run lint
npm test
npm run build
./deploy.sh
```

The commands themselves can be correct while the human process remains unreliable. Someone can skip lint, use another Node version, deploy before tests finish, or build from the wrong commit. The first requirement is therefore to express delivery as an executable procedure tied to one source revision.

Keep these questions in view as you work through the lesson:

1. **Which Three Problems Does a CI/CD Platform Solve?**
2. **How Do Pipelines, Stages, Jobs, and Steps Describe the Work?**
3. **How Do Controllers and Runners Divide Responsibility?**
4. **How Is a Job's Execution Environment Constructed?**
5. **Why Do Artifacts Carry Outputs Between Jobs?**
6. **How Do Caches Differ from Artifacts?**
7. **How Do Dependencies, Parallelism, and Evidence Shape the Pipeline Graph?**
8. **How Does the Complete Delivery Architecture Fit Together?**

## Which Three Problems Does a CI/CD Platform Solve?
<!-- section-summary: Pipelines define work, runners supply execution, and artifacts retain the outputs that later work needs. -->

The ordered, repeatable procedure is a **pipeline**. It answers, “How does this exact source revision become verified software?” The initial picture often looks linear:

```text
source → verify → build → package → deploy
```

Real delivery work is usually a graph. Lint, unit tests, and type checking can begin from the same source without depending on one another. Packaging should wait until all required verification succeeds. Deployment needs the package produced by the build. A pipeline is therefore a set of tasks, dependencies between those tasks, and rules that decide when each task may run.

The pipeline definition still cannot execute `npm test` by itself. A controller must assign the work to compute, and a runner must prepare a filesystem and process environment. When one job finishes, that temporary runner may disappear. If a later deployment needs `app.tar.gz`, the build job must place the file in durable storage and the deployment job must retrieve it. That retained output is an artifact.

This separation prevents a common conceptual mistake. The pipeline is not the web page displaying green and red boxes, and it is not one long-lived build server. The definition describes transformations and conditions. A particular run applies that definition to a trigger and a source revision. Runners provide replaceable execution capacity for the nodes in the graph, while durable systems preserve the results that must outlive those nodes.

The source revision anchors the process. Pipeline `#1842` should identify commit `7fa92ac`, rather than quietly checking out whichever commit happens to be newest when a runner becomes free. Installation should use the declared lock file and runtime. The build should name its output. Deployment should consume that named output. These explicit identities turn “run the usual release commands” into a repeatable claim that another person can inspect later.

The complete path crosses several systems:

```text
developer push
      ↓
source repository
      ↓
CI/CD controller
      ↓ schedules jobs
runners execute verification and build
      ↓ upload outputs
artifact store
      ↓ supplies exact package
staging and production jobs
```

Everything else in this lesson—stages, steps, workspaces, containers, services, caches, matrices, permissions, and provenance—supports one of those three problems.

## How Do Pipelines, Stages, Jobs, and Steps Describe the Work?
<!-- section-summary: A pipeline run contains schedulable jobs, jobs contain ordered steps, and stages optionally group jobs into delivery phases. -->

CI/CD products use some terms differently, so begin with the conceptual hierarchy rather than one vendor's syntax:

```text
Pipeline
└── optional stages
    └── jobs
        └── steps
```

A **pipeline run** is one execution of a workflow definition for one trigger and source revision. Pipeline `#1842`, for example, can record commit `7fa92ac`, the workflow configuration used, and the results of lint, tests, build, packaging, and deployment. Another push creates a separate run with its own identity and evidence.

A **job** is a schedulable unit of work. Lint, Linux tests, Windows tests, a build, or a production deployment can each be a job. Separating work into jobs creates isolation and lets the controller make decisions that one long script cannot express cleanly. Jobs can run in parallel, use different operating systems or hardware, receive different credentials, run in different container images, and retry independently.

A **step** is an individual action within a job. A test job might check out the repository, install a runtime, restore dependencies, run tests, and upload a report. Steps normally execute in order inside the same job environment, so a file made by an earlier step is available to a later step:

```text
test job workspace
  checkout
     ↓
  install
     ↓
  test
     ↓
  upload report
```

Jobs do not have that implicit filesystem relationship. Treat two jobs as if they run on unrelated machines, even when a platform sometimes reuses underlying infrastructure. Ordering one job after another does not copy the first job's files.

A **stage** is an optional logical phase that groups related jobs. One platform might define `Verify`, `Build`, and `Release` stages, with lint, unit tests, and type checking inside `Verify`. Jobs in a stage can run concurrently, while a later stage waits for the required earlier phase. Other products express the same dependency directly between jobs without using the word stage.

The distinctions are:

| Object | Plain meaning | Example |
|---|---|---|
| Pipeline | The whole run and dependency graph | Verify, build, test the package, and deploy commit `7fa92ac` |
| Stage | A named phase containing related work | `Verify` |
| Job | One schedulable execution unit | `unit-tests-linux` |
| Step | One ordered action inside a job | `npm test` |

A concrete tree makes the boundaries visible:

```text
PIPELINE #1842
├── STAGE: Verify
│   ├── JOB: Lint
│   │   ├── checkout 7fa92ac
│   │   ├── install dependencies
│   │   └── run lint
│   └── JOB: Tests
│       ├── checkout 7fa92ac
│       ├── install dependencies
│       └── run tests
├── STAGE: Build
│   └── JOB: Package
│       ├── compile
│       └── create app.tar.gz
└── STAGE: Release
    └── JOB: Deploy
        └── deploy app.tar.gz
```

The lint and test jobs each check out the source because they may land on separate runners. Their steps share only the workspace inside their own job. The package job can start once the controller sees the required verification results. The deploy job has both a control dependency on the package result and a data dependency on `app.tar.gz`.

Jobs also let one logical pipeline use several environments. A cross-platform library can run Linux, Windows, and macOS tests as separate jobs. A compiler job can request more memory than lint. A signing job can use a tightly protected runner and credential unavailable to all validation jobs. Splitting work is therefore about scheduling, isolation, permissions, and data flow as much as readability.

This structure makes both sequential and parallel work explicit. Lint, unit tests, and type checking can fan out. Packaging can wait for all three. Deployment can wait for packaging and for separate approval or evidence conditions.

![Pipeline job graph showing a pull request fan out to lint and test jobs, then a package job waiting for both](/content-assets/articles/article-cicd-fundamentals-pipelines-runners-and-artifacts/pipeline-job-graph.png)

*Independent jobs can occupy parallel branches, while a dependent package job waits for every required verification result.*

A useful way to describe any job is with four questions:

1. Which inputs does it require?
2. Which computation does it perform?
3. Which outputs does it intentionally produce?
4. Which later consumers may use those outputs?

For example, a build job receives a source commit, lock file, and compiler image; compiles the application; emits `app.tar.gz`; and permits integration-test, staging, and production jobs to consume it. This input-computation-output view is stronger than treating the pipeline as a page of disconnected shell commands.

## How Do Controllers and Runners Divide Responsibility?
<!-- section-summary: The controller owns orchestration and job state, while runners own CPU, filesystem, processes, and network execution. -->

The **controller** is the orchestration side of a CI/CD platform. After a repository event, it reads the workflow, resolves dependencies, creates jobs, decides which jobs are ready, selects compatible runners, records logs and statuses, handles approvals, and determines whether downstream work may begin.

The **runner** is the execution side. It receives a job description, prepares an environment, obtains the specified source revision and inputs, invokes actions or shell commands, collects results, and reports an exit status to the controller.

```text
controller: “Job test is ready on Linux.”
                 ↓ assigns
runner: prepares workspace and runs commands
                 ↓ reports
controller: records success or failure and updates the graph
```

This separation allows horizontal scale. Ten ready jobs can run on ten machines while one controller keeps their dependency state coherent. It also creates a security boundary: source-controlled scripts execute on runners rather than inside the service that owns users, repository metadata, approvals, and the global job queue.

A **hosted runner** is capacity managed by the CI provider. The provider supplies and maintains compatible machines, runner software, base images, cleanup, and ordinary scaling. Hosted runners are convenient for common operating systems and toolchains, and ephemeral hosted execution gives each job a clean starting point with little infrastructure work for the team.

A **self-hosted runner** is a machine the team controls: a cloud VM, physical server, Kubernetes pod, workstation, or data-center host with runner software attached to the controller. It becomes useful for private network access, licensed software, a custom compiler, large persistent build capacity, GPUs, or other hardware that a general hosted runner cannot provide.

Control creates responsibility. The self-hosting team owns operating-system patches, tool versions, capacity, availability, disk cleanup, network exposure, runner registration, credentials, and isolation between jobs. A machine with access to production systems or an internal network represents a powerful trust boundary, especially when a pull request can modify the scripts it executes.

Runner selection is therefore a permission decision as well as a performance decision. Ordinary validation can use low-trust ephemeral runners. A production deployment job can use a separately controlled runner pool with the necessary network path and credentials. Labels, groups, branch rules, and environment gates can restrict which work reaches that high-trust pool.

Hosted capacity trades control for convenience. The provider can create a compatible machine on demand, record its logs, then destroy or recycle it. The team avoids maintaining the operating system and runner service, but must work within the supplied machine types, images, networking options, and available hardware. For general builds and tests, that boundary is often desirable.

Self-hosting trades convenience for control. A GPU test, private database migration, licensed compiler, large monorepo build, or internal package mirror may justify it. The runner now behaves like production infrastructure: it needs an owner, upgrade and patch policy, capacity monitoring, recovery plan, and an explicit list of repositories, branches, and job types allowed to use it.

Clean execution improves both reproducibility and security. If Job A leaves a private key, source tree, process, or build output on a persistent machine, Job B may encounter or deliberately read it. An ephemeral runner can create a fresh environment for the job and discard it afterward. A self-hosted fleet needs equivalent cleanup or disposable workers.

Persistent runners introduce operational failure modes. Docker layers and test output can fill disks. A failed test can leave a server listening on port `3000`. A previous job's environment or credential file can affect a later build. Cleanup traps, scheduled pruning, disk monitoring, process isolation, and one-job disposable VMs or pods are ways to keep hidden state from becoming an input.

For a background process, cleanup belongs to the job lifecycle rather than the happy path alone:

```bash
npm run start &
APP_PID=$!

cleanup() {
  kill "$APP_PID"
}

trap cleanup EXIT
npm run test:e2e
```

The `trap` runs when the script exits, including many failure exits, so the next job is less likely to inherit the server. Disposable workers go further by destroying the entire machine or pod, which removes files, processes, and containers together.

## How Is a Job's Execution Environment Constructed?
<!-- section-summary: A runner provides a temporary workspace, then shell, container, and service-container choices supply the process environment a job needs. -->

When a runner begins a job, it prepares a **workspace**: the temporary filesystem area where source files, installed dependencies, generated intermediates, and job outputs exist. A checkout operation puts the selected repository revision there. Later steps run from that directory unless the workflow selects another path.

The workspace might contain:

```text
workspace/
├── src/
├── tests/
├── package.json
├── package-lock.json
├── node_modules/
└── dist/
```

One step can build `dist/app.js`, and a later step in the same job can package it. A later job cannot assume the path exists because it receives its own workspace, possibly on another machine several minutes later.

Simple diagnostics make this boundary observable:

```bash
pwd
ls -la
node --version
npm --version
```

These commands show the current directory, repository files, and runtime selected by the runner. If checkout was omitted, the workspace will not contain the application source. If a later job cannot find `dist/app.js`, listing its fresh workspace demonstrates that job ordering did not copy the earlier filesystem.

The job's processes can run through three common execution models. A **shell job** invokes commands directly in the runner operating system. The job depends on tools already installed or installed by earlier steps. This is the simplest model:

```text
runner operating system
└── shell
    └── npm test
```

A **container job** runs the steps inside a selected container image. The runner remains outside the container to coordinate execution, while the mounted workspace and process use the image's userspace, runtime, libraries, and tools. Pinning a container image can make the CI environment more consistent with development or production.

```text
runner host
└── Node 24 container
    ├── mounted repository workspace
    └── test process
```

A **service container** runs supporting software beside the main job. Integration tests may need PostgreSQL, Redis, Kafka, or Elasticsearch. Starting a temporary service gives this job a private dependency and isolated test data without installing the server permanently on the runner.

```text
runner
├── application tests
│      └── connect to postgres:5432
└── PostgreSQL service container
```

The service should have a readiness or health check so tests wait for an observable ready condition instead of guessing a sleep duration. When the job ends, both the job environment and temporary database can be removed.

Service isolation also prevents concurrent pipelines from sharing mutable test data. Two pull requests using one staging database can overwrite rows or consume one another's queued messages. Separate PostgreSQL or Redis containers give each job a bounded instance whose schema and data can be created from scratch. This makes a failure more likely to belong to the proposed change than to another pipeline running at the same time.

Containers improve consistency only for the inputs they actually pin. A floating image tag, unrecorded environment variable, or dependency fetched without a lock can still change a job. The execution model should name the image, source revision, runtime, and configuration that materially determine the result.

![Runner execution boundary showing workspace, host shell, container job, service container, and cleanup](/content-assets/articles/article-cicd-fundamentals-pipelines-runners-and-artifacts/runner-execution-boundary.png)

*The workspace belongs to one job; shell and container execution use it, service containers support it, and cleanup removes temporary state afterward.*

These models solve environment construction, not cross-job transfer. The workspace is deliberately disposable. The pipeline should identify which outputs deserve to survive and move only those through explicit storage.

## Why Do Artifacts Carry Outputs Between Jobs?
<!-- section-summary: An artifact is an intentional durable job output that lets later work test and deploy the exact same object. -->

Suppose a build job creates `app.tar.gz`. A deployment job starts later on another runner. Re-running the build during deployment would create a second object:

```text
CI build from source → package A → tests pass
deployment rebuild   → package B → production
```

Even with the same commit, compiler versions, dependency resolution, build flags, generated files, operating-system differences, timestamps, or environment variables can make A and B differ. The stronger path builds once, tests the resulting object, and promotes that same object:

```text
commit 7fa92ac
      ↓
build once
      ↓
app.tar.gz
      ├── integration test
      ├── staging
      └── production
```

An **artifact** is a meaningful output that a job explicitly retains outside its temporary workspace. Compiled binaries, container images, `.jar` files, mobile packages, static site bundles, test reports, coverage reports, browser screenshots, SBOMs, scan reports, and generated documentation can all be artifacts.

The artifact path is explicit:

```text
build workspace
     ↓ upload
artifact store
     ↓ download
later job workspace
```

Artifacts answer a different question from status and logs. Status tells whether the job succeeded. Logs describe what happened while commands ran. Artifacts identify what the run produced and retain evidence that remains useful after the runner disappears.

```text
Build job
  status:   success
  logs:     “compiled 483 files”
  artifact: app.tar.gz
```

Each item supports a different investigation. A success status lets the graph progress. Logs explain commands and failures. The artifact supplies the bytes that a tester, deployer, or reviewer needs. Treating logs as a package store or treating a package filename as sufficient provenance blurs those roles.

The principle **build once, promote many** improves traceability. “Production runs artifact digest `sha256:abc...`, built by pipeline `#1843` from commit `7fa92ac`” is stronger than “production runs something built from commit `7fa92ac`.” Source identity alone omits the environment and transformation that created the deployable bytes.

Released artifacts should ideally be immutable. If `app-v1.8.3.tar.gz` can later be overwritten with different bytes, the statement that version `1.8.3` passed testing loses meaning. A cryptographic digest strengthens identity because even a one-byte change produces a different fingerprint.

This source-to-object relationship is **provenance**:

```text
running production object
          ↓ identify
artifact digest
          ↓ created by
pipeline run
          ↓ used
source commit and repository
```

Artifacts can also carry evidence instead of deployable software. A test runner can upload `junit-results.xml`, coverage HTML, and failure screenshots. A security job can retain an SBOM and scan result. A release gate can require the deployable artifact plus the evidence accumulated for it.

Retention should match the purpose. A pull-request screenshot may need only enough time for diagnosis. A released binary, signature, SBOM, or regulated test record may need a much longer lifecycle. Clear artifact names, run identities, checksums, and retention policies let humans locate the right evidence without preserving every temporary workspace forever.

Artifact immutability also separates promotion from rebuilding. Staging and production can attach environment-specific configuration at runtime while receiving the same application package. If environment settings must be compiled into the bytes, the team has created separate artifacts and should identify and test them separately rather than claiming one object moved unchanged.

The workspace should remain disposable while artifacts remain intentional. Compiler intermediates, downloads, local test databases, and temporary logs can vanish with the runner. Retain only outputs that a later job or person has a defined reason to consume.

## How Do Caches Differ from Artifacts?
<!-- section-summary: Artifacts preserve meaningful outputs, while caches are disposable optimizations that make repeatable computation faster. -->

Artifacts and caches both save files outside a workspace, but they serve different purposes. An artifact exists because the output or evidence matters. A **cache** exists because downloading or recomputing reusable input is expensive.

| Question | Artifact | Cache |
|---|---|---|
| Why retain it? | It is a meaningful result from this run. | Reusing it can make later work faster. |
| Does correctness depend on this exact stored object? | Often yes. | Ideally no. |
| Is it associated with one run or release? | Usually. | Often shared across compatible runs. |
| What happens if it disappears? | Evidence or a release object may be lost. | The job should still succeed more slowly. |
| Example | `app.tar.gz`, `test-results.xml` | downloaded npm archives, compiler cache |

The “delete it” test makes the distinction concrete. Delete `~/.npm` and the next job downloads packages again but still produces the correct build. Delete the only retained `app-v1.8.3.tar.gz` and the release object no longer exists.

A cache must decide whether stored data is compatible with the current inputs. A dependency cache key can combine operating system, runtime version, and the hash of `package-lock.json`:

```text
linux-node24-8ab739...
```

When the lock file changes, its hash changes, which prevents the pipeline from blindly treating the previous dependency set as exact. The general rule is that cache identity should include the inputs that determine the cached computation.

Consider an npm job. On a cold run, the package manager downloads archives and stores reusable package data. On a later compatible run, it restores that data and avoids some downloads. The job still runs `npm ci`, which uses the lock file to reconstruct `node_modules`. The cache accelerates acquisition; the package manager and lock file still determine the installed dependency tree.

A broad fallback key can find a nearby cache when an exact key is absent. That can improve speed after a small lock-file change, but it makes the normal installation step even more important. Restored cache contents are candidates for reuse, not proof that the workspace already matches the current inputs.

Caches deliberately add state to a job, so they must not become hidden correctness dependencies. A healthy pipeline behaves like this:

```text
empty cache → correct output, slower
warm cache  → same correct output, faster
```

If a build succeeds only because an undeclared compiler or generated file happens to be cached, the cache has become a mysterious required input. The fix is to declare and create that input through the normal pipeline.

The cold-cache test should be part of pipeline reasoning even if it is not run on every commit. Ask whether a completely empty cache can still reach the correct result from declared source and dependencies. If the answer is no, the system has confused optimization state with required delivery state.

![Pipeline storage summary comparing artifacts as run outputs with caches as reusable inputs across separate job workspaces](/content-assets/articles/article-cicd-fundamentals-pipelines-runners-and-artifacts/pipeline-storage-summary.png)

*Artifacts cross job boundaries because their outputs matter; caches may cross runs because they accelerate work that remains reproducible without them.*

The distinction also guides storage scope. Build and deploy jobs transfer a named package artifact. Test and security jobs transfer named reports. Dependency downloads use a keyed cache. Jobs never rely on another runner's unannounced filesystem leftovers.

## How Do Dependencies, Parallelism, and Evidence Shape the Pipeline Graph?
<!-- section-summary: A pipeline has control and data dependencies, and its graph determines which work may run concurrently and which evidence gates promotion. -->

A pipeline carries two overlapping graphs. The **control graph** describes ordering: job B may start only after job A succeeds. The **data graph** describes values: job A produces a package that job B consumes.

```text
control: build succeeds ─────────────→ integration test may start
data:    build emits app.tar.gz ─────→ integration test downloads it
```

Adding `needs: build` or an equivalent dependency controls readiness. It does not transfer `app.tar.gz`. Upload and download operations, a registry, or another explicit store create the data path.

Dependency gates encode organizational rules. In a `Build → Test → Deploy` graph, a failed test leaves deployment unready because the required evidence was never established:

```text
deploy allowed = build passed ∧ test passed
```

Independent jobs can run in parallel. Four unrelated five-minute checks can occupy four runners and finish in about five minutes of wall-clock time instead of twenty. Parallelism is safe only when the graph accurately describes prerequisites. A deployment cannot begin beside the build unless it already has the exact artifact it needs.

A **matrix job** expands one logical definition over several values. A library supporting Node 20, 22, and 24 can define one test shape and let the controller create three physical jobs. This separates the logical computation from the runner instances that execute each combination.

```text
logical test definition
      ├── Node 20 → runner A
      ├── Node 22 → runner B
      └── Node 24 → runner C
```

The matrix is parallel only where capacity exists and the combinations are independent. If all combinations must pass, the downstream build waits for the expanded set. If one platform is allowed to fail experimentally, that exception belongs in the graph policy rather than in a reviewer remembering to ignore one red box.

The graph also accumulates evidence. It begins with a commit. Static checks add evidence about source. Tests add behavioral evidence. The build produces an identified artifact. Security jobs can add an SBOM, scan report, or signature result. Deployment records that the known artifact reached environment X.

```text
commit
  ↓ static and test evidence
verified build inputs
  ↓ build
identified artifact + provenance
  ↓ package tests and scans
promotion evidence
  ↓ deploy
known artifact running in a named environment
```

This is **progressive evidence**: each successful node establishes a condition that downstream work can rely on. Failure prevents the graph from silently assuming an unproved condition.

Credentials should follow the same dependency boundaries. A test job usually needs repository content and perhaps a temporary service credential. It does not need a production deployment token. The controller should make production credentials available only to the specific protected deployment job. Separate jobs create natural least-privilege boundaries.

Evidence can travel beside the software. The build may emit both `app.tar.gz` and `sbom.json`. Test jobs can add `test.xml`; a scan can add `scan.json`; signing can associate a signature with the artifact digest. The release condition can then require the identified package plus the required evidence rather than trusting one undifferentiated “pipeline passed” label.

Retries need the same discipline. Retrying a failed test job should consume the same declared artifact and test inputs. Re-running a build without changing its run identity can create ambiguity about which package later evidence refers to. Explicit output identities keep retries from silently replacing the object under review.

Self-hosted runners make that rule urgent. A runner with persistent storage, internal network access, cloud identity, or signing keys has a larger blast radius than an ephemeral validation runner. Decide which principals can cause a job to run, which code that job executes, and which secrets or network paths its runner can reach.

## How Does the Complete Delivery Architecture Fit Together?
<!-- section-summary: A mature CI/CD system has a control plane, execution plane, and artifact data plane joined by explicit inputs, outputs, dependencies, and permissions. -->

Follow commit `7fa92ac` through a complete pipeline. The controller creates parallel lint, unit-test, and type-check jobs. Separate runners check out the same commit and return their results. When every required verification job passes, a build runner installs locked dependencies, compiles the application, and creates `app.tar.gz`.

The build workspace is temporary, so the job uploads the package. A different integration-test runner downloads that artifact, starts the application and a PostgreSQL service container, then runs API tests. It uploads `integration-results.xml` as evidence. A staging deployment downloads the same package, deploys it, and runs smoke checks. Production later receives that same `app.tar.gz`; no stage rebuilds it.

```text
commit 7fa92ac
      │
      ├── lint ───────┐
      ├── unit test ──┼──→ build → app.tar.gz → artifact store
      └── type check ─┘                         │
                                                ↓
                                  integration test + PostgreSQL
                                                ↓
                                  staging smoke verification
                                                ↓
                                           production
```

At a systems level, the architecture contains three planes. The **control plane** owns events, definitions, dependencies, scheduling, permissions, approvals, and job state. The **execution plane** owns CPU, memory, filesystems, containers, shell commands, network connections, and build processes. The **artifact or data plane** stores durable outputs between computations.

```text
controller
  │ schedules and receives status
  ▼
runners
  │ upload and download explicit outputs
  ▼
artifact store
```

A non-trivial pipeline is therefore a distributed program. It coordinates multiple machines, remote data, retries, failures, credentials, and partial ordering. Hidden state makes that distributed program fragile. Explicit source revisions, dependency graphs, job inputs, output artifacts, cache keys, permissions, and tool versions make it understandable.

The complete flow also explains a missing-file failure. If deployment reports `app.tar.gz: No such file or directory`, inspect the current workspace. Confirm that the build uploaded a named artifact, the deployment has a control dependency on the correct build, and the deployment downloads that artifact before invoking its script. `needs: build` establishes order; only the data-transfer step establishes the file.

You can model each job as a function:

```text
Build(source commit, lock file, compiler image)
  → application artifact

Test(application artifact, test suite, service environment)
  → test evidence
```

The ideal is deterministic: the same declared inputs and computation produce the same outputs. Clean runners, locked dependencies, pinned toolchains, containers, immutable artifacts, and explicit transfer all move the system toward that ideal. A cache may change execution time, but should not change the output.

Thinking of jobs as functions makes reviews more precise. Instead of asking only whether the shell commands look familiar, ask whether every input is named, every important output is retained, every consumer is authorized, and hidden machine state can influence the result. The pipeline then becomes a composition of transformations rather than a remote script with accidental side effects.

Apply that review to the build node. Its inputs should name commit `7fa92ac`, the dependency lock, the compiler or build image, and any flags that affect the bytes. Its computation compiles and packages. Its output is an immutable object with a recorded digest. Its consumers are the integration test and protected deployment jobs. A dependency cache can assist the computation, but deleting it must not change the package that those declared inputs produce.

Apply the same review to testing. The package artifact and test suite are inputs. A temporary PostgreSQL service is part of the declared environment. The computation starts the package and exercises the API. The outputs include a pass or fail status, logs, and `integration-results.xml`. The result authorizes staging only when the control graph requires it, and the evidence remains associated with the artifact that was actually tested.

Finally, apply it to deployment. The input is the previously identified package rather than a source checkout that rebuilds. The runner and credential are selected for the destination environment. The computation places that object into staging or production and records the deployed digest. The output is both a running system and evidence connecting environment X to artifact Y. These job contracts make the release path inspectable from either direction: source to production during delivery, or production back to source during an incident.

A practical pipeline review can therefore ask five plain questions at every edge:

1. Which result allows the downstream node to start?
2. Which exact data crosses the boundary?
3. Where is that data stored while neither runner exists?
4. Which identity may produce and consume it?
5. Can a clean rerun reconstruct the same result from declared inputs?

Those questions expose missing artifacts, accidental workspace sharing, unsafe runner trust, cache-dependent builds, and rebuild-on-deploy patterns before they become release failures.

The design should remain understandable after a runner has vanished. A reviewer looking only at the controller record and durable stores should be able to identify the source revision, each required result, the package digest, the evidence created for that package, and the environment that received it. If the explanation depends on opening an old runner filesystem or asking which machine happened to execute the build, important state was never made explicit. Disposable execution and durable named outputs are complementary: the first removes accidental state, while the second preserves exactly the state the delivery chain intends to trust.

The central model is now complete. A pipeline defines a dependency graph for transforming source into increasingly trustworthy software. Runners perform each transformation inside temporary environments. Artifacts carry meaningful results across the gaps between those environments. Caches accelerate reproducible work. The controller coordinates the graph, and permissions constrain who may execute or consume each part.

## Check Your Answers

:::expand[Which Three Problems Does a CI/CD Platform Solve?]{kind="recap"}
The pipeline defines what work and dependencies exist, runners provide compute to perform jobs, and artifacts retain useful outputs for later work.
:::

:::expand[How Do Pipelines, Stages, Jobs, and Steps Describe the Work?]{kind="recap"}
A pipeline run is the full graph, stages optionally group phases, jobs are schedulable units, and steps are ordered actions sharing one job environment.
:::

:::expand[How Do Controllers and Runners Divide Responsibility?]{kind="recap"}
The controller owns orchestration, readiness, state, and approvals. Runners own the filesystem, processes, tools, and network activity that execute a job.
:::

:::expand[How Is a Job's Execution Environment Constructed?]{kind="recap"}
The runner prepares a temporary workspace, then commands run on the host shell or in a container, with optional service containers supplying temporary dependencies.
:::

:::expand[Why Do Artifacts Carry Outputs Between Jobs?]{kind="recap"}
Jobs have isolated workspaces. Artifacts retain intentional outputs so later jobs can test and promote the exact built object with traceable provenance.
:::

:::expand[How Do Caches Differ from Artifacts?]{kind="recap"}
Artifacts preserve meaningful outputs or evidence. Caches are disposable performance optimizations whose absence may slow the job but should not change correctness.
:::

:::expand[How Do Dependencies, Parallelism, and Evidence Shape the Pipeline Graph?]{kind="recap"}
Control dependencies govern readiness, data dependencies move explicit outputs, independent jobs may run concurrently, and successful nodes accumulate evidence that gates promotion.
:::

:::expand[How Does the Complete Delivery Architecture Fit Together?]{kind="recap"}
The control plane schedules work, runners execute it, and the artifact plane stores durable results. Explicit inputs, outputs, versions, dependencies, and permissions make the distributed program reproducible.
:::

## References

- [Workflow syntax for GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) - Documents jobs, dependencies, containers, service containers, and steps.
- [GitHub-hosted runners](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners) - Explains provider-managed runner machines and images.
- [Adding self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners) - Documents self-hosted setup and trust warnings.
- [Running jobs in a container](https://docs.github.com/en/actions/using-jobs/running-jobs-in-a-container) - Describes container-based job execution.
- [Communicating with Docker service containers](https://docs.github.com/en/actions/tutorials/communicating-with-docker-service-containers) - Explains temporary supporting services for jobs.
- [Store and share data with workflow artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data) - Documents artifact upload, download, retention, and cross-job transfer.
- [Dependency caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching) - Describes cache keys, restore behavior, hits, and misses.
- [GitLab Runner](https://docs.gitlab.com/runner/) - Defines the execution agent that runs GitLab CI/CD jobs.
- [Caching in GitLab CI/CD](https://docs.gitlab.com/ci/caching/) - Distinguishes dependency caches from build artifacts.
- [Recording tests and artifacts in Jenkins](https://www.jenkins.io/doc/pipeline/tour/tests-and-artifacts/) - Shows test result recording and artifact archival in Jenkins Pipeline.
