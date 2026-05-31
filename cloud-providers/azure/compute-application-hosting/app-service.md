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

1. [What Is App Service](#what-is-app-service)
2. [Declarative App Service Slot Bicep Configuration](#declarative-app-service-slot-bicep-configuration)
3. [App Service Plan: The Capacity Reservoir](#app-service-plan-the-capacity-reservoir)
4. [Web App: The Logical Profile](#web-app-the-logical-profile)
5. [Runtime Settings: Dynamic Injection](#runtime-settings-dynamic-injection)
6. [Managed Identity: Passwordless Integration](#managed-identity-passwordless-integration)
7. [Deployment Slots: Zero-Downtime Releases](#deployment-slots-zero-downtime-releases)
8. [App Service Environment: Absolute Network Isolation](#app-service-environment-absolute-network-isolation)
9. [Scaling Mechanics: Scale-Up vs. Scale-Out](#scaling-mechanics-scale-up-vs-scale-out)
10. [Logs And Health](#logs-and-health)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## What Is App Service

Azure App Service is Azure's managed web runtime for applications that need a long-running HTTP host without owning the server operating system. It is a Platform as a Service (PaaS) designed to host web applications, REST APIs, and background processes. It removes the operational chores of traditional infrastructure management. You do not need to configure virtual networks, install operating system patches, configure IIS or Nginx servers, set up systemd supervisors, write custom startup scripts, or coordinate manual SSL/TLS certificate renewals. You create the Web App, provide the application code or container image, and let Azure's platform controller prepare the runtime environment.

:::expand[Under the Hood: Front-End Pools and Noisy Neighbors]{kind="design"}
The physical architecture of App Service is split into two primary layers: the Front-End pool and the Worker pool. The Front-End layer consists of redundant load-balancing routing nodes at the entry point of Azure's regional data centers. These Front-End gateways receive all inbound public HTTP/HTTPS requests, handle SSL/TLS decryption, and route the traffic over a private internal network to the specific WebWorkers hosting your code.

WebWorkers are virtual machine instances dedicated to running your chosen runtime environment. The scale and density of these WebWorkers are governed entirely by your App Service Plan (ASP). Web App resources are merely logical configuration boundaries, whereas the ASP represents the physical VM compute boundary. If you deploy multiple Web Apps to the same ASP, they are co-located on the same physical VM instances, sharing the same CPU schedulers, physical memory blocks, and network socket threads. Under high traffic, this multi-app co-location can lead to severe noisy neighbor resource contention, where a resource spike in one application starves the other apps of resources, causing latency spikes and socket timeouts.
:::

If you host applications on AWS, App Service solves a similar problem to AWS Elastic Beanstalk (for code-based deployments) or AWS App Runner (for containerized web applications). However, the underlying resource models differ: while AWS Elastic Beanstalk provisions standard EC2 instances directly under your AWS account (which you can SSH into and manage), Azure App Service abstracts the physical servers completely into managed container WebWorkers attached to your App Service Plan.

Treat App Service as a managed runtime that wraps your application process. Even though the platform is managed, you are responsible for process start commands, environment variables, database connection pools, memory utilization, and active health monitoring.

| Platform Interface | Functional Role inside App Service |
| --- | --- |
| Compute Capacity | App Service Plan instance count, VM SKU size, and regional placement |
| Ingress Edge | Redundant Front-End routing gateways, managed TLS handshakes, and custom domains |
| Runtime Stack | Pre-configured Node.js, Python, or .NET container engines, or custom Docker images |
| Environment Configuration | App Settings injected as environment variables directly into the process |
| Secure Entra ID Access | Managed Identity token exchanges with Key Vault or Azure SQL |
| Safe Releases | Deployment slots utilizing isolated directories and logical routing swaps |
| Performance Evidence | Application Insights telemetry, standard out log pipes, and active health checks |

## Declarative App Service Slot Bicep Configuration

You can deploy and configure an App Service Plan, a production Web App, and a dedicated staging deployment slot declaratively using Bicep. The following sample Bicep template defines a Premium V3 plan, a web application with dynamic slot integration, and slot-sticky settings rules:

```bicep
resource appServicePlan 'Microsoft.Web/serverfarms@2022-03-01' = {
  name: 'asp-orders-prod'
  location: 'eastus'
  sku: {
    name: 'P1v3'
    tier: 'PremiumV3'
    size: 'P1v3'
    family: 'Pv3'
    capacity: 2
  }
}

resource webApp 'Microsoft.Web/sites@2022-03-01' = {
  name: 'app-orders-prod'
  location: 'eastus'
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
  }
}

resource stagingSlot 'Microsoft.Web/sites/slots@2022-03-01' = {
  name: 'app-orders-prod/staging'
  location: 'eastus'
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
  }
}
```

This configuration sets up the physical infrastructure required to support zero-downtime releases.

## App Service Plan: The Capacity Reservoir

An App Service Plan (ASP) is the shared compute pool that your Web Apps run on. It decides how much CPU, memory, storage quota, and scale capacity are available before any individual app code starts.

Example: `asp-orders-prod-eus` might host the public `orders-api` Web App and a smaller `orders-admin` Web App. If the API consumes all CPU in the plan, the admin app can slow down too because both apps draw from the same worker capacity.

When you create an ASP, you are creating Virtual Machine Scale Sets (VMSS) managed by Azure's fabric, hidden behind the PaaS abstraction layer. The tier you choose (Basic, Standard, Premium v3, or Isolated) dictates the availability of advanced features, such as regional virtual network integration, deployment slots, custom domains, and autoscale rules.

![An infographic showing several web apps sharing the capacity boundary of one App Service plan](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-app-service-web-backends/plan-capacity-boundary.png)

*The App Service plan is the capacity boundary; multiple web apps inside it can compete for the same CPU and memory.*

Because the ASP provides the physical RAM and CPU allocations, you must monitor it using host-level metrics. If a Web App returns a gateway timeout or becomes unresponsive, inspect the App Service Plan's overall CPU and Memory utilization. Scaling up the ASP changes the size of the worker VMs (e.g., shifting from 2 cores and 8 GB of RAM to 4 cores and 16 GB of RAM), whereas scaling out increases the number of running VM instances.

### Shared Disk Storage Gotchas in App Service Plans

Another vital system behavior of App Service Plans is shared local disk storage. By default, all Web Apps running inside the same App Service Plan share a single central storage volume backed by Azure Storage (using a network-attached SMB/NFS share under the hood).

This means that if you have three separate Web Apps on the same plan, they all write to the same shared directory path. If Web App A has a bug that continuously dumps massive log files to local disk and fills up the allocated plan storage, Web App B and Web App C will immediately crash with disk full or no space left on device I/O write errors.

To prevent this shared-storage failure mode, always set up proactive alerts on the App Service Plan's storage quota, isolate high-write applications to dedicated plans, or configure your web apps to stream logs off-host directly to Log Analytics rather than writing locally.

For production workloads, isolate critical services on dedicated App Service Plans. Placing an internal administrative portal, a slow-running batch utility, and a high-throughput checkout API on the same plan introduces unnecessary operational risk. Dedicated plans ensure that resource consumption remains isolated and predictable.

## Web App: The Logical Profile

A Web App is the runnable application profile inside an App Service Plan. It tells Azure which code or container to start, which settings to inject, which identity to use, and which HTTP endpoint should receive traffic.

Example: the `devpolaris-orders-api` Web App can run Node.js 20, start with `npm start`, expose `/healthz`, and use a system-assigned identity to read Key Vault secrets. Those choices belong to the Web App, while the CPU and memory capacity belong to the App Service Plan.

For built-in runtime stacks, App Service starts the selected language runtime and routes HTTP traffic through the platform front ends to your process. For custom Linux containers, your container must listen on the port App Service expects, often configured through the platform's port settings for the container. A failed startup command, wrong listening port, or missing environment setting can make a healthy deployment package unreachable.

To maintain operational clarity during incidents, document a stable profile of each Web App. This avoids confusion when troubleshooting configuration issues or deployment failures.

| Profile Field | Practical Value |
| --- | --- |
| Web App Name | `devpolaris-orders-api` |
| Parent App Service Plan | `asp-orders-prod-eus` |
| Runtime Stack Version | `Node.js 20 LTS (Linux)` |
| Physical Startup Command | `npm start` |
| Ingress Health Endpoint | `/healthz` |
| Entra ID Principal | `System-Assigned Managed Identity` |

When a deployment completes but the application remains unreachable, the issue is rarely the Azure control plane. The most common failures are process crashes caused by missing database settings, startup script errors, or the application process failing to bind to the port within the platform's startup timeout limit.

## Runtime Settings: Dynamic Injection

App Settings in App Service are platform-stored key-value pairs that become environment variables inside your process. They exist so the same deployment package can run in different environments without rebuilding the code.

Example: the same container image can read `ORDERS_DB_HOST=sql-orders-prod.database.windows.net` in production and `ORDERS_DB_HOST=sql-orders-staging.database.windows.net` in staging. The image stays the same, but the runtime setting changes.

The platform ensures that these settings are encrypted at rest and dynamically loaded when the process boots. They allow you to maintain environment-specific configuration without baking connection strings, API URLs, or environment tags into your deployment package.

A critical systems behavior of App Settings is that saving a configuration change triggers an immediate restart of the Web App process. The platform controller recycles the application pool to inject the new environment variables. If you update three settings sequentially in a deployment script, you can trigger three consecutive process restarts, creating temporary downtime and database connection spikes. To prevent this, apply configuration updates in a single, atomic operation using deployment templates or CLI batch scripts.

Some settings must be marked as slot settings. When you create a deployment slot, you can check a box to stick the setting to the slot. This ensures that database connection strings, logging levels, and third-party webhook endpoints do not move when you perform a release swap.

## Managed Identity: Passwordless Integration

Managed Identity is the Web App's Azure-backed service identity for passwordless calls to other Azure resources. It eliminates the need to store long-lived credentials (like passwords, client secrets, or certificate files) inside your application code or App Settings. When you enable a system-assigned managed identity on a Web App, Azure creates a Microsoft Entra service principal associated with that Web App resource.

Under the hood, the Web App accesses this identity through a local managed identity endpoint exposed to the app by the App Service platform. When your application code uses an Azure SDK credential such as `DefaultAzureCredential`, the SDK requests an access token through the endpoint and platform-provided headers. Microsoft Entra ID issues the token for the managed identity, and your app presents that token to services such as Key Vault or Azure SQL. This is different from a Virtual Machine's Instance Metadata Service path, even though the SDK can hide that difference from your code.

The identity does not grant permission by itself. Creating a system-assigned managed identity only gives the app a principal. Someone still has to grant that principal the right access to the target resource. When a secret read fails, check both halves: does the app have an identity, and does the target service allow that identity?

## Deployment Slots: Zero-Downtime Releases

Deployment slots are fully functional, independent Web App instances that run under the same App Service parent resource. A slot has its own unique hostnames, environment configuration settings, and deployment history, but it shares the underlying worker VM resources of the App Service Plan by default.

![An infographic showing a staging slot warming up before a production slot swap](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-app-service-web-backends/slot-swap-safety.png)

*Deployment slots are safest when the candidate slot is warmed, checked, and only then swapped into production traffic.*

When you swap deployment slots (such as swapping `staging` with `production`), App Service runs a controlled swap workflow rather than a blind URL flip. It applies target-slot settings that must be tested on the source slot, restarts and warms the source instances as needed, and then switches routing so the warmed source slot becomes the production target. After the routing switch, the previous production app is moved into the other slot.

This swap process avoids many cold-start failures through an automated warmup sequence. The platform can send warmup requests to the source slot before completing the swap. If the source instances fail to restart or warm successfully, the swap can stop and revert the settings applied to the source slot. The important design habit is to mark environment-specific settings as slot settings and to test the app under production-like settings before completing a swap.

### Slot-Sticky Settings Under the Hood

Slot-sticky settings are the configuration values that stay attached to a slot during a route swap. Under the hood, deployment slots represent distinct Azure resources. When you execute a swap operation, the Azure ARM controller updates the virtual IP mapping at the ARR (Application Request Routing) front-end load balancer:

```plain
Before Swap:
  Front-End Route for devpolaris.com ──> Production Slot WebWorker (Code v1.0)
  Front-End Route for staging.devpolaris.com ──> Staging Slot WebWorker (Code v1.1)

After Swap:
  Front-End Route for devpolaris.com ──> Staging Slot WebWorker (Code v1.1)
  Front-End Route for staging.devpolaris.com ──> Production Slot WebWorker (Code v1.0)
```

The WebWorker container instances are physically swapped in the routing tables. To ensure that database connection strings or logging levels do not swap with the code, mark them as slot-sticky.

:::expand[Slot-Sticky Settings Discipline]{kind="pattern"}
Azure App Service deployment slots permit zero-downtime releases by warming up code in a staging slot and swapping routing targets at the Front-End gateway. However, during a swap, all Web App configurations (App Settings and Connection Strings) swap with the code *unless* they are explicitly marked as **Slot-Sticky**.

This contrasts with AWS, where deployment slots do not exist natively. In AWS ECS or Elastic Beanstalk, you achieve blue-green deployments by spinning up a separate service and swapping ALB target groups or Route 53 DNS records. Because AWS environment variables are permanently bound to the respective task definition or environment, there is no risk of configuration swapping - though it demands more complex pipeline scripting.

If you forget to mark environment-specific configurations as sticky in Azure, the swap leads to critical misalignment:

```plain
Before Swap:
  Staging Slot ──> DB_CONN="staging-db" (Non-sticky)
  Production Slot ──> DB_CONN="prod-db" (Non-sticky)

After Swap (The Misconfiguration Failure):
  Staging Slot (now pointing to old prod code) ──> DB_CONN="prod-db"
  Production Slot (now hosting new code) ──> DB_CONN="staging-db" (CRITICAL: Prod calls Staging database)
```

To prevent this, mark all environment-sensitive properties as sticky:

| App Setting / Connection String Type | Should Be Sticky? | Architectural Reason |
| :--- | :--- | :--- |
| **Database Connection String** | **Yes** | Prevents production from writing to staging database. |
| **`ASPNETCORE_ENVIRONMENT` / `NODE_ENV`** | **Yes** | Keeps runtime telemetry mapped to the correct environment. |
| **Feature Flag (e.g., `EnableBetaFeatures`)** | **No** | Allows the new feature flag to promote to production with the code. |
| **Key Vault Reference URI (scoped per slot)** | **Yes** | Ensures each slot reads secrets from its respective vault. |

**The Fix:** In your Bicep templates, set the `slotSetting` boolean flag to `true` on the configuration block:
```bicep
resource appSettings 'Microsoft.Web/sites/config@2022-03-01' = {
  name: 'web/appsettings'
  properties: {
    DB_CONN: {
      value: 'prod-db-string'
      slotSetting: true // Prevents swapping
    }
  }
}
```

**Rule of thumb:** If the value of an App Setting differs between your staging and production environments, it **must** be marked as slot-sticky.
:::

## App Service Environment: Absolute Network Isolation

An App Service Environment (ASE) is the single-tenant App Service deployment shape for workloads that need stronger network isolation than standard App Service Plans. Single-tenant means the App Service front ends and workers are dedicated to one customer's environment instead of sharing the same hosting stamp with unrelated customers.

Example: a regulated payments API can run inside an internal ASE with only a private IP in `snet-payments-appservice`, while public users reach it through an upstream Application Gateway and Web Application Firewall. Standard App Service Plans operate inside a multi-tenant infrastructure tier. Customer code runs in isolated WebWorker processes, but the physical hosting tier shares common network ingress controllers, storage connections, and database fabric lines.

For large enterprises requiring absolute data compliance, strict security perimeters, and direct private network isolation, standard multi-tenant hosting is insufficient. Azure provides this absolute isolation through the **App Service Environment (ASE)**.

An ASE is a dedicated, single-tenant deployment tier of App Service that is injected directly into a private subnet within your Virtual Network. When you deploy an ASE:

*   **Dedicated WebWorkers**: All virtual machine hosts (both Front-End gateways and back-end WebWorkers) are physically dedicated to your account, eliminating noisy neighbor resource contention entirely.
*   **Private Network Ingress**: An Internal ASE (ILB ASE) exposes a private IP address inside your subnet. External internet traffic cannot reach the hosted web apps unless you explicitly route it through an upstream Application Gateway or Web Application Firewall.
*   **High-Scale Capacity**: An ASE supports massive scale capacity, allowing you to scale up to two hundred VM worker instances in a single environment.

Deploying an ASE adds significant cost, but it provides the ultimate security boundary for regulated workloads that are strictly prohibited from sitting on shared multi-tenant public infrastructure.

## Scaling Mechanics: Scale-Up vs. Scale-Out

App Service scaling changes the capacity of the App Service Plan, not just one Web App. It provides two modes: vertical scaling (scaling up) and horizontal scaling (scaling out).

*   **Scaling Up**: Changes the compute tier, core count, or memory allocation of the VM instances. This is suitable for addressing single-instance performance limits or memory constraints.
*   **Scaling Out**: Provisions additional VM instances to distribute traffic across a larger resource pool. This is suitable for spreading CPU-heavy request volume and ensuring high availability.

Horizontal autoscaling is governed by rules that monitor specific performance indicators, such as average CPU utilization, memory pressure, or TCP queue length. When a scaling threshold is breached, Azure adds worker capacity to the App Service Plan according to the configured scale rule.

### Cooldown Periods and Autoscaling Flapping

When setting up horizontal autoscaling rules, you must configure a cooldown or quiet period (typically 5 to 10 minutes) before the platform allows subsequent scaling actions. If your application CPU spikes, triggering a scale-out of one instance, the platform freezes further scaling evaluations during this cooldown. This allows the new instance time to boot, pull configurations, join the routing tables, and absorb a portion of the traffic load. Without a cooldown period, transient CPU spikes can trigger multiple scaling events in rapid succession (flapping), resulting in over-provisioned instances and inflated costs.

Under the hood, provisioning a new instance does not require you to manually copy application files onto the new worker. App Service manages the deployment content and host startup path for the selected runtime or container model. The new worker starts the runtime or container, loads the configured app settings, executes your startup command, and enters the routing pool once the platform can send traffic to it successfully.

## Logs And Health

App Service captures standard output and standard error streams from your application process, piping them to a managed log stream. In Linux-based App Service containers, console logs are collected by a host docker daemon and can be streamed in real-time or forwarded directly to an Azure Log Analytics workspace.

### Application Insights APM Integration

Application Insights is the application telemetry backend that connects App Service request handling to traces, dependencies, exceptions, and logs. For deep application diagnostics, App Service integrates natively with **Application Insights**, Azure's Application Performance Management (APM) service. When enabled:

*   **Runtime Profiler Injection**: The App Service platform automatically injects an APM agent into your container runtime environment on boot, utilizing environment variables like `APPLICATIONINSIGHTS_CONNECTION_STRING`.
*   **No-Code Telemetry**: The injected agent hooks into the runtime's underlying standard HTTP libraries (such as Node.js HTTP/HTTPS modules or .NET Core HttpClient), automatically capturing incoming HTTP request latency, SQL query execution durations, and exit exception codes without requiring any code-level modifications.
*   **Distributed Tracing Propagation**: The APM agent automatically injects and extracts W3C Distributed Tracing headers (specifically `traceparent` and `tracestate` headers) across service boundaries. If your web storefront calls a downstream checkout microservice, the request's parent trace ID is preserved, allowing you to trace a single checkout transaction's path end-to-end across multiple compute tiers in Azure.

This APM capability provides essential telemetry to locate hidden performance regressions before they cause customer-facing service degradation.

### Active Health Check Polling

An active Health Check is critical to prevent routing traffic to degraded worker instances. When you configure a Health Check path (such as `/healthz`), the platform's load balancers poll the endpoint on every running instance at regular intervals. The endpoint must verify that the process is warm, configurations are parsed, and core socket connections are established.

```mermaid
flowchart LR
    Gateway["Front-End Load Balancer<br/>(TLS Decryption)"] --> Net["Internal Virtual Network"]
    Net --> Worker1["ASP Worker Instance 1"]
    Net --> Worker2["ASP Worker Instance 2"]
```

```mermaid
flowchart TD
    subgraph Workers["App Service Plan Workers"]
        Worker1["Worker Instance 1"]
        Worker2["Worker Instance 2"]
    end
    subgraph SharedStorage["Shared Storage Layer"]
        CodeStorage["Shared Azure Storage Volume"]
    end
    Worker1 -- "SMB/NFS Mount" --> CodeStorage
    Worker2 -- "SMB/NFS Mount" --> CodeStorage
```

If an instance fails to return a `200 OK` response multiple times, the load balancer marks the instance degraded and removes it from the active routing pool. If all instances become degraded, the load balancer falls back to returning a `502 Bad Gateway` error to public requests, protecting downstream database and message queues from failing connections.

## Putting It All Together

Understanding the physical architecture of App Service prevents common deployment and operational assumptions.

* **Plan vs. Logical Isolation**: The App Service Plan is the physical VM compute boundary; the Web App is a logical configuration workspace.
* **Slot Swap Workflow**: Deployment slot swaps apply target settings, warm source instances, then switch routing when the app is ready.
* **Managed Startup**: Scaling out relies on App Service's managed deployment and startup path for the selected runtime or container model.
* **Managed Credentials**: Managed Identities use an App Service local identity endpoint to fetch Microsoft Entra access tokens without storing client secrets.
* **Dedicated Environments**: The App Service Environment provides single-tenant virtual network injection for absolute data compliance.

By designing your applications around these physical realities, you can construct deployment slot configurations, autoscale thresholds, and resource plans that guarantee high performance and high availability.

## What's Next

In the next chapter, we will transition to Azure Container Apps (ACA). We will package our application as a container image, configure a Container Apps environment, manage revisions, and configure event-driven autoscaling.

---

* [Azure App Service Overview](https://learn.microsoft.com/en-us/azure/app-service/overview) - Official overview of the App Service PaaS features.
* [App Service Plan Details](https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans) - Deep dive into physical hosting, sizes, and VM tier limits.
* [Set up staging environments](https://learn.microsoft.com/en-us/azure/app-service/deploy-staging-slots) - Explanation of slot warmup, routing shifts, and slot settings.
* [VNet Integration for App Service](https://learn.microsoft.com/en-us/app-service/web-sites-integrate-with-vnet) - Technical overview of regional subnet routing and port injection.
