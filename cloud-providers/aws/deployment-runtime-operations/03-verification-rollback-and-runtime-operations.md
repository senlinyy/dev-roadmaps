---
title: "Verification, Rollback, and Runtime Operations"
description: "Verify production behavior after an AWS deployment, compare runtime evidence, choose rollback, pause, or fix forward, and prove the system recovered."
overview: "Follow watch windows, deployment markers, smoke tests, user journeys, metrics, logs, traces, ECS and Lambda checks, asynchronous backlog, remediation decisions, and secondary damage."
tags: ["aws", "ecs", "lambda", "cloudwatch", "rollback", "observability"]
order: 3
id: article-cloud-providers-aws-deployment-runtime-operations-deploying-and-updating-an-ecs-service
aliases:
  - verification-rollback-and-runtime-operations
  - release-verification-rollback-runtime-operations
  - article-cloud-providers-aws-deployment-runtime-operations-verification-rollback-runtime-operations
  - deploying-and-updating-an-ecs-service
  - cloud-providers/aws/deployment-runtime-operations/deploying-and-updating-an-ecs-service.md
  - cloud-providers/aws/deployment-runtime-operations/02-ecs-deployments.md
  - article-cloud-providers-aws-deployment-runtime-operations-scaling-jobs-and-operational-controls
  - scaling-jobs-and-operational-controls
  - runtime-controls
  - cloud-providers/aws/deployment-runtime-operations/scaling-jobs-and-operational-controls.md
  - cloud-providers/aws/deployment-runtime-operations/04-runtime-controls.md
---

## Table of Contents

1. [Why Is Deployment Success Not Runtime Success?](#why-is-deployment-success-not-runtime-success)
2. [How Long Should the Watch Window Last?](#how-long-should-the-watch-window-last)
3. [How Do Metrics, Logs, and Traces Work Together?](#how-do-metrics-logs-and-traces-work-together)
4. [How Do You Verify an ECS Deployment?](#how-do-you-verify-an-ecs-deployment)
5. [How Do You Verify a Lambda Deployment?](#how-do-you-verify-a-lambda-deployment)
6. [How Do You Choose Rollback, Pause, or Fix Forward?](#how-do-you-choose-rollback-pause-or-fix-forward)
7. [How Does Runtime Operations Form a Feedback Loop?](#how-does-runtime-operations-form-a-feedback-loop)
8. [What Is the Complete Verification Model?](#what-is-the-complete-verification-model)
9. [References](#references)

A deployment system can copy an image, start containers, update a Lambda function, and report `SUCCESS` while customers receive errors. Successful control-plane work proves that AWS created or activated what was requested. It does not prove that the resulting system is correct, fast, stable, or valuable.

Before a deployment, production is in some known state `S0`. The change moves it toward `S1`, but `S1` is initially an assumption rather than a proven healthy state.

The sections below answer these questions in order:

1. **Why Is Deployment Success Not Runtime Success?**
2. **How Long Should the Watch Window Last?**
3. **How Do Metrics, Logs, and Traces Work Together?**
4. **How Do You Verify an ECS Deployment?**
5. **How Do You Verify a Lambda Deployment?**
6. **How Do You Choose Rollback, Pause, or Fix Forward?**
7. **How Does Runtime Operations Form a Feedback Loop?**
8. **What Is the Complete Verification Model?**

## Why Is Deployment Success Not Runtime Success?
<!-- section-summary: The deployment plane proves requested infrastructure state, while the runtime plane proves availability, correctness, latency, capacity, dependencies, data integrity, and business behavior. -->

Suppose a pipeline deploys API version 42 and reports:

```text
Image pushed       success
Task definition    success
ECS deployment     success
Containers running success
```

This proves the infrastructure could deploy v42. It does not prove that users can sign in, orders persist, payments succeed, latency remains acceptable, background work drains, memory remains stable, or database permission is correct.

Separate two planes:

| Plane | Question |
| --- | --- |
| Deployment or control plane | Did AWS create and activate the requested resources and versions? |
| Runtime or data plane | Does the resulting system work correctly for real users and workloads? |

Define health from the properties the system must preserve:

- **Availability:** legitimate work can be served.
- **Correctness:** responses and side effects are correct.
- **Latency:** work completes within its expected time.
- **Capacity:** the system can sustain the workload.
- **Data integrity:** data is not lost or corrupted.
- **Dependency health:** databases, queues, caches, APIs, and other services continue to work.
- **Business correctness:** users can complete checkout, upload, sign-up, payment, or another valuable outcome.

Verification is not merely "did anything crash?" It asks whether the change violated any important invariant.

Create an exact deployment marker on operational timelines. Attach service, version, deployment ID, task definition or Lambda version, environment, account, Region, configuration revision, and release time to metrics and logs.

```text
Errors
  |
  |                         rising failures
  |                       /
  |______________________/____________ time
                        ^
                   deploy v42
```

Without the marker, the spike is unexplained. With it, the team can immediately test the hypothesis that behavior changed with v42. Observability is more powerful when it answers "what changed?" as well as "what is broken?"

## How Long Should the Watch Window Last?
<!-- section-summary: Observation must cover the traffic volume and delayed failure modes relevant to the system rather than a ritual number of minutes. -->

Five seconds of healthy behavior after traffic reaches a new version is not enough. Some failures require time or accumulated work:

```text
memory leak -> gradual growth -> limit -> out-of-memory kill

slower database query -> connections accumulate -> pool exhausted -> failures

Lambda processing regression -> retries -> queue grows -> dependency overload
```

A **watch window** begins when the new production state starts receiving meaningful workload:

```text
old version ---- deployment marker ---- new version ---- observation ---->
```

The window should cover relevant behaviors:

- Startup and warm-up
- Normal production traffic distribution
- Autoscaling decisions
- Background and queue processing
- Cache fill, expiry, and eviction
- Dependency interactions
- Scheduled or batch code paths
- Sustained resource use

A high-volume synchronous API can reveal statistical problems quickly. A nightly batch needs enough time to execute the path at least once. A low-volume feature may need synthetic or targeted traffic because elapsed clock time without requests provides little evidence.

Different failures have different timescales. Syntax and startup errors appear in seconds. A latency regression can appear in minutes. A connection leak may need an hour. Daily settlement code may not run until later. Select the window from plausible failure modes and observed workload rather than declaring that every deployment is safe after ten minutes.

The watch window also continues after full rollout or recovery. Delayed feedback is still production evidence, and a system that returned to low error rates but retains a growing backlog has not fully recovered.

### How Deep Should Verification Go?
<!-- section-summary: Verification progresses from resource existence through application and dependency checks to user journeys, real traffic, and business outcomes. -->

Use a hierarchy:

```text
Deployment completed
  -> process, container, or function version exists
  -> application responds
  -> dependencies work
  -> critical user journeys work
  -> real traffic behaves normally
  -> business outcomes remain normal
```

Each level proves more than the previous one.

#### Health checks are a foundation

`GET /health -> 200` proves a process can answer that endpoint. It may not prove database authentication, payment credentials, Redis access, order writes, or business correctness. Design readiness checks to cover what is safe and inexpensive, but do not mistake them for full verification.

#### Smoke tests find catastrophic failures cheaply

A smoke test can verify DNS, load-balancer reachability, application response, authentication, and one representative request. For an online store:

```text
GET /products
-> HTTP 200
-> valid JSON and expected schema
-> response within a reasonable time
```

The goal is to answer "is the application fundamentally usable?" quickly enough to run after every deployment, not to prove every feature.

#### User journeys verify outcomes across services

A real unit of value is often a sequence:

```text
browse product -> add to cart -> authenticate -> checkout
-> payment -> order persisted
```

Every individual endpoint can look healthy while order persistence fails at the end. Synthetic or automated journeys reveal whether the connected system produces a valuable user outcome.

| Evidence | Main question |
| --- | --- |
| Health check | Is this process ready or alive? |
| Smoke test | Is the application basically usable? |
| User journey | Can a user accomplish something valuable? |
| Production monitoring | Does it stay healthy under real workload? |

These layers complement one another.

#### Production traffic reduces residual uncertainty

Staging approximates production. It does not have all real data distributions, permissions, network behavior, concurrency, caches, account configuration, dependency latency, and user behavior.

Progressive delivery follows:

```text
tests -> staging -> deploy -> smoke test
-> small production cohort -> observe -> expand
```

The system is buying information while limiting blast radius.

#### Verification is hypothesis testing

The predeployment claim is "v42 is safe." Production supplies evidence from smoke tests, metrics, logs, traces, journeys, resources, and business results. Independent signals increase confidence:

```text
deployment complete
tasks stable
load balancer healthy
smoke test passes
errors and latency unchanged
checkout journey passes
business outcomes normal
```

Verification cannot create mathematical certainty. It reduces uncertainty enough that accepting or rejecting the release becomes rational.

## How Do Metrics, Logs, and Traces Work Together?
<!-- section-summary: Metrics reveal abnormal behavior, traces show which dependency or span caused it, and logs provide the detailed event or error context. -->

Metrics compress many events into signals such as request rate, error rate, p95 latency, CPU, memory, queue depth, Lambda throttles, and business success. They answer, "Is something wrong?"

A version comparison can immediately reveal:

```text
v41 errors: 0.2%
v42 errors: 7.8%
```

Logs answer, "What happened?" A log can show `DatabaseException: permission denied for relation orders` with the version and request ID.

Traces answer, "Where did the request spend time or fail?"

```text
Browser 40ms -> API 30ms -> Order service 55ms
-> Payment service 3,200ms -> external payment API
```

The API is not the primary latency source; the downstream payment call is.

An investigation chain is:

```text
Metric detects:   something is wrong
Trace localizes:  payment span is slow
Log explains:     upstream API timeouts
```

### Four signal categories reveal many incidents

| Signal | Question |
| --- | --- |
| Traffic | How much work is arriving? |
| Errors | How much work is failing? |
| Latency | How long does work take? |
| Saturation | How close are resources to their limits? |

A latency change from 100 to 200 ms can appear harmless, yet longer requests increase concurrency, consume more database connections and memory, cause pool saturation, timeouts, retries, and more traffic. Monitoring leading signals can stop the feedback loop before the final outage.

### Compare with a baseline

CPU at 72% has no universal meaning. If normal is 65–80%, it may be expected. If normal is 15–20% and it jumped at the deployment marker, it is significant.

Compare postdeployment behavior with the predeployment baseline and, during a canary, candidate behavior with stable behavior. Look for changes correlated with the version rather than only static "high" or "low" thresholds.

## How Do You Verify an ECS Deployment?
<!-- section-summary: ECS verification crosses service, task, container, load-balancer, application, resource, and dependency layers and requires stable behavior over time. -->

An ECS service with desired tasks 10 and running tasks 10 proves only that the scheduler currently has ten running tasks. All ten can return HTTP 500.

Verify layer by layer:

```text
ECS deployment reached expected revision
  -> candidate tasks started
  -> containers stay running
  -> readiness and health checks pass
  -> load balancer marks targets healthy
  -> production traffic reaches candidates
  -> requests and user journeys succeed
  -> resources and dependencies remain normal
```

| Layer | What to establish |
| --- | --- |
| ECS service | Intended task definition and count are active |
| Tasks | Tasks remain stable instead of cycling |
| Containers | Processes do not exit or hit resource limits |
| Load balancer | Candidate targets are eligible and receiving traffic |
| Application | Version-specific requests succeed with normal latency |
| Resources | CPU, memory, networking, and scaling behave normally |
| Dependencies | Database, queue, cache, and downstream APIs remain healthy |

A suspicious loop is:

```text
task starts -> health check fails -> ECS stops it
-> replacement starts -> health fails -> replacement starts
```

An instantaneous count can repeatedly show running tasks even though the service never reaches equilibrium. Verify stability over the watch window, task stop reasons, deployment events, and restart rate.

Separate scheduler and application questions:

```text
ECS scheduler: Can I keep the requested containers alive?
Application:   Do those containers correctly serve users?
```

`PAYMENT_API_URL=https://wrong-host` can allow a container to start, remain alive, pass a shallow health endpoint, and consume normal CPU while every payment fails. The scheduler cannot infer business semantics.

## How Do You Verify a Lambda Deployment?
<!-- section-summary: Lambda verification observes invocation outcomes, duration, concurrency, throttling, retry, event age, and downstream work rate rather than server uptime. -->

Lambda has no continuously running server to inspect. Ask what happens when the new function version is invoked.

Useful signals include:

```text
Invocations
Errors
Duration
Throttles
Concurrency
Retries
Event age and queue backlog
Downstream failures
Dead-letter behavior
```

Suppose errors remain at 0.1% while duration increases from 180 to 950 ms. The deployment has not failed yet, but fivefold duration increases concurrent executions. That can reach concurrency limits, produce throttling, cause retries, and grow backlog. Duration is a leading indicator.

### Asynchronous work can be unhealthy without explicit errors

An SQS-triggered function receives 1,000 messages per minute but after deployment completes only 700. The visible difference is:

```text
1,000 arrivals - 700 completions = 300 additional messages/minute
```

After one hour, backlog increases by 18,000. Individual invocations can mostly succeed while the system falls farther behind.

For event-driven Lambda, ask whether work arrives faster than it finishes. Monitor queue depth, oldest-message or event age, retry volume, batch failures, DLQ messages, concurrency, throttles, and dependency capacity. A function success rate alone does not prove that the asynchronous system is meeting its timeliness obligation.

If an alias or traffic-shifting mechanism exposes a candidate version, separate its duration, errors, and business outcome from the stable version rather than relying on the aggregate function metric.

## How Do You Choose Rollback, Pause, or Fix Forward?
<!-- section-summary: Choose the action with the lowest expected harm using active impact, blast radius, reversibility, and confidence in the proposed correction. -->

When verification fails, the broad choices are rollback, pause, or fix forward. The objective during active impact is to restore a healthy system while adding the least risk, not to prove the exact root cause before acting.

### Rollback restores a known-good state

```text
v41 healthy -> deploy v42 -> unhealthy -> restore v41
```

The previous version has real production evidence, which often makes rollback safer than an emergency v43. Use rollback when impact is high, returning is compatible, and diagnosis or fix confidence is low.

Rollback safety depends on more than binaries. A v42 schema migration that drops `first_name` and `last_name` in favor of `full_name` can make v41 fail after return. Consider schema, transformed data, messages already published, external side effects, cached formats, and API contracts. Backward-compatible migrations preserve the option.

### Pause contains uncertainty

During a 10% canary, suspicious but inconclusive signals can justify stopping further traffic expansion:

```text
planned: 10% -> 25% -> 50% -> 100%
actual:  10% -> PAUSE
```

Pause buys investigation time without increasing blast radius. It is useful when a small cohort is affected and the signal needs confirmation.

### Fix forward applies another correction

If v42 uses `PAYMENT_TIMEOUT=1` and the intended value is 10, a narrow high-confidence configuration change may be faster and safer than reversing the entire release. Fix forward can also be necessary after irreversible state change.

It has a cost: another unproven change enters an already unhealthy system. Use it when the problem and correction are clear and rollback is riskier.

### Use four decision variables

| Variable | Question |
| --- | --- |
| Impact | How badly are users affected? |
| Blast radius | How much of the system is exposed? |
| Reversibility | Can the old state safely operate now? |
| Confidence | How certain is the proposed diagnosis and correction? |

```text
Large impact + safe rollback + uncertain diagnosis -> rollback
Contained canary + uncertain signal               -> pause
Small contained impact + obvious correction       -> fix forward
```

Choose the shortest safe path with the lowest expected harm. During a severe outage, minimize `time × impact`. Restore service, verify recovery, then investigate deeply. Debugging elegance should not keep checkout unavailable when a tested rollback exists.

### How Do You Verify Recovery and Find Secondary Damage?
<!-- section-summary: Rollback changes production and therefore needs the same runtime proof, followed by checks for queues, caches, retries, workflows, and dependency load left by the incident. -->

Rollback is another deployment. Do not verify v42 carefully and assume that a rollback command returning success means v41 is healthy.

Verify:

```text
rollback initiated
-> old version active
-> tasks or function aliases stable
-> traffic reaches old version
-> errors and latency recover
-> smoke tests and user journeys pass
```

The same control-plane-versus-runtime distinction applies after remediation.

#### Application version recovery is not complete system recovery

An incident can leave:

- Failed messages waiting for retry
- A large queue backlog
- Caches with bad values
- Stuck database connections
- Clients continuing to retry
- Dead-letter queues containing events
- Partially completed workflows
- Elevated autoscaling capacity
- External side effects that need reconciliation

If a broken Lambda accumulated 50,000 SQS messages, restoring the old function can create high catch-up concurrency, saturate the database, and cause another outage. Plan the drain rate, consumer concurrency, retry behavior, and dependency capacity instead of releasing the entire backlog at once.

Ask, "What state did failure leave behind?" Application code can be healthy while queues, caches, data, and workflows remain damaged.

#### Verification occurs twice

The complete lifecycle is:

```text
CHANGE -> DEPLOY -> VERIFY
                    |
                healthy?
              /          \
            yes           no
             |             |
          OBSERVE        DECIDE
                    rollback / pause / fix
                             |
                           VERIFY
                             |
                         HEALTHY STATE
                             |
                           LEARN
```

After deployment, verification asks whether the change worked. After action, it asks whether recovery worked and whether secondary state is safe.

## How Does Runtime Operations Form a Feedback Loop?
<!-- section-summary: Runtime operations connects change mechanisms, observability, diagnosis, corrective actions, and renewed verification into a control system. -->

At the broadest level:

```text
Change -> Observe -> Detect -> Diagnose -> Act -> Verify -> repeat
```

Observability is the sensory system. Deployment changes the plant. Rollback, traffic movement, configuration changes, and remediation are actuators. Runtime operations connects them with feedback.

Without feedback:

```text
deploy -> hope
```

With feedback:

```text
deploy
-> measure actual behavior
-> compare with desired behavior
-> correct deviations
-> measure again
```

For an application with ALB, ECS API, database, Lambda, and SQS, the verification chain can be:

```text
deployment state
-> ECS tasks stable and Lambda invoked
-> CPU, memory, concurrency, throttling
-> errors and latency
-> database, queue, and API dependencies
-> synthetic checkout
-> real user success
```

No one layer is sufficient. Together they create evidence about the actual production state.

## What Is the Complete Verification Model?
<!-- section-summary: A deployment is complete only when a controlled change has enough layered evidence, limited exposure, and verified reversibility to return production to an acceptable state. -->

Every production change introduces uncertainty. Verification converts some uncertainty into evidence. Progressive rollout limits the damage that remaining uncertainty can cause. Observability detects unexpected behavior. Rollback or remediation provides reversibility. The watch window lets latent failure emerge.

```text
Safe deployment = controlled change
                + observability
                + layered verification
                + limited blast radius
                + reversibility
```

Frequent deployment is not automatically reckless. Small, observable, progressively exposed, easily reversible changes can carry less risk than rare, large, opaque releases.

Think of every change as consuming a risk budget. Before deployment, the existing production behavior has accumulated evidence. The candidate is partly unknown. A small cohort spends little of that budget while metrics, traces, logs, journeys, and business results buy information. A global cutover spends the budget immediately. A long recovery path increases the cost of being wrong. This is why release size, exposure, watch quality, and reversibility belong in one decision rather than separate operational checklists.

The same reasoning explains why independent signals matter. Ten running ECS tasks are evidence about scheduling. A passing smoke test is evidence about a small request path. Stable candidate error and latency metrics are evidence under traffic. A successful checkout is evidence about one important outcome. Normal order completion across real users and a full watch window adds further evidence. None proves absolute safety, but together they make acceptance substantially more rational than any single green status.

Do not use this lifecycle:

```text
build -> deploy -> done
```

Use:

```text
deploy -> production changed -> uncertainty
       -> verify and observe -> evidence
       -> expected? yes: accept and continue watching
                    no: contain through rollback, pause, or fix
                        -> verify again -> stable production
```

The deployment is finished only when there is enough evidence that production has returned to a known, acceptable operating state. That one idea explains watch windows, deployment markers, smoke tests, user journeys, metrics, logs, traces, ECS and Lambda runtime checks, rollback design, secondary-damage inspection, and observation after corrective action.

:::expand[Why Is Deployment Success Not Runtime Success?]{kind="recap"}
The deployment plane proves requested infrastructure state, while the runtime plane proves availability, correctness, latency, capacity, dependencies, data integrity, and business behavior.

Control-plane success proves AWS created the requested state. Runtime success proves availability, correctness, latency, capacity, data and dependency health, and valuable user outcomes. Both need explicit evidence.
:::

:::expand[How Long Should the Watch Window Last?]{kind="recap"}
Observation must cover the traffic volume and delayed failure modes relevant to the system rather than a ritual number of minutes.

Observe long enough and with enough traffic to reveal the system's plausible startup, scaling, backlog, cache, dependency, scheduled, and resource failures. A universal number of minutes cannot replace workload-specific evidence.

Verification progresses from resource existence through application and dependency checks to user journeys, real traffic, and business outcomes.

Progress from resource existence and health checks through smoke tests, dependencies, user journeys, real traffic, and business outcomes. Each layer proves something different, and no shallow signal replaces the higher-value ones.
:::

:::expand[How Do Metrics, Logs, and Traces Work Together?]{kind="recap"}
Metrics reveal abnormal behavior, traces show which dependency or span caused it, and logs provide the detailed event or error context.

Metrics detect abnormal traffic, errors, latency, or saturation. Traces localize the failing or slow span. Logs explain the detailed event and error. Compare candidate behavior with a predeployment or stable baseline.
:::

:::expand[How Do You Verify an ECS Deployment?]{kind="recap"}
ECS verification crosses service, task, container, load-balancer, application, resource, and dependency layers and requires stable behavior over time.

Confirm the intended service revision and count, task stability, container stop reasons, health checks, load-balancer eligibility, version-specific traffic, resources, dependencies, requests, and journeys. Scheduler health does not prove business health.
:::

:::expand[How Do You Verify a Lambda Deployment?]{kind="recap"}
Lambda verification observes invocation outcomes, duration, concurrency, throttling, retry, event age, and downstream work rate rather than server uptime.

Observe invocations, errors, duration, concurrency, throttles, retries, event age, backlog, DLQs, and dependency capacity. A slower event consumer can create a growing backlog even when most invocations succeed.
:::

:::expand[How Do You Choose Rollback, Pause, or Fix Forward?]{kind="recap"}
Choose the action with the lowest expected harm using active impact, blast radius, reversibility, and confidence in the proposed correction.

Use impact, blast radius, reversibility, and correction confidence. Roll back large impact to a compatible known-good state, pause a contained uncertain canary, or fix forward when the narrow correction is highly credible and reversal is riskier.

Rollback changes production and therefore needs the same runtime proof, followed by checks for queues, caches, retries, workflows, and dependency load left by the incident.

Treat rollback as another deployment and repeat runtime checks. Then inspect backlog, retries, caches, connections, workflows, DLQs, autoscaling, data, and external side effects left by the failed version before declaring recovery.
:::

:::expand[How Does Runtime Operations Form a Feedback Loop?]{kind="recap"}
Runtime operations connects change mechanisms, observability, diagnosis, corrective actions, and renewed verification into a control system.

Deployment changes the system, observability senses the response, diagnosis identifies the deviation, an action adjusts production, and verification measures again. Operations is the closed loop that replaces deploy-and-hope.
:::

:::expand[What Is the Complete Verification Model?]{kind="recap"}
A deployment is complete only when a controlled change has enough layered evidence, limited exposure, and verified reversibility to return production to an acceptable state.

A production change is complete only after layered evidence supports an acceptable state, remaining uncertainty has bounded exposure, and any remediation or rollback has itself been verified along with the state it left behind.
:::

## References

- [Amazon CloudWatch documentation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/WhatIsCloudWatch.html)
- [Amazon ECS documentation: Service deployment state and rollout](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html)
- [AWS Lambda documentation: Monitoring functions](https://docs.aws.amazon.com/lambda/latest/dg/lambda-monitoring.html)
- [Amazon SQS documentation: CloudWatch metrics](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-available-cloudwatch-metrics.html)
- [AWS X-Ray documentation](https://docs.aws.amazon.com/xray/latest/devguide/aws-xray.html)
