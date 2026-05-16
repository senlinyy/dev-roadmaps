---
title: "Container Apps"
description: "Run containerized Azure services by understanding environments, container apps, images, revisions, ingress, scale rules, secrets, identity, and logs."
overview: "Azure Container Apps is a managed container runtime for teams that want to run containers without making Kubernetes the first operating surface. This article explains the nouns that matter when a container becomes a live service."
tags: ["azure", "container-apps", "containers", "revisions", "scale"]
order: 3
id: article-cloud-providers-azure-compute-application-hosting-azure-container-apps
aliases:
  - azure-container-apps
  - cloud-providers/azure/compute-application-hosting/azure-container-apps.md
---

## Table of Contents

1. [The Problem](#the-problem)
2. [What Is Container Apps](#what-is-container-apps)
3. [Environment](#environment)
4. [Container App](#container-app)
5. [Image And Registry](#image-and-registry)
6. [Revisions](#revisions)
7. [Ingress](#ingress)
8. [Scaling](#scaling)
9. [Secrets And Identity](#secrets-and-identity)
10. [Logs](#logs)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## The Problem

The checkout team now builds a container image for the API. The image runs locally. It exposes port `3000`, reads settings from environment variables, and writes logs to standard output. The team wants Azure to run it without making Kubernetes the first production lesson.

The container solves packaging, but it does not answer hosting questions:

- Where does the container app live, and which network and log workspace surround it?
- Which image tag is running right now?
- What happens when a new image is deployed?
- Which port receives external traffic?
- Can the service scale down when idle without losing required background work?

Azure Container Apps is for this middle ground. The team brings an image. Azure gives a managed container app shape around it: environment, app, revisions, ingress, scaling, secrets, identity, and logs.

## What Is Container Apps

Azure Container Apps is a managed service for running containers and microservices. You do not create a Kubernetes cluster directly. You create container apps inside an Azure Container Apps environment, deploy images, expose ingress when needed, and define scale behavior.

That makes Container Apps feel close to the beginner problem solved by ECS on Fargate in AWS: "I have a container and want it to run without managing servers." The comparison helps, but the Azure nouns are different. Learn the Azure model directly.

A container app has a practical runtime contract:

| Runtime need | Container Apps noun |
| --- | --- |
| Shared boundary for apps | Environment |
| Deployed service | Container app |
| Packaged artifact | Container image |
| Versioned app template | Revision |
| HTTP or TCP entry | Ingress |
| Scale behavior | Scale rule and replica count |
| Protected values | Secrets |
| Azure caller identity | Managed identity |
| Runtime evidence | Logs and metrics |

The service is not a container image validator. If the image cannot start, listens on the wrong port, or needs a setting that is not present, Container Apps will faithfully run a failing container. The image contract still belongs to the team.

## Environment

A Container Apps environment is the boundary around one or more container apps. It provides the managed runtime context, networking scope, and log destination for the apps inside it. In many small systems, one environment holds a related set of APIs and workers for one product and stage.

The environment matters because it is not just a folder. It affects how apps inside it communicate, where logs go, and how the platform is configured. A production environment and a staging environment should usually be separate so their network, identities, secrets, and logs do not blur.

For the checkout API, an environment name such as `cae-orders-prod-eus` tells a human three useful things: it is a Container Apps environment, it belongs to orders production, and it sits in East US. The name is not the boundary by itself, but good names make the boundary easier to inspect.

## Container App

The container app is the Azure resource that runs the service. It points to an image, carries runtime settings, owns ingress configuration, holds scale rules, and creates revisions when the application template changes.

Do not confuse the environment with the app. The environment is the neighborhood. The container app is the service. Several container apps can live in one environment, such as `orders-api`, `orders-worker`, and `receipt-renderer`.

A small runtime record makes the resource easy to read:

```text
Environment: cae-orders-prod-eus
Container app: ca-orders-api-prod
Image: acrorders.azurecr.io/orders-api:2026-05-16.7
Target port: 3000
Ingress: external HTTPS
Min replicas: 1
Max replicas: 10
Identity: system-assigned managed identity
Secrets:
  database-url
  stripe-webhook-secret
```

If an incident starts with "Container Apps is down," this record turns that sentence into inspectable pieces. Which image is running? Which port is exposed? How many replicas are desired? Did the latest revision receive traffic? Which settings and secrets are required?

## Image And Registry

The image is the deployable artifact. It contains the application files, dependencies, and startup command. A registry stores and serves that image to the platform.

Container Apps expects the image to be runnable. That means the process should start without interactive setup, listen on the configured port if it is serving traffic, write logs to standard output or standard error, and exit clearly when it cannot start. If the image assumes a local file that was not copied into the image, or hardcodes a development port, Azure will expose the mistake rather than repair it.

Tags deserve care. A tag such as `latest` is convenient for a demo but weak evidence in production. A build number, commit SHA, date-based tag, or immutable digest makes a revision easier to audit. When someone asks what changed, the image reference should help answer.

## Revisions

A revision is a versioned snapshot of a container app's application template. When you change revision-scope properties, such as the image or certain runtime settings, Container Apps can create a new revision. Traffic can then move between revisions depending on the app's revision mode and traffic weights.

This is one of the most important differences between "the app resource" and "the running version." The container app name may stay the same while the active revision changes underneath it. A rollout question should ask which revision is active, which image it runs, whether it is healthy, and how traffic is assigned.

Revisions make safer releases possible. A new revision can start, fail, or receive only part of the traffic while the previous revision remains available. They also create cleanup work. Old revisions are useful for rollback and evidence, but stale revisions can confuse humans if nobody knows which ones are active.

## Ingress

Ingress decides whether and how traffic reaches the container app. For an HTTP API, ingress usually defines external or internal exposure and the target port inside the container. If ingress points to the wrong port, the container can be healthy from its own point of view while users cannot reach it.

External ingress means the app can receive traffic from outside the environment through a public endpoint. Internal ingress keeps traffic inside the environment or virtual network integration boundary. The right choice depends on the architecture. A public API may need external ingress. A private worker API usually should not.

Ingress is not the whole security model. It is the front door shape. You still need identity, app-level authorization, network design, and secrets handled correctly. But ingress is the first place to look when the complaint is "the container runs, but nobody can reach it."

## Scaling

Container Apps can scale replicas based on rules such as HTTP concurrency, event sources, CPU, memory, and other KEDA-supported signals. A replica is a running copy of the container app revision. Minimum and maximum replica counts define the floor and ceiling.

The scale-to-zero story is useful but easy to overgeneralize. Some workloads can safely run with zero replicas until traffic or an event arrives. Others need at least one warm replica for latency, connection setup, background loops, or because the chosen metric requires a running replica to observe it. CPU and memory based scaling cannot measure a stopped container.

For the checkout API, a production setup may keep `minReplicas: 1` so the first customer request does not pay a cold start penalty. A background worker that processes queue messages may scale to zero when the queue is empty. The cost choice should be visible: always warm costs more; cold start and event wakeup can cost latency.

## Secrets And Identity

Container Apps secrets store sensitive values for the container app. Environment variables can reference those secrets so the container receives the value at runtime. This is better than baking a password into an image, because the same image can move between environments while secrets stay environment-specific.

Managed identity gives the container app an Azure identity. That identity can access Azure services if the target service grants it permission. This is the preferred shape for calls to protected Azure resources because the container does not need a long-lived cloud credential inside the image.

Secrets and identity solve different problems. A secret is a protected value. An identity is who the app is when it calls Azure. Many production apps use both: a managed identity to read Key Vault or Storage, and a few Container Apps secrets for values that must be injected directly.

## Logs

Container Apps collects platform and console logs so you can inspect what the container printed and how the platform handled it. The useful beginner habit is to write application logs to standard output and standard error. Do not hide the real startup failure in a local file inside the container.

When a new revision fails, read logs next to revision state. A log line that says `Missing DATABASE_URL` means the image likely started and failed during configuration. A state that says the revision never became ready may point at startup, probe, port, or dependency behavior. The point is to tie the evidence to the platform noun: image, revision, replica, ingress, secret, identity, or scale rule.

## Putting It All Together

The opener had a runnable container but no hosting model. Container Apps gives that model clear pieces.

The environment is the shared boundary. The container app is the service. The image is the artifact. The revision is the versioned runtime template. Ingress decides how traffic reaches the app. Scale rules decide how many replicas run. Secrets and identity decide how the app receives protected values and calls Azure services. Logs tell you what the app and platform did after deployment.

That is why Container Apps is a good first managed container runtime for many teams. It keeps the container packaging model while avoiding a full Kubernetes operating surface. The team still owns the image quality, settings, ports, health behavior, identity permissions, and release evidence.

## What's Next

Next we will look at Functions, where the runtime is shaped less by an always-on service and more by the event that wakes the code.

---

**References**

- [Azure Container Apps overview](https://learn.microsoft.com/en-us/azure/container-apps/overview)
- [Revisions in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/revisions)
- [Set scaling rules in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/scale-app)
- [Manage secrets in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets)
