---
title: "What Is a Release in AWS"
description: "Understand an AWS release as a controlled transition across exact artifacts, runtime targets, configuration, identity, traffic, health evidence, and rollback."
overview: "Separate build, deployment, rollout, and release, then follow an immutable container through ECS candidate capacity, health gates, canary traffic, bake time, acceptance, and rollback."
tags: ["aws", "deployment", "release", "runtime", "rollback"]
order: 1
id: article-cloud-providers-aws-deployment-runtime-operations-runtime-operations-mental-model
aliases:
  - what-is-a-release-in-aws
  - what-is-a-release
  - article-cloud-providers-aws-deployment-runtime-operations-what-is-a-release
  - runtime-operations-mental-model
  - cloud-providers/aws/deployment-runtime-operations/runtime-operations-mental-model.md
  - cloud-providers/aws/deployment-runtime-operations/01-runtime-operations-mental-model.md
---

## Table of Contents

1. [How Is a Release Different from a Deployment?](#how-is-a-release-different-from-a-deployment)
2. [Why Must a Release Use an Exact Artifact?](#why-must-a-release-use-an-exact-artifact)
3. [Why Are Configuration and Identity Part of a Release?](#why-are-configuration-and-identity-part-of-a-release)
4. [How Does Traffic Turn a Deployment into User Experience?](#how-does-traffic-turn-a-deployment-into-user-experience)
5. [Which Health Evidence Should Control a Rollout?](#which-health-evidence-should-control-a-rollout)
6. [Why Must Rollback Be Designed Before Release?](#why-must-rollback-be-designed-before-release)
7. [How Does a Complete ECS Release Run?](#how-does-a-complete-ecs-release-run)
8. [What Is the First-Principles Release Model?](#what-is-the-first-principles-release-model)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A release is a controlled change to what users experience in a running production system. A deployment puts a change into the runtime environment. A release makes the intended production behavior depend on that change, observes whether the new state is acceptable, and retains a known way back.

AWS has no single universal resource named "release." ECR stores artifacts, ECS runs tasks, CodeDeploy shifts traffic, AppConfig deploys configuration and feature flags, CloudWatch supplies evidence, and IAM gives workloads security identities. Release engineering connects those service-specific pieces into one production-state transition.

Suppose version 1 of an orders API returns:

```json
{
  "id": 123,
  "status": "SHIPPED"
}
```

Version 2 adds a tracking URL. Compiling and testing it on a laptop changes nothing for production users because requests still reach running version 1 processes.

Keep these questions in view as you work through the lesson:

1. **How Is a Release Different from a Deployment?**
2. **Why Must a Release Use an Exact Artifact?**
3. **Why Are Configuration and Identity Part of a Release?**
4. **How Does Traffic Turn a Deployment into User Experience?**
5. **Which Health Evidence Should Control a Rollout?**
6. **Why Must Rollback Be Designed Before Release?**
7. **How Does a Complete ECS Release Run?**
8. **What Is the First-Principles Release Model?**

## How Is a Release Different from a Deployment?
<!-- section-summary: Build creates bytes, deployment runs them, rollout changes exposure, and release accepts the resulting production behavior. -->

Production must move from:

```text
Requests -> running application v1
```

to:

```text
Requests -> running application v2
```

That transition raises questions beyond whether AWS can start a process:

```text
What exact bytes are v2?
Where will they run?
Which configuration and permissions will they use?
When will production traffic reach them?
Which evidence proves that they work?
What known state will replace them if they fail?
```

The answers together define the release.

A simplified path is:

```text
Source -> Git commit -> Build -> Tests -> Container image -> ECR
       -> ECS task definition -> Candidate tasks -> Health checks
       -> Traffic shift -> Observe -> Accept or roll back
```

Several distinct activities appear:

| Activity | Question |
| --- | --- |
| Build | Which executable bytes did source produce? |
| Publish | Where can the runtime retrieve those bytes? |
| Deploy | Where are those bytes running? |
| Roll out | Which users or traffic are exposed? |
| Release | Is this now accepted production behavior? |

CI/CD systems often trigger them in one pipeline, which makes the concepts appear identical. They remain distinct operational boundaries.

The release can be modeled as:

```text
Release = Artifact
        + Runtime target and specification
        + Effective configuration
        + Runtime identity
        + Traffic policy
        + Health evidence
        + Rollback plan
```

## Why Must a Release Use an Exact Artifact?
<!-- section-summary: Immutable artifact identities make promotion, incident analysis, and rollback refer to one precise set of bytes. -->

A release must answer: **Exactly what software is running?**

An image tag such as `orders-api:latest` can refer to image A at 10:00 and image B after someone pushes at 14:00. The label remains the same while its meaning changes. "Roll back to latest" therefore has no precise interpretation.

Use immutable identities such as:

```text
Git commit:      91d8e452
Image digest:    sha256:12ab34...
Build ID:        orders-api-2026.08.23.17
```

Amazon ECR supports image-tag immutability so an existing tag cannot be silently overwritten. Even with human-friendly tags, record and deploy the content digest where exact identity matters.

The principle is **build once, promote the same artifact**:

```text
source -> one tested image -> dev
                         ├--> staging
                         └--> production
```

Avoid rebuilding separately for each environment:

```text
source -> dev image
source -> staging image
source -> production image
```

In the second flow, staging proved one set of bytes while production received another. Even if source commit and build instructions appear identical, dependency retrieval, toolchain drift, timestamps, or nondeterministic build behavior can change the result.

An exact artifact supports provenance:

```text
Production release -> runtime definition -> image digest
                   -> build -> source commit
```

It also makes a rollback target concrete. Operators restore the known-good digest and runtime definition rather than searching for "an older image that probably worked."

### How Does an Artifact Become a Running Application?
<!-- section-summary: Stored bytes need a runtime specification, target, and running instance; each AWS compute platform exposes those layers differently. -->

An ECR image is inert stored data. It does not answer HTTP requests. A runtime specification connects it to CPU, memory, networking, commands, logging, storage, and identities, and a runtime platform creates live processes.

For ECS:

```text
ECR image digest
       |
ECS task definition revision
       |
ECS task
```

AWS describes the task definition as an application blueprint. It identifies the container image and can specify CPU and memory, ports and networking, commands, volumes, log configuration, task role, and execution role. A task is one running instantiation of that definition.

An ECS service maintains a desired number of tasks. Changing its desired definition from `orders-api:41` to `orders-api:42` asks ECS to replace the old runtime population with one described by revision 42. That is a deployment change. Whether production users should rely on revision 42 remains the release decision.

The runtime target is part of release identity:

```text
Account:  production
Region:   eu-west-2
Cluster:  prod-cluster
Service:  orders-api
```

The same digest in development and production is not the same operational event. The same digest in two Regions can represent distinct production states and rollout schedules.

AWS compute platforms express the layers differently:

| Runtime | Artifact or version | Target and runtime specification |
| --- | --- | --- |
| EC2 | Package, executable, or AMI | Instances or Auto Scaling group |
| ECS | Container image | Task definition and ECS service |
| EKS | Container image | Kubernetes workload and cluster |
| Lambda | ZIP, image, or function version | Function and alias |

The common pattern remains:

```text
exact artifact -> runtime specification -> selected target -> running capacity
```

## Why Are Configuration and Identity Part of a Release?
<!-- section-summary: Effective behavior is a function of code, configuration, dependencies, permissions, and data, so non-code changes can be releases. -->

Identical code can produce different behavior:

```python
if ENABLE_NEW_CHECKOUT:
    use_new_checkout()
else:
    use_old_checkout()
```

One environment runs with the flag false, and another with it true. The artifact is identical, but users experience different paths.

A better model is:

```text
Running behavior = f(
  code,
  configuration,
  dependencies,
  permissions,
  data
)
```

Configuration can come from a task definition, environment variables, AWS AppConfig, Systems Manager Parameter Store, Secrets Manager, or command-line arguments. A release record therefore needs effective configuration identity, not only an image digest.

### Configuration can itself be a release

Suppose Monday deploys code v17 with `NEW_CHECKOUT=false`. The new code runs, but users continue on the old path. Tuesday changes the flag to true without creating a new container image. Production behavior changed on Tuesday, so that configuration deployment is meaningfully a release.

AppConfig explicitly supports deploying code behind a feature flag and enabling it later. Therefore:

```text
Deployment does not always release behavior.
Release does not always require new code deployment.
```

### Version identity and security identity are different

Version identity answers what software and configuration this process represents:

```text
Git 91d8e452
Image sha256:a72f...
Task definition orders-api:42
Release rel-2026-08-23-017
```

Security identity answers what the running process may do. An ECS task role might permit DynamoDB reads and writes and one Secrets Manager secret while forbidding S3 bucket deletion or IAM user creation.

Changing the role can change runtime behavior without changing code. Version 42 with permission to retrieve its secret can start; version 42 without that permission can crash or fail requests. Release analysis must therefore include both identity types.

## How Does Traffic Turn a Deployment into User Experience?
<!-- section-summary: A traffic policy exposing users turns candidate capacity into a release, and that policy determines blast radius and rollback speed. -->

Suppose production traffic reaches three version 1 targets. Starting two healthy version 2 targets means version 2 is deployed, but if it receives no production traffic, users have not experienced it.

```text
Users -> v1, v1, v1

Candidate capacity: v2, v2 with no production traffic
```

Traffic movement makes the change real.

### All-at-once

```text
v1 100%, v2 0% -> v1 0%, v2 100%
```

This is easy to reason about and quick to complete. Its blast radius is all production traffic. A serious defect reaches every customer immediately.

### Canary

Expose a small sample first:

```text
Step 1: v1 95%, v2 5%
Step 2: v1 75%, v2 25%
Step 3: v1 0%,  v2 100%
```

Observe between steps. If version 2 error rate spikes at 5%, restore version 1 to 100%. Production supplies evidence under real traffic while limiting initial blast radius.

### Blue/green

Maintain two complete task sets or environments:

```text
Blue:  v1 serving production
Green: v2 prepared and tested
```

Shift production from blue to green while retaining blue temporarily. A failure can often be reversed by routing traffic back rather than rebuilding old capacity. CodeDeploy supports ECS blue/green deployments by creating a replacement task set and transferring traffic between original and replacement sets.

The strategies answer different risk and capacity needs. Blue/green can require duplicate capacity. Canary needs version-specific evidence and a traffic-shifting mechanism. All-at-once is simplest but accepts maximum exposure.

## Which Health Evidence Should Control a Rollout?
<!-- section-summary: Release acceptance moves from process and infrastructure health through application and customer signals to real business outcomes. -->

A container in `RUNNING` state can still fail database connections, return `500`, or corrupt orders. Health has several layers:

```text
1. Process:        container has not exited
2. Infrastructure: load balancer sees a healthy target
3. Application:    health endpoint and dependencies work
4. Customer:       latency and error experience remain acceptable
5. Business:       checkout or other transactions behave normally
```

Useful rollout evidence can include:

- HTTP 5xx rate
- p50, p95, and p99 latency
- ECS task exits and restarts
- CPU and memory
- ALB unhealthy targets
- Queue backlog and oldest-message age
- Database and dependency failures
- Custom application metrics
- Business transaction success, such as checkout completion

The release should form a feedback loop:

```text
Deploy candidate -> limited traffic -> measure
                                 |
                         healthy? yes -> more traffic
                                  no -> rollback
```

Without measurement, the process is `change -> hope`.

### Bake time catches delayed defects

Healthy metrics five seconds after full traffic do not prove success. Bugs can appear after cache expiry, connection-pool saturation, scheduled work, sustained load, or gradual memory leakage.

A rollout can reach 100% and continue observing before acceptance:

```text
10% -> healthy -> 50% -> healthy -> 100% -> bake -> accept
```

AppConfig deployment strategies explicitly include bake time and continue monitoring CloudWatch alarms after configuration reaches all targets. The idea applies to code and other runtime changes as well.

### Deployment health and release health are not identical

ECS may report all twelve tasks healthy while checkout conversion falls from 42% to 19%. Infrastructure reached the desired state, but the production outcome is unacceptable.

```text
Deployment success does not imply release success.
```

Define thresholds before rollout so the controller does not improvise whether a bad metric is "bad enough" during an incident.

## Why Must Rollback Be Designed Before Release?
<!-- section-summary: A release is operationally ready only when its known-good recovery target, traffic action, data compatibility, and automatic triggers are defined. -->

Rollback should not be an activity invented after production breaks. A release is not ready until the team knows how to reverse its production effect.

Suppose release 117 uses image digest `sha256:AAAA` and task definition 41. Release 118 uses `sha256:BBBB` and task definition 42. Release 118 should record:

```text
forward target:  orders-api:42
rollback target: orders-api:41 / release 117
```

CodeDeploy can automatically deploy the last known-good revision after deployment failure or configured alarm conditions. Technically, rollback is another deployment. Time does not move backward; the controller creates a new runtime state from a previous known-good specification.

```text
state A -> state B -> failure -> newly established state A'
```

### Data changes can make application rollback unsafe

If version 2 changes a database from `name` to `first_name` and `last_name`, returning application code to version 1 may fail against the new schema.

Use backward-compatible **expand-and-contract** transitions:

1. Add new fields while retaining old fields so both application versions work.
2. Move writers and readers to the new fields.
3. Remove obsolete fields only after old software is no longer a valid rollback target.

Safe release engineering maintains valid system states during transitions. Code, configuration, identity, and data must remain compatible for the planned rollback window.

AppConfig provides the same feedback-loop concept for configuration: CloudWatch alarms can trigger automatic rollback to the previous configuration. Whether code or configuration changes, define the trigger, recovery version, authority, and evidence that rollback succeeded.

### What Should a Release Record Contain?
<!-- section-summary: A release record connects source, exact artifact, target, runtime definition, configuration, traffic, health thresholds, result, and known rollback state. -->

Think of production as a state:

```text
S1:
  artifact        = sha256:AAAA
  task definition = 41
  config          = config-7
  checkoutV2      = false
  IAM role        = orders-role-v3
  traffic         = 100% v1
```

The release controls `S1 -> S2`, where one or more of those values change. A useful record can be:

```yaml
release:
  id: orders-prod-2026-08-23-017

  application:
    name: orders-api

  source:
    repository: orders-api
    commit: 91d8e452

  artifact:
    type: container
    repository: ECR/orders-api
    digest: sha256:a72f894...

  target:
    account: production
    region: eu-west-2
    platform: ECS
    cluster: prod
    service: orders-api

  runtime:
    task_definition: orders-api:42
    desired_count: 12
    task_role: orders-api-prod-role

  configuration:
    version: config-18

  traffic:
    strategy: canary
    steps: [10%, 50%, 100%]

  health:
    max_5xx_rate: 1%
    max_p95_latency_ms: 500
    min_healthy_tasks: 12

  rollback:
    previous_release: orders-prod-2026-08-20-016
    task_definition: orders-api:41

  status:
    result: successful
```

This lets an operator answer what changed, which source and bytes produced it, where it ran, which runtime and configuration were effective, how traffic moved, which thresholds defined health, and what previously known-good state can be restored.

Preserve release ID, Git SHA, image digest, task definition or function version, configuration version, infrastructure revision, feature-flag state, deployment ID, timestamps, approving or automation identity, rollback target, and result as applicable.

A higher-level release ID solves a human problem. Instead of discussing several unrelated hashes and AWS IDs, the team can say `release-017`, which points to all of them and to `release-016` as the recovery target.

#### Make the production state reconstructable

Six months later, an incident or audit may ask what production was running at 14:23 on August 23. The answer cannot depend on whichever value a mutable tag has today. Preserve the release start and completion times, traffic-step times, deployment identity, task definition revision, exact image digest, configuration and feature-flag versions, infrastructure revision, task role, target account and Region, and the automation or approver that authorized the change.

That evidence creates a chain in both directions:

```text
customer request at 14:23
  -> active production release
  -> runtime definition and configuration
  -> exact artifact digest
  -> build record
  -> source commit
```

It also lets the team compare two states rather than guessing from a pipeline log:

```text
release-016
  image OLD, task 41, config 17, flag false

release-017
  image NEW, task 42, config 18, flag true
```

If several changes were combined, this record shows that the observed behavior cannot be attributed to code alone.

#### Record evidence and decisions, not just identifiers

"Jenkins succeeded" proves only that the pipeline reached its own success state. A useful release record also preserves the evidence that justified each traffic increase, the alarm or threshold that stopped a rollout, the operator decision where automation did not decide, and the post-rollback verification.

For a canary, record version-specific values rather than only fleet-wide averages. A bad 5% candidate can disappear inside a healthy 95% baseline. Capture candidate 5xx, latency, task health, and business success separately from the old version. Then the acceptance statement becomes falsifiable: version 42 stayed below the defined error and latency limits at 10%, 50%, and 100% through the bake period.

If the release rolls back, retain the failed release as history. Its status should say which gate failed, when candidate traffic returned to zero, which known-good state was restored, and which metrics demonstrated recovery. Rollback does not erase the unsuccessful transition; preserving it helps future releases avoid repeating the same failure.

## How Does a Complete ECS Release Run?
<!-- section-summary: An ECS release builds and stores one immutable image, creates a new runtime definition, starts candidates, gates traffic on evidence, bakes, and records the new known-good state. -->

Production begins with twelve tasks using task definition 41 and digest `sha256:OLD`, receiving 100% of traffic.

### 1. Build one artifact

CI builds commit `abc123`, runs tests, and produces `orders-api@sha256:NEW`.

### 2. Publish the artifact

Push the image to ECR. The bytes now exist in AWS, but production still serves version 41.

### 3. Define the candidate runtime

Create task definition `orders-api:42` with the new digest, CPU, memory, ports, logging, task role, and effective settings.

### 4. Start candidate capacity

ECS or CodeDeploy starts version 42 tasks while version 41 remains available. The new artifact is deployed but not yet accepted as production behavior.

### 5. Establish basic health

Verify process startup, ALB target health, application initialization, and dependency reachability. Abort before traffic if candidates cannot pass these gates.

### 6. Send limited production traffic

Route 10% to version 42 and keep 90% on 41.

### 7. Compare evidence

Measure version-specific 5xx, latency, CPU, memory, restarts, dependency failures, and business signals. If version 42 has 0.2% errors and acceptable p95 latency, expand. If it has 12% errors while version 41 has 0.1%, restore version 41 to 100% and record the violated threshold.

### 8. Expand and complete

Move to 50%, observe again, then reach 100% only if the defined gates remain healthy.

### 9. Bake

Continue observing at full exposure long enough to catch delayed defects.

### 10. Accept and record

Declare release 118 successful. Record digest `sha256:NEW`, task definition 42, configuration, traffic history, thresholds, timestamps, and release 117 as the next rollback target.

This accepted state becomes the known-good baseline for release 119.

## What Is the First-Principles Release Model?
<!-- section-summary: A release is a controlled, observable, reversible transition from one recorded production state to another. -->

Production cannot be proven safe from testing alone. Real traffic, customer behavior, scale, data, dependencies, timing, and failure modes differ from preproduction. Release engineering treats production exposure as controlled experimentation:

This does not make production an uncontrolled test environment. The candidate has already passed build and preproduction checks. The release adds bounded evidence under conditions that only production can provide, with explicit traffic limits, stop conditions, and a recovery target. The experiment is controlled precisely because the expected signals and response to failure were defined before exposure.

```text
Immutable artifact
  -> small exposure
  -> evidence
  -> more exposure
  -> evidence
  -> full exposure
  -> bake
```

The blast radius is deliberately limited and an escape path is predefined.

Three questions unify every release:

1. **What state do we want?** Exact artifact, configuration, runtime, permission, and target.
2. **How do we safely move production there?** Candidate capacity, validation, staged traffic, evidence, and bake time.
3. **What if the assumption is wrong?** Stop expansion, remove traffic, and restore a known-good compatible state.

The controlled state machine is:

```text
Source change -> exact artifact -> runtime specification -> candidate runs
      -> health checks -> traffic shift -> observe
      -> healthy? yes: expand and bake -> RELEASED
                  no: restore known-good state
```

The shortest definition is: **An AWS release is a recorded, controlled transition from one known production state to another, using an exact artifact and effective runtime configuration, deliberate traffic exposure, measurable health criteria, and a known rollback path.**

Deployment gets the change into the environment. Release decides whether production should live on it.

## Check Your Answers

:::expand[How Is a Release Different from a Deployment?]{kind="recap"}
Build creates bytes, deployment runs them, rollout changes exposure, and release accepts the resulting production behavior.

Build creates bytes, deployment runs them, rollout changes who sees them, and release accepts or rejects the resulting production behavior using evidence and a recovery path. Configuration can release behavior without a new code deployment.
:::

:::expand[Why Must a Release Use an Exact Artifact?]{kind="recap"}
Immutable artifact identities make promotion, incident analysis, and rollback refer to one precise set of bytes.

Mutable labels can point to different bytes over time. An immutable digest and build provenance make promotion, incident analysis, and rollback refer to the same tested artifact across environments.

Stored bytes need a runtime specification, target, and running instance; each AWS compute platform exposes those layers differently.

Stored bytes need a runtime specification and target. In ECS, an image digest enters a task definition, a service maintains tasks from that definition, and tasks are the running processes that can receive traffic.
:::

:::expand[Why Are Configuration and Identity Part of a Release?]{kind="recap"}
Effective behavior is a function of code, configuration, dependencies, permissions, and data, so non-code changes can be releases.

Behavior depends on code, configuration, dependencies, permissions, and data. Feature flags can release behavior without new code, and a changed task role can make identical code succeed or fail.
:::

:::expand[How Does Traffic Turn a Deployment into User Experience?]{kind="recap"}
A traffic policy exposing users turns candidate capacity into a release, and that policy determines blast radius and rollback speed.

Candidate capacity is only deployed until users reach it. All-at-once exposes everyone, canary expands a small sample, and blue/green switches between complete task sets while retaining a quick traffic-based recovery path.
:::

:::expand[Which Health Evidence Should Control a Rollout?]{kind="recap"}
Release acceptance moves from process and infrastructure health through application and customer signals to real business outcomes.

Use process, infrastructure, application, customer, and business signals. Expand traffic only when predefined thresholds remain healthy, and continue through bake time so delayed defects can appear before acceptance.
:::

:::expand[Why Must Rollback Be Designed Before Release?]{kind="recap"}
A release is operationally ready only when its known-good recovery target, traffic action, data compatibility, and automatic triggers are defined.

Rollback is another deployment toward a recorded known-good state. Define the trigger and target in advance, and use backward-compatible data migrations so the previous application remains valid during the rollback window.

A release record connects source, exact artifact, target, runtime definition, configuration, traffic, health thresholds, result, and known rollback state.

Connect one human release ID to source commit, artifact digest, target, runtime revision, configuration, identity, traffic steps, health thresholds, timestamps, result, and previous known-good release.
:::

:::expand[How Does a Complete ECS Release Run?]{kind="recap"}
An ECS release builds and stores one immutable image, creates a new runtime definition, starts candidates, gates traffic on evidence, bakes, and records the new known-good state.

Build and publish one immutable image, define task revision 42, start candidates beside revision 41, pass basic health, expand traffic through evidence gates, bake at full exposure, and record the accepted state or rollback reason.
:::

:::expand[What Is the First-Principles Release Model?]{kind="recap"}
A release is a controlled, observable, reversible transition from one recorded production state to another.

A release controls the transition from one production state to another. It defines the intended state, the safe traffic-and-evidence path toward it, and the known action when production disproves the release assumption.
:::

## References

- [Amazon ECR documentation: Image tag immutability](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html)
- [Amazon ECS documentation: Task definitions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html)
- [AWS AppConfig documentation](https://docs.aws.amazon.com/appconfig/latest/userguide/what-is-appconfig.html)
- [AWS CodeDeploy documentation](https://docs.aws.amazon.com/codedeploy/latest/userguide/welcome.html)
- [AWS AppConfig documentation: Deployment strategies and bake time](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-creating-deployment-strategy.html)
- [AWS CodeDeploy documentation: Rollback and redeploy](https://docs.aws.amazon.com/codedeploy/latest/userguide/deployments-rollback-and-redeploy.html)
- [AWS AppConfig documentation: Feature flags and automatic rollback](https://docs.aws.amazon.com/appconfig/latest/userguide/deploying-feature-flags.html)
