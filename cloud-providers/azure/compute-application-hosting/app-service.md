---
title: "App Service"
description: "Run a managed Azure web app by separating the App Service plan, the web app, runtime settings, identity, slots, health, and scale."
overview: "App Service is Azure's managed web application platform. This article explains the plan-versus-app split and the runtime evidence a team should understand before treating an App Service deployment as healthy."
tags: ["azure", "app-service", "web-apps", "runtime", "slots"]
order: 2
id: article-cloud-providers-azure-compute-application-hosting-app-service-web-backends
aliases:
  - app-service-for-web-backends
  - cloud-providers/azure/compute-application-hosting/app-service-for-web-backends.md
---

## Table of Contents

1. [The Problem](#the-problem)
2. [What Is App Service](#what-is-app-service)
3. [App Service Plan](#app-service-plan)
4. [Web App](#web-app)
5. [Runtime Settings](#runtime-settings)
6. [Managed Identity](#managed-identity)
7. [Logs And Health](#logs-and-health)
8. [Deployment Slots](#deployment-slots)
9. [Scaling](#scaling)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Problem

The previous article chose App Service as one possible home for a normal checkout API. The team does not want to patch servers, operate Kubernetes, or build a custom container platform yet. They want to deploy a web backend, give it settings, connect it to secrets, check whether it is healthy, and roll out changes without guessing.

That sounds like one resource, but App Service quickly exposes several layers:

- The web app exists, but nobody knows which compute capacity pays for it.
- A deployment finishes, but the app is still returning 502s because the process never became healthy.
- A staging slot looks safe, but a production-only setting follows the swap by mistake.
- Scaling the app does not help because the real bottleneck is the shared plan underneath it.

App Service is useful because it hides a lot of server work. It is also dangerous to treat it as magic. A good App Service mental model separates the plan, the web app, configuration, identity, health, release slots, and scale.

## What Is App Service

Azure App Service is a managed platform for hosting web apps, REST APIs, and mobile backends. You bring application code or a custom container. Azure provides the web hosting environment around it: HTTPS entry, runtime support, app settings, managed identities, logging hooks, deployment options, custom domains, TLS, and scaling controls.

For a beginner Node API, App Service replaces a common hand-built server checklist. You do not start by provisioning a VM, installing Node, configuring Nginx, writing a systemd unit, wiring TLS renewal, and deciding how to restart the process. You create a web app on an App Service plan, deploy the code or image, and make the runtime contract visible.

That contract is still real:

| App need | Where it appears in App Service |
| --- | --- |
| CPU and memory | App Service plan size and instance count |
| HTTP entry | Web app hostname, custom domain, TLS, routing |
| Runtime | Stack setting or custom container image |
| Configuration | App settings and connection strings |
| Secret access | Managed identity plus Key Vault or other protected service |
| Release safety | Deployment slots and swap behavior |
| Evidence | Logs, health checks, metrics, and diagnostics |

The main habit is to read App Service as a managed runtime, not just a URL. A URL can respond while the wrong code is running. A deployment can succeed while required settings are missing. A healthy platform can host an unhealthy app. The runtime evidence matters.

## App Service Plan

An App Service plan is the compute container for one or more App Service apps. It defines the pricing tier, region, operating system, VM size family, and scale limits. When an app runs on a plan, it uses that plan's workers.

The plan is where many surprises hide. If several apps share one plan, they share capacity. One noisy app can affect another. If the plan is too small, every app on it can feel slow even when each web app's deployment is correct. If the plan is in the wrong region, moving the web app later is not the same as changing one label.

Think of the plan as the apartment building and the web apps as tenants. Each tenant has its own hostname, settings, deployment history, and identity. The building supplies the underlying workers. Upgrading or scaling the building changes what the tenants can use.

For production systems, teams usually avoid mixing unrelated workloads on one plan just to save a little money. Sharing can be reasonable for small, low-risk apps, but it should be intentional. When a plan is shared, the operational question becomes "which apps share these workers?"

## Web App

The web app is the application resource users and deployment tools touch most often. It has the hostname, app settings, runtime stack, identity, deployment source, slots, logs, and health behavior for one application.

For a Node backend, the web app needs to know how the app starts and where it listens. App Service sets a port contract for its runtime environment, and your app must obey it. If the application ignores the expected port or takes too long to start, the platform can be fine while the app is unreachable.

A useful first runtime record looks like this:

```text
Web app: devpolaris-orders-api
Plan: asp-orders-prod-eus
Runtime: Node.js LTS
Start: npm start
Health: GET /healthz
Identity: system-assigned managed identity
Required settings:
  NODE_ENV=production
  ORDERS_DB_URL=<secret reference or protected setting>
  RECEIPT_QUEUE_NAME=orders-receipts
```

This small record makes the app easier to reason about than a resource name alone. It tells a reviewer which plan pays for compute, which process should start, which endpoint proves readiness, and which settings must exist before traffic is trusted.

## Runtime Settings

App settings are environment variables presented to the running app. They are the normal place to put runtime configuration such as feature flags, endpoint names, queue names, and references to protected secret sources. They are not a substitute for application design, but they keep deployment artifacts from hardcoding environment-specific values.

The gotcha is that settings belong to the app or slot, not to a developer's shell. A backend that works locally because `.env` contains `DATABASE_URL` can fail in App Service if that setting was never configured. A deployment artifact can be perfect and still crash on boot because the runtime settings are incomplete.

Some settings should be slot-specific. For example, a staging slot should usually keep its staging database or staging feature flag when swapped with production. If the setting follows the code during a slot swap, the staging configuration can leak into production behavior. Treat slot settings as part of release safety, not as an afterthought.

The safe question before every deployment is simple: "Can the new code read every setting it needs in the slot where it will start?"

## Managed Identity

Managed identity gives the web app an Azure identity without storing a long-lived credential in the application code. The app can use that identity to request tokens for Azure services such as Key Vault, Storage, or databases that support Microsoft Entra authentication.

This is one of the clearest ways App Service changes the shape of secret handling. Instead of placing a database password or cloud credential directly inside source code, the app receives an identity from Azure. Azure role assignments or access policies then decide what that identity can read or call.

The identity does not grant permission by itself. Creating a system-assigned managed identity only gives the app a principal. Someone still has to grant that principal the right access to the target resource. When a secret read fails, check both halves: does the app have an identity, and does the target service allow that identity?

## Logs And Health

A deployment is not healthy just because the deployment command succeeded. App Service needs runtime evidence: process start logs, application logs, platform logs, metrics, and a health path that tells the platform whether the app can receive traffic.

A good health endpoint should be boring and honest. It should return success when the app can serve requests and failure when it should not receive traffic. It should not run an expensive database migration, call every downstream service, or hide startup failure behind a generic `200 OK`.

For the checkout API, `/healthz` might check that the process started, configuration was loaded, and the HTTP server can answer. A deeper `/readyz` or diagnostic endpoint can check dependencies if the team needs that distinction. The exact design depends on the app, but the App Service lesson is stable: traffic decisions need a specific signal, not hope.

When App Service returns a bad gateway or the app never warms up, the first useful evidence is not the Azure resource list. It is the app's recent logs, startup errors, configured runtime, required settings, identity failures, health check result, and plan metrics.

## Deployment Slots

Deployment slots are separate live app environments under the same App Service app. A common pattern is to deploy the next version to a staging slot, warm it up, verify it, and then swap staging with production.

Slots reduce release risk because they let the new version start before it receives production traffic. They also make mistakes more visible. If the app cannot boot, cannot read a setting, or fails its health endpoint in staging, you can catch that before the production hostname moves.

The important detail is swap behavior. Some configuration moves with the code during a swap, and some settings can be marked as slot-specific so they stay with the slot. Database names, external endpoint flags, and secret references often need careful treatment. A slot swap is safe only when the team knows which values move and which values stay.

Use slots when the release risk justifies the extra ceremony. For a production API, they often do. For a throwaway dev app, they may be unnecessary.

## Scaling

App Service scaling has two common meanings. Scale up means choose a larger pricing tier or worker size for the plan. Scale out means run more instances. Both affect the plan, and the web app runs on that capacity.

Scale is not a cure for every failure. If the app cannot start because a setting is missing, more instances will create more failing starts. If one dependency is slow, adding web workers may increase pressure on that dependency. If all apps share one plan, scaling the plan affects the shared pool rather than one isolated process.

Use scaling after you know the signal. CPU pressure, memory pressure, request queueing, latency, and instance health point to different actions. A simple production setup should make the plan, instance count, autoscale rule, and health signal easy to find.

## Putting It All Together

The opener had a web app, a mystery plan, a failed deployment, risky slot behavior, and unclear scaling. App Service gives each problem a place.

The App Service plan explains which workers and pricing tier the app uses. The web app explains the hostname, runtime, settings, identity, logs, and health. Runtime settings explain why code that worked locally may fail in Azure. Managed identity explains how the app calls protected Azure services without embedded credentials. Slots explain how a new version can start before production traffic moves. Scaling explains whether the team is changing worker size, worker count, or a shared capacity pool.

App Service is a strong first home for many web backends because it removes server chores. The team still needs to own the application contract: start command, settings, identity, health, logs, release safety, and scale signals.

## What's Next

Next we will look at Container Apps, where the deployment unit is a container image and the important Azure nouns become environment, container app, revision, ingress, secrets, identity, and scale rules.

---

**References**

- [Overview of Azure App Service](https://learn.microsoft.com/en-us/azure/app-service/overview)
- [Azure App Service plan overview](https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans)
- [Monitor App Service instances using Health check](https://learn.microsoft.com/en-us/azure/app-service/monitor-instances-health-check)
- [Set up staging environments in Azure App Service](https://learn.microsoft.com/en-us/azure/app-service/deploy-staging-slots)
