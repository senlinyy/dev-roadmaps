---
title: "App Service"
description: "Host a production web API on Azure App Service by separating the plan, web app, settings, identity, slots, networking, scale, and health evidence."
overview: "App Service is Azure's managed platform for web apps, APIs, and mobile back ends. This article follows one Orders API from first deployment to production operation so each App Service piece has a clear job."
tags: ["azure", "app-service", "web-apps", "runtime", "slots"]
order: 2
id: article-cloud-providers-azure-compute-application-hosting-app-service-web-backends
aliases:
  - app-service-for-web-backends
  - cloud-providers/azure/compute-application-hosting/app-service-for-web-backends.md
---

## Table of Contents

1. [What Is App Service](#what-is-app-service)
2. [The App Service Shape](#the-app-service-shape)
3. [App Service Plan](#app-service-plan)
4. [Web App](#web-app)
5. [Runtime Settings and Secrets](#runtime-settings-and-secrets)
6. [Managed Identity](#managed-identity)
7. [Deployment Slots](#deployment-slots)
8. [Networking](#networking)
9. [Scaling and Availability](#scaling-and-availability)
10. [Logs and Health](#logs-and-health)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## What Is App Service
<!-- section-summary: App Service runs web apps and APIs on Azure-managed infrastructure, while the team still owns the application process, configuration, identity, and production evidence. -->

**Azure App Service** is Azure's managed hosting platform for HTTP applications such as web apps, REST APIs, and mobile back ends. Managed hosting means Azure operates the underlying server fleet, front-end routing layer, operating system patching, platform runtime, TLS support, and scaling machinery. Your team brings the application code or container image, then configures how that application starts, what settings it receives, how it authenticates to other Azure services, and how operators prove that it is healthy.

For AWS readers, the closest anchors are Elastic Beanstalk for managed web-app hosting and App Runner for a simpler managed app runtime. The Azure detail to notice is the **App Service plan**, because it is the regional worker capacity and pricing boundary that one or more Web Apps can share.

We will follow one production example through the whole article. The Orders team runs `app-orders-api-prod`, a Node.js API that receives checkout requests, reads secrets from Key Vault, writes order records to Azure SQL, stores receipt PDFs in Blob Storage, and ships a new version every week. A virtual machine could run that API too, but the team would then own the operating system, web server setup, process supervisor, patching routine, and most of the release wiring. App Service lets the team work at the web application layer while Azure handles the platform layer.

The managed part does a lot, but it leaves real production choices in your hands. The team still decides the App Service plan size, whether several apps share compute, which app settings belong to production, which identity can read which secret, how a staging slot gets warmed before a swap, which network paths are public or private, how many instances should run, and which logs prove a release is safe. Those choices are the practical App Service story.

## The App Service Shape
<!-- section-summary: A production App Service app needs separate names for the plan, web app, settings, identity, slots, network paths, scale rules, and health evidence. -->

Before we zoom into individual features, it helps to name the pieces in the order you usually meet them during a real deployment. The App Service plan gives the app CPU and memory. The Web App resource tells Azure what to run on that capacity. Settings, identity, slots, networking, scale, and health checks then turn that runnable app into something a team can operate with evidence.

For the Orders API, the first useful design note can fit in a small table. This table gives every later section a place to attach, so the article moves from one Azure feature name to the next with a reason.

| Piece | Beginner-friendly definition | Orders API example |
|---|---|---|
| **App Service plan** | The regional compute pool that supplies workers, memory, CPU, and pricing tier. | `asp-orders-prod-eus` runs two Premium v3 Linux workers in East US. |
| **Web App** | The application resource that chooses the runtime, startup behavior, domains, settings, identity, and health path. | `app-orders-api-prod` runs the Node.js API and exposes `/healthz`. |
| **App settings** | Key-value settings that App Service injects as environment variables when the process starts. | `ORDERS_DB_HOST` points to the production SQL server. |
| **Managed identity** | A Microsoft Entra workload identity attached to the app so code can request Azure tokens through Azure-managed credentials. | The API identity reads Key Vault secrets and writes receipt files. |
| **Deployment slot** | A live sibling runtime for staging a release before production traffic moves to it. | The pipeline deploys version `2026.06.11` to `staging`, warms it, then swaps. |
| **Networking controls** | The inbound and outbound paths that decide who can reach the app and what private resources the app can reach. | Public customers enter through HTTPS, while the app reaches private data services through controlled Azure network paths. |
| **Scale and health evidence** | The instance count, health endpoint, metrics, logs, and traces that show whether the app can serve traffic. | The API runs at least two workers, reports health on `/healthz`, and sends request telemetry to Application Insights. |

That table also shows the order of responsibility. The plan answers where the compute comes from. The Web App answers what runs there. Settings and identity answer what the process knows and who it can be. Slots answer how a new version arrives safely. Networking answers which request paths exist. Scale and health answer whether the app keeps working when real users arrive.

![App Service runtime map showing plan capacity, web app profile, settings, identity, slots, and health evidence around the Orders API](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-app-service-web-backends/app-service-runtime-map-v2.png)

*The runtime map keeps the App Service pieces separate: the plan supplies capacity, the Web App describes the process, and settings, identity, slots, and evidence make the API operable.*

## App Service Plan
<!-- section-summary: The App Service plan is the compute and billing boundary, so apps, slots, logs, and background jobs inside one plan share the same workers. -->

An **App Service plan** is the compute home for one or more App Service apps. It defines the Azure region, operating system family, pricing tier, worker size, and worker count. Every App Service app runs inside a plan, and every running app in that plan uses the workers that the plan provides.

For the Orders team, `asp-orders-prod-eus` might start as a Premium v3 Linux plan with two workers. The public Orders API and a small internal admin app can both sit in that plan during an early launch. That saves cost because the same paid workers host both apps, but it also means the apps share CPU, memory, storage quota, and some operational pressure. If the admin app starts exporting huge reports at noon, the API can feel that resource pressure because the plan is the shared compute pool.

This is the part many beginners miss. In dedicated compute tiers such as Basic, Standard, Premium, Premium v2, Premium v3, and Premium v4, Azure dedicates the VM resources to the App Service plan. Those dedicated resources belong to the plan, and the apps inside the plan share them with each other. Compute isolation per app usually means creating a separate plan for the critical app.

The pricing tier controls both capacity and features. Free and Shared are useful for experiments and learning, but they run with quotas and limited scale behavior. Standard and higher tiers unlock common production features such as deployment slots, and larger Premium tiers give more CPU, memory, and scale-out headroom. The bill mostly follows the plan workers, so adding five tiny apps to one paid plan can cost the same as adding one app, while overloading that plan can make all six apps slow together.

Here is a compact Bicep shape for the plan behind the Orders API. The `capacity` value starts the plan with two workers, so the production app has more than one place to run during normal maintenance and health-based routing.

```bicep
resource plan 'Microsoft.Web/serverfarms@2022-03-01' = {
  name: 'asp-orders-prod-eus'
  location: resourceGroup().location
  kind: 'linux'
  sku: {
    name: 'P1v3'
    tier: 'PremiumV3'
    capacity: 2
  }
  properties: {
    reserved: true
  }
}
```

Once the plan exists, the next question is what Azure should run on those workers. That is the job of the Web App resource.

## Web App
<!-- section-summary: The Web App resource is the runnable application profile that connects code, runtime stack, hostnames, settings, identity, and health behavior to a plan. -->

A **Web App** is the App Service resource for one running HTTP application. In Azure Resource Manager, it belongs to the `Microsoft.Web/sites` resource type. It points at an App Service plan and stores the application-level choices: runtime stack, container image or deployment package, startup command, environment settings, custom domains, TLS settings, authentication options, managed identity, logging, and health check path.

The Orders Web App is `app-orders-api-prod`. It runs the Orders API on the workers from `asp-orders-prod-eus`, receives traffic through App Service front ends, and starts the application process with the configured runtime and startup command. If the team scales the plan to four workers, the Web App can run across those four workers. If the team changes the Web App startup command incorrectly, the plan can have plenty of CPU while the application still fails to start.

That split gives you a clean debugging habit. A slow app under high CPU pressure points you toward the plan metrics. A failed boot after a deployment points you toward the Web App runtime, startup command, package, container, or settings. The plan is the capacity boundary; the Web App is the application profile that consumes that capacity.

For built-in language stacks, App Service prepares a supported runtime such as .NET, Java, Node.js, Python, or PHP. For custom containers, App Service starts the image and routes HTTP traffic to the app process through the platform's container hosting path. Either way, the application must start cleanly, listen for HTTP traffic in the expected way, and return useful status from its health endpoint.

Here is a simplified production Web App attached to the plan from the previous section. The important pieces are the plan link, HTTPS-only setting, managed identity, Always On, health check path, runtime stack, and startup command.

```bicep
resource app 'Microsoft.Web/sites@2022-03-01' = {
  name: 'app-orders-api-prod'
  location: resourceGroup().location
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      alwaysOn: true
      healthCheckPath: '/healthz'
      appCommandLine: 'npm start'
    }
  }
}
```

The Web App can now start code, but code usually needs environment-specific values. The same package should know which database belongs to production, which telemetry endpoint to use, and which feature flags are enabled. App settings handle that part.

## Runtime Settings and Secrets
<!-- section-summary: App settings become environment variables at startup, and production teams keep environment-specific values, secrets references, and slot-sticky settings explicit. -->

**App settings** are key-value records stored by App Service and injected into your app as environment variables. They let one deployment package run in different environments from one build artifact. The Orders API can use the same artifact in staging and production while receiving different values for `ORDERS_DB_HOST`, `PAYMENTS_BASE_URL`, `FEATURE_CHECKOUT_V2`, and `APPLICATIONINSIGHTS_CONNECTION_STRING`.

App settings arrive when the process starts. When someone adds, edits, or removes an app setting, App Service restarts the app so the new environment can be loaded. That restart behavior matters during releases because three separate setting updates can mean three separate process recycles. Production teams usually apply related settings as one batch so the app restarts once with a coherent configuration.

App Service encrypts app settings at rest, but secret management usually belongs in Key Vault. A **Key Vault reference** is an app setting value that points at a Key Vault secret. The application reads the setting like a normal environment variable, while the platform resolves the secret value through the app's identity. This keeps the secret lifecycle, access history, and rotation workflow in Key Vault and avoids spreading passwords through app configuration screens.

Here is the kind of app settings shape the Orders team might keep with its deployment code. `ORDERS_DB_HOST` is ordinary configuration, while `ORDERS_DB_PASSWORD` is a Key Vault reference. The slot setting flag means the value stays attached to the environment slot during swaps, which protects production from accidentally taking a staging database value.

```json
[
  {
    "name": "ORDERS_DB_HOST",
    "value": "sql-orders-prod.database.windows.net",
    "slotSetting": true
  },
  {
    "name": "ORDERS_DB_PASSWORD",
    "value": "@Microsoft.KeyVault(SecretUri=https://kv-orders-prod.vault.azure.net/secrets/orders-db-password/)",
    "slotSetting": true
  },
  {
    "name": "FEATURE_CHECKOUT_V2",
    "value": "true",
    "slotSetting": false
  }
]
```

The table behind that JSON tells a useful production story. Database host and password differ by environment, so they stay with the slot. A feature flag that should move with the release can swap with the code. This small distinction prevents a very real failure: the new code reaches production but talks to the staging database because the setting moved with the wrong thing.

The same idea can be applied from the Azure CLI during a release. The first command writes the production values to the production slot and marks the database settings as slot-sticky. The second command writes staging values to the staging slot. The values are used by the Node.js process as environment variables after App Service restarts the app.

```bash
az webapp config appsettings set \
  --resource-group rg-orders-prod-eus \
  --name app-orders-api-prod \
  --slot-settings ORDERS_DB_HOST=sql-orders-prod.database.windows.net \
                  ORDERS_DB_PASSWORD='@Microsoft.KeyVault(SecretUri=https://kv-orders-prod.vault.azure.net/secrets/orders-db-password/)' \
  --settings FEATURE_CHECKOUT_V2=true

az webapp config appsettings set \
  --resource-group rg-orders-prod-eus \
  --name app-orders-api-prod \
  --slot staging \
  --slot-settings ORDERS_DB_HOST=sql-orders-staging.database.windows.net \
                  ORDERS_DB_PASSWORD='@Microsoft.KeyVault(SecretUri=https://kv-orders-staging.vault.azure.net/secrets/orders-db-password/)' \
  --settings FEATURE_CHECKOUT_V2=true
```

After the pipeline applies the settings, the operator verifies the shape rather than printing secret values into a ticket. App Service redacts setting values in command output, so the check focuses on names and the slot-sticky flag.

```bash
az webapp config appsettings list \
  --resource-group rg-orders-prod-eus \
  --name app-orders-api-prod \
  --query "[].{name:name,slotSetting:slotSetting}" \
  --output table
```

```console
Name                         SlotSetting
---------------------------  -----------
FEATURE_CHECKOUT_V2          False
ORDERS_DB_HOST               True
ORDERS_DB_PASSWORD           True
WEBSITE_NODE_DEFAULT_VERSION False
```

The healthy result shows `ORDERS_DB_HOST` and `ORDERS_DB_PASSWORD` as slot settings, while `FEATURE_CHECKOUT_V2` can move with the release when that is the intended behavior. The output should not expose the secret value itself. It should prove the setting names exist and that environment-specific values stay attached to the right slot during a swap.

Settings explain what the process knows. The next question is how the process proves who it is when it calls Key Vault, Storage, SQL, or another Azure service. That is where managed identity enters the story.

## Managed Identity
<!-- section-summary: Managed identity gives the Web App a Microsoft Entra workload identity, but permissions still come from RBAC or service-specific authorization on the target resource. -->

A **managed identity** is a Microsoft Entra identity that Azure attaches to an Azure resource. For App Service, it lets the Web App request tokens for Azure services through Azure-managed credentials. Azure manages the underlying credential lifecycle, and your code uses an Azure SDK credential class to ask the platform for a token.

There are two common managed identity shapes. A **system-assigned managed identity** belongs to one Web App and is deleted when that app is deleted. A **user-assigned managed identity** is its own Azure resource, can attach to multiple apps, and can survive when one app is replaced. App Service also treats managed identity configuration as slot-specific, so production and staging can have separate principals and separate target permissions.

The identity proves the caller, but it grants no access by itself. The Orders API can have a system-assigned identity and still receive `403 Forbidden` from Key Vault until someone grants that identity a role such as **Key Vault Secrets User** at the vault or secret scope. The same pattern applies to Blob Storage, Azure SQL, Service Bus, and other services. The runtime identity needs permissions on each target resource it calls.

Application code usually stays simple. With Azure SDKs, `DefaultAzureCredential` can use a developer login on a laptop and the App Service managed identity in Azure. The same shape lets local development and production share code while using different credential sources.

```python
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient

credential = DefaultAzureCredential()
client = SecretClient(
    vault_url="https://kv-orders-prod.vault.azure.net/",
    credential=credential,
)

database_password = client.get_secret("orders-db-password").value
```

Under the hood, App Service exposes managed identity environment values such as `IDENTITY_ENDPOINT` and `IDENTITY_HEADER`. SDKs use those values to request a token from the local platform endpoint, and Microsoft Entra ID issues a token for the app's managed identity. Your application sends that token to Key Vault or another target service, and that target service checks whether the identity has the required permission.

The runtime check has two sides. First confirm the Web App has an identity, then confirm the target resource grants that identity the role the code needs.

```bash
az webapp identity show \
  --resource-group rg-orders-prod-eus \
  --name app-orders-api-prod \
  --query "{principalId:principalId,tenantId:tenantId,type:type}"

az role assignment list \
  --assignee 11111111-2222-3333-4444-555555555555 \
  --scope /subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-orders-prod-eus/providers/Microsoft.KeyVault/vaults/kv-orders-prod \
  --query "[].{role:roleDefinitionName,scope:scope}" \
  --output table
```

```console
PrincipalId                           TenantId                              Type
------------------------------------  ------------------------------------  --------------
11111111-2222-3333-4444-555555555555  99999999-8888-7777-6666-555555555555 SystemAssigned

Role                    Scope
----------------------  ------------------------------------------------------------------------
Key Vault Secrets User  .../resourceGroups/rg-orders-prod-eus/providers/Microsoft.KeyVault/vaults/kv-orders-prod
```

The first command proves Azure created the workload identity for the app. The second command proves Key Vault has a role assignment for that principal at the expected scope. If production logs show `403` from Key Vault, this pair of checks tells the operator whether the app lacks an identity or the target vault lacks authorization for that identity.

Now the app can receive configuration and call other Azure services through Azure-managed credentials. The next production problem is release safety. A team needs a way to start the new version, warm it, check it, and then move traffic while customers continue using the current version.

## Deployment Slots
<!-- section-summary: Deployment slots are live sibling apps that let a team warm and verify a release before swapping it into production traffic. -->

A **deployment slot** is a live App Service app that sits beside the production slot. It has its own hostname, app content, settings, identity configuration, and deployment history, while sharing the underlying App Service plan workers with the parent app. Slots are available on Standard, Premium, and Isolated App Service plan tiers.

The Orders team uses a `staging` slot for weekly releases. The pipeline deploys the new API version to `app-orders-api-prod-staging.azurewebsites.net`, applies staging settings, warms `/healthz`, runs smoke tests, and checks Application Insights for startup exceptions. When the candidate looks good, the team swaps `staging` and `production` so production traffic lands on the warmed version.

Slot swaps move app content and many configuration elements between slots. **Slot-sticky settings** stay attached to the slot as the code moves. This distinction protects environment-specific values such as database hosts, Key Vault reference URIs, storage account names, external webhook targets, and telemetry environment names.

| Setting | Usually sticky? | Why the Orders team treats it that way |
|---|---:|---|
| `ORDERS_DB_HOST` | Yes | Production code should keep using the production database after the swap. |
| `ORDERS_DB_PASSWORD` | Yes | Each slot should resolve the secret from the matching Key Vault path. |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Yes | Staging and production telemetry should remain separate during validation. |
| `FEATURE_CHECKOUT_V2` | Usually no | A release flag may intentionally move with the new version. |
| `BUILD_VERSION` | Usually no | The running code version should follow the deployment artifact. |

The safest slot story treats staging as a real runtime and a validation target. The app starts there, loads settings there, resolves identity there, connects to dependencies there, and answers health checks there. Then the swap changes which warmed slot receives production traffic.

![Safe App Service slot release flow from staging deployment through health warmup, log checks, traffic swap, sticky settings, and Key Vault access](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-app-service-web-backends/safe-slot-release.png)

*A slot release is safest when the new code warms in staging, health and logs are checked, sticky settings stay with the environment, and the swap moves traffic only after the candidate is ready.*

Slots share the plan workers, so they still need capacity planning. A heavy staging load test can compete with production when both slots live in the same plan. For high-risk releases, teams often run smoke tests that prove startup and key paths while keeping the staging slot from becoming a second production-scale traffic source.

Here is the practical release sequence the Orders team can put in a runbook. The slot creation step gives the deployment a live target. The warmup and health checks prove the candidate before traffic moves. The swap happens after those validation steps.

```bash
az webapp deployment slot create \
  --resource-group rg-orders-prod-eus \
  --name app-orders-api-prod \
  --slot staging

curl --fail https://app-orders-api-prod-staging.azurewebsites.net/healthz

az webapp deployment slot swap \
  --resource-group rg-orders-prod-eus \
  --name app-orders-api-prod \
  --slot staging \
  --target-slot production
```

```console
{
  "status": "ok",
  "version": "2026.06.11",
  "checks": {
    "configuration": "ok",
    "sql": "ok",
    "keyVault": "ok"
  }
}
```

The values here become operational evidence. `staging` is the release target, `/healthz` is the health contract, and `production` is the traffic target after validation. The health response should name the deployed version and the dependency checks that matter for this API without printing secrets. If `/healthz` fails, the team fixes the staging candidate and leaves production untouched.

Slots solve release movement. Networking decides who can reach the app and what the app can reach, so that is the next piece.

## Networking
<!-- section-summary: App Service networking separates inbound access to the app from outbound access from the app to private resources, and each direction uses different Azure features. -->

**App Service networking** has two directions. **Inbound networking** controls who can reach the app. **Outbound networking** controls what the app can reach. Keeping those two directions separate prevents a lot of confusion because the Azure features have different jobs.

By default, an App Service app has a public hostname such as `app-orders-api-prod.azurewebsites.net`. A production app usually adds a custom domain, TLS certificate binding, and possibly a front door such as Azure Front Door or Application Gateway. **Access restrictions** can filter inbound requests by priority-ordered allow and deny rules, which helps when only specific IP ranges, service tags, or virtual network sources should reach the app.

A **private endpoint** gives the app an inbound private IP address through Azure Private Link. Clients on the connected private network can reach the app privately, and public exposure can be removed by disabling public network access. Private endpoint DNS matters here: internal clients need the app hostname to resolve to the private endpoint path, often through the `privatelink.azurewebsites.net` private DNS zone.

**VNet integration** solves the other direction. It lets the app make outbound calls into a virtual network, peered networks, private endpoints, service endpoint-secured services, ExpressRoute-connected networks, or routes controlled by the integration subnet. It gives the app an outbound path while inbound private access uses a private endpoint. In a production Orders system, VNet integration might let the API reach a private database endpoint while the public customer entry path still comes through HTTPS.

An **App Service Environment**, often shortened to ASE, is the single-tenant App Service shape that runs inside your virtual network. It fits internal line-of-business apps, strict network isolation requirements, high scale needs, or compliance cases where the supporting App Service infrastructure should be dedicated to one customer environment. Most teams start with multi-tenant App Service plus the right inbound and outbound networking features, then move to ASE only when the isolation and scale requirements justify the cost and operational weight.

Now the request path is clearer. A customer reaches the Orders API through the approved inbound path. The app reaches data services through the approved outbound path. Managed identity proves the app's caller identity, while networking proves the packet path.

## Scaling and Availability
<!-- section-summary: Scaling changes the App Service plan workers, so production scale design must consider every app and slot that shares the plan. -->

**Scaling up** changes the worker size for the App Service plan. The plan receives workers with more CPU, memory, or feature capacity. This helps when one instance needs more memory for each process, more CPU for heavy request handling, or a tier feature such as deployment slots.

**Scaling out** changes the number of worker instances in the plan. More instances can spread HTTP traffic across several running copies of the app and can improve availability during platform maintenance or individual worker trouble. The important detail stays the same: apps and slots in the same plan share the scaled workers, and scaling the plan affects that shared pool.

The Orders API might run with two always-on instances during normal traffic, then scale out during a sale. Azure Monitor autoscale can add or remove instances based on metrics such as CPU percentage, memory pressure, HTTP queue length, or a schedule. App Service automatic scaling can also add instances for supported web apps based on HTTP demand, with settings such as maximum burst and app-level always-ready instances.

Scale-out only works well when the application is ready for multiple instances. Uploaded files should go to Blob Storage, while local disk is treated as temporary runtime storage. Sessions should live in an external store when the app needs shared session state. Background jobs should account for more than one running instance. Database connection pools should respect the database tier, because doubling web instances can double the number of active database connections.

The scale rule should also respect downstream systems. If `app-orders-api-prod` scales from two to twelve workers while Azure SQL stays tiny, the bottleneck moves to the database tier. A good scale design names the web limit, the database limit, the queue limit, and the cost limit together, because the API serves orders with database, queue, and storage capacity.

Scaling gives the app capacity. Health and observability tell the team whether that capacity is actually serving users.

## Logs and Health
<!-- section-summary: App Service operations depend on health checks, logs, metrics, traces, and alerts that prove the process started and user requests are succeeding. -->

**Logs** are records of what happened. **Metrics** are numeric measurements over time. **Traces** connect work across services so one checkout request can be followed through the API, database call, storage write, and downstream payment call. App Service gives platform logs and log streaming, while Application Insights and Azure Monitor give deeper application telemetry, alerts, dashboards, and queryable history.

The Orders team needs both platform and application evidence. App Service log stream helps during a failed startup because it can show standard output, standard error, and web server messages quickly. Application Insights helps after the app starts because it can show failed requests, slow dependencies, exceptions, request rates, and latency percentiles. Azure Monitor metrics help explain plan-level pressure such as CPU, memory, instance count, and HTTP queue behavior.

A **Health check** path is an endpoint that App Service can call on each running instance to decide whether that instance should receive traffic. A path such as `/healthz` should prove that the process is alive and that critical dependencies are reachable enough for the app to serve real users. When the Orders API loses database connectivity or required configuration, `/healthz` should return a server error, and the friendly success response should belong only to the healthy path.

Health checks work best when the plan has at least two instances. With multiple instances, App Service can route around unhealthy workers according to the platform's health behavior and configured limits. The health endpoint should return a direct successful response when healthy, because redirect chains can make the platform treat the check as failed. This is one reason teams often keep `/healthz` simple, unauthenticated, and fast.

Here is a small Application Insights query a team might use after a slot swap. It asks whether failed requests or latency changed during the last thirty minutes, grouped into five-minute windows.

```kusto
requests
| where timestamp > ago(30m)
| where cloud_RoleName == "app-orders-api-prod"
| summarize
    failedRequests = countif(success == false),
    p95Duration = percentile(duration, 95)
  by bin(timestamp, 5m)
| order by timestamp asc
```

Always On belongs in this same operational picture. When Always On is enabled, the App Service front end pings the app regularly so the app stays loaded during quiet periods. That reduces cold-start surprises for normal web apps and is required for continuous or scheduled WebJobs. It pairs with a real health endpoint, because a root ping and a dependency-aware health check answer different questions.

At this point the pieces are connected. The plan gives capacity, the Web App starts the code, settings shape the environment, identity gives the workload a caller, slots handle release movement, networking controls paths, scaling changes capacity, and health evidence tells the team what happened.

## Putting It All Together
<!-- section-summary: A solid App Service design connects compute, runtime profile, configuration, identity, release path, network path, scale behavior, and evidence before production traffic arrives. -->

Let's put the Orders API back together as one production shape. `asp-orders-prod-eus` gives the app two or more Premium workers. `app-orders-api-prod` defines the runtime, startup command, HTTPS behavior, managed identity, Always On, and health endpoint. App settings provide environment-specific values, Key Vault references keep secrets in the vault, and slot-sticky settings keep production configuration attached to production during swaps.

The release path uses a `staging` slot. The pipeline deploys the new artifact there, applies slot settings, warms `/healthz`, checks logs and telemetry, then swaps only after the candidate has started and answered real checks. The runtime identity for production has the production Key Vault and Storage permissions it needs, while the staging identity can have narrower staging permissions. Those identities are separate from the deployment pipeline identity.

The network path names both directions. Customers enter through the approved inbound path, which might be the public App Service endpoint behind a custom domain and front door. The API reaches private dependencies through VNet integration where needed. A private admin surface can use private endpoint and private DNS, with public network access disabled when the design calls for private-only reachability.

Here is a compact Bicep sketch that connects the main App Service pieces. Real production templates usually add role assignments, diagnostic settings, private DNS, alerts, and environment parameters, but this shape shows the relationship between plan, app, slot, settings, and slot-sticky configuration.

```bicep
param location string = resourceGroup().location

resource plan 'Microsoft.Web/serverfarms@2022-03-01' = {
  name: 'asp-orders-prod-eus'
  location: location
  kind: 'linux'
  sku: {
    name: 'P1v3'
    tier: 'PremiumV3'
    capacity: 2
  }
  properties: {
    reserved: true
  }
}

resource app 'Microsoft.Web/sites@2022-03-01' = {
  name: 'app-orders-api-prod'
  location: location
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      alwaysOn: true
      healthCheckPath: '/healthz'
      appCommandLine: 'npm start'
    }
  }
}

resource staging 'Microsoft.Web/sites/slots@2022-03-01' = {
  name: '${app.name}/staging'
  location: location
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      alwaysOn: true
      healthCheckPath: '/healthz'
      appCommandLine: 'npm start'
    }
  }
}

resource appSettings 'Microsoft.Web/sites/config@2022-03-01' = {
  name: '${app.name}/appsettings'
  properties: {
    ORDERS_DB_HOST: 'sql-orders-prod.database.windows.net'
    ORDERS_DB_PASSWORD: '@Microsoft.KeyVault(SecretUri=https://kv-orders-prod.vault.azure.net/secrets/orders-db-password/)'
    FEATURE_CHECKOUT_V2: 'true'
  }
}

resource stickySettings 'Microsoft.Web/sites/config@2022-03-01' = {
  name: '${app.name}/slotConfigNames'
  properties: {
    appSettingNames: [
      'ORDERS_DB_HOST'
      'ORDERS_DB_PASSWORD'
    ]
  }
}
```

When something breaks, this same structure gives the team a troubleshooting path. A deployment that fails to start points to the Web App runtime, package, startup command, or settings. A `403` from Key Vault points to managed identity and target authorization. A private database timeout points to outbound networking, DNS, or firewall rules. A slow sale-day checkout points to plan metrics, scale rules, database limits, and application traces.

App Service is beginner-friendly because it removes a lot of server work. A production-ready App Service setup explains each part of the runtime: where the compute lives, what app profile runs, which settings arrive, which identity calls dependencies, how releases move, which paths are public or private, how scale behaves, and which evidence proves the app is healthy.

![Production App Service checklist showing capacity, runtime, configuration, access, network, and operations evidence around the production Orders API](/content-assets/articles/article-cloud-providers-azure-compute-application-hosting-app-service-web-backends/production-app-service-checklist.png)

*The production checklist turns the article into a review habit: confirm capacity, runtime startup, configuration, access, network paths, and operating evidence before trusting the App Service app.*

## What's Next

The next article moves from App Service to Azure Container Apps. App Service is a strong fit when a web app or API matches the supported runtime and App Service release model. Container Apps is interesting when the team wants container-first revisions, event-driven scale rules, sidecars, and a managed environment that feels closer to modern container platforms while avoiding full Kubernetes cluster responsibility.

---

**References**

- [Azure App Service overview](https://learn.microsoft.com/en-us/azure/app-service/overview) - Microsoft Learn overview of App Service for web apps, REST APIs, and mobile back ends.
- [Azure App Service plans](https://learn.microsoft.com/en-us/azure/app-service/overview-hosting-plans) - Microsoft Learn explanation of plans, tiers, shared resources, scaling, and cost behavior.
- [Configure an App Service app](https://learn.microsoft.com/en-us/azure/app-service/configure-common) - Microsoft Learn guide to app settings, connection strings, Always On, HTTPS, runtime settings, and restart behavior.
- [Use Key Vault references as app settings](https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references) - Microsoft Learn guide to resolving Key Vault secrets through App Service configuration.
- [Use managed identities for App Service and Azure Functions](https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity) - Microsoft Learn guide to system-assigned and user-assigned identities for App Service.
- [Set up staging environments in Azure App Service](https://learn.microsoft.com/en-us/azure/app-service/deploy-staging-slots) - Microsoft Learn documentation for deployment slots, swaps, slot hostnames, and slot settings.
- [App Service networking features](https://learn.microsoft.com/en-us/azure/app-service/networking-features) - Microsoft Learn overview of inbound and outbound networking features for App Service.
- [Use private endpoints for Azure App Service apps](https://learn.microsoft.com/en-us/azure/app-service/overview-private-endpoint) - Microsoft Learn guide to private inbound access, private DNS, and public access considerations.
- [Integrate your app with an Azure virtual network](https://learn.microsoft.com/en-us/azure/app-service/overview-vnet-integration) - Microsoft Learn guide to outbound VNet integration for App Service.
- [App Service Environment overview](https://learn.microsoft.com/en-us/azure/app-service/environment/overview) - Microsoft Learn overview of single-tenant App Service Environment v3.
- [How to enable automatic scaling](https://learn.microsoft.com/en-us/azure/app-service/manage-automatic-scaling) - Microsoft Learn guide to App Service automatic scaling, maximum burst, and always-ready instances.
- [Monitor App Service instances using Health check](https://learn.microsoft.com/en-us/azure/app-service/monitor-instances-health-check) - Microsoft Learn guide to App Service health checks and instance health behavior.
- [Monitor Azure App Service](https://learn.microsoft.com/en-us/azure/app-service/monitor-app-service) - Microsoft Learn overview of App Service monitoring, metrics, logs, and log stream.
