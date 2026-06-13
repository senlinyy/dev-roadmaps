---
title: "What Is Compute"
description: "Choose an Azure compute service by matching the workload shape to the amount of runtime ownership the team wants."
overview: "Compute is where application code becomes a running process. This article builds a practical Azure compute map across Virtual Machines, App Service, Container Apps, Functions, and AKS so a beginner can choose by workload shape, ownership, scaling behavior, and production evidence."
tags: ["azure", "compute", "app-service", "container-apps", "functions", "aks"]
order: 1
id: article-cloud-providers-azure-compute-application-hosting-azure-compute-mental-model
aliases:
  - azure-compute-mental-model
  - choosing-app-service-container-apps-functions-or-vms
  - runtime-configuration-health-and-scaling
  - article-cloud-providers-azure-compute-application-hosting-choosing-app-service-container-apps-functions-vms
  - article-cloud-providers-azure-compute-application-hosting-runtime-configuration-health-scaling
  - cloud-providers/azure/compute-application-hosting/azure-compute-mental-model.md
  - cloud-providers/azure/compute-application-hosting/choosing-app-service-container-apps-functions-or-vms.md
  - cloud-providers/azure/compute-application-hosting/runtime-configuration-health-and-scaling.md
---

## Table of Contents

1. [The Compute Map](#the-compute-map)
2. [What Compute Gives Your Code](#what-compute-gives-your-code)
3. [Workload Shape](#workload-shape)
4. [Virtual Machines](#virtual-machines)
5. [App Service](#app-service)
6. [Container Apps](#container-apps)
7. [Azure Functions](#azure-functions)
8. [Azure Kubernetes Service](#azure-kubernetes-service)
9. [Sample Compute Map](#sample-compute-map)
10. [Runtime Evidence](#runtime-evidence)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## The Compute Map
<!-- section-summary: Azure compute choices make more sense when you separate the runtime job, deployment artifact, scaling unit, ownership boundary, network entry, and evidence you need during production work. -->

When someone says **compute** in Azure, they mean the hosting model for the resources that run application code. That sounds small, but it covers a lot of real production behavior. Compute decides where the process starts, how much CPU and memory it receives, which network it joins, how it scales, how it gets restarted, how it proves it is healthy, and how much of the operating platform your team has to own.

We will keep one example system in our hands for the whole article. The system is `devpolaris-orders`, a small ecommerce backend in `rg-devpolaris-orders-prod`. It has a public Orders API, a containerized checkout service, a receipt job, and one old inventory daemon that still expects a normal Linux server. That mix is useful because different parts of the system ask for different runtime contracts.

Here is the map we will build before we talk about product names. Each row gives us one question to carry through the whole article, from the first service choice to the first production incident.

| Concept | Plain meaning | Orders system example |
|---|---|---|
| **Runtime job** | The job the running code performs after deployment. | Receive HTTP requests, process queue messages, run a daemon, or host many services. |
| **Deployment artifact** | The thing the team ships to Azure. | Source code, a ZIP package, a container image, a VM image, or Kubernetes YAML. |
| **Scaling unit** | The thing Azure adds or removes when demand changes. | VM instances, App Service workers, Container Apps replicas, function workers, or AKS nodes and pods. |
| **Ownership boundary** | The line between what Azure operates and what the team operates. | Azure may own host patching, while the team still owns app settings, images, secrets, ports, and health checks. |
| **Network entry** | The path requests or private traffic use to reach the runtime. | Public HTTPS ingress, VNet integration, a VM NIC, or a Kubernetes ingress controller. |
| **Runtime evidence** | The facts an operator checks during a failed deploy or incident. | Current image, revision, instance count, power state, logs, metrics, identity, and recent deployment history. |

This structure keeps the conversation practical. A beginner can look at the Orders API and ask what it runs as, what the team deploys, what scales, who patches the host, where traffic enters, and what evidence proves the current version. Those questions lead naturally into the Azure services.

![Azure compute map showing App Service, Container Apps, Functions, Virtual Machines, and AKS around a running code runtime](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-azure-compute-mental-model/azure-compute-map.png)

*The map puts the five Azure compute families around the same runtime question: how does this code receive CPU, memory, networking, scaling, and production evidence?*

## What Compute Gives Your Code
<!-- section-summary: Compute turns source code, containers, functions, or VM images into running work by giving them CPU, memory, startup behavior, networking, identity, scaling, and operational signals. -->

**Compute** gives application code a live place to run. On a laptop, that place might be a local Node.js process, a Python script, a Docker container, or a background service. In Azure, the same idea appears as a managed web app, a container replica, a function invocation, a virtual machine process, or a Kubernetes pod.

The beginner-friendly definition is this: compute is the runtime home for code. It supplies **CPU**, **memory**, **process startup**, **network attachment**, **identity hooks**, **scale behavior**, and **signals** such as logs and metrics. Storage keeps data after the process exits. Networking moves traffic. Identity controls what the process can access. Compute is the part that actually runs the program.

Imagine the Orders API receives a checkout request. The request reaches a public endpoint, then Azure sends it to some running compute. That compute might be an App Service worker running a web process, a Container Apps replica running an image, an AKS pod behind a Kubernetes Service, or a VM where a systemd service listens on a port. The user sees one API call, while the operator sees a very different set of responsibilities depending on the compute service.

The ownership boundary matters because cloud platforms share the work. Azure usually owns the physical datacenter, the physical servers, the host networking, and many managed platform pieces. Your team still owns the application code, runtime configuration, secrets, identity assignment, health behavior, and cost choices. The exact split changes from service to service, so the next useful idea is workload shape.

## Workload Shape
<!-- section-summary: Workload shape describes how code naturally wants to run, and Azure compute choices line up better when the team names that shape before choosing a service. -->

**Workload shape** means the natural running pattern of a piece of software. Some code wants a full server because it needs OS control. Some code wants a web platform because it mainly answers HTTP requests. Some code wants a container platform because the team ships Docker images and needs revision-based releases. Some code wants event execution because it wakes up only when a queue message, timer, or file upload appears.

The Orders system has several shapes at the same time. The public API receives HTTP requests all day. The checkout worker runs as a container and scales when queue depth rises. The receipt sender wakes up only after an order event. The inventory daemon expects a Linux host, local packages, and a long-running service supervisor. A larger platform team might later run shared services on Kubernetes after a real platform need appears.

Here is the beginner map for those shapes. The service names matter, but the shape explains why one service feels natural for a workload and another service creates extra operating work.

| Workload shape | Simple definition | Azure service that often fits |
|---|---|---|
| **Server-shaped** | The software needs a full operating system, custom packages, persistent server behavior, or direct admin control. | **Azure Virtual Machines** |
| **Web-app-shaped** | The software is a normal web app or API that can run inside a managed web hosting platform. | **Azure App Service** |
| **Container-shaped** | The team deploys container images and wants managed ingress, revisions, scaling, and Azure-managed platform operations. | **Azure Container Apps** |
| **Event-shaped** | The code runs after a trigger such as HTTP, a timer, a queue message, a blob upload, or a database event. | **Azure Functions** |
| **Platform-shaped** | The organization needs Kubernetes APIs, shared cluster policy, custom controllers, or deep container platform control. | **Azure Kubernetes Service** |

This table also explains why a real system can use more than one compute service. The Orders team can run the public API on App Service, a queue worker on Container Apps, a receipt sender on Functions, and a legacy daemon on a VM. The architecture stays easier to operate because each part gets the runtime that matches how it behaves in production.

![Workload shape chooser mapping server-shaped, web-app-shaped, container-shaped, event-shaped, and platform-shaped workloads to Azure compute services](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-azure-compute-mental-model/workload-shape-chooser.png)

*This chooser keeps the decision tied to the workload: the Orders system can mix compute services because each component runs in a different shape.*

## Virtual Machines
<!-- section-summary: Azure Virtual Machines give the team a full guest operating system, which helps legacy or specialized workloads but keeps OS patching, process supervision, and server-level operations with the team. -->

An **Azure Virtual Machine**, or VM, is the server-shaped compute option. Azure gives your team a guest operating system, CPU and memory from a chosen VM size, managed disks, a network interface, and administrator access inside the machine. Azure operates the physical hardware and virtualization platform, while your team maintains the software that runs inside the guest operating system.

The Orders system uses `vm-devpolaris-orders-legacy-01` for the inventory daemon. That daemon has old package dependencies, writes to a local mounted data disk, and runs as a Linux service. A VM fits because the team needs control over packages, service files, disk mounts, kernel-level settings, and host-level monitoring agents. Those are server responsibilities, so the team accepts server work.

Three VM concepts matter early. A **VM image** is the boot template, such as an Ubuntu image or a custom image with company packages already installed. A **VM size** is the capacity profile, such as CPU count, memory, disk throughput, and network throughput. A **managed disk** is the Azure-managed block storage device that the guest operating system sees as a disk. The VM size can cap disk and network performance, so a faster disk will still feel slow when the VM size allows only a small amount of throughput.

In production, VM work looks familiar to anyone who has operated servers before. The team patches the OS, installs security agents, configures users, manages systemd units, rotates SSH access, collects logs, monitors disk usage, and writes recovery steps. Azure helps with features such as VM extensions, managed disks, availability options, backups, and Virtual Machine Scale Sets, but the server remains a server from the team's point of view.

The runtime evidence also feels server-like. During an incident, the operator wants the power state, OS health, VM size, image lineage, disk state, recent extension runs, and process logs. This command asks Azure for the instance view, which includes useful power and provisioning status details:

```bash
az vm get-instance-view \
  --resource-group rg-devpolaris-orders-prod \
  --name vm-devpolaris-orders-legacy-01 \
  --query "instanceView.statuses[].displayStatus"
```

A VM gives maximum runtime freedom in this module, and that freedom comes with operating work. The public Orders API has a different shape. It is a normal HTTP service, and the team wants deployment slots, managed host patching, app settings, diagnostics, and scale controls while Azure carries the host maintenance. That moves the conversation to App Service.

## App Service
<!-- section-summary: Azure App Service hosts web apps and APIs on a managed platform where the team deploys code or containers while Azure handles much of the web hosting infrastructure. -->

**Azure App Service** is the managed web hosting option for web applications, REST APIs, and mobile back ends. The team deploys application code or a container image, and Azure provides the web hosting platform around it. App Service fits code that behaves like a steady web process: it listens for requests, answers them quickly, uses app settings for configuration, emits logs, and scales by adding more worker capacity.

The important beginner concept is the split between the **App Service plan** and the **Web App**. The App Service plan provides the compute resources in a region. The Web App holds the application's runtime settings, hostname, deployment configuration, identity, logs, and other app-level settings. Multiple Web Apps can share the same plan, which can save money in development and create noisy-neighbor problems in production when one app consumes too much CPU or memory.

For the Orders system, `app-devpolaris-orders-api-prod` can run the public API when the team wants managed web hosting. The application still owns its code, app settings, connection behavior, managed identity assignment, dependency versions, and health endpoint. Azure handles more of the underlying web host and operating platform than a VM would, and the team works through App Service concepts such as deployment slots, custom domains, TLS, diagnostics, scale out, and VNet integration.

A small Bicep sketch shows the separation. The plan names the capacity pool, and the app points at that plan. The app settings then become the runtime configuration the process reads when it starts:

```bicep
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'asp-devpolaris-orders-prod'
  location: resourceGroup().location
  sku: {
    name: 'P1v3'
    tier: 'PremiumV3'
  }
}

resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: 'app-devpolaris-orders-api-prod'
  location: resourceGroup().location
  properties: {
    serverFarmId: plan.id
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      appSettings: [
        {
          name: 'ORDERS_QUEUE_NAME'
          value: 'orders-created'
        }
      ]
    }
  }
}
```

That snippet contains the main operating contract. The plan answers, "how much web worker capacity exists?" The app answers, "which code and settings run here?" During a failed release, an operator checks the app state, the plan, the current slot, recent deployments, app logs, CPU, memory, HTTP 5xx counts, and health check behavior:

```bash
az webapp show \
  --resource-group rg-devpolaris-orders-prod \
  --name app-devpolaris-orders-api-prod \
  --query "{state:state, hostNames:enabledHostNames, plan:serverFarmId}"
```

App Service works well when the code fits the managed web app shape. The checkout worker has a slightly different story because the team already packages it as a container image and wants event-aware scaling. That leads to Container Apps.

## Container Apps
<!-- section-summary: Azure Container Apps runs container images in a managed serverless container platform with environments, ingress, revisions, traffic splitting, and KEDA-based scale rules. -->

**Azure Container Apps** is the managed container platform for teams that want to run container images while Azure carries much of the platform operation. The team ships a Docker image, configures CPU and memory, sets ingress and scale rules, and lets Azure manage much of the hosting environment. Microsoft describes Container Apps as a serverless platform for containerized applications, and the practical value is that the team gets container releases and autoscaling with less cluster work.

The beginner concepts are **environment**, **container app**, **revision**, and **scale rule**. An environment is the shared boundary for networking, logging, and platform settings. A container app is one deployable service inside that environment. A revision is an immutable version created from a template change such as a new image, resource setting, environment variable, or scale configuration. A scale rule tells the platform when to add or remove replicas based on HTTP traffic, CPU, memory, queues, or other supported event sources.

For the Orders system, `ca-devpolaris-orders-api-prod` can run the checkout service from a container image. The team might keep one replica warm during business hours, allow more replicas when HTTP concurrency rises, and scale a queue worker down to zero when the `orders-created` queue has no messages. Under the hood, Container Apps uses Kubernetes-based infrastructure and KEDA-style event scaling. Normal operations go through Container Apps APIs.

Here is a deployment command that shows the shape of the service. The team names the image, CPU and memory, ingress port, and replica range because those are the runtime facts Container Apps needs before it can run the container. Those fields become the first facts the platform uses when it starts replicas.

```bash
az containerapp create \
  --resource-group rg-devpolaris-orders-prod \
  --name ca-devpolaris-orders-api-prod \
  --environment cae-devpolaris-orders-prod \
  --image acrdevpolaris.azurecr.io/orders-api:2026.06.11 \
  --target-port 8080 \
  --ingress external \
  --cpu 0.5 \
  --memory 1Gi \
  --min-replicas 1 \
  --max-replicas 10
```

Container Apps also changes how releases work. A new image or template change can create a new revision. In multiple revision mode, the team can send a small percentage of traffic to a new revision, watch logs and metrics, then move more traffic when the evidence looks healthy. During an incident, the operator checks the active revision, traffic weights, image tag, replica count, scale rule, target port, secrets, managed identity, and logs:

```bash
az containerapp show \
  --resource-group rg-devpolaris-orders-prod \
  --name ca-devpolaris-orders-api-prod \
  --query "{state:properties.provisioningState, latestRevision:properties.latestRevisionName, mode:properties.configuration.activeRevisionsMode}"
```

Container Apps fits many modern microservices because it keeps the container artifact while reducing platform work. The receipt sender in our Orders system has an even smaller runtime shape. It wakes from an order event, runs the receipt logic, records the result, and goes idle. That is the natural home for Azure Functions.

## Azure Functions
<!-- section-summary: Azure Functions runs event-driven handlers from triggers such as HTTP, timers, queues, blobs, and service events, with hosting-plan choices controlling scale, cost, and networking behavior. -->

**Azure Functions** is Azure's event-driven compute service. A function is a small handler that runs when a trigger fires. The trigger can come from an HTTP request, a timer, a queue message, a Service Bus message, a blob upload, an Event Grid event, or another supported source. The team writes the handler and configuration, while the Functions platform handles invocation, scale behavior, and much of the host runtime.

Two terms matter right away: **trigger** and **binding**. A trigger starts the function. A binding connects the function to input or output data, such as reading a blob or sending a queue message. The useful beginner idea is that the function code can stay focused on the work while the platform handles the event connection around it.

For the Orders system, `func-devpolaris-orders-jobs-prod` can send receipts after a message lands in a queue. The code reads the order ID, loads the order details, sends the email, and records the result. The team still owns idempotency because messages can be retried. Idempotency means the handler can safely run more than once for the same order and still send one receipt and write one result.

The hosting plan matters because it changes how the function scales, how cold starts feel, how networking works, and how cost appears. Consumption-style plans fit bursty event handlers. Premium or dedicated hosting can fit functions that need warmer instances, longer-running behavior, or stronger networking requirements. The runtime job drives the plan choice, and the label "serverless" only starts the conversation.

During an incident, the operator checks the function app state, hosting plan, trigger configuration, recent invocation failures, retry behavior, Application Insights traces, identity, and app settings. This command gives the basic shape of the function app resource before the operator goes into logs. The output helps confirm the app is running on the expected plan before deeper log review.

```bash
az functionapp show \
  --resource-group rg-devpolaris-orders-prod \
  --name func-devpolaris-orders-jobs-prod \
  --query "{state:state, kind:kind, plan:serverFarmId}"
```

Functions works best when the unit of work starts from an event and finishes cleanly. A platform team has a different kind of problem when it needs shared Kubernetes APIs, custom controllers, namespace policy, service mesh choices, and deeper control over container scheduling. That is where AKS enters the picture.

## Azure Kubernetes Service
<!-- section-summary: Azure Kubernetes Service gives teams managed Kubernetes with direct API access, so it fits platform needs that require cluster-level policy, node pools, schedulers, controllers, and Kubernetes-native operations. -->

**Azure Kubernetes Service**, or AKS, is Azure's managed Kubernetes service for running containerized applications. Kubernetes is a container orchestration system: it stores desired state, schedules pods, exposes services, rolls out deployments, and coordinates cluster behavior. AKS lets the team use Kubernetes APIs while Azure operates major parts of the managed control plane.

The beginner split is **control plane** versus **node pools**. The control plane is the Kubernetes management layer that accepts API requests, stores desired state, and schedules work. Node pools are groups of VM-backed worker nodes that run the actual pods. Azure helps operate the managed Kubernetes service, while the team still owns cluster configuration, workload manifests, node capacity choices, networking, identity integration, upgrade planning, and application reliability.

For the Orders system, AKS becomes interesting when the company has many services and a platform team that wants Kubernetes-native operations. They might need custom ingress controllers, admission policies, service mesh behavior, shared Helm charts, strict namespace quotas, Kubernetes operators, or a standard cluster platform used by many teams. Those needs justify the extra operating surface because Kubernetes gives the platform team powerful shared controls.

AKS now has different operating experiences, including more managed defaults in AKS Automatic and deeper configuration control in AKS Standard. That distinction matters because "AKS" can mean a fairly guided managed experience or a more configurable cluster platform. The team should still ask the same basic question: which Kubernetes features do we need enough to operate them?

The evidence changes again in Kubernetes. An operator checks deployments, pods, services, ingress objects, node pools, events, replica counts, image tags, resource requests, autoscaler behavior, and cluster health. When a pod stays `Pending` or `CrashLoopBackOff`, the answer may live in image pulls, secrets, node capacity, readiness probes, or networking policy.

AKS gives the most platform control among the main services in this article. The cost is that the team now operates a full container platform along with application runtimes. With all five services on the table, we can map the Orders system to concrete resources.

## Sample Compute Map
<!-- section-summary: A sample map ties each Orders resource to its workload shape, Azure service, deployment artifact, scaling unit, and operator evidence. -->

Here is the Orders system as a small compute map. Each row names the job one component performs and then chooses the runtime that gives the right amount of control, scale behavior, and operating work. This keeps the map close to real production responsibilities.

| Component | Azure resource | Workload shape | Azure compute choice | Deployment artifact | Scaling unit |
|---|---|---|---|---|---|
| Public Orders API | `app-devpolaris-orders-api-prod` | Web-app-shaped | **App Service** | Node.js app package or container | App Service plan workers |
| Checkout container service | `ca-devpolaris-orders-api-prod` | Container-shaped | **Container Apps** | Container image | Container app replicas |
| Receipt sender | `func-devpolaris-orders-jobs-prod` | Event-shaped | **Azure Functions** | Function app package | Function workers or instances |
| Legacy inventory daemon | `vm-devpolaris-orders-legacy-01` | Server-shaped | **Virtual Machines** | VM image plus packages | VM instance or scale set instance |
| Shared future platform | `aks-devpolaris-platform-prod` | Platform-shaped | **AKS** | Kubernetes manifests and container images | Pods and node pool VMs |

Now imagine a failed release. The App Service API might show a bad deployment slot swap, the Container App might point traffic at the wrong revision, the Function App might retry the same receipt message, and the VM daemon might be down because a package update changed a system library. Those failures all say "compute" at a high level, but each one needs different runtime evidence.

That is why the map includes artifact and scaling unit. The artifact tells the team what changed. The scaling unit tells the team what Azure adds or removes under pressure. A container image problem should lead the operator toward revisions and image tags. A VM daemon problem should lead toward OS logs and process supervision. The next section turns that idea into a practical evidence checklist.

## Runtime Evidence
<!-- section-summary: Runtime evidence is the proof an operator gathers from Azure before changing production, including current version, health, scale, network, identity, and recent deployment behavior. -->

**Runtime evidence** means the current facts about what Azure is running. It keeps troubleshooting grounded. Without evidence, the team guesses from product names and dashboards. With evidence, the team can say which version runs, how many instances exist, whether the platform thinks the app is healthy, which identity the runtime uses, and where traffic enters.

For Azure compute, useful evidence usually falls into six buckets: **current version**, **health**, **scale**, **network**, **identity**, and **recent change history**. Current version might be a container image, deployment slot, function package, VM image, or Kubernetes rollout. Health might be HTTP failures, readiness probes, platform status, process state, or invocation errors. Scale might be worker count, replica count, VM size, node pool size, or function instance behavior.

Here is a compact checklist for the Orders resources. Each row points the operator toward the evidence that matches the runtime, so a VM problem, a container revision problem, and a function retry problem stay distinct during triage.

| Service | Evidence that helps during a failed release |
|---|---|
| **Virtual Machines** | Power state, VM size, OS image, extension status, disk status, boot diagnostics, system logs, daemon status, recent package changes. |
| **App Service** | App state, App Service plan, deployment slot, current runtime stack, app settings, managed identity, health check result, HTTP errors, recent deployments. |
| **Container Apps** | Active revision, image tag, traffic weight, target port, replica count, scale rule, secrets, managed identity, revision logs. |
| **Azure Functions** | Function app state, hosting plan, trigger settings, invocation failures, retry count, app settings, managed identity, Application Insights traces. |
| **AKS** | Deployment rollout, pod status, events, node capacity, image pull errors, service and ingress configuration, autoscaler behavior, logs, Kubernetes secrets and identities. |

![Runtime evidence board showing failed release triage through version, health, scale, network, identity, and change history for Azure compute services](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-azure-compute-mental-model/runtime-evidence-board.png)

*During a failed release, the evidence board helps the team choose the right debugging path for each compute service instead of treating every runtime issue the same way.*

The same resource group can show several compute families side by side. This command gives a quick inventory before the operator drills into each service-specific command. The table output gives the operator a fast service inventory before deeper troubleshooting begins.

```bash
az resource list \
  --resource-group rg-devpolaris-orders-prod \
  --query "[?contains(name, 'devpolaris-orders')].{name:name,type:type,location:location}" \
  --output table
```

This evidence-first habit also improves architecture reviews. When the team proposes a compute service, the review should include what the deployment artifact is, what the rollback path looks like, how the runtime scales, where logs and metrics go, which identity the workload uses, and what an on-call engineer checks at 02:00. The service choice then connects to daily operations and stays more useful than a diagram label.

## Putting It All Together
<!-- section-summary: The practical Azure compute decision is an ownership tradeoff between runtime control, managed platform help, scaling behavior, release style, and the evidence the team can use in production. -->

Azure compute choices make the most sense when the team starts with the workload first and the product menu second. The inventory daemon needs server control, so a VM fits even though it creates patching and process-supervision work. The public API can fit App Service because it behaves like a normal web app. The checkout service can fit Container Apps because the team ships containers and wants managed revisions and scale rules. The receipt sender can fit Functions because it runs from events. AKS belongs when Kubernetes itself gives the organization platform value.

The ownership tradeoff looks like this. The left side is the service family, the middle columns show the shared work, and the final column names a common signal that the team may have picked a heavier runtime than the workload needs.

| Compute choice | Azure handles more of | The team still owns | Mismatch warning sign |
|---|---|---|---|
| **Virtual Machines** | Physical hardware, host virtualization, managed disks, platform features. | Guest OS, patches, packages, process supervision, firewall rules, backups, server logs. | The team spends more time maintaining servers than improving the application. |
| **App Service** | Managed web hosting, platform patching, web app features, deployment slots, diagnostics. | App code, plan sizing, settings, identity, health checks, dependencies, release safety. | Several apps share one plan and one busy app starves the others. |
| **Container Apps** | Managed container hosting, environments, revisions, ingress, KEDA-style scale rules. | Container image, port contract, resource limits, secrets, identity, scale settings, logs. | A simple web app carries container complexity before container release behavior adds value. |
| **Azure Functions** | Event invocation, trigger handling, host runtime, elastic execution behavior. | Handler code, idempotency, bindings, retries, plan choice, app settings, downstream limits. | A long-running workflow gets squeezed into short event handlers and creates retry pain. |
| **AKS** | Managed Kubernetes service components and Azure integration points. | Cluster design, node pools, manifests, policies, ingress, upgrades, workload reliability. | The team adopts Kubernetes before it has platform needs or operators ready to own it. |

The most useful decision record for compute is short and concrete. It names the workload shape, the Azure service, the deployment artifact, the scaling unit, the owner, the network path, the identity, the logs, the rollback path, and the reason the team accepted that ownership boundary. That record helps the next engineer understand the choice during normal work and during incidents.

The Orders system now has a practical compute map. Each component has a runtime home, a clear artifact, and an evidence path. That gives the rest of the module a strong base, because the next articles can study each compute service with its own failure modes and operating habits.

![Azure compute choice summary comparing VM, App Service, Container Apps, Functions, and AKS by artifact, scaling unit, and team ownership](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-azure-compute-mental-model/azure-compute-choice-summary.png)

*The final summary connects each service to the artifact it runs, the thing Azure scales, and the work the team still owns.*

## What's Next

The next article focuses on Azure Virtual Machines. We will take the server-shaped part of the Orders system and look closely at VM images, VM sizes, managed disks, network interfaces, scale sets, extensions, startup behavior, process supervision, patching, and logs.

---

* [Choose an Azure compute service](https://learn.microsoft.com/en-us/azure/architecture/guide/technology-choices/compute-decision-tree) - Microsoft architecture guide for comparing Azure compute hosting models, workload fit, networking, scale, operations, and cost.
* [Overview of virtual machines in Azure](https://learn.microsoft.com/en-us/azure/virtual-machines/overview) - Official introduction to Azure VMs and the maintenance work teams keep inside the guest operating system.
* [Sizes for virtual machines in Azure](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/overview) - Official reference for VM size families and the CPU, memory, storage, and network characteristics attached to a size.
* [Overview of Azure App Service](https://learn.microsoft.com/en-us/azure/app-service/overview) - Official guide to App Service for managed web apps, REST APIs, and mobile back ends.
* [Azure App Service plans](https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans) - Official explanation of how App Service plans provide compute resources for apps.
* [Azure Container Apps overview](https://learn.microsoft.com/en-us/azure/container-apps/overview) - Official overview of Azure's serverless container platform.
* [Set scaling rules in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/scale-app) - Official guide to Container Apps scale behavior and KEDA-related scale settings.
* [Update and deploy changes in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/revisions) - Official documentation for Container Apps revisions and revision modes.
* [Azure Functions overview](https://learn.microsoft.com/en-us/azure/azure-functions/functions-overview) - Official overview of Azure's event-driven serverless compute service.
* [Azure Functions triggers and bindings](https://learn.microsoft.com/en-us/azure/azure-functions/functions-triggers-bindings) - Official explanation of triggers, input bindings, and output bindings.
* [What is Azure Kubernetes Service](https://learn.microsoft.com/en-us/azure/aks/what-is-aks) - Official overview of AKS as a managed Kubernetes service for containerized applications.
* [Core concepts for Azure Kubernetes Service](https://learn.microsoft.com/en-us/azure/aks/core-aks-concepts) - Official guide to AKS clusters, modes, and Kubernetes operating concepts.
