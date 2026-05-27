---
title: "Azure Core Services Map"
description: "Choose the first Azure service family to inspect by asking which app job needs help."
overview: "After the Azure boundary and resource identity articles, the service list becomes easier to read as a map of jobs. This article follows one Orders API through traffic, compute, state, access, signals, deployment, cost, and recovery."
tags: ["azure", "services", "compute", "data", "observability"]
order: 4
id: article-cloud-providers-azure-foundations-core-services
aliases:
  - core-services
  - azure-core-services-map
  - article-cloud-providers-azure-foundations-azure-core-services-map
  - cloud-providers/azure/foundations/core-services.md
  - cloud-providers/azure/foundations/azure-core-services-map.md
---

## Table of Contents

1. [The Job-Based Service Map](#the-job-based-service-map)
2. [Traffic: Managing Public Entry](#traffic-managing-public-entry)
3. [Compute: Where the Code Runs](#compute-where-the-code-runs)
4. [State: Relational Databases and Object Storage](#state-relational-databases-and-object-storage)
5. [Access: Workload Identities and Secret Vaults](#access-workload-identities-and-secret-vaults)
6. [The CLI Scope: Querying Container App Ingress and Revisions](#the-cli-scope-querying-container-app-ingress-and-revisions)
7. [Under-the-Hood: Inside the Container Apps Serverless Fabric](#under-the-hood-inside-the-container-apps-serverless-fabric)
8. [Operational Diagnostics: Mapping Symptoms to Service Families](#operational-diagnostics-mapping-symptoms-to-service-families)
9. [Putting It All Together](#putting-it-all-together)

## The Job-Based Service Map

The sheer number of services in the Azure catalog can feel overwhelming. But if you group these services by the specific operational jobs they perform for your application, the catalog suddenly transforms into a clean, easy-to-read map:

*   **Public Traffic Entry (Ingress & Routing)**: How does a customer's browser request safely reach your running code?
*   **Compute Execution (Runtime Host)**: Where does your code physically execute, and what triggers it?
*   **Persistent State (Storage & Databases)**: Where do your transactions, file assets, and user sessions live so they survive system restarts?
*   **Access Control (Identity & Secrets)**: How do your services prove who they are and securely read passwords?
*   **Operational Evidence (Observability)**: Where do your logs, metrics, and alerts go so you can see what is happening under the hood?
*   **Repeatable Release (Deployment Operations)**: How do your container images and templates safely transition from Git into active production?

By standardizing on this map, you prevent your team from getting lost in product menus. When a problem occurs, you immediately identify which family owns the job, locate the correct CLI commands, and query the specific resource properties. 

This job-centric mapping is the best antidote to cloud catalog fatigue. As a developer, your primary concern is not memorizing trademarked marketing names; it is understanding the flow of bytes through your system. By categorizing services by their runtime responsibilities, you can immediately narrow down where a bug lives. If a user cannot resolve your domain name, you check DNS; if their container crashes during an active query, you check Compute; if their session data is lost, you check State.

## Traffic: Managing Public Entry

Traffic services answer a fundamental routing question: How does a customer's browser request safely navigate the internet and reach your running code?

When an application starts small, you can connect your compute containers directly to the public internet using their built-in HTTPS ingress endpoints. But as your traffic grows and security requirements become more strict, exposing your application servers directly to the raw internet is an operational risk. You need dedicated routing layers to serve as shields and traffic cops.

In the Azure ecosystem, public ingress is managed by four specialized routing layers:

*   **Azure DNS**: This is the translation layer. It maps human-friendly custom domain names (like `api.devpolaris.com`) to the raw IP addresses or default domain names of your Azure resources.
*   **Azure Front Door**: A global edge routing service deployed across hundreds of Microsoft edge points of presence (PoPs) worldwide. Front Door utilizes Anycast routing to automatically route user traffic to the physically nearest edge facility. It handles Web Application Firewall (WAF) filtering, terminates SSL/TLS handshakes close to the user to eliminate latency overhead (using a split-TCP design), and load-balances requests across global regions. If a DDoS attack hits your API, Front Door absorbs the impact at the global edge before the traffic ever reaches your hosting region.
*   **Application Gateway**: A regional Layer 7 load balancer that lives inside your private virtual network. It functions as a high-performance reverse proxy (built on Nginx-style routing fabrics) designed to handle regional SSL termination, custom path-based routing rules (e.g., sending `/api/*` to your backend containers and `/static/*` to object storage), and private backend integration.
*   **API Management (APIM)**: An API gateway that serves as an administrative proxy. It sits in front of your microservices, enforcing rate limits, usage quotas, token validation, and versioning constraints. APIM uses an in-memory Redis caching layer under the hood to authenticate incoming client tokens without forcing every request to query your backend compute directory, keeping your systems fast and shielded.

## Compute: Where the Code Runs

Compute resources provide the physical CPU cycles and memory pools that host your active application code. Azure splits compute into distinct models based on an **abstraction ladder**—where each step up the ladder hides more of the underlying hardware, operating system, and orchestration complexities, allowing your team to focus strictly on code:

### 1. Virtual Machines (The Infrastructure Tier)
This is the lowest step on the compute ladder. You lease a slice of a physical hypervisor, granting you complete root access to the operating system, file system, and kernel parameters. However, this means your team is responsible for managing operating system patches, system upgrades, security firewalls, and disk backups. It is identical to running your own physical servers in a local rack.

### 2. App Service (The Managed Hosting Tier)
One step up the ladder, App Service hides the operating system. Azure handles all kernel patching, OS updates, and physical hardware scaling. However, you are still responsible for configuring the web server engine (like Nginx, IIS, or Node.js) and managing the application pool boundaries.

### 3. Azure Container Apps (The Managed Container Tier)
A step higher, Container Apps hides both the OS and the web server engine, as well as the entire container orchestrator. You do not manage Kubernetes nodes, API servers, or pod network interfaces. You simply supply a pre-built Docker container image, and Azure handles container scheduling, ingress proxying, TLS termination, and autoscaling.

### 4. Azure Functions (The Serverless FaaS Tier)
At the top of the ladder, even the container boundary is hidden. You do not manage scaling limits or runtime pools. You simply supply raw code functions cabled to specific events—such as an incoming HTTP query, a new row in a database, or a message in a queue. If no events occur, the platform scales to zero, and you pay absolutely nothing for idle compute.

For our transactional orders API, Azure Container Apps (ACA) provides the ideal balance of managed serverless scaling and simple container orchestration.

## State: Relational Databases and Object Storage

State services guarantee that your application data survives deployment updates, server crashes, and regional power outages. You select state services by matching their engine to the specific structure and query patterns of your data:

*   **Azure SQL Database**: A fully managed relational database engine based on Microsoft SQL Server. It is the ideal home for structured transactional records (like order ledgers and billing accounts) because it guarantees strict ACID (Atomicity, Consistency, Isolation, Durability) properties, complex schema validation, and automated point-in-time recovery backups. It utilizes write-ahead transaction logging to ensure that no committed record is lost during a hypervisor failover.
*   **Azure Cosmos DB**: A globally distributed NoSQL database designed for planet-scale write performance and sub-10ms response times. It supports multiple API shapes (like JSON documents or key-value tables) and asynchronously replicates data across global regions automatically. It measures capacity in Request Units (RUs) and allows you to tune consistency levels along a spectrum from Strong (immediate replication check) to Eventual (asynchronous caching), balancing latency against data correctness.
*   **Azure Blob Storage**: The object storage service (Azure's equivalent of Amazon S3). It stores unstructured data files—such as PDF invoices, user profile photos, or raw CSV logs—in highly durable storage blocks. It organizes data into distinct lifecycle tiers (Hot for active reads, Cool for infrequent access, and Archive for backups) and automatically migrates old blocks to cheaper media based on lifecycle rules you define, optimizing storage costs.

## Access: Workload Identities and Secret Vaults

Access services establish secure trust boundaries between your compute containers and your data persistent blocks. To keep private passwords and keys out of your Git repositories and Docker image layers, you enforce a strict access loop:

```text
Container App (Managed Identity) -> REST API -> Key Vault (Role Assignment) -> Decrypted Secret
```

Under the hood, this passwordless access loop relies on a highly secure **IMDS (Instance Metadata Service) cryptographic handshake**:

1.  **The Metadata Call**: When your application container starts and needs to connect to the database, it makes an HTTP GET request to a private, non-routable link-local IP address: `http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://vault.azure.net`.
2.  **IMDS Interception**: The local host hypervisor intercepts this loop. Because the request originates from the physical compute container cabled to the virtual network interface, the hypervisor proves to Microsoft Entra ID that the request is authentic.
3.  **Token Generation**: Microsoft Entra ID issues a short-lived JSON Web Token (JWT), cryptographically signed by Azure's master identity key, and returns it to the container over the local metadata bridge.
4.  **Vault Verification**: The container app extracts this JWT and passes it in the `Authorization: Bearer eyJ...` header of its REST API query to your Azure Key Vault resource.
5.  **Role Assignment Check**: Key Vault reads the JWT, verifies the signature against Entra ID, parses the workload identity ID, and checks its own Role-Based Access Control (RBAC) rules. If the identity holds the `Key Vault Secrets User` role assignment, Key Vault decrypts the secret connection string and returns it to the container in the JSON response body.

This passwordless handshake is infinitely safer than storing database connection strings or API keys in configuration files or container images. Even if an attacker somehow gains read access to your Git repository, there are no passwords to steal, because credentials only exist as ephemeral, cryptographically signed memory tokens generated at runtime. It completely resolves "the first secret problem" of bootstrap security.

## The CLI Scope: Querying Container App Ingress and Revisions

To audit your compute boundaries and verify ingress health directly from the terminal, you use the Azure CLI to inspect your container application's active configuration profiles.

Let us execute a terminal session to query our production orders container app properties:

```bash
$ az containerapp show \
    --name "app-orders-prod" \
    --resource-group "rg-orders-prod-uksouth"
```

This terminal command instructs the ARM engine to return the runtime, network ingress, and active deployment parameters:

```json
{
  "id": "/subscriptions/88888888-4444-4444-4444-121212121212/resourceGroups/rg-orders-prod-uksouth/providers/Microsoft.App/containerApps/app-orders-prod",
  "location": "uksouth",
  "name": "app-orders-prod",
  "properties": {
    "configuration": {
      "activeRevisionsMode": "Single",
      "ingress": {
        "external": true,
        "fqdn": "app-orders-prod.uksouth.azurecontainerapps.io",
        "targetPort": 8080,
        "traffic": [
          {
            "latestRevision": true,
            "weight": 100
          }
        ],
        "transport": "auto"
      }
    },
    "provisioningState": "Succeeded",
    "template": {
      "containers": [
        {
          "image": "crproddevpolaris.azurecr.io/orders-api:v2.1.0",
          "name": "orders-container",
          "resources": {
            "cpu": 0.5,
            "memory": "1.0Gi"
          }
        }
      ]
    }
  },
  "resourceGroup": "rg-orders-prod-uksouth"
}
```

Every returned parameter provides critical runtime evidence:

*   `fqdn`: The Fully Qualified Domain Name automatically generated by the container ingress. This is the endpoint WAF proxies or DNS records target.
*   `targetPort`: The network port (`8080`) that the ingress proxy expects your container process to listen on. If your application code is configured to bind to a different port (such as 3000), the ingress proxy will suffer continuous health check timeouts, returning 504 Gateway errors to users.
*   `image`: The exact container registry path and version tag (`v2.1.0`) running.
*   `cpu` & `memory`: The precise compute limits allocated to the task container.

## Under-the-Hood: Inside the Container Apps Serverless Fabric

To design a robust compute architecture, you must understand the physical layers that Azure manages beneath the surface. When you deploy a container app to Azure Container Apps (ACA), the platform does not run your container directly on a bare metal host. Instead, ACA abstracts three highly complex orchestration frameworks behind a simple, serverless REST API:

```text
Container App API -> Kubernetes (AKS Nodes) -> KEDA (Scale rules) -> Envoy Proxy (Ingress/TLS)
```

### 1. The Envoy Proxy Handshake

Every ingress request is intercepted by a managed **Envoy Proxy**. Envoy functions as a high-performance, L7 traffic cop. It terminates incoming TLS connections, effectively shielding your container from the complexities of certificate renewal and encryption negotiation. Once decrypted, Envoy performs a "health-check-aware" forward to your container. If your container process is failing to respond, Envoy immediately marks the endpoint as unhealthy, preventing the propagation of 504 gateway errors to your users.

### 2. KEDA: The Event-Driven Metrics Loop

Scaling in ACA is not governed by simple CPU percentages. It is managed by **KEDA** (Kubernetes Event-driven Autoscaling). KEDA operates a continuous monitoring loop that interrogates external "event sources." For example, if you define a scale rule based on HTTP request concurrency, KEDA samples the telemetry coming from the Envoy ingress. When the backlog of pending requests exceeds your threshold, KEDA signals the orchestrator to provision new Pod instances. This is a "reactive" scaling loop that happens at sub-minute intervals, allowing the system to scale down to exactly zero when the telemetry reports idle status.

### 3. Managed Kubernetes (AKS)

Under the hood, all these components reside within a multi-tenant, hidden AKS cluster. Azure manages the control plane, keeping the API server hardened and patched. When you update your container image, Azure performs a "Blue-Green" deployment by spinning up the new version, running Envoy health checks against it, and shifting the weighted traffic only when the new revision confirms it is ready to accept production load.

## Operational Diagnostics: Mapping Symptoms to Service Families

To keep your team from wasting time during outages (like scaling the database during an ingress failure), you must map system symptoms directly to the correct service family to inspect:

| Incident Symptom | Primary Outage Job | Azure Service Family to Inspect |
| :--- | :--- | :--- |
| **HTTP 502 / 504 Errors** | Ingress cannot reach or validate container tasks. | **Traffic Ingress / Compute**: Inspect target port configurations, health probe paths, and task container resource limits. |
| **Database Connection Timeouts** | Compute tasks are saturating database sockets. | **State Database**: Audit active connections, database lock tables, index definitions, and connection pool scopes. |
| **Application Startup Crashes** | Container process fails to read decryption credentials. | **Access Control**: Verify Managed Identity role assignments, Key Vault network firewalls, and KMS decrypt scopes. |
| **Storage Egress Failures** | Workers cannot write exported files. | **State Storage**: Inspect Blob Storage container access policies and SAS token expiration times. |
| **Blank Telemetry / Missing Traces** | App logs are not streaming to workspaces. | **Observability**: Verify Application Insights connection strings and Log Analytics workspace ingestion configurations. |

By standardizing on this diagnostic matrix, you ensure that every troubleshooting run starts with empirical evidence, isolating the true failure coordinate immediately.

## Putting It All Together

Operating a resilient cloud system requires connecting application symptoms to exact service blocks:

*   **Triage by App Job**: Start every diagnostic run by mapping the symptom to the correct service family; never scale capacity blindly without evidence.
*   **Secure the Access Loop**: Leverage Managed Identities cabled to Key Vault and RBAC assignments to decouple credentials from images.
*   **Map target Ingress Ports**: Align your container app's `targetPort` configurations with your container code's internal network binding port to prevent gateway timeout errors.
*   **Acknowledge the Serverless Fabric**: Recognize that Azure Container Apps abstracts AKS, Envoy, and KEDA under the hood, managing scaling and traffic transitions.
*   **Isolate Database Latency**: Look past database CPU metrics during connection drops, inspecting I/O bottlenecks, active connection limits, and query index definitions first.

---

**References**

* [Azure Container Apps Architecture](https://learn.microsoft.com/en-us/azure/container-apps/overview) - Core serverless fabric and orchestration components.
* [Envoy Proxy Ingress and Routing](https://www.envoyproxy.io/docs/envoy/latest/) - Technical details of Envoy edge path proxying.
* [Kubernetes Event-driven Autoscaling (KEDA)](https://keda.sh/) - Event autoscaling patterns and metrics operators.
* [Azure Service Map and Triage Workflows](https://learn.microsoft.com/en-us/azure/architecture/guide/) - Best practices for cloud infrastructure operations.
