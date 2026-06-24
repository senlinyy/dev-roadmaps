---
title: "Continuous Delivery"
description: "Learn how continuous delivery turns a tested build into a safe, repeatable, approval-ready production release."
overview: "Continuous delivery connects CI output to production release operations. This article explains delivery vs. deployment, immutable artifacts, runtime configuration, promotion gates, health checks, failed rollouts, and rollback design."
tags: ["delivery", "environments", "rollbacks", "architecture", "deployment"]
order: 3
id: article-cicd-fundamentals-continuous-delivery
aliases:
  - continuous-delivery
  - article-cicd-fundamentals-continuous-delivery
  - cicd/fundamentals/continuous-delivery.md
---

## Table of Contents

1. [The Release Path After CI](#the-release-path-after-ci)
2. [Delivery and Deployment](#delivery-and-deployment)
3. [Manual Releases and Drift](#manual-releases-and-drift)
4. [Build Once, Promote the Same Artifact](#build-once-promote-the-same-artifact)
5. [Runtime Configuration and Secrets](#runtime-configuration-and-secrets)
6. [Promotion Environments and Approval Gates](#promotion-environments-and-approval-gates)
7. [Health Checks and Rollout Deadlines](#health-checks-and-rollout-deadlines)
8. [A Rollout That Fails Safely](#a-rollout-that-fails-safely)
9. [Rollback and Recovery](#rollback-and-recovery)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Release Path After CI
<!-- section-summary: Continuous delivery takes the tested output from CI and turns it into a repeatable release path. -->

The previous article focused on pipelines, runners, and artifacts. CI gives the team a trusted build result: tests passed, the package exists, and the pipeline saved the output somewhere durable. That is a huge step, but a package in a registry still has one more journey to make before users receive value from it.

**Continuous delivery**, usually shortened to **CD**, means the team keeps software in a state where an approved change can reach production through an automated, repeatable process. The important part is readiness. A change that passes the pipeline should already have a clear route through staging, approval, production rollout, health checks, and recovery.

Let's use one production example through the article. A company called Northstar Travel runs a service named `booking-api`. Customers use it to reserve hotel rooms, apply discount codes, and pay for trips. A developer merges a discount-code fix, CI builds a container image, and the team now needs to release that exact change safely.

This article follows the path that image takes. First we separate **delivery** from **deployment** so the two CD meanings stay clear. Then we look at why manual releases create drift. After that we build once, inject configuration at runtime, promote through environments, watch rollout health, and design rollback before the incident happens.

## Delivery and Deployment
<!-- section-summary: Delivery prepares a change for safe release, while deployment moves that change into a running environment. -->

Two words get mixed together all the time: **delivery** and **deployment**. Delivery means the change has passed enough automated checks and release steps that the business can choose to ship it. Deployment means the platform actually places that change into a running environment, such as staging or production.

Continuous delivery keeps a human decision near the final production step. The pipeline can build the image, deploy it to staging, run smoke tests, and wait at the production gate. A release manager, engineer, or change approver then reviews the evidence and clicks the production approval button.

**Continuous deployment** goes one step further. Every change that passes the automated checks flows into production without a manual approval step. That can work beautifully for mature web services with strong tests, fast observability, and small changes. It can cause real pain for teams that still have flaky tests, manual database checks, or release windows tied to customer support.

Northstar Travel chooses continuous delivery for `booking-api`. The team wants a person to approve production releases because payment behavior, partner hotel contracts, and support staffing all matter. The approval step confirms the release evidence, and the pipeline still performs the production deployment.

That difference matters because the risky part of many old release processes was never the approval. The risky part was the manual work people performed after the approval. That takes us to the next problem.

## Manual Releases and Drift
<!-- section-summary: Manual release steps create hidden differences between servers, environments, and release attempts. -->

A **manual release** means a person performs the production change by hand. They might SSH into a server, pull code from Git, install dependencies, edit a config file, restart a process, and watch logs in a terminal. This can feel simple with one service and one server, especially in the early days of a project.

Here is a realistic old release path for `booking-api`. An engineer connects to `prod-app-01`, runs `git pull`, runs `npm install`, copies a `.env` file from a shared folder, restarts `systemd`, and then repeats a similar set of steps on `prod-app-02`. The release depends on memory, local shell history, and the engineer noticing every warning at the right moment.

The first failure mode is **repeatability**. A repeatable process produces the same result each time because the instructions and inputs stay controlled. Manual work breaks repeatability because one missed command can leave one server running the new code with old dependencies while another server runs old code with new dependencies.

The second failure mode is **environment drift**. Drift means an environment slowly drifts away from what the team believes exists. One engineer adds a hotfix file directly on the server. Another changes a process limit during an outage. A third rotates a secret on one host and forgets the second host. The next release now behaves differently on machines that the dashboard describes as identical.

The third failure mode is weak recovery. A manual release often has a vague rollback plan like "put the old branch back" or "restart the previous process." During an incident, the team then has to remember which commit ran before, which dependency versions came with it, and which config files changed during the release. Recovery turns into a second manual release under stress.

Continuous delivery removes those hand-built release steps from the production path. The pipeline performs the same deployment action every time, records which artifact moved, records who approved it, and gives the team one place to see the result. That only works if the artifact itself stays stable across every environment.

## Build Once, Promote the Same Artifact
<!-- section-summary: The same immutable artifact should move through staging and production so production runs what staging already tested. -->

An **artifact** is the packaged output of a build. For a backend service, that artifact might be a Docker image, a JAR file, a Go binary, or a zipped serverless function bundle. An artifact should represent one specific version of the application that the pipeline can store, verify, and deploy.

An **immutable artifact** keeps the same bytes after the build creates it. A container image digest is a good example. The tag `booking-api:2026-06-13` is a friendly label, but the digest `sha256:8c2f...` points to exact image bytes. If the digest stays the same, the runtime receives the same filesystem layers and application code.

The core CD rule is **build once, promote the same artifact**. CI builds `booking-api` once from commit `9f4c2a1`, pushes the image to the registry, and records the digest. The staging deployment uses that digest. The production deployment uses that same digest after staging passes and the production gate receives approval.

![Build once promote one digest showing commit, CI image build, image digest, staging, smoke tests, approval gate, and production](/content-assets/articles/article-cicd-fundamentals-continuous-delivery/build-once-promote-digest.png)

*Build-once promotion keeps staging and production tied to the same immutable image digest, so release evidence points at the thing users actually receive.*

A common mistake is rebuilding for each environment. The staging job builds an image from the commit and deploys it. Later, the production job checks out the same commit and builds again. The source commit matches, but the output can still change because a base image moved, a package registry returned a newer dependency, or a build script read a different environment variable.

That mistake creates a nasty question during incidents. Did staging actually test the thing now running in production? Build-once promotion gives a clean answer. Production runs the same image digest that staging already used, so the team can focus on environment data, configuration, traffic, and runtime behavior instead of wondering whether two builds produced different bytes.

Now a new question appears. If staging and production use the same image, how does the application connect to different databases and partner APIs?

## Runtime Configuration and Secrets
<!-- section-summary: Runtime configuration lets one artifact run in different environments without rebuilding it. -->

**Configuration** means values that change between deployments while the application code stays the same. Database URLs, Redis hosts, feature flag keys, partner API endpoints, log levels, and public hostnames all count as configuration. **Secrets** are sensitive configuration values, such as passwords, API tokens, signing keys, and private credentials.

The Twelve-Factor App guidance explains this idea clearly: config belongs in the environment because config changes between deploys while code stays stable. In practical CD work, the image for `booking-api` contains application code, dependency files, and startup commands. Production database passwords and staging API endpoints live outside the image in environment-owned configuration.

Northstar's staging deployment injects staging values at runtime. These values point the same image at sandbox-style systems where the team can test behavior without touching real customers. The staging environment values look like this:

```bash
DATABASE_URL=postgres://booking_staging:***@staging-db.internal:5432/bookings
PAYMENT_PROVIDER_URL=https://sandbox-payments.example.com
FEATURE_DISCOUNT_CODES=true
```

The production deployment injects production values into the same image digest. The variable names stay consistent, while the values point to production systems. The production environment values look like this:

```bash
DATABASE_URL=postgres://booking_prod:***@prod-db.internal:5432/bookings
PAYMENT_PROVIDER_URL=https://payments.example.com
FEATURE_DISCOUNT_CODES=true
```

The application reads these values at startup. In Node.js, the code might use `process.env.DATABASE_URL`. In Python, it might use `os.environ["DATABASE_URL"]`. In Kubernetes, the values might come from a `Secret` or `ConfigMap`, and the deployment manifest maps those values into container environment variables.

```yaml
env:
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: booking-api-db
        key: database-url
  - name: PAYMENT_PROVIDER_URL
    valueFrom:
      configMapKeyRef:
        name: booking-api-config
        key: payment-provider-url
```

This separation gives the team two useful controls. The artifact stays stable, so staging and production run the same code. The environment owns its own runtime values, so staging can safely point to a sandbox payment provider while production points to the real provider.

![Runtime config boundary showing one image digest with separate staging and production values injected outside the image](/content-assets/articles/article-cicd-fundamentals-continuous-delivery/runtime-config-boundary.png)

*Runtime configuration lets the same release artifact run in different environments while secrets and environment-specific values stay outside the image.*

Configuration also needs ownership. Platform teams usually store environment values in a secrets manager, CI/CD environment settings, or Kubernetes secrets managed through a secure process. Developers can change code through pull requests, while production secret changes require a smaller set of trusted people and a clear audit trail.

Once the artifact and runtime configuration are separated, the pipeline can promote the release through environments. The next step is deciding which environments the artifact must pass through before real users see it.

## Promotion Environments and Approval Gates
<!-- section-summary: Promotion pipelines move the same artifact through controlled environments with automated checks and human approvals where needed. -->

An **environment** is a named place where the application runs with a specific purpose. Development catches early integration problems. Staging should look close to production and gives the team a place to test the real release artifact. Production serves real users and carries the highest risk.

**Promotion** means moving the same artifact from one environment to the next. The pipeline uses the recorded digest again instead of creating a new build. The target environment then runs that digest with its own configuration and secrets.

**Approval gates** add a controlled pause before a sensitive step. GitHub Actions environments, for example, can require deployment protection rules before a job that references an environment proceeds. A production environment can require reviewers, wait timers, branch restrictions, or custom checks from another system.

Here is a simplified GitHub Actions release pipeline for `booking-api`. It starts from an image digest that already exists, then deploys that same digest to staging before production. A short version looks like this:

```yaml
name: booking-api-release

on:
  workflow_dispatch:
    inputs:
      image_digest:
        required: true
        type: string

jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to staging
        run: ./scripts/deploy.sh staging "${{ inputs.image_digest }}"
      - name: Run staging smoke tests
        run: ./scripts/smoke-test.sh https://staging-booking.example.com

  deploy-production:
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to production
        run: ./scripts/deploy.sh production "${{ inputs.image_digest }}"
      - name: Run production smoke tests
        run: ./scripts/smoke-test.sh https://booking.example.com
```

The `needs: deploy-staging` line creates the dependency. Production waits for staging to finish successfully. The `environment: production` line connects the job to the platform's production rules, so required reviewers can inspect the release before the job receives production secrets and starts the deployment.

This is where continuous delivery is more than a YAML file. The approval screen should show useful evidence: image digest, commit SHA, pull request links, test results, staging smoke-test result, migration summary, and release notes. The approver should review a small release packet rather than guess from a job name.

Promotion controls reduce the blast radius of a bad change. **Blast radius** means the amount of damage a failure can cause. A broken deployment in staging affects testers and internal workflows. A broken deployment in production affects customers, revenue, and trust. The pipeline uses environments, checks, and approvals to catch problems before the blast radius grows.

After the production gate opens, the deployment still needs runtime safety checks. A successful file copy or Kubernetes apply command proves that the platform received the desired change. Health checks prove that the application can serve traffic.

## Health Checks and Rollout Deadlines
<!-- section-summary: Health checks teach the platform when a new version can receive traffic and when a rollout should stop. -->

A **health check** is a small test the platform runs against the application while it starts and while it keeps running. In a web service, this is often an HTTP endpoint such as `/healthz` or `/readyz`. The endpoint should report whether the application can do the work users need, including more than simple process existence.

Kubernetes uses a few probe types that show up in many production CD systems. A **readiness probe** decides whether a pod can receive traffic from services. A **liveness probe** decides whether the container has become stuck and should restart. A **startup probe** gives slow-starting applications extra time before liveness checks begin.

For `booking-api`, the readiness endpoint should verify that the service can accept traffic. It might check that the HTTP server has started, required configuration exists, database migrations are compatible, and the payment provider client can initialize. The liveness endpoint should stay simpler because a failed liveness check restarts the container, and aggressive restarts can make an outage worse.

```yaml
readinessProbe:
  httpGet:
    path: /readyz
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 6
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 30
  periodSeconds: 10
  failureThreshold: 3
```

A **rollout deadline** gives the deployment a time limit for progress. Kubernetes has `progressDeadlineSeconds` on Deployments. If the new ReplicaSet misses the deadline, Kubernetes reports a failed rollout condition. Higher-level deployment tooling can then mark the pipeline as failed, send notifications, and trigger the team's rollback policy.

```yaml
spec:
  progressDeadlineSeconds: 600
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
```

The `maxUnavailable: 0` setting tells Kubernetes to keep the current capacity available during the update. The `maxSurge: 1` setting allows one extra pod above the desired count while the new version proves itself. These values cost a little extra capacity during rollout, but they protect customers from a release that removes healthy pods too early.

Health checks turn deployment from "the command succeeded" into "the new version can serve traffic." That distinction is very clear during a failed rollout.

## A Rollout That Fails Safely
<!-- section-summary: A safe rollout blocks broken new pods before they take customer traffic. -->

Imagine the discount-code fix passed unit tests and staging smoke tests. The production approver reviews the release packet and approves the job. The pipeline updates the Kubernetes Deployment to use image digest `sha256:8c2f...`, and Kubernetes starts one new pod because the rolling update allows a small surge.

The pipeline waits for the rollout. This command gives the release job a clear success or failure result instead of leaving the team to interpret scattered dashboard signals. The pipeline log then looks like this:

```bash
$ kubectl rollout status deployment/booking-api -n production --timeout=10m
Waiting for deployment "booking-api" rollout to finish: 0 of 4 updated replicas are available...
Waiting for deployment "booking-api" rollout to finish: 0 of 4 updated replicas are available...
error: deployment "booking-api" exceeded its progress deadline
```

The release failed, and the failure still protected customers. The old pods still serve users because the new pod never passed readiness. The platform kept customer traffic on the previous version. The pipeline now needs diagnosis rather than panic.

The engineer checks the pods next. The label selector narrows the output to `booking-api`, so the release diagnosis stays focused. The output shows old and new pods together:

```bash
$ kubectl get pods -n production -l app=booking-api
NAME                           READY   STATUS             RESTARTS   AGE
booking-api-8467b96d6f-j8q2l   0/1     CrashLoopBackOff   5          5m
booking-api-6dc9fd79c7-p9x7r   1/1     Running            0          12d
booking-api-6dc9fd79c7-r4m2n   1/1     Running            0          12d
booking-api-6dc9fd79c7-t6h8s   1/1     Running            0          12d
booking-api-6dc9fd79c7-v1k3m   1/1     Running            0          12d
```

`CrashLoopBackOff` means the container starts, crashes, and Kubernetes waits before trying again. The new pod has zero readiness because it never stays alive long enough to serve traffic. The old ReplicaSet still has four ready pods, so customers continue using the previous version.

The engineer inspects logs from the failed pod. The application error now points to the startup reason rather than only the rollout symptom. The log output gives the missing config key:

```bash
$ kubectl logs booking-api-8467b96d6f-j8q2l -n production
Error: required environment variable PAYMENT_PROVIDER_URL is missing
    at loadConfig (/app/dist/config.js:17:11)
    at startServer (/app/dist/server.js:41:18)
```

The code expected `PAYMENT_PROVIDER_URL`, but the production environment settings used the old key name `PAYMENTS_URL`. The image worked in staging because staging had both keys during a previous migration. Production only had the old key, so the application crashed at startup.

This failure teaches an important CD lesson. The artifact promotion path was correct, and the health checks protected traffic. The weak part was configuration compatibility between environments. The team can fix the production environment value, rerun the same image digest, and add a preflight config check to the staging smoke test so the same mistake shows up earlier next time.

Some failures pass startup checks and still hurt users. A discount calculation bug might return the wrong price while every pod stays healthy. That is where recovery design matters.

## Rollback and Recovery
<!-- section-summary: Recovery design gives the team a fast path back to a known-good version during an incident. -->

**Rollback** means returning production to a previous known-good version. In a CD system, rollback should redeploy an artifact the team already built, stored, and used before. A fresh build during an incident introduces new inputs at the worst possible time, so the recovery path should reuse a known artifact.

**Roll forward** means shipping a new fix that corrects the problem. This can work for small defects with a clear patch. During a customer-facing incident, roll forward still has to pass CI, review, deployment, and health checks. The users keep experiencing the bug while the team builds the fix.

Teams often measure recovery with **MTTR**, which means mean time to restore or mean time to recovery. The practical goal is simple: production should return to a healthy user experience quickly. DORA uses restore time and change failure rate as part of the delivery performance picture because deployment speed alone gives an incomplete view.

For `booking-api`, a release record should contain the current digest and the previous digest. That record gives the rollback job a specific target instead of relying on memory during an incident. A small release record can look like this:

```yaml
service: booking-api
environment: production
currentDigest: ghcr.io/northstar/booking-api@sha256:8c2f...
previousDigest: ghcr.io/northstar/booking-api@sha256:31b7...
approvedBy: release-manager@northstar.example
deployedAt: "2026-06-13T10:30:00Z"
```

The rollback job can use that record to target the previous digest. It deploys through the same automation path as the original release, so recovery still has logs and rollout checks. The command path can look like this:

```bash
$ ./scripts/deploy.sh production ghcr.io/northstar/booking-api@sha256:31b7...
$ kubectl rollout status deployment/booking-api -n production --timeout=10m
deployment "booking-api" successfully rolled out
```

Kubernetes also supports Deployment revision rollback through `kubectl rollout undo`. Many teams still prefer digest-based rollback in their CD tool because it creates a clear release record across clusters, dashboards, approvals, and audit logs. The important property is the same: recovery uses an artifact the system already knows.

Database changes need extra care because schema migrations can make code rollback risky. A strong CD process uses backward-compatible migration patterns, such as adding a nullable column first, deploying code that writes both old and new fields, backfilling data, switching reads, and removing the old field in a later release. This pattern lets the application roll backward during the transition while the database still supports both code versions.

A good rollback plan also defines who can trigger recovery. During business hours, the on-call engineer might trigger rollback after confirming a customer-impacting metric. During a regulated release, the release manager might approve rollback while the incident commander coordinates customer updates. The plan belongs inside the CD process and the release runbook, where the whole team can find it.

Rollback completes the release path that started with build-once promotion. The team can move forward with confidence because it also has a rehearsed way to move back.

## Putting It All Together
<!-- section-summary: Continuous delivery combines stable artifacts, controlled environments, runtime checks, and recovery into one release system. -->

Let's connect the pieces through the `booking-api` release. CI builds one image from commit `9f4c2a1`, pushes it to the registry, and records the digest. The CD pipeline deploys that digest to staging with staging configuration, runs smoke tests, and collects release evidence.

After staging passes, the production job waits at an approval gate. The approver sees the commit, digest, test status, staging result, migration notes, and rollback target. They approve the job, and the pipeline deploys the same digest to production with production configuration and secrets.

Kubernetes starts a rolling update. Readiness checks decide which pods can receive traffic. Liveness checks restart stuck containers. The rollout deadline gives the pipeline a clear failure signal if the new version misses progress. Observability tools watch customer-facing metrics after the rollout because a healthy process can still contain a business bug.

The release record keeps the previous known-good digest. If the new version causes customer impact, the team can rollback through the same CD system instead of inventing a manual recovery path. The rollback receives the same monitoring, audit trail, and rollout checks as the original deployment.

These practices form the everyday CD checklist. **Automation** removes hand-built production changes. **Immutable artifacts** make staging evidence meaningful. **Runtime configuration** lets one artifact run safely in multiple environments. **Promotion gates** control risk before production. **Health checks** keep broken pods away from users. **Rollback design** lowers recovery time when a real defect reaches production.

![Continuous Delivery summary showing immutable artifact, runtime config, staging checks, approval gate, health probes, rollback target, release evidence, and repeatable path](/content-assets/articles/article-cicd-fundamentals-continuous-delivery/continuous-delivery-summary.png)

*A continuous delivery path combines stable artifacts, environment-owned configuration, approval evidence, health checks, and a known rollback target.*

Continuous delivery turns release work into normal engineering work. The team can ship during the day, read the evidence, approve the release, watch the system, and recover through a known path. That is the real value: production changes become visible, repeatable, and easy to review.

## What's Next
<!-- section-summary: The next article adds security checks to the delivery path so fast releases also protect the software supply chain. -->

The release path now has structure: build once, promote the same artifact, inject configuration, approve production, verify health, and recover quickly. That structure gives the team speed, but speed also gives mistakes less time to hide.

The next article, **Securing the Pipeline**, adds security gates to this delivery path. It covers secret scanning, dependency scanning, SAST, DAST, SBOMs, image signing, and provenance so the pipeline can protect the software supply chain before a release reaches production.

---

**References**

- [Continuous Delivery](https://continuousdelivery.com/) - Defines continuous delivery as getting changes into production or users' hands safely, quickly, and sustainably.
- [DORA: Continuous delivery](https://dora.dev/capabilities/continuous-delivery/) - Explains continuous delivery as an on-demand, low-risk release capability and connects it to delivery performance.
- [GitHub Actions deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments) - Documents environment protection rules, required reviewers, wait timers, environment secrets, and deployment restrictions.
- [The Twelve-Factor App: Config](https://12factor.net/config) - Explains why deploy-specific configuration belongs in environment variables instead of application code.
- [Kubernetes liveness, readiness, and startup probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) - Documents probe behavior for traffic readiness, restarts, and startup protection.
- [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) - Documents Deployment rollout behavior, progress deadlines, failed rollout conditions, and revision history.
- [kubectl rollout status](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_rollout/kubectl_rollout_status/) - Documents how rollout status watches a Deployment until completion or timeout.
