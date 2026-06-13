---
title: "Container Apps"
description: "Run containerized Azure services by understanding environments, container apps, images, revisions, ingress, scale rules, secrets, identity, Dapr, and logs."
overview: "Azure Container Apps runs container images on a managed Azure platform. This article explains the core pieces a beginner needs before a container becomes a reliable production service."
tags: ["azure", "container-apps", "containers", "revisions", "scale"]
order: 3
id: article-cloud-providers-azure-compute-application-hosting-azure-container-apps
aliases:
  - azure-container-apps
  - cloud-providers/azure/compute-application-hosting/azure-container-apps.md
---

## Table of Contents

1. [What Is Container Apps](#what-is-container-apps)
2. [Managed Environments](#managed-environments)
3. [Container Apps and Replicas](#container-apps-and-replicas)
4. [Images and Registries](#images-and-registries)
5. [Revisions](#revisions)
6. [Ingress](#ingress)
7. [Scale Rules](#scale-rules)
8. [Secrets and Managed Identity](#secrets-and-managed-identity)
9. [Dapr and Sidecars](#dapr-and-sidecars)
10. [Logs](#logs)
11. [When Container Apps Fits](#when-container-apps-fits)
12. [Putting It All Together](#putting-it-all-together)
13. [What's Next](#whats-next)

## What Is Container Apps
<!-- section-summary: Azure Container Apps runs container images with managed ingress, revisions, scale rules, identity, and logs, while the team still owns the image and runtime configuration. -->

**Azure Container Apps** is a managed Azure service for running containerized applications. A containerized application is an application packaged as a container image, usually built from a Dockerfile, with the code, runtime, libraries, and startup command in one deployable artifact. Container Apps gives that image a place to run without asking the team to operate a Kubernetes cluster as the main daily surface.

We will keep one production example in our hands for the whole article. The team runs `devpolaris-orders`, an ecommerce backend in `rg-devpolaris-orders-prod`. The system has `ca-orders-api-prod`, a public HTTP API that receives checkout requests, and `ca-orders-worker-prod`, a background worker that reads messages from an Azure Storage Queue after each order is created.

Those two services are useful because they show the two common Container Apps shapes. The API needs a public HTTPS entry point, one warm replica during normal hours, safe releases, and logs tied to each revision. The worker needs no public endpoint, can scale down to zero while the queue is empty, and needs a managed identity so it can read queue messages and write receipt files without a stored password.

Here is the structure of Container Apps before we go deeper. Each concept answers one production question that appears during deployment, scaling, security review, or incident response.

| Concept | Plain meaning | Orders system example |
|---|---|---|
| **Managed environment** | The shared boundary for networking, logs, workload profiles, and related container apps. | `cae-orders-prod-eus` contains the Orders API and worker. |
| **Container app** | One deployable service definition inside the environment. | `ca-orders-api-prod` names the image, CPU, memory, ingress, identity, and scale behavior for the API. |
| **Replica** | One running instance of a revision. | Three API replicas can serve traffic during a sale. |
| **Image** | The packaged application artifact pulled from a registry. | `acrorders.azurecr.io/orders-api:2026-06-11.1` is the image the API revision runs. |
| **Revision** | A version snapshot created from revision-scoped configuration. | Revision `ca-orders-api-prod--v21` runs the new checkout code during a canary release. |
| **Ingress** | The rule that decides whether traffic can reach the app and which target port receives it. | The API uses external ingress on port `8080`; the worker keeps ingress disabled. |
| **Scale rule** | A trigger that decides when to add or remove replicas. | HTTP concurrency scales the API, and queue length scales the worker. |
| **Secret** | A named sensitive value available to the app configuration. | `stripe-webhook-secret` can be referenced by the API without appearing in source code. |
| **Managed identity** | An Entra ID identity attached to the running app. | The worker uses identity-based access to Storage instead of a connection string. |
| **Logs** | Console, system, and HTTP evidence used during operations. | The team checks system logs for image pull failures and console logs for application exceptions. |

The important beginner idea is that Container Apps gives containers a managed production wrapper. The team still owns the container image, startup behavior, listening port, environment variables, secrets, health behavior, role assignments, and cost limits. Azure handles much of the platform around those choices: the environment, ingress layer, revision lifecycle, scaling machinery, and log collection.

![Container Apps runtime shape showing customer traffic, ingress, managed environment, Orders API, Orders Queue, Orders Worker, managed identity, Blob Storage, and Log Analytics](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-azure-container-apps/container-apps-runtime-shape.png)

*The runtime shape keeps the API, worker, queue, identity, storage, and logs connected inside one managed environment.*

This is the bridge between the App Service article and the Functions article. App Service works well for a traditional web app or API that fits a managed web-hosting model. Container Apps becomes useful when the team wants container-first releases, worker processes, scale rules based on events, and optional sidecars while keeping the platform smaller than a full Kubernetes operating model.

## Managed Environments
<!-- section-summary: A managed environment is the shared Container Apps boundary for related apps, networking, logging, workload profiles, and isolation decisions. -->

A **managed environment** is the shared boundary around one or more container apps and jobs. It is the place where Azure groups related runtime concerns: networking, log destination, Dapr configuration, workload profiles, and platform operations. Microsoft describes the environment as a secure boundary, and that word matters because many production choices happen at this layer before one app starts.

For the Orders system, the production environment can be named `cae-orders-prod-eus`. The API, worker, and a small payment adapter can live inside it because they belong to the same product, region, lifecycle, and operations team. They can share a log destination, use the same network placement, and call each other through environment-level service discovery when the design allows it.

The environment also helps the team avoid mixing unrelated blast zones. Development, staging, and production usually deserve separate environments because they have different data, secrets, traffic, and access rules. A staging app that shares a production network boundary can become a strange security and debugging problem because traffic paths and logs start to blur together.

Networking starts at the environment. Azure can create a virtual network arrangement for the environment, or the team can provide an existing virtual network for more control. In production, teams often provide a VNet because they want private database access, predictable subnet planning, private endpoints, firewall routing, or clearer separation from other workloads.

The environment also carries the workload profile choice. A workload profile describes the compute capacity style available to apps in the environment. Many teams begin with consumption-style behavior because they want scale-to-zero and pay-per-use behavior for low or spiky traffic. Dedicated workload profiles become interesting when a workload needs more predictable capacity, specialized hardware, or stronger cost planning.

Logs belong in this conversation early. Apps in the same environment can write to the same Log Analytics workspace, which gives operators one place to query system logs, console logs, and related platform events. During an incident, the environment name tells the team which set of apps, logs, network rules, and platform events belong together.

This environment boundary gives us the shared home. The next question is what actually runs inside that home. That smaller unit is the container app.

## Container Apps and Replicas
<!-- section-summary: A container app is the service definition, while replicas are the running instances that serve traffic or process work. -->

A **container app** is the service definition for one workload inside a managed environment. It names the image, container resources, environment variables, ingress settings, revision mode, secrets, identity, and scale rules. The container app is the thing an operator opens when they want to know what the service is configured to run.

A **replica** is one running instance of a revision. If the Orders API has three replicas, Azure has started three copies of that revision so more requests can be handled at the same time. If the worker has zero replicas, the service definition still exists, but no running container is currently processing queue messages.

The Orders API profile might look like this in a production review. It gives the release lead and the on-call engineer the same facts in one place.

| Profile field | Example value | Why the team cares |
|---|---|---|
| **Environment** | `cae-orders-prod-eus` | Shows the shared network and log boundary. |
| **Container app** | `ca-orders-api-prod` | Names the service people deploy and debug. |
| **Image** | `acrorders.azurecr.io/orders-api:2026-06-11.1` | Shows the configured build. |
| **CPU and memory** | `0.5` CPU and `1Gi` memory | Sets the per-replica resource shape and cost. |
| **Target port** | `8080` | Tells ingress where the application listens. |
| **Ingress** | External HTTP | Lets customer traffic reach the API. |
| **Scale range** | `1` to `10` replicas | Keeps one warm replica and caps sale-day cost. |
| **Identity** | System-assigned managed identity | Lets the app call Azure resources without a stored credential. |

A first deployment command can show the same shape. The exact values change by company, but the fields are the important part: environment, image, resources, port, ingress, and replica limits.

```bash
az containerapp create \
  --resource-group rg-devpolaris-orders-prod \
  --environment cae-orders-prod-eus \
  --name ca-orders-api-prod \
  --image acrorders.azurecr.io/orders-api:2026-06-11.1 \
  --target-port 8080 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 10 \
  --cpu 0.5 \
  --memory 1Gi
```

This command tells Azure the runtime contract. The app needs to start from that image, bind to port `8080`, emit useful logs, and survive normal container restarts. Azure can add replicas up to the maximum, but each replica can only work if the container process starts correctly and listens where ingress sends traffic.

That last sentence becomes a common production story. A team can deploy a perfectly built image and still get `502` or `503` symptoms because the app listens on `3000` while Container Apps sends traffic to `8080`. The platform cannot guess the port from application code, so the target port becomes one of the first facts to check during a failed release.

The container app definition tells Azure what to run. The image tells Azure exactly which build to pull and start. That is where release evidence begins.

## Images and Registries
<!-- section-summary: A container image is the release artifact Container Apps pulls from a registry, so stable tags and registry access make releases understandable. -->

A **container image** is the packaged application artifact. It includes the application code, runtime, libraries, and default startup command. Container Apps pulls that image from a registry such as Azure Container Registry, Docker Hub, GitHub Container Registry, or another supported registry when it starts replicas.

For the Orders API, the registry is Azure Container Registry at `acrorders.azurecr.io`. The build pipeline creates an image after tests pass, pushes it to the registry, and deploys that image to Container Apps. The build pipeline handles source compilation and image creation before deployment, and the running service starts the artifact the team already built.

The tag matters because it becomes release evidence. A tag like `2026-06-11.1` or a Git commit SHA tells the team which build is expected to run. A tag like `latest` can point to a different build later, which makes incidents confusing because the deployment record and the registry state can drift apart.

```bash
GIT_SHA=$(git rev-parse --short HEAD)

docker build \
  -t acrorders.azurecr.io/orders-api:$GIT_SHA \
  .

docker push acrorders.azurecr.io/orders-api:$GIT_SHA
```

The image also needs cloud-friendly behavior. A useful process writes logs to standard output and standard error, because Container Apps collects those streams as console logs. The process handles `SIGTERM` cleanly, because scale-in, revision deactivation, and app deletion can ask a container to shut down. Durable data belongs in Azure SQL, Blob Storage, Redis, or another external service, because local container storage behaves like temporary runtime space.

Private registry access needs its own security path. A quick demo might use a registry username and password, but production teams usually prefer managed identity for Azure Container Registry pulls. The container app gets an identity, the registry receives the right pull permission, and the image pull path avoids a long-lived password sitting in deployment configuration.

Images answer the artifact question. Revisions answer the versioned runtime question: once this image and template are deployed, how does Azure remember and route the running version?

## Revisions
<!-- section-summary: A revision is an immutable runtime snapshot, and revision mode decides whether releases replace one another or run side by side for controlled traffic movement. -->

A **revision** is an immutable snapshot of a container app version. It records the revision-scoped parts of the app, such as container image, container configuration, resource allocation, environment variable mappings, and scale rules. When those template values change, Azure creates a new revision.

The first deployment of `ca-orders-api-prod` creates the first revision. A later deployment that changes the image from `orders-api:2026-06-11.1` to `orders-api:2026-06-11.2` creates another revision. That gives the team a versioned trail instead of one mutable service record that keeps overwriting itself.

```bash
az containerapp update \
  --resource-group rg-devpolaris-orders-prod \
  --name ca-orders-api-prod \
  --image acrorders.azurecr.io/orders-api:2026-06-11.2
```

Revision mode controls how many revisions can actively run. **Single revision mode** keeps the app on one active revision at a time. Azure keeps the old revision serving traffic until the new one becomes ready, then moves traffic to the new revision. This mode works well for simple services where each release replaces the previous one.

**Multiple revision mode** allows more than one revision to run at the same time. This is useful for canary releases, blue-green releases, A/B tests, and direct testing through revision labels. The Orders team can send 90 percent of traffic to the stable revision and 10 percent to the candidate revision while they watch errors, latency, checkout conversion, and logs.

| Release question | Single revision mode | Multiple revision mode |
|---|---|---|
| How many active versions usually run? | One active revision. | More than one active revision can run. |
| How does a normal deploy behave? | New ready revision replaces the old active revision. | Team chooses active revisions and traffic weights. |
| What is the simple fit? | Straight replacement releases. | Canary, blue-green, A/B testing, and direct revision testing. |
| What do operators watch? | New revision readiness and rollback path. | Traffic weights, labels, old revision state, and metric split by revision. |

![Container Apps ingress splitting live traffic between a stable revision and a canary revision with rollback and monitoring paths](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-azure-container-apps/revisions-traffic-split.png)

*Traffic splitting lets the team compare a stable revision with a canary revision while logs and metrics decide the next move.*

Application-scoped settings behave differently from revision-scoped settings. Ingress configuration, traffic splitting rules, revision mode, registry credentials, Dapr settings, and secret values live under the app-level configuration. These changes can apply without creating a new revision, although secrets still need careful handling because existing running revisions may need a restart or a fresh revision before the container sees the new value.

That separation matters during real releases. If the team changes the API image, they expect a new revision. If the team changes traffic weights from 10 percent canary to 50 percent canary, they are changing routing rather than creating a new build. If the team rotates a secret, they need to plan how running replicas pick up the new secret instead of assuming a revision appeared automatically.

Revisions give us a safe release path. The next question is how traffic reaches one of those revisions in the first place.

## Ingress
<!-- section-summary: Ingress controls inbound reachability, protocol, target port, and traffic routing, so it is the first place to check for many HTTP failures. -->

**Ingress** is the Container Apps setting that controls inbound traffic. It decides whether an app receives requests from the public web, from inside the environment, from a virtual network path, or from nowhere at all. It also defines the protocol and the target port that Azure uses to reach the container.

For `ca-orders-api-prod`, external HTTP ingress makes sense because customers and frontend services need a public HTTPS path to the API. For `ca-orders-worker-prod`, ingress can stay disabled because the worker reads messages from a queue and only needs outbound access to Azure services. Exposing a public endpoint for a queue worker adds attack surface without helping the worker do its job.

There are three everyday reachability shapes. Each one gives the same container a different exposure boundary.

| Ingress shape | Plain meaning | Orders system example |
|---|---|---|
| **Disabled** | No inbound endpoint for the app. | `ca-orders-worker-prod` processes queue messages only. |
| **Internal** | Reachable inside the Container Apps environment, and in supported VNet paths for the environment. | `ca-payments-adapter-prod` receives calls through the internal application path. |
| **External** | Reachable through the environment inbound address and public endpoint when the environment has public inbound access. | `ca-orders-api-prod` receives customer checkout requests. |

The target port is the small setting that causes many large incidents. If the Node.js app listens on `8080`, ingress needs target port `8080`. If the app listens on `3000` and the container app targets `8080`, Azure can route traffic to the replica and still fail because nothing accepts the connection on that port.

HTTP ingress brings useful platform behavior. Container Apps can provide TLS termination, HTTP/1.1 and HTTP/2 support, WebSocket and gRPC support, request routing, custom domains, CORS settings, authentication integration, IP restrictions, and traffic splitting between active revisions. The app still needs to treat forwarded headers carefully, especially any client IP data that can cross proxies before it reaches the service.

Ingress also connects directly to release safety. In multiple revision mode, traffic weights live at the ingress layer. The team can move a small percentage of public traffic to the candidate revision, inspect the result, and then either increase the weight or send traffic back to the stable revision.

Traffic gets requests into the app. Scale rules decide how many replicas exist when that traffic or event load changes.

## Scale Rules
<!-- section-summary: Scale rules watch HTTP, TCP, CPU, memory, or event signals and adjust replica counts within the minimum and maximum limits. -->

A **scale rule** tells Container Apps when to add or remove replicas. The rule watches a signal, compares it to a threshold, and asks the platform for more or fewer running instances within the configured minimum and maximum replica counts. Container Apps uses KEDA-supported scaling for many event sources, so a worker can scale from a queue backlog before the container has started.

The API and the worker need different scale rules because they do different jobs. The API serves HTTP requests, so HTTP concurrency gives the team a natural signal. The worker processes queue messages, so queue length gives the team a natural signal. Both apps run on Container Apps, but their scale behavior follows the work they perform.

| Workload | Useful scale signal | Example behavior |
|---|---|---|
| **Public API** | HTTP concurrency | Add replicas when concurrent requests per replica pass the threshold. |
| **TCP service** | TCP connection count | Add replicas when active TCP connections increase. |
| **Queue worker** | Queue depth through a KEDA scaler | Add replicas when pending messages build up. |
| **Steady processor** | CPU or memory | Add replicas when replicas stay busy or memory pressure rises. |

Minimum replicas decide the cold-start tradeoff. If `minReplicas` is `0`, the app can scale to zero and stop running replicas while idle. That can save money for development environments, internal tools, and background workers. The next request or event then waits while Azure allocates capacity and starts the container.

For `ca-orders-api-prod`, the team might keep `minReplicas` at `1` because checkout traffic benefits from avoiding first-replica wakeup. For `ca-orders-worker-prod`, `minReplicas` can be `0` because a small queue-processing delay may be acceptable and the worker has no customer-facing request path. The maximum replica value protects cost and downstream dependencies, because scaling the worker to 200 replicas can overwhelm the database even if the queue is huge.

CPU and memory scale rules need a small note. They help steady services that already have running replicas because they measure replica resource usage. A zero-replica app has no CPU or memory signal to measure, so HTTP and event-driven rules fit scale-to-zero designs better because the demand signal exists outside the sleeping container.

The scale rule only starts containers. The application still needs safe concurrency behavior, idempotent message handling, retry rules, and downstream limits. If ten worker replicas pick up the same kind of order event at once, the code and storage design need to handle parallel work safely.

Scaling creates more running code. That running code still needs secrets and identity before it can call databases, queues, registries, and other Azure services.

## Secrets and Managed Identity
<!-- section-summary: Secrets hold sensitive configuration, while managed identity gives a container app an Entra ID identity for passwordless access to Azure resources. -->

A **secret** in Container Apps is a named sensitive value stored at the container app level. The app can reference that secret from environment variables or scale rules. Secrets are useful for values that still exist as strings, such as third-party webhook signing secrets or legacy connection strings.

A **managed identity** is an identity from Microsoft Entra ID attached to the container app. The running app can use that identity to request tokens for Azure services that support Entra authentication. The team can then grant permissions with Azure RBAC instead of storing a password or access key in the app configuration.

The Orders worker gives us a clean example. It needs to read from an Azure Storage Queue and write receipt PDFs to Blob Storage. A weaker design stores a Storage connection string as a secret. A stronger Azure-native design gives `ca-orders-worker-prod` a managed identity, grants that identity the minimum required Storage roles, and lets the Azure SDK request tokens at runtime.

Managed identities come in two shapes. A **system-assigned identity** belongs to one container app and disappears when that app is deleted. A **user-assigned identity** is a separate Azure resource that can be attached to one or more apps. User-assigned identities are useful when a team wants to create the identity and role assignments before the app exists, or when several revisions or apps need the same approved caller identity.

Secrets and revisions have an important relationship. Secret values are application-scoped, so adding or changing a secret leaves the existing revision set in place. Existing running revisions may need a restart, or the team may deploy a new revision that references the updated secret. This detail matters during secret rotation because the team still needs evidence that every running container has picked up the new value.

Key Vault references improve the secret story. A Container Apps secret can point to a Key Vault secret, and the app's managed identity can read that Key Vault value. The team then gets centralized secret storage, Key Vault auditing, and a cleaner rotation path while Container Apps still exposes the value to the app as a named secret.

```bash
az containerapp identity assign \
  --resource-group rg-devpolaris-orders-prod \
  --name ca-orders-api-prod \
  --system-assigned

az containerapp secret set \
  --resource-group rg-devpolaris-orders-prod \
  --name ca-orders-api-prod \
  --secrets "stripe-webhook-secret=keyvaultref:https://kv-orders-prod.vault.azure.net/secrets/stripe-webhook-secret,identityref:system"
```

Identity also helps with image pulls from Azure Container Registry. Instead of storing registry credentials, the container app can use managed identity to authenticate to a private registry. That keeps the deployment path aligned with the same rule as runtime access: Azure identities and scoped role assignments beat long-lived passwords.

Secrets and identity cover access to other services. Some systems also need helper runtime behavior for service-to-service calls, pub/sub, state, or bindings. That is where Dapr can enter the design.

## Dapr and Sidecars
<!-- section-summary: Dapr is an optional sidecar layer that can provide service invocation, pub/sub, state access, and bindings for microservice designs. -->

**Dapr**, short for Distributed Application Runtime, is an optional sidecar runtime that Container Apps can add beside an application container. A sidecar is a helper container that runs next to the app and provides shared behavior through local HTTP or gRPC APIs. The app talks to its local sidecar, and the sidecar handles supported patterns such as service invocation, pub/sub, state access, and bindings.

For a small Orders API that only calls one database and one queue, Dapr may add more moving parts than the team needs. For a microservice system where Orders calls Payments, Inventory publishes events, and several services use pub/sub, Dapr can move some plumbing out of application code. The value comes from using a consistent API for those patterns across services.

When Dapr is enabled for a container app, the app receives a Dapr sidecar. The sidecar exposes local ports for HTTP and gRPC calls. For service invocation, one app can call its local Dapr sidecar and identify another Dapr-enabled app by its Dapr app ID. Container Apps and Dapr then handle the service invocation path inside the environment.

This gives the team another production object to understand. Dapr components define connections to state stores, pub/sub brokers, secret stores, or bindings. Those components can use managed identity or Key Vault-backed secrets. If a Dapr component fails to load, the application might start but fail once it tries to publish an event or call another service.

Dapr also changes the log story. The app has its own console logs, and the Dapr sidecar has logs too. During an incident, the team may need to check both streams because an application error and a sidecar component error can look similar from the caller's point of view.

Dapr is optional, so it belongs in the design because the system benefits from the sidecar APIs rather than because every container platform article mentions it. The required evidence for every Container Apps workload remains logs, metrics, revision state, ingress behavior, scale behavior, and identity access.

## Logs
<!-- section-summary: Container Apps exposes console, system, and HTTP logs so operators can separate platform failures from application failures. -->

**Logs** are the first evidence trail for a Container Apps problem. Container Apps can send logs to Log Analytics at the environment level, and the platform separates several kinds of information. Console logs come from the app's standard output and standard error streams. System logs come from the Container Apps service. HTTP logs come from the ingress layer when HTTP logging is enabled through diagnostic settings.

That separation is practical during failed releases. If the system logs show `ErrImagePull`, the platform failed to pull the image from the registry. If the system logs show `ContainerCrashing`, the container started and exited repeatedly. If console logs show a database connection exception, the app process started but failed after it tried to reach a dependency.

A live debugging session often begins with the log stream because it shows recent platform and console events without writing a full query. The team can stream console logs for the app and switch to system logs when the symptom points at image pulls, revision provisioning, scaling, or platform events.

```bash
az containerapp logs show \
  --resource-group rg-devpolaris-orders-prod \
  --name ca-orders-api-prod \
  --type console \
  --follow

az containerapp logs show \
  --resource-group rg-devpolaris-orders-prod \
  --name ca-orders-api-prod \
  --type system \
  --tail 100
```

For historical analysis, Log Analytics queries help connect the same incident across revisions and replicas. This query shape gives the operator a compact view of system messages for one app, and the revision name keeps canary evidence separate from stable-release evidence.

```kusto
ContainerAppSystemLogs_CL
| where ContainerAppName_s == "ca-orders-api-prod"
| project TimeGenerated, RevisionName_s, Log_s
| order by TimeGenerated desc
```

Console logs need application discipline. A useful app logs startup configuration without printing secrets, records dependency connection failures clearly, includes request or operation IDs where possible, and sends errors to standard error. A container that writes important information only to local files makes the platform log path much less useful.

Metrics complete the picture. Replica count, request count, status codes, CPU, memory, and revision-level splits help the team tell whether a canary is failing, a dependency is slow, or a scale rule is too conservative. Logs explain what happened in words, while metrics show the shape and size of the problem.

Now we have the main pieces. The final design question is when this service is the right compute choice.

## When Container Apps Fits
<!-- section-summary: Container Apps fits container-first APIs, workers, and microservices when the team wants managed platform behavior without owning a Kubernetes cluster. -->

Container Apps fits workloads that already think in containers. The team builds an image, deploys it, controls CPU and memory per replica, chooses ingress, and lets Azure handle managed runtime behavior around that image. APIs, background workers, event processors, small microservices, and internal tools often fit this shape.

Compared with App Service, Container Apps gives the team a more container-native release and scaling surface. Revisions, traffic splitting, sidecars, and KEDA-style event rules are central concepts. App Service remains a strong choice for traditional web apps and APIs that fit its runtime and deployment model.

Compared with Azure Functions, Container Apps keeps the long-running container shape. The app owns its process and listens for HTTP, processes queue messages, or runs worker code as a container. Functions fit event-started units of work where triggers, bindings, invocation behavior, and function hosting plans are the main design language.

Compared with AKS, Container Apps removes a large amount of cluster ownership from the team's daily work. Azure carries the Kubernetes node pool, ingress controller, pod spec, service mesh, cluster upgrade, and custom controller concerns away from the team's normal operating surface. AKS becomes the stronger fit when the organization truly needs Kubernetes APIs, deep platform customization, shared cluster policy, or custom controller patterns.

The Orders team can make a reasonable first production choice with Container Apps because the service shape is clear. The API is a containerized HTTP service with simple ingress and revision needs. The worker is a containerized background processor with queue-based scale behavior. The team wants image-based releases and managed scale without building a Kubernetes platform team first.

The service can outgrow that first choice in several directions. A simple API can move to App Service if the team wants a more standard web-app host. A short event handler can move to Functions if the function trigger model fits better. A large platform with many custom Kubernetes requirements can move to AKS. The decision stays grounded in workload shape, operations evidence, and the amount of platform control the team is ready to own.

## Putting It All Together
<!-- section-summary: Container Apps becomes understandable when the team can explain the environment, app, image, revision, ingress, scale, identity, and logs for one workload. -->

Azure Container Apps turns a container image into a managed Azure service. The managed environment gives related apps a shared boundary for networking, logs, and platform settings. The container app defines one workload. Replicas are the running copies. Images come from registries. Revisions preserve versioned runtime snapshots. Ingress controls reachability and target ports. Scale rules decide replica counts. Secrets and managed identity handle access. Logs and metrics give operators evidence.

For `devpolaris-orders`, the final production shape is easy to say out loud. `ca-orders-api-prod` runs the Orders API image in `cae-orders-prod-eus`, listens on port `8080`, keeps at least one replica warm, uses external HTTPS ingress, and releases through revisions. `ca-orders-worker-prod` runs the worker image in the same environment, keeps ingress disabled, scales from the queue, and uses managed identity to access Storage.

![Container Apps production evidence checklist showing artifact, runtime, access, and signals for one service story](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-azure-container-apps/container-apps-production-evidence.png)

*The production evidence checklist ties the article together: artifact, runtime, access, and signals all need to tell the same service story.*

The same sentence also gives the incident checklist. A bad release can point to the image, revision state, target port, ingress traffic weights, logs, identity permissions, secrets, scale limits, or downstream dependencies. Container Apps hides a lot of infrastructure, but production still needs the team to name those facts clearly.

## What's Next

The next article moves from Container Apps to Azure Functions. Container Apps runs a full container process with ingress, revisions, and scale rules, while Functions starts from events and organizes code around triggers, invocations, bindings, timeouts, retries, and hosting-plan tradeoffs.

---

**References**

- [Azure Container Apps overview](https://learn.microsoft.com/en-us/azure/container-apps/overview) - Microsoft Learn overview of the serverless container platform, common uses, features, revisions, ingress, scaling, registries, secrets, and logs.
- [Azure Container Apps environments](https://learn.microsoft.com/en-us/azure/container-apps/environment) - Microsoft Learn guide to environments, virtual networks, workload profiles, shared logs, and environment isolation choices.
- [Update and deploy changes in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/revisions) - Microsoft Learn documentation for revisions, revision-scoped changes, application-scoped changes, revision modes, and traffic behavior.
- [Application lifecycle management in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/application-lifecycle-management) - Microsoft Learn explanation of deployment, update, deactivation, shutdown, and revision lifecycle.
- [Ingress in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview) - Microsoft Learn documentation for external and internal ingress, HTTP and TCP protocols, target behavior, traffic splitting, and ingress features.
- [Set scaling rules in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/scale-app) - Microsoft Learn guide to HTTP, TCP, custom, CPU, memory, and event-driven scale rules.
- [Manage secrets in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets) - Microsoft Learn documentation for app-level secrets, Key Vault references, and secret behavior across revisions.
- [Managed identities in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity) - Microsoft Learn guide to system-assigned and user-assigned managed identities, Azure RBAC, registry pulls, and Dapr connections.
- [Microservice APIs powered by Dapr](https://learn.microsoft.com/en-us/azure/container-apps/dapr-overview) - Microsoft Learn overview of Dapr sidecars, Dapr APIs, components, and Container Apps integration.
- [Monitor logs in Azure Container Apps with Log Analytics](https://learn.microsoft.com/en-us/azure/container-apps/log-monitoring) - Microsoft Learn guide to console logs, system logs, HTTP logs, and Log Analytics tables.
- [View log streams in Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/log-streaming) - Microsoft Learn guide to streaming console and system logs from the Azure portal and Azure CLI.
