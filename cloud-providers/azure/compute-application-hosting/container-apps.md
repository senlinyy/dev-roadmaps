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

1. [What Is Container Apps](#what-is-container-apps)
2. [Environment](#environment)
3. [Container App](#container-app)
4. [Image And Registry](#image-and-registry)
5. [Revisions](#revisions)
6. [Ingress](#ingress)
7. [Scaling](#scaling)
8. [Secrets And Identity](#secrets-and-identity)
9. [Logs](#logs)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## What Is Container Apps

Azure Container Apps is a serverless container hosting platform that runs containerized microservices without requiring team cluster management. It bridges the gap between simple managed web hosts and complex container orchestration platforms. Instead of writing complex Kubernetes deployment manifests, configuring ingress controllers, managing TLS certificates, and upgrading VM node pools, you deploy a standard container image and let the platform manage the orchestration.

:::expand[Under the Hood: Managed Ingress and Scale Rules]{kind="design"}
Container Apps hides cluster operations behind a managed environment. Microsoft documents that the service is built on Kubernetes and open-source cloud-native components, but you should treat the cluster and ingress implementation as Azure-managed infrastructure rather than as an AKS cluster you can administer.

The practical runtime objects you control are the Container Apps environment, the container app, its revisions, its ingress setting, and its scale rules. When ingress is enabled, Azure gives the app an internal or external endpoint and forwards traffic to the target port on healthy replicas. Your main responsibility is to make sure the container listens on that target port, starts reliably, and exposes useful health behavior.

Autoscaling is configured through scale rules. Rules can react to HTTP concurrency, CPU, memory, queues, or supported event sources. If the minimum replica count is `0`, the platform can scale the app to zero when idle. If the app serves customer-facing requests, keep at least one replica warm when cold-start latency would harm the user experience.
:::

If you run containerized architectures on AWS, Container Apps solves a very similar problem to AWS ECS on Fargate or AWS App Runner. Both allow you to run standard containers without operating raw virtual machines. The important difference for a learner is the resource contract: Container Apps gives you managed environments, revisions, ingress, secrets, identities, and scale rules instead of asking you to manage cluster nodes directly.

The platform runs the exact Docker image you build. If the container process crashes on boot because of missing environment variables, listens on the wrong port, or fails local health checks, Container Apps will cycle through failing replicas, making application logs your primary troubleshooting tool.

| Platform Primitive | Architectural Role inside Container Apps |
| --- | --- |
| Environment | The shared network, security, and logging boundary that wraps a subnet and namespace |
| Container App | The logical service definition specifying the image, ports, ingress, and scaling bounds |
| Container Image | The immutable packaged application artifact built from your Dockerfile |
| Revision | A read-only snapshot of the application template, enabling versioned rollouts |
| Ingress | Public or private HTTP/TCP entry to the target port on the app |
| Scale Rule | Scaling thresholds defining minimum and maximum replica limits |
| Secrets | Environment-specific encrypted values mounted dynamically into the container |

## Environment

The Container Apps Environment serves as the physical network and telemetry boundary for a group of related services. It isolates your microservices from other workloads inside Azure's multi-tenant clusters. In a typical production architecture, you deploy a group of cooperating services (such as a front-end API gateway, an inventory service, and a data worker) to the same Container Apps Environment.

This co-location allows all services in the environment to utilize internal DNS name resolution and communicate securely over a shared private subnet. Because the environment maps directly to a virtual network, you can configure regional virtual network integration to secure database connections and private endpoint tunnels without exposing public IP addresses.

To maintain strict security separation, provision separate Container Apps Environments for separate lifecycle stages (such as development, staging, and production). Sharing a single environment across stages introduces structural risks, as a compromised staging service could exploit internal network routing to access production databases or shared secrets.

## Container App

The Container App is the deployable resource that represents your running microservice. It manages the configuration template, defines the container registry access, maps inbound network ports, and links secrets to environment variables. Rather than managing complex pod templates, you configure the Container App through a simplified REST API or Azure CLI command.

To ensure operational clarity during incidents, maintain a clear, documented record of each Container App profile. This avoids configuration mismatches when rolling out updates.

| Profile Field | Current Value |
| --- | --- |
| Parent Environment | `cae-orders-prod-eus` |
| Container App Name | `ca-orders-api-prod` |
| Registry Image Reference | `acrorders.azurecr.io/orders-api:2026-05-16.7` |
| Target Container Port | `3000` |
| Ingress Configuration | `External HTTPS` |
| Scale Limits | `Min Replicas: 1 / Max Replicas: 10` |
| System Managed Identity | `Enabled` |

If a deployment fails, reference this profile to verify that the target container port matches the port your application code actually binds to. If the image exposes port `3000` but ingress is configured to target port `8080`, the platform cannot reach the container process correctly, and inbound HTTP requests can return `502`, `503`, or `504` symptoms depending on the failure path.

## Image And Registry

The container image is the immutable package that contains your application binary, runtime libraries, and start commands. Container Apps does not compile source code; it pulls this compiled image from a container registry (such as Azure Container Registry or Docker Hub) when launching replica instances.

To guarantee that your image runs reliably, design your Dockerfile to conform to cloud-native standards. The process must write all logs to standard output or standard error streams rather than local files inside the container. It must handle termination signals (`SIGTERM`) gracefully, allowing active requests to finish before shutting down. It must also avoid assuming write access to persistent local directories, as container storage is ephemeral and reset whenever a replica recycles.

Avoid deploying images using mutable tags like `latest` or `staging`. If a scale-out event occurs, the platform will pull the image from the registry again. If a build pipeline overwrote the `latest` tag with new, untested code in the registry, the scale-out event will spin up mismatching container versions, causing hard-to-debug runtime differences. Instead, tag every image with a unique commit SHA or build ID to guarantee version consistency across all replicas.

:::expand[Mutable Image Tags and Mixed-Version Replicas]{kind="pitfall"}
A major system reliability risk in Container Apps is deploying containers using mutable image tags (such as `myapp:latest` or `myapp:staging`). A revision records the template you deploy, including the image reference. If your release process keeps reusing a mutable tag, humans and automation can lose the ability to prove which build is running, and later redeployments or rollbacks can pull a different image than the one the tag represented during the first release.

This leads to a version-control hazard: two revisions, environments, or redeployments can appear to reference the same tag while actually representing different builds over time. The symptom appears as intermittent or hard-to-reproduce behavior because the deployment record no longer names the immutable image artifact clearly.

This matches the behavior of **AWS ECS Fargate**, where scaling out tasks that target a mutable tag like `:latest` pulls whatever image currently exists in ECR at task boot time, creating the exact same silent version divergence.

Consider this deployment tag transformation:

*   **Before (Mutable Tag Trap):** Re-using the same tag on every pipeline push:
    ```bash
    # Overwrites the registry's tag; forces mixed-version scale-outs
    docker build -t acrorders.azurecr.io/orders-api:latest .
    docker push acrorders.azurecr.io/orders-api:latest
    ```
*   **After (Immutable SHA Tag Pattern):** Generate a unique, immutable tag based on the Git commit SHA for every build:
    ```bash
    # Each build is unique; scale-out is fully locked to this SHA digest
    GIT_SHA=$(git rev-parse --short HEAD)
    docker build -t acrorders.azurecr.io/orders-api:$GIT_SHA .
    docker push acrorders.azurecr.io/orders-api:$GIT_SHA
    ```

**Rule of thumb:** Never deploy mutable tags like `latest` or `prod` to a production Container App. Treat every deployment image tag as an immutable, versioned release record, uniquely named by Git commit SHA or build ID to guarantee version consistency across all scaling replicas.
:::

## Revisions

A Revision is a version-locked snapshot of a Container App's configuration template. Any change to a revision-scope property (such as deploying a new image tag, updating CPU/Memory limits, or altering App Settings) automatically triggers the creation of a new Revision.

Container Apps supports two revision modes: Single and Multiple. In Single mode, the platform automatically deactivates the old Revision as soon as the new Revision passes its health and readiness probes. In Multiple mode, you can run multiple Revisions concurrently, allowing you to split traffic between different versions of your service.

```mermaid
flowchart LR
    Ingress["Managed Ingress<br/>(Traffic Splitter)"] --> Rev1["Revision 1<br/>(80% Active Traffic)"]
    Ingress --> Rev2["Revision 2<br/>(20% Canary Traffic)"]
```

```mermaid
flowchart TD
    subgraph Replicas["Logical Revision Replicas"]
        PodA["Replica Pod A"]
        PodB["Replica Pod B"]
    end
    subgraph Nodes["Physical Worker Node VMs"]
        Node1["Worker VM Instance 1"]
        Node2["Worker VM Instance 2"]
    end
    PodA -- scheduled to --> Node1
    PodB -- scheduled to --> Node2
```

This multiple-revision architecture enables safe, progressive rollouts (such as canary releases or blue-green deployments). Container Apps manages the traffic split at the ingress boundary, allowing you to route a small percentage of public traffic (for example, 10%) to the new revision while monitoring exception rates before completing the shift.

## Ingress

Ingress is the network configuration layer that determines how outside traffic reaches your container. Container Apps supports three ingress states: disabled (fully private background workers), internal (only reachable by other services inside the same environment or virtual network), and external (exposed to the public internet).

![An infographic showing Container Apps ingress mapping external traffic to the configured target port](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-azure-container-apps/target-port-contract.png)

*Ingress works only when the platform target port matches the port your container actually listens on.*

When ingress is enabled, the platform allocates an external endpoint or internal reachability for the app and routes traffic to the configured target port of your running container replicas. Container Apps can handle TLS at the managed endpoint, but your container still has to listen on the correct target port and become ready before traffic can succeed.

If your service needs to execute background jobs or process messages from a queue, disable ingress entirely. Running a worker service with an exposed HTTP port creates unnecessary security vectors and forces you to manage public access routes for a process that only needs to connect outbound to a queue.

## Scaling

Container Apps scaling is designed to adapt compute resources dynamically to match request volumes. You can write scale rules that trigger scaling based on HTTP request concurrency, CPU load, memory pressure, or external event sources.

![An infographic showing Container Apps scaling from zero to replicas and back down when demand disappears](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-azure-container-apps/scale-to-zero-loop.png)

*Scale-to-zero is a loop: no traffic means no replicas, new demand wakes replicas, and idle time shuts them down again.*

A key capability of Container Apps is the ability to scale to zero replicas when no traffic or events are present. This can dramatically lower costs for development workloads or background processors that only run sporadically. However, scaling to zero introduces the physical constraint of cold starts.

When a container scales to zero, there are no active replicas to serve the first new request or event. The platform must allocate capacity, pull or prepare the image if needed, start the container process, and wait for the application to become ready. This sequence creates cold-start latency that must be factored into your API design. To prevent this cold-start delay for customer-facing services, set the minimum replica limit to `1`.

## Secrets And Identity

Container Apps separates sensitive credentials from standard environment variables by utilizing a dedicated Secrets store. You define secrets (such as database passwords, third-party API keys, or private registry tokens) at the Container App level. These values are encrypted at rest and can be referenced by name in your container template, which injects them as standard environment variables when the replicas boot.

For secure access to Azure resources (like Azure SQL or Key Vault), avoid using static passwords or access keys. Enable a system-assigned managed identity on the Container App to grant the service a secure, passwordless identity in Entra ID.

The container process accesses Entra ID tokens through a secure local endpoint exposed inside the running app. When the application code initiates a token request, the Azure SDK calls the Container Apps managed identity endpoint using platform-provided environment details and headers. The endpoint returns an access token for the Container App identity, and the app passes that token to downstream services, eliminating the risk of hardcoded credentials leaking through version control or container logs.

## Logs

All console log outputs (standard out and standard error) written by your container processes are intercepted by the cluster's host container runtime daemon (`containerd`). The platform streams these logs directly to a managed Log Analytics workspace configured at the Environment level.

When troubleshooting a failed revision rollout, do not rely on high-level resource states. If a revision fails its readiness probes, inspect the platform events and application logs simultaneously.

A resource state of `Degraded` or `Revision Failed` indicates that the platform could not complete the deployment. If the application logs are completely empty, the container process likely crashed before initializing the log pipes, which points to a startup command error or a missing container entrypoint script. If the logs show application exceptions, the process booted but failed its internal database connection or health check logic, preventing the readiness probe from returning success.

## Putting It All Together

Container Apps wraps containerized applications in a managed, serverless orchestration layer.

* **Managed Environment Abstraction**: Container Apps gives you container hosting, ingress, revisions, and scale rules without exposing cluster administration.
* **Revision Mappings**: Revision-scope changes create read-only revisions that can receive traffic independently in multiple-revision mode.
* **Cold-Start Physics**: Scaling to zero removes all active replicas. The next request or event waits while the platform starts a replica and the application initializes.

By designing your container images and scaling rules around these architectural mechanisms, you can build reliable, elastic microservice environments that scale dynamically without the overhead of raw cluster management.

## What's Next

In the next chapter, we will look at Azure Functions. We will explore event-driven execution models, detail how the Scale Controller daemon polls event backlogs without booting application code, compare Consumption and Flex plans, and analyze cold starts.

![An infographic showing a Container Apps environment with ingress, revisions, traffic split, scale rules, secrets, and managed identity](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-azure-container-apps/container-apps-revision-map.png)

*Use this as the Container Apps revision map: a new image becomes a new revision, traffic can split between revisions, and scale rules, secrets, identity, and logs decide whether it runs safely.*


---

**References**

- [Azure Container Apps Overview](https://learn.microsoft.com/en-us/azure/container-apps/overview) - Official overview of the serverless container platform.
- [Revisions in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/revisions) - Technical details of versioned snapshots and traffic split rules.
- [Azure Container Apps scaling](https://learn.microsoft.com/en-us/azure/container-apps/scale-app) - Official guide to scale rules, concurrency metrics, and scaling to zero.
- [Managed Secrets in Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets) - Documentation on encrypting and injecting environment variables.
