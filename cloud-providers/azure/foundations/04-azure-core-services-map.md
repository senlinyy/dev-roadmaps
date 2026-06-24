---
title: "Azure Core Services Map"
description: "Map an Azure application to the service families that carry traffic, run code, store state, protect access, publish evidence, release changes, and control cost."
overview: "After the Azure boundary and resource identity articles, the service list can be read as a map of jobs. This article follows one Orders API through traffic, compute, state, access, signals, deployment, cost, and recovery."
tags: ["azure", "services", "container-apps", "monitoring", "managed-identities"]
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

1. [The Job-Based Map](#the-job-based-map)
2. [The Orders API](#the-orders-api)
3. [Traffic: What Handles Public Entry](#traffic-what-handles-public-entry)
4. [Compute: Where the Code Runs](#compute-where-the-code-runs)
5. [State: Where Data Survives](#state-where-data-survives)
6. [Access: Identity, RBAC, and Secrets](#access-identity-rbac-and-secrets)
7. [Signals: Logs, Metrics, and Traces](#signals-logs-metrics-and-traces)
8. [Operations: Deployment, Cost, and Recovery](#operations-deployment-cost-and-recovery)
9. [Debugging with the Map](#debugging-with-the-map)
10. [Putting It All Together](#putting-it-all-together)

## The Job-Based Map
<!-- section-summary: An Azure core services map groups product names by the application job they perform, so traffic, runtime, state, access, signals, release, cost, and recovery each have a clear place. -->

An **Azure core services map** is a small operating map for an application. It connects each important application job to the Azure service family that performs that job. The point is to stop treating Azure as a long product menu and start treating it as a set of cooperating parts around one real system.

Imagine a junior engineer joining the on-call rotation for a production Orders API. On day one, the useful list is much smaller than the Azure catalog: where public traffic enters, where the code runs, where order data lives, which identity reads secrets, where logs land, where container images come from, who owns the resource group, how cost is tracked, and how the team restores data after a bad day.

That gives us the structure for the whole article:

| Application job | Plain English question | Common Azure service families |
|---|---|---|
| **Traffic entry** | How does a browser or client reach the app? | Azure DNS, Azure Front Door, Application Gateway, API Management, runtime ingress |
| **Compute runtime** | Where does the code receive CPU, memory, network, and scale behavior? | Azure Virtual Machines, App Service, Azure Container Apps, Azure Functions, AKS |
| **Persistent state** | Where does data survive after containers restart or deployments replace code? | Azure SQL Database, Azure Blob Storage, Azure Cosmos DB, managed disks |
| **Access and secrets** | Which workload identity can read which service or secret? | Microsoft Entra ID, managed identities, Azure RBAC, Azure Key Vault |
| **Signals** | Where do logs, metrics, traces, and activity records go? | Azure Monitor, Log Analytics, Application Insights, diagnostic settings, Activity Log |
| **Release path** | Where does the deployable artifact live, and which running version uses it? | Azure Container Registry, Container Apps revisions, App Service deployment slots |
| **Cost ownership** | Which team, service, and environment created this spend? | Resource groups, tags, Cost Management, budgets |
| **Recovery** | Which data and workloads can be restored after failure or deletion? | Azure Backup, database restore features, storage redundancy, soft delete |

If you know AWS, use this as a first translation layer. The job is the stable part; the Azure scope, identity model, and runtime boundary are the details to check before you design or troubleshoot.

| Application job | Familiar AWS anchor | Azure detail to notice |
|---|---|---|
| **Traffic entry** | Route 53, CloudFront, ALB, NLB, AWS WAF | Front Door is the global HTTP edge, Application Gateway is regional layer 7, and Azure Load Balancer is lower-level load balancing. |
| **Compute runtime** | EC2, Elastic Beanstalk, App Runner, ECS/Fargate, Lambda, EKS | Azure choices range from VMs to App Service, Container Apps, Functions, and AKS, with different release and scaling surfaces. |
| **Persistent state** | RDS/Aurora, S3, DynamoDB, EBS | Azure SQL, Blob Storage, Cosmos DB, and Managed Disks each match a different data contract. |
| **Access and secrets** | IAM, IAM Identity Center, Secrets Manager, KMS | Microsoft Entra ID, Azure RBAC, managed identities, and Key Vault split identity, authorization, and secret storage across Azure scopes. |
| **Signals** | CloudWatch, CloudWatch Logs Insights, X-Ray, CloudTrail | Azure Monitor, Log Analytics, Application Insights, and Activity Log cover the operating evidence path. |
| **Release path** | ECR, CodePipeline, CodeBuild, CodeDeploy, Lambda aliases, ECS deployments | Azure Container Registry, slots, revisions, and traffic weights provide Azure-native rollout handles. |
| **Cost ownership** | Cost Explorer, AWS Budgets, cost allocation tags | Cost Management, budgets, resource groups, and tags turn Azure spend into owner-aware views. |
| **Recovery** | AWS Backup, EBS snapshots, S3 Versioning/Object Lock, RDS PITR | Azure Backup, database PITR, Blob versioning, soft delete, snapshots, and redundancy form the recovery map. |

This map should stay close to the system people operate today. A map with future services, unclear owners, and half-finished guesses looks impressive in a diagram tool, then causes pain during an incident. A useful first map is small, named, and tied to real resource IDs, tags, logs, and deployment records.

The rest of the article uses one application so the sections connect naturally. We will keep coming back to the same Orders API and follow the request path through the service families as one connected system.

## The Orders API
<!-- section-summary: The example system is one production Orders API with a public entry path, managed container runtime, database, object storage, workload identity, vault, telemetry, image registry, tags, and recovery plan. -->

Our example application is `devpolaris-orders-api`, a regional checkout backend for a small ecommerce product. It accepts HTTPS requests, creates orders, stores receipts, writes logs, and runs in the production resource group `rg-devpolaris-orders-prod`. The team has tagged the group with `team=orders`, `env=prod`, `service=orders-api`, and `owner=backend` so billing, ownership, and incident review have real labels.

The first production version uses a deliberately small set of services. The API runs as a container in **Azure Container Apps**. The image comes from **Azure Container Registry**. Order records live in **Azure SQL Database**. Receipt PDFs and export files live in **Azure Blob Storage**. The runtime uses a **managed identity** to read secrets from **Azure Key Vault** and to access approved Azure resources through **Azure RBAC**. Logs and traces go to **Azure Monitor**, **Log Analytics**, and **Application Insights**.

Here is the request path in one service map:

![Orders API service map showing the customer browser, Azure DNS, public entry, Container Apps, state, access, signals, and operations services](/content-assets/articles/article-cloud-providers-azure-foundations-core-services/orders-api-service-map.png)

*This map shows how one request depends on traffic, compute, state, access, signals, and operational evidence around the same Orders API.*

This image also shows why a service map is more than a traffic diagram. The request comes through public entry and compute, but the system depends on identity, secrets, database access, blob writes, image history, logs, tags, and recovery choices. The next sections walk through each row of the map with this same app in mind.

## Traffic: What Handles Public Entry
<!-- section-summary: Traffic entry services handle DNS, TLS, routing, WAF, backend health, API policy, and public access before a request reaches the application runtime. -->

**Traffic entry** is the part of the system that receives client requests before the code handles them. It includes DNS names, HTTPS certificates, routing rules, web application firewall policy, backend health checks, API quotas, and the final handoff to the runtime. In plain English, traffic entry answers, "How does a request for `orders.devpolaris.example` reach the Orders API in a controlled way?"

For the first release, a simple regional API might use the built-in HTTPS endpoint from App Service or Container Apps ingress. That can be a completely reasonable starting point for a small team because the runtime already gives the app a hostname, TLS support, and a direct backend target. The map should still name that choice clearly, because someone debugging a 502 needs to know where TLS terminates and where backend health gets checked.

As the app grows, other entry services earn a place when their specific job appears:

| Service | Beginner definition | Orders API example |
|---|---|---|
| **Azure DNS** | DNS hosting for names and records. It maps a friendly name to the service endpoint clients should reach. | `orders.devpolaris.example` points to the public entry endpoint for the API. |
| **Azure Front Door** | A global edge entry service for HTTP and HTTPS apps. It can route through Microsoft's edge network, apply WAF rules, and send traffic to different origins. | The Orders team adds Front Door when customers in several regions need a global entry point and multi-region routing. |
| **Application Gateway** | A regional layer 7 load balancer. It routes by HTTP host name or path, handles TLS, checks backend health, and can run WAF close to a virtual network boundary. | `/api/orders/*` goes to the Orders backend while `/api/inventory/*` goes to a different backend in the same region. |
| **API Management** | An API gateway and API product layer. It applies policies such as quotas, subscriptions, token checks, transformations, and developer access. | Partner apps call Orders through a managed API product with request limits and versioned policies. |
| **Runtime ingress** | The entry feature built into a hosting service such as Container Apps or App Service. It exposes the app directly through the runtime's supported endpoint. | The first release exposes the Container App through HTTPS ingress while the team proves product demand. |

The important habit is matching the entry service to the job. A hostname alone points toward DNS. Global edge routing and WAF point toward Front Door. Regional HTTP routing and private backend health point toward Application Gateway. API products, quotas, and caller policy point toward API Management. A small first release can stay on runtime ingress until one of those jobs is real.

Traffic connects naturally to compute because entry services hand accepted requests to a runtime. Once the request passes the public entry layer, Azure needs a place that can start the Orders API process, keep it healthy, scale it, and expose logs.

## Compute: Where the Code Runs
<!-- section-summary: Compute services give application code CPU, memory, networking, lifecycle, scale behavior, and an ownership contract, from full virtual machine control to managed app and function runtimes. -->

**Compute** is the runtime layer where code executes. It gives the app CPU, memory, process startup, network attachment, scale rules, and health behavior. A compute choice also decides the ownership contract between your team and Azure: how much operating system, container orchestration, patching, and scaling work your team accepts.

The Orders API is a containerized HTTP backend, so **Azure Container Apps** fits the first production version well. The team builds a Docker image, pushes it to Azure Container Registry, deploys it to Container Apps, and lets the platform manage much of the container hosting surface. The team still owns the application code, image contents, resource limits, ingress configuration, environment variables, identity assignment, and scale settings.

Azure offers several compute shapes, and each one gives a different amount of control:

| Compute service | What it is | Good fit |
|---|---|---|
| **Azure Virtual Machines** | Virtual servers where your team manages the guest operating system, patches, installed software, disks, and many scaling choices. | Legacy software, custom OS needs, specialized agents, or workloads that require server-level control. |
| **Azure App Service** | Managed web app hosting for APIs, web apps, and mobile backends. Azure handles much of the infrastructure while your team configures app settings, scaling, slots, and runtime choices. | Standard web APIs and backend apps that fit a supported language/runtime model. |
| **Azure Container Apps** | A serverless container platform for running containerized apps and jobs. It supports ingress, revisions, traffic splitting, managed environments, Dapr integration, and KEDA-based scale rules. | HTTP APIs, background workers, queue consumers, and microservices where the team wants containers while Azure manages much of the hosting platform. |
| **Azure Functions** | Event-driven compute for small units of code triggered by HTTP, timers, queues, events, and other bindings. | Event handlers, scheduled jobs, queue processors, and workflows that fit function-style execution. |
| **Azure Kubernetes Service** | Managed Kubernetes control plane with worker nodes, Kubernetes objects, cluster networking, ingress controllers, and platform extensions. | Teams that need Kubernetes APIs, custom controllers, service mesh patterns, cluster-level policies, or shared platform control. |

For `devpolaris-orders-api`, the service map can begin with Container Apps because the app is one containerized HTTP API with logs, database access, secrets, and a small on-call team. AKS is a serious option later when the team needs Kubernetes-level platform features, shared cluster networking, custom controllers, or deep multi-service orchestration. More control can be useful, and it also adds platform work that someone must operate.

Container Apps has a few concepts worth naming because they show up during real incidents:

| Container Apps concept | Simple definition | Production example |
|---|---|---|
| **Managed environment** | The boundary where one or more container apps share networking, logging, Dapr settings, and platform configuration. | Orders and Inventory run in the same production environment so they can communicate through internal service names. |
| **Ingress** | The Container Apps feature that exposes an app to public traffic, virtual network traffic, or other apps in the same environment. | Orders exposes HTTPS ingress on target port `8080`. |
| **Revision** | An immutable version record for a container app template. Image, environment variable, resource, and scale changes can create new revisions. | `orders-api--v184` runs 100 percent of traffic after release, while an older revision remains available for rollback in multiple revision mode. |
| **Scale rule** | A rule that tells the platform how many replicas to run based on HTTP traffic, CPU, memory, queues, or other KEDA-supported signals. | The API keeps one warm replica during business hours and scales out when HTTP concurrency rises. |

Here is the kind of runtime evidence the team expects to retrieve from Azure CLI during review:

```bash
az containerapp show \
  --name devpolaris-orders-api \
  --resource-group rg-devpolaris-orders-prod \
  --query "{fqdn:properties.configuration.ingress.fqdn,targetPort:properties.configuration.ingress.targetPort,image:properties.template.containers[0].image,revisionMode:properties.configuration.activeRevisionsMode}"
```

That command asks Azure for the hostname, ingress target port, image reference, and revision mode. Those fields matter because many production failures hide in those small details. A container that listens on `3000` while ingress forwards to `8080` can produce gateway errors even though the resource exists. A revision pointing at the wrong image tag can keep old code running even though the release pipeline says it deployed.

Compute gives the Orders API a running process. The next question is where the application data goes after that process exits, scales in, crashes, or gets replaced by a new revision.

## State: Where Data Survives
<!-- section-summary: State services keep business data after runtimes restart, and Azure separates relational records, object files, document data, and attached disk storage into different service families. -->

**State** is the data that must survive beyond one request or one running container. Cloud compute is replaceable by design. A new revision can replace old replicas, scaling can remove idle containers, and a failed host can disappear from the system. The Orders API needs state services because order records, receipts, export files, and audit data must remain after those runtime events.

Azure splits state services by data shape and access pattern. A relational order ledger behaves differently from a PDF receipt. A shopping cart document behaves differently from a virtual machine disk. The service map should name the data type and the service that owns it.

| State need | Azure service | What it means in practice |
|---|---|---|
| **Relational transactions** | **Azure SQL Database** | Managed relational database for structured rows, SQL queries, indexes, constraints, transactions, backups, and high availability features. |
| **Unstructured files** | **Azure Blob Storage** | Object storage for files such as receipts, images, CSV exports, raw logs, backups, and data lake objects. |
| **Document or globally distributed NoSQL data** | **Azure Cosmos DB** | Fully managed database for document, key-value, and globally distributed app patterns where partitioning, latency, and scale are central design choices. |
| **Attached block storage** | **Managed disks** | Durable disks attached to virtual machines for operating systems and VM-based workloads. |

For `devpolaris-orders-api`, Azure SQL Database stores the core order tables. A checkout request creates an `orders` row, `order_items` rows, and a payment state record inside a transaction. A transaction means the database treats a group of changes as one unit: either the whole order commit succeeds, or the database rolls it back so the system avoids a half-written order.

Blob Storage stores receipt PDFs and export files. Those files can become large, and their main needs are object APIs, lifecycle controls, access tiers, and durable file storage. A blob has a storage account, container, and object name, such as `receipts/2026/06/order-10492.pdf`. The database can store the blob URL or object key while Blob Storage handles the file bytes.

Cosmos DB enters the conversation when the data behaves like high-scale document data. For example, a global shopping cart service might store one document per cart, partition by customer or cart ID, and serve low-latency reads from multiple regions. That is a different job from a relational order ledger that needs strong relational constraints and transactional reporting.

Managed disks belong mostly to VM-based designs. If the Orders team ran a legacy inventory daemon on a VM, the VM might need an OS disk and a data disk. For the Container Apps version, the app treats local container storage as temporary scratch space and sends durable data to Azure SQL Database or Blob Storage.

Managed state still needs ownership. Azure SQL Database removes much of the platform work around patching and availability, and the team still owns schema design, query shape, indexes, connection pooling, access policy, backup settings, restore tests, and data growth. A managed service reduces infrastructure chores; application data responsibility stays with the team.

Now the runtime has somewhere to write data. The next problem is access. The Orders API needs to prove which workload is calling SQL, Blob Storage, and Key Vault, and Azure needs a way to allow only the right actions.

## Access: Identity, RBAC, and Secrets
<!-- section-summary: Access connects a workload identity, Azure RBAC assignments, and Key Vault so running code can call approved services while keeping long-lived credentials out of the image. -->

**Access** is the set of identity and authorization decisions that decide what the running app can do. In Azure, the important pieces are **Microsoft Entra ID**, **managed identities**, **Azure RBAC**, and **Azure Key Vault**. Entra ID names the caller, managed identity gives an Azure resource a workload identity, RBAC grants actions at a scope, and Key Vault stores secrets, keys, and certificates.

For the Orders API, the container app gets a managed identity named by Azure. That identity is the runtime caller. Instead of putting a storage key, database password, or Key Vault client secret in the image, the app asks the Azure platform for a short-lived token for its managed identity. Azure issues the token through Microsoft Entra ID, and the app uses that token when it calls Azure services that trust Entra authentication.

The Key Vault read path looks like this:

![Managed identity access path showing an Orders container asking the local identity endpoint, Microsoft Entra ID issuing a short-lived token, and Azure Key Vault checking RBAC before returning a secret](/content-assets/articles/article-cloud-providers-azure-foundations-core-services/managed-identity-access-path.png)

*The access path separates identity from authorization: the token proves the workload, and the vault permission decides what the workload can read.*

There are two beginner-friendly ideas inside this flow. First, the managed identity belongs to the workload, so logs and access checks can point to the app identity and avoid a copied password. Second, Key Vault still checks authorization. A token proves the caller, and a role assignment or vault access rule decides whether that caller can read the secret.

In a production review, the map should name the caller and the scope, for example:

```bash
az role assignment create \
  --assignee "<managed-identity-principal-id>" \
  --role "Key Vault Secrets User" \
  --scope "/subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-orders-prod/providers/Microsoft.KeyVault/vaults/kv-devpolaris-orders-prod"
```

That command shows the shape of the authorization record: one principal, one role, and one scope. If the app receives `403 Forbidden` from Key Vault, the team can check the managed identity principal ID, the assigned role, the vault scope, the vault network settings, and the exact secret operation being attempted. The map turns a vague phrase like "the app can read secrets" into reviewable facts.

Access connects directly to signals because identity failures only become useful when someone can see them. The next row of the map collects the evidence that proves what the app, platform, and Azure control plane experienced.

## Signals: Logs, Metrics, and Traces
<!-- section-summary: Signals are the logs, metrics, traces, alerts, and activity records that leave the runtime and give operators evidence during normal operation and incidents. -->

**Signals** are the evidence a system emits while it runs. Logs explain events, metrics show numeric behavior over time, traces connect one request across components, and activity records show Azure control-plane changes. Those signals give the on-call engineer proof that the diagram matches the live system.

In Azure, the main observability family is **Azure Monitor**. Azure Monitor includes metrics, logs, alerts, dashboards, Log Analytics, and Application Insights. **Log Analytics** stores and queries logs with Kusto Query Language, usually called KQL. **Application Insights** focuses on application telemetry such as requests, dependencies, exceptions, performance, and distributed traces.

For the Orders API, signals should cover at least four paths:

| Signal path | What it should answer | Example evidence |
|---|---|---|
| **Application logs** | What did the app code say happened? | Checkout validation errors, payment provider timeouts, request IDs, structured JSON logs. |
| **Request telemetry** | Did the request reach the app, and how long did it take? | HTTP result codes, duration, route name, operation ID, dependency calls. |
| **Platform metrics** | Did the runtime or dependency run out of capacity? | Replica count, CPU, memory, HTTP concurrency, SQL DTU or vCore metrics, storage latency. |
| **Control-plane activity** | Who changed infrastructure or configuration? | Activity Log events for revision updates, role assignments, firewall changes, deleted resources. |

The map should name where those signals land. For example, `devpolaris-orders-api` sends application telemetry to an Application Insights resource connected to a Log Analytics workspace. The Container Apps environment also sends platform logs and metrics to Azure Monitor. Critical resources such as Key Vault, Azure SQL Database, and storage accounts can use diagnostic settings to send service logs to the same workspace.

Here is a small KQL query the team might use during a checkout incident:

```kusto
requests
| where cloud_RoleName == "devpolaris-orders-api"
| where timestamp > ago(30m)
| project timestamp, operation_Id, name, resultCode, duration, success
| order by timestamp desc
```

This query asks Application Insights for recent request records from the Orders API. The useful field is `operation_Id`, because that ID can connect the request row to traces, dependency calls, exceptions, and custom logs from the same request. When failed public requests are missing from app telemetry, the evidence points back toward traffic entry or runtime ingress before the app code.

Signals naturally connect to operations. Logs and metrics tell the team what happened after a deploy, cost records show what the system consumed, and backup or restore evidence proves the team can recover.

## Operations: Deployment, Cost, and Recovery
<!-- section-summary: Operations connect image origin, running versions, resource boundaries, tags, budgets, cost evidence, backups, and restore plans so the application remains manageable after launch. -->

**Operations** are the habits and services that keep the system manageable after the first successful deploy. This row of the map answers questions such as: Where did this container image come from? Which revision is running it? Which resource group owns the app? Which tags connect spend to the team? Which backup or restore path protects the data?

For deployments, the Orders API needs an artifact path and a runtime version path. **Azure Container Registry** stores the container images and related artifacts. **Container Apps revisions** record which image and template are running. If the app used App Service instead, **deployment slots** could hold staging and production versions for safer swaps.

That release chain should be reviewable:

![Release and operations evidence showing source code, build pipeline, Azure Container Registry, Container Apps revision, production traffic, cost tags, release signals, and recovery path](/content-assets/articles/article-cloud-providers-azure-foundations-core-services/release-operations-evidence.png)

*The release map keeps artifact history, running revision, traffic weight, cost ownership, signals, and recovery evidence in one operating view.*

If a release says it deployed version `1.8.4`, the team should be able to confirm that the image exists in ACR and that the active Container Apps revision references that exact tag or digest. A missing image tag points to the artifact path. A healthy image with a failing revision points to runtime configuration, identity, state, or code behavior.

For ownership and cost, the map should name the **resource group** and the core tags. The practice environment uses:

```bash
az group show \
  --name rg-devpolaris-orders-prod \
  --query "{id:id,location:location,tags:tags}"
```

The expected output should prove the production boundary:

```json
{
  "id": "/subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-orders-prod",
  "location": "eastus",
  "tags": {
    "team": "orders",
    "env": "prod",
    "service": "orders-api",
    "owner": "backend"
  }
}
```

Those tags matter during cost review. If monthly spend doubles, the team can group Azure Cost Management data by subscription, resource group, tag, or service family before changing infrastructure. The first evidence might show extra Log Analytics ingestion, SQL scale-up, storage growth, runaway retries, or an accidentally duplicated environment.

For recovery, the service map should list the data that needs restore behavior. Azure SQL Database has built-in backup and restore capabilities that depend on the selected service tier and configuration. Storage accounts can use redundancy, versioning, soft delete, and lifecycle policy depending on the workload. Azure Backup can protect supported workloads and centralize backup management for VMs, disks, files, and other scenarios. The key habit is a tested restore path with evidence from a real drill.

At this point the map covers the live system. The final operating skill is using the same rows during an incident so the team moves through portal pages with a reason.

## Debugging with the Map
<!-- section-summary: Debugging with the service map means matching each symptom to the row that can explain it, then moving through traffic, compute, identity, state, signals, release, cost, and recovery with evidence. -->

**Debugging with the map** means matching a symptom to the service family that can explain it. The team looks for evidence in the row closest to the symptom, then moves to the next row when the evidence points there. This keeps an incident review focused.

Here are common symptoms for `devpolaris-orders-api`:

| Symptom | First map row to inspect | Why that row comes first |
|---|---|---|
| `502 Bad Gateway` and missing app request logs | **Traffic entry** and **compute ingress** | The request may fail before the app receives it. Backend health, target port, active revision, and ingress settings matter first. |
| New deploy still runs old behavior | **Release path** and **compute revision** | The image tag, ACR artifact, active revision, and traffic weight explain what code is actually running. |
| Key Vault returns `Forbidden` | **Access** | The managed identity, RBAC role, scope, vault network settings, and requested secret operation decide the result. |
| SQL connection times out | **State** and **network access** | The app may authenticate correctly while still failing reachability, firewall, private endpoint, route, or connection pool checks. |
| Only receipt downloads fail | **Blob Storage** and **access** | The checkout database can be healthy while object path, container permissions, token expiry, or storage firewall settings fail. |
| Cost doubles while the app stays healthy | **Operations and cost** | Tags, resource groups, service family cost, logs ingestion, database scale, and storage growth provide first evidence. |

Let us walk one incident through the map. Users report `502 Bad Gateway` at `https://orders.devpolaris.example`. The support dashboard is missing the request IDs in Application Insights. Database CPU is normal, and recent SQL queries look healthy. That evidence points to traffic entry and runtime ingress before the app code.

The first useful runtime check collects the active ingress and image fields:

```bash
az containerapp show \
  --name devpolaris-orders-api \
  --resource-group rg-devpolaris-orders-prod \
  --query "{fqdn:properties.configuration.ingress.fqdn,targetPort:properties.configuration.ingress.targetPort,image:properties.template.containers[0].image,provisioningState:properties.provisioningState}"
```

Suppose the command returns `targetPort: 8080`, and the latest release changed the Node.js app to listen on `3000`. That one mismatch explains why entry can reach the Container App surface while the backend remains unhealthy. The resolution belongs in compute configuration or app startup before SQL tuning or Key Vault permissions.

Now imagine a different incident. The API logs show `Forbidden` when reading `sql-orders-connection` from Key Vault. Public traffic reaches the app, and the app starts normally. The map moves to access because the symptom names the vault. The team checks the managed identity on the container app, the role assignment on the vault, the role name, the scope, and any vault network restrictions. A missing `Key Vault Secrets User` assignment at the vault scope would explain the failure.

The value of the map is calm sequencing. Traffic evidence can lead to compute. Compute logs can lead to access. Access can lead to state. State errors can lead back to network or secrets. The map gives the team a shared language for moving through the system with proof.

## Putting It All Together
<!-- section-summary: A useful Azure core services map stays small, names current services and owners, follows one request path, includes evidence sources, and grows as new services take on real jobs. -->

The Azure core services map is a way to make a production app readable. It turns a long list of product names into a small set of jobs around one workload: traffic entry, compute runtime, durable state, access, signals, release, cost, and recovery.

For `devpolaris-orders-api`, the first map can stay compact. Public entry handles DNS, HTTPS, routing, WAF, or API policy as needed. Container Apps runs the API from an image in Azure Container Registry. Azure SQL Database stores order records, and Blob Storage stores receipts and exports. A managed identity reads Key Vault through Azure RBAC. Azure Monitor, Log Analytics, and Application Insights store evidence. Resource groups and tags make ownership and cost visible. Backup and restore choices protect state.

The first version should describe the system people operate today. Extra services belong on the map when they perform a real current job. If the app later needs global edge routing, Front Door can join. If partner API quotas become important, API Management can join. If the team needs Kubernetes APIs and cluster-level control, AKS can join. Each addition should make operations clearer and give the diagram a real operating purpose.

This is the practical test for the map: during an incident, a new teammate should be able to answer where the request enters, where code runs, where state lives, which identity calls each dependency, where evidence lands, which artifact is running, who owns the resources, where cost appears, and how the data can be recovered. If the map answers those questions, it is doing useful work.

![Azure core services checklist summarizing traffic entry, compute runtime, durable state, access, signals, release path, cost ownership, and recovery around devpolaris-orders-api](/content-assets/articles/article-cloud-providers-azure-foundations-core-services/azure-core-services-checklist.png)

*Use this checklist as the quick scan before designing, deploying, or debugging a small Azure production service.*

---

**References**

- [Azure DNS overview](https://learn.microsoft.com/en-us/azure/dns/dns-overview) - Official Azure DNS overview for hosting zones, records, public DNS, private DNS, and DNS-based traffic services.
- [Azure Front Door overview](https://learn.microsoft.com/en-us/azure/frontdoor/front-door-overview) - Microsoft Learn guide for global HTTP/HTTPS edge delivery, routing, acceleration, and WAF scenarios.
- [Application Gateway overview](https://learn.microsoft.com/en-us/azure/application-gateway/overview) - Official overview for regional layer 7 load balancing, HTTP routing, TLS handling, and backend health.
- [Azure API Management key concepts](https://learn.microsoft.com/en-us/azure/api-management/api-management-key-concepts) - Official API Management concepts for API gateways, policies, products, versions, and developer access.
- [Azure Container Apps overview](https://learn.microsoft.com/en-us/azure/container-apps/overview) - Official overview for managed container apps, revisions, ingress, environments, and scale behavior.
- [Set scaling rules in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/scale-app) - Official scaling guide for KEDA-supported triggers, replicas, and scale settings.
- [Ingress in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview) - Official ingress documentation for public, virtual network, and environment-level traffic exposure.
- [Overview of Azure App Service](https://learn.microsoft.com/en-us/azure/app-service/overview) - Official overview for managed web app, API, and backend hosting.
- [Azure Functions overview](https://learn.microsoft.com/en-us/azure/azure-functions/functions-overview) - Official overview for serverless event-driven compute.
- [Overview of Azure virtual machines](https://learn.microsoft.com/en-us/azure/virtual-machines/overview) - Official virtual machine overview and responsibility notes.
- [Azure SQL Database overview](https://learn.microsoft.com/en-us/azure/azure-sql/database/sql-database-paas-overview?view=azuresql) - Official overview for managed SQL Database platform capabilities.
- [Introduction to Azure Blob Storage](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blobs-introduction) - Official introduction to object storage for unstructured data.
- [Azure Cosmos DB overview](https://learn.microsoft.com/en-us/azure/cosmos-db/overview) - Official overview for fully managed NoSQL and vector database scenarios.
- [Managed identities for Azure resources](https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/overview) - Official managed identity overview for credential-free workload authentication.
- [Azure Key Vault basic concepts](https://learn.microsoft.com/en-us/azure/key-vault/general/basic-concepts) - Official Key Vault concepts for secrets, keys, certificates, vaults, and managed HSM pools.
- [Azure Monitor overview](https://learn.microsoft.com/en-us/azure/azure-monitor/fundamentals/overview) - Official Azure Monitor overview for metrics, logs, analysis, alerts, and troubleshooting.
- [Azure Container Registry introduction](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-intro) - Official introduction to managed private container registries and artifacts.
- [Cost Management budgets](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets) - Official tutorial for creating and reviewing Azure budgets.
- [Azure Backup overview](https://learn.microsoft.com/en-us/azure/backup/backup-overview) - Official overview for Azure Backup data protection and recovery scenarios.
