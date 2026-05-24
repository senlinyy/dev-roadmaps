---
title: "Continuous Delivery"
description: "Learn the differences between delivery and deployment, how stateless artifacts promote across environments, and how to build automated rollback pipelines."
overview: "Automated application releases require immutable promotion paths. This article explains the difference between delivery and deployment, the build-once rule, environment secret injections, and recovery-first rollbacks."
tags: ["delivery", "environments", "rollbacks", "architecture", "deployment"]
order: 3
id: article-cicd-fundamentals-continuous-delivery
aliases:
  - continuous-delivery
  - article-cicd-fundamentals-continuous-delivery
  - cicd/fundamentals/continuous-delivery.md
---

## Table of Contents

1. [Continuous Delivery as an Operational Discipline](#continuous-delivery-as-an-operational-discipline)
2. [The Boundary: Continuous Delivery vs. Continuous Deployment](#the-boundary-continuous-delivery-vs-continuous-deployment)
3. [The Operational Failures of Manual Releases](#the-operational-failures-of-manual-releases)
4. [The Golden Rule: Build Once, Deploy Everywhere](#the-golden-rule-build-once-deploy-everywhere)
5. [Stateless Artifacts: Configuration and Secret Injection](#stateless-artifacts-configuration-and-secret-injection)
6. [Anatomy of the Environment Promotion Pipeline](#anatomy-of-the-environment-promotion-pipeline)
7. [Detecting Outages: Health Checks and Progress Deadlines](#detecting-outages-health-checks-and-progress-deadlines)
8. [Common Rollout Failure: The Crash-Looping Container](#common-rollout-failure-the-crash-looping-container)
9. [Designing for Recovery: Instant Rollbacks and MTTR](#designing-for-recovery-instant-rollbacks-and-mttr)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## Continuous Delivery as an Operational Discipline

Continuous Integration (CI) guarantees that your application code is tested, validated, and securely packaged. However, a verified package sitting in a container registry provides no value to your customers. To deliver value, the package must be deployed to servers where it can execute.

Continuous Delivery (CD) is the engineering practice of automating the entire software release lifecycle so that your application can be deployed to production at any time, simply by clicking a button. 

When an organization achieves Continuous Delivery, deployments become routine, non-events. We deploy code on Tuesday afternoons without system outages or team anxiety. There are no "release weekends" or midnight maintenance windows because the automated pipeline executes the exact same deployment steps on every release.

## The Boundary: Continuous Delivery vs. Continuous Deployment

In platform engineering, the acronym "CD" represents two distinct release models. We separate them based on the role of human approval:

* **Continuous Delivery**: Every code change that passes the automated CI validation is packaged, stored as an immutable artifact, and immediately deployed to a staging environment for validation. The promotion of this artifact to production is fully automated, but a human must explicitly approve the final release step (such as clicking a "Deploy to Production" button). This model is common in industries (such as financial or healthcare systems) that require manual business audits, compliance sign-offs, or marketing synchronization.
* **Continuous Deployment**: Every code change that passes the automated CI validation is automatically deployed directly to the production environment without human intervention. A developer merges a pull request, and ten minutes later the new code is live for real users.

Continuous Deployment requires a mature automated testing infrastructure. If your unit or integration tests are flaky, incomplete, or easily bypassed, buggy code will deploy directly to production and cause an immediate incident. Because of this risk, most organizations start with Continuous Delivery and maintain human approval gates for production promotions.

## The Operational Failures of Manual Releases

To understand the value of automated Continuous Delivery, we must trace how manual release models fail.

Consider a legacy deployment process:

First, a developer opens an SSH (Secure Shell) connection to a production server.

Second, they execute `git pull` to fetch the latest code from the repository.

Third, they run `npm install` to update the dependencies on the disk.

Fourth, they execute a system command to restart the application process.

This manual sequence introduces three major operational failures:

First, it is **unrepeatable**. If the engineer forgets to run the dependency install command, or pulls the wrong git tag, the application will crash.

Second, it is **unscalable**. While SSHing into a single server takes two minutes, executing the same sequence of commands across fifty servers behind a load balancer is impossible without introducing configuration mismatches.

Third, it creates **environment drift**. Over time, the production server becomes a unique "snowflake." An engineer logs in to apply a temporary hotfix, modifies a local system configuration, but fails to record the change in code. When the server eventually dies, provisioning a new one fails because the undocumented local adjustment is missing.

Continuous Delivery resolves these failures by forcing all deployments through automated pipelines. The pipeline executes identical commands on every run, documents every change in Git, and treats servers as disposable resources.

## The Golden Rule: Build Once, Deploy Everywhere

If there is one absolute rule in Continuous Delivery, it is this: **never compile or rebuild your application artifact for a new environment.**

A common pipeline mistake is to compile separate builds based on Git branches:
* Code merged to `staging` branch -> Pipeline runs webpack build -> Deploys to Staging.
* Code merged to `main` branch -> Pipeline runs webpack build again -> Deploys to Production.

This is a serious operational risk. Staging and production are running different artifacts. Even if both builds are compiled from the exact same Git commit SHA, the production build may differ because of a base container image update, a minor package version change, a compiler environment drift, or a difference in build-time inputs.

If you rebuild for production, you are deploying code that has never been tested in staging.

```mermaid
flowchart TD
    Commit["Commit SHA"] --> Build["1. Compile Once<br/>(CI Runner)"]
    Build --> Registry["2. Push Image<br/>(Registry)"]
    Registry --> Staging["3. Deploy to Staging"]
    Staging --> Validate["4. Validate & Test"]
    Validate --> Production["5. Promote to Prod"]
```

We solve this by enforcing the **Build Once, Deploy Everywhere** rule. The CI runner compiles the application once, packages it into an immutable container image tagged with the Git commit SHA, and pushes it to a secure registry. 

The CD pipeline deploys this exact image to staging, runs the integration tests, and then promotes the **identical container image** to production. This guarantees that the bytes running in production are the exact bytes tested in staging.

## Stateless Artifacts: Configuration and Secret Injection

If you deploy the identical container image to both staging and production, how does the application know which database to connect to without embedding different configuration files inside the image?

The application must be completely stateless, and all configuration details must be injected at runtime.

A container image must never contain environment-specific details, database connection strings, API keys, or access credentials. Instead, the application reads these values from standard **Environment Variables** injected by the CD pipeline at the moment of deployment.

For example, when the CD pipeline deploys the image to the staging cluster, it fetches credentials from the staging secrets vault and injects them:

```bash
DATABASE_URL=postgres://staging-user:pass@staging-db.internal.example.com:5432/testdb
```

When the pipeline promotes the identical image to production, it fetches credentials from the production vault:

```bash
DATABASE_URL=postgres://prod-user:pass@prod-db.internal.example.com:5432/ordersdb
```

This ensures that the application code remains agnostic to its execution environment, and prevents developers from accidentally exposing production credentials in staging configurations.

## Anatomy of the Environment Promotion Pipeline

An automated promotion pipeline enforces a strict progression through isolated environments to control the **blast radius** of a release (the scale of potential customer damage if a bug is deployed).

Consider a declarative promotion pipeline structure:

```yaml
name: Application Release Pipeline

on:
  release:
    types: [published]

jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - name: Deploy Image to Staging
        run: ./deploy.sh --env staging --version ${{ github.event.release.tag_name }}

  deploy-production:
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Deploy Image to Production
        run: ./deploy.sh --env production --version ${{ github.event.release.tag_name }}
```

The `needs: deploy-staging` instruction creates a non-bypassable dependency gate. The production deployment cannot execute unless the staging job completes successfully. 

The `environment: production` declaration triggers the manual approval workflow. The CI/CD platform halts execution, sends an alert to the release coordinators, and waits for a verified manager to click the approval button in the UI before promoting the image.

## Detecting Outages: Health Checks and Progress Deadlines

Continuous Delivery does not end when files are copied to a server. The pipeline must verify that the new application version is running and healthy before routing user traffic to it. We achieve this by configuring **Health Checks** and **Progress Deadlines**.

When the CD pipeline deploys a container, it tells the orchestrator (such as Kubernetes) to monitor the application's health. The orchestrator regularly sends HTTP GET requests to a designated path (such as `/api/health`).

The orchestrator enforces two critical gates:
* **Readiness Probes**: Verifies that the container is ready to accept user requests. The load balancer only routes traffic to the container when the readiness path returns an HTTP status of 200.
* **Liveness Probes**: Verifies that the container is still alive. If the container freezes or enters a deadlocked state, the liveness probe fails, and the orchestrator automatically restarts the container.

Additionally, the pipeline configures a **Progress Deadline** (such as 10 minutes). If the orchestrator deploys a new container version, but the container fails to pass its readiness checks within the deadline window, the orchestrator halts the rollout, prevents the old container version from being terminated, and marks the deployment job as failed.

## Common Rollout Failure: The Crash-Looping Container

Let us look at a common deployment failure mode: the **Crash-Looping Container**.

An engineer configures a new database connection library in the application code. They run tests locally, the CI pipeline passes, and the CD pipeline triggers a production deployment. 

The deployment log shows a progress deadline timeout:

```text
> deploy.sh --env production --version v1.18.2

Authenticating to production cluster... Success.
Applying deployment manifests...
deployment.apps/orders-api configured
Waiting for deployment "orders-api" rollout to finish: 0 of 3 updated replicas are available...
Waiting for deployment "orders-api" rollout to finish: 1 of 3 updated replicas are available...
error: deployment "orders-api" exceeded its progress deadline
Error: Process completed with exit code 1.
```

The pipeline tells us only that the rollout timed out. To diagnose the failure, the engineer must query the orchestrator for the pod status:

```text
$ kubectl get pods -n production
NAME                          READY   STATUS             RESTARTS      AGE
orders-api-7a9f26e4-abc12     0/1     CrashLoopBackOff   5 (40s ago)   3m12s
orders-api-31b7c0a9-xyz78     1/1     Running            0             14d
```

The new pod is in a **CrashLoopBackOff** state. The container started, immediately crashed, and the orchestrator is waiting before attempting to restart it again. 

Because the new pod never reached a `READY` state, the load balancer continued to route 100% of user traffic to the old, healthy pod (`orders-api-31b7c0a9`). The blast radius of the failure was zero because the health check system blocked the rollout.

To find the root cause, the engineer inspects the logs of the crashed container:

```text
$ kubectl logs orders-api-7a9f26e4-abc12 -n production
Error: Connection failed to host 'postgres-prod.internal.example.com'.
    at Client.connect (src/db.js:14:12)
    at Object.<anonymous> (src/app.js:28:4)

Connection Refused: check your environment variables.
```

The log reveals the issue: the production database URL environment variable was misspelled in the pipeline secrets configuration, preventing the application from connecting on startup. 

The developer corrects the secret in the CD vault and re-runs the pipeline. The new container connects successfully, passes its readiness probe, and the orchestrator replaces the old containers.

## Designing for Recovery: Instant Rollbacks and MTTR

Even with robust health checks, a logical bug (such as an incorrect tax calculation) will occasionally pass all gates and reach production. When a critical bug is active, you have two recovery pathways:

First, **Roll Forward**. Frantically write a code fix on your laptop, commit it, wait ten minutes for the CI pipeline to run, wait for peer review, and deploy the new version. During this entire time, your users continue to experience the bug.

Second, **Roll Back**. Instruct the CD system to immediately redeploy the previous, known-good container image digest.

In platform engineering, we optimize for **Mean Time to Recovery (MTTR)** over **Mean Time Between Failures (MTBF)**. We accept that failures will eventually happen. Our primary goal is to minimize the duration of the outage.

If you follow the golden rule of building once and promoting immutable images, a rollback is instant and risk-free. The CD system does not recompile code; it simply re-targets the deployment manifest to point to the previous container image digest (`ghcr.io/devpolaris/orders-api@sha256:31b7c0a9...`). 

The load balancer routes traffic back to the trusted version within seconds, restoring production to a healthy state while the engineering team investigates the bug offline.

## Putting It All Together

Continuous Delivery transforms the high-risk, manual release process into a predictable and automated pipeline. By enforcing the build-once rule, separating configurations from immutable artifacts, utilizing manual approval gates for environment promotion, configuring readiness health probes, and designing for instant rollbacks, organizations protect their production perimeters while maintaining delivery speed.

When configuring and auditing your Continuous Delivery pipelines, ensure you enforce these five core practices:

First, mandate total automation of deployments. Never allow manual modifications, process restarts, or direct SSH code updates on staging or production servers.

Second, build once and deploy everywhere. Never recompile code or build different container images for different environments; promote identical, immutable images.

Third, isolate your configurations. Strip all connection strings, secrets, and URLs from your container images, injecting them as environment variables at the moment of deployment.

Fourth, enforce automated health checks. Configure readiness probes on all workloads, and establish strict progress deadlines to block broken rollouts before they affect users.

Fifth, prioritize MTTR with automated rollbacks. Design your CD platform to support single-click, instant redeployments of previous, known-good container image digests during active incidents.

## What's Next

Automating your deployment pipeline ensures that release operations are repeatable and fast. However, shifting code rapidly to production introduces severe security risks. In the next chapter, **Securing the Pipeline**, we will explore how to shift security left by scanning code repositories for secrets, executing static and dynamic scans, generating Software Bills of Materials (SBOMs), and signing images cryptographically.

---

**References**

- [Continuous Delivery: Reliable Software Releases by Jez Humble and David Farley](https://continuousdelivery.com/) - The foundational textbook defining the patterns, practices, and architecture of CD.
- [Twelve-Factor App: Store Config in the Environment](https://12factor.net/config) - Architectural standards for separating configuration from application artifacts.
- [Kubernetes Readiness and Liveness Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/) - Technical specifications for configuring health gates in container orchestrators.
- [DORA Metrics: Accelerate State of DevOps Report](https://cloud.google.com/devops) - Research on how MTTR, deployment frequency, and change failure rate drive organizational performance.
