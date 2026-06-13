---
title: "Public Entry Points"
description: "Choose the Azure public entry service that receives user traffic, proves DNS and TLS, routes to healthy backends, and fits the layer of the problem."
overview: "A public hostname is a chain of decisions. This article follows one orders API through public DNS, TLS, Azure Front Door, Application Gateway, Azure Load Balancer, backend health, and the evidence that proves traffic reaches the right private backend."
tags: ["azure", "dns", "tls", "front-door", "application-gateway"]
order: 3
id: article-cloud-providers-azure-networking-connectivity-load-balancers-application-gateway-and-front-door
aliases:
  - public-entry-points
  - load-balancers-application-gateway-and-front-door
  - dns-custom-domains-and-tls-entry-points
  - article-cloud-providers-azure-networking-connectivity-dns-custom-domains-and-tls-entry-points
  - cloud-providers/azure/networking-connectivity/load-balancers-application-gateway-and-front-door.md
  - cloud-providers/azure/networking-connectivity/dns-custom-domains-and-tls-entry-points.md
---

## Table of Contents

1. [Public Entry Points](#public-entry-points)
2. [Public DNS](#public-dns)
3. [TLS](#tls)
4. [Azure Front Door](#azure-front-door)
5. [Application Gateway](#application-gateway)
6. [Azure Load Balancer](#azure-load-balancer)
7. [Health Probes](#health-probes)
8. [Choosing The Entry Point](#choosing-the-entry-point)
9. [Sample Entry Shape](#sample-entry-shape)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## Public Entry Points
<!-- section-summary: Public traffic should arrive through a deliberate DNS, TLS, routing, and health-check path before it reaches private application code. -->

In the last Azure networking article, we controlled private packet flow with **Network Security Groups**. An NSG rule can say that only the application gateway subnet may reach `orders-api` on port `443`. That protects the private side of the application, but customers still need a clean public way to reach `orders.devpolaris.com`.

A **public entry point** is the internet-facing path that receives users before the request reaches your application backend. In Azure, that path usually includes a public DNS record, a TLS certificate, an entry service such as **Azure Front Door**, **Application Gateway**, or **Azure Load Balancer**, a routing rule, a backend pool, and a health check.

Here is the important production idea. The public entry point should receive traffic, prove the hostname, apply the right network or HTTP decisions, and then forward only healthy traffic toward private backends. The application servers should stay behind that controlled entry layer even while the product serves public users.

For our running example, imagine a team running `devpolaris-orders-api` in `uksouth`. The first release has two API instances in a private subnet. The team wants users to visit `orders.devpolaris.com`, use HTTPS, hit a regional gateway, and reach only the API instances that pass `/healthz`.

![Azure public entry chain showing user browser, public DNS, TLS, Azure Front Door, Application Gateway, private orders API, and a health probe](/content-assets/articles/article-cloud-providers-azure-networking-connectivity-load-balancers-application-gateway-and-front-door/public-entry-chain.png)

*The public entry path keeps the browser-facing pieces in front while the orders API stays behind the controlled regional entry layer.*

That picture gives us the structure for the rest of the article. **DNS** gets the user to the named entry point. **TLS** proves the hostname and encrypts the connection. **Front Door** handles global HTTP entry. **Application Gateway** handles regional HTTP routing inside the Azure network shape. **Load Balancer** handles lower-level TCP or UDP traffic. **Health probes** decide which backends should receive new traffic.

Before we choose a product, we need to understand the first thing the user touches: the public name. DNS decides which Azure entry service the browser tries first, and a stale answer can send users down the old path during a cutover.

## Public DNS
<!-- section-summary: Public DNS turns a friendly hostname into the Azure entry target, and TTL controls how long old answers can keep sending users to the previous target. -->

**Public DNS** is the naming system that turns a hostname like `orders.devpolaris.com` into the public target a client should contact. Azure DNS can host a public zone such as `devpolaris.com`, and inside that zone you create record sets for names like `orders`, `www`, or `api`.

A **record set** is a group of DNS records with the same name and type. For a public entry point, the common records are **CNAME**, **A**, **TXT**, and sometimes an **alias record** in Azure DNS. A CNAME points one name at another DNS name. An A record points a name at an IPv4 address. A TXT record stores a piece of text that Azure services can use for ownership proof. An alias record can point at certain Azure resources, such as a public IP address, so the record follows the resource instead of hardcoding an address.

For `orders.devpolaris.com`, the DNS review might contain these records:

| Name | Type | Value | Why it exists |
|---|---|---|---|
| `orders` | CNAME | `fd-orders-prod.azurefd.net` | Sends users to the Front Door endpoint |
| `_dnsauth.orders` | TXT | Azure-provided token | Proves domain ownership for Front Door custom domain validation |
| `asuid.orders` | TXT | Azure-provided token | Proves ownership for services such as App Service hostname binding |

The exact TXT record name depends on the Azure service that asks for validation. Front Door commonly uses `_dnsauth` records. App Service commonly uses `asuid` records. The shared idea stays the same: Azure gives you a token, DNS proves that you control the name, and the service can safely accept that custom domain.

The second DNS idea is **TTL**, short for time to live. TTL tells recursive resolvers how long they may cache an answer before asking again. In Azure DNS, TTL belongs to the record set. A record set with a TTL of `3600` can leave some clients using the old answer for up to an hour after you change the target.

That matters during cutovers. Suppose `orders.devpolaris.com` points directly at an old Application Gateway public IP, and the team wants to move it to Front Door. If the TTL has been `86400` for weeks, many resolvers can keep the old answer for a long time. A common release plan lowers the TTL before the cutover, waits for old caches to drain, changes the CNAME, watches traffic, and then raises the TTL again after the new path looks stable.

During a production review, the evidence usually comes from both Azure and public DNS lookup tools. The Azure CLI can show the record Azure DNS stores, and that evidence should line up before the team changes public traffic:

```bash
az network dns record-set cname show \
  --resource-group rg-devpolaris-dns-prod \
  --zone-name devpolaris.com \
  --name orders

az network dns record-set txt show \
  --resource-group rg-devpolaris-dns-prod \
  --zone-name devpolaris.com \
  --name asuid.orders
```

The CNAME proves where the public name sends users. The TXT record proves that the Azure service can validate the hostname before it accepts traffic or issues a managed certificate. Once the name points at the right place, the next question is whether the browser can trust and encrypt the connection.

## TLS
<!-- section-summary: TLS proves the public hostname and encrypts each connection, while the entry design decides where TLS ends and how the backend hop stays protected. -->

**TLS**, or Transport Layer Security, is the protocol behind HTTPS. It encrypts the connection and gives the client a certificate chain that proves the service controls the requested hostname. For `orders.devpolaris.com`, the browser expects a certificate that covers `orders.devpolaris.com` and chains back to a trusted certificate authority.

TLS creates two design questions for Azure public entry points. The first question asks where the client TLS session ends. It can end at Front Door near the user, at Application Gateway inside a region, or directly on a backend service in a simpler design. The second question asks how the next hop stays encrypted after the first entry service accepts the user connection.

**TLS termination** means the entry service completes the HTTPS handshake for the client. After termination, the entry service can understand HTTP details such as host headers, paths, cookies, and request headers. That is why Layer 7 services can route `/api/*` to one backend pool and `/admin/*` to another backend pool.

**End-to-end TLS** means the connection from the entry service to the backend also uses TLS. Front Door can terminate the client connection and then open a new TLS connection to the origin. Application Gateway can also use HTTPS backend settings so the gateway validates the backend certificate while it forwards traffic to the server pool.

Here is the concrete orders API version. Users connect to Front Door with the `orders.devpolaris.com` certificate. Front Door forwards to Application Gateway over HTTPS. Application Gateway forwards to `orders-api` over HTTPS on port `443`. That gives the team HTTP routing at each entry layer while keeping the backend hop encrypted.

Certificate names and host headers matter in that design. A backend TLS certificate has a subject name, and the entry service sends Server Name Indication, usually called **SNI**, during the backend handshake. If the gateway sends the wrong backend host name, the backend certificate validation can fail even though DNS and the public certificate look correct.

A good incident story looks like this. A release changes the origin host name in Front Door from `agw-orders-prod.devpolaris.net` to the raw IP address of the gateway. DNS still works, and the public certificate still works, but the backend TLS handshake fails because the certificate expects a DNS name. The TLS evidence points to the fix before anyone touches the API process.

Now that DNS and TLS can bring a browser to a trusted HTTPS entry point, we can talk about the Azure services that receive the request. Each service handles a different layer of the request path, so the service choice should follow the kind of traffic decision the app needs.

## Azure Front Door
<!-- section-summary: Azure Front Door is the global HTTP entry layer for custom domains, edge TLS, WAF policy, routing rules, origin groups, and origin protection. -->

**Azure Front Door** is Azure's global HTTP and HTTPS entry service. It receives web traffic at Microsoft's edge network, matches the request to a Front Door profile, evaluates optional Web Application Firewall rules, matches a route, chooses an origin group, and forwards the request to a selected origin.

For a beginner, the useful definition is this: Front Door is the public front layer for web apps that need global entry, custom domains, managed TLS, WAF policy, route rules, caching in some designs, and origin health checks. It works at **Layer 7**, so it understands HTTP details such as hostname and path.

In our orders API story, Front Door owns the public custom domain `orders.devpolaris.com`. Users in London, Toronto, and Sydney all connect to the nearby Front Door edge. Front Door can apply a WAF policy before the request reaches the regional app, redirect HTTP to HTTPS, and route traffic to the `uksouth` origin group during the first release.

The core Front Door objects are easier to understand as a request path:

| Front Door object | What it controls in the orders API |
|---|---|
| **Endpoint** | The Azure-provided hostname for the Front Door profile |
| **Custom domain** | The public name, such as `orders.devpolaris.com` |
| **Route** | The host and path match that decides which origin group receives a request |
| **Origin group** | The set of backend origins plus health-probe and load-balancing behavior |
| **Origin** | The actual backend target, such as an Application Gateway or App Service |
| **WAF policy** | HTTP security rules that inspect the public request before the backend sees it |

Front Door also introduces an origin security habit. If the backend origin has a public address, attackers may try to bypass Front Door and hit that origin directly. Then they avoid Front Door WAF rules, custom-domain routing, and edge controls. Azure recommends restricting origins so traffic flows through Front Door, using patterns such as Front Door Premium with Private Link, managed identity where supported, IP filtering, service tags, and Front Door identifier checks.

That is the difference between "the app has a public URL" and "the app has one controlled public entry." In a mature design, Front Door receives the public request, and the origin accepts traffic only from the intended Front Door path. The orders API team can then reason about one internet-facing policy layer instead of defending every backend endpoint separately.

Front Door handles the global HTTP edge. Some teams also need a regional gateway inside the virtual network shape, especially when the backend sits behind private subnets, regional pools, and VNet-level controls. That is where Application Gateway enters the picture.

## Application Gateway
<!-- section-summary: Application Gateway is the regional Layer 7 gateway that routes HTTP traffic by host, path, listener, backend settings, and backend pool health. -->

**Azure Application Gateway** is a regional web traffic load balancer. It receives HTTP, HTTPS, HTTP/2, or WebSocket traffic and makes routing decisions from HTTP request attributes such as hostnames and URL paths. It can also run Azure Web Application Firewall in front of regional web workloads.

The simplest useful definition is this: Application Gateway is the managed regional reverse proxy for web traffic. It sits in its own subnet, owns a frontend IP configuration, listens for hostnames and ports, applies routing rules, and forwards requests to backend pools.

For `devpolaris-orders-api`, Application Gateway might live in `snet-app-gateway` and forward to two private API instances in `snet-orders-api`. The NSG from the previous article allows the gateway subnet to reach the API subnet on port `443`. The API subnet can stay private because the gateway receives the client-facing request first.

Application Gateway has a few important parts:

| Application Gateway part | What it means |
|---|---|
| **Frontend IP** | The IP address where the gateway accepts traffic |
| **Listener** | The protocol, port, hostname, and certificate for incoming requests |
| **Routing rule** | The connection between a listener and a backend target |
| **Backend pool** | The backend IPs, VM scale set instances, App Service targets, or FQDNs |
| **Backend settings** | The protocol, port, timeout, host name, TLS validation, and connection behavior for the backend hop |
| **Probe** | The health check that decides whether each backend target should receive new requests |

Application Gateway shines when regional HTTP routing matters. A single gateway can host `orders.devpolaris.com` and `admin.devpolaris.com`, send `/api/*` to the API pool, send `/images/*` to another pool, and keep one WAF policy close to the regional application. It also helps with private backend placement because the gateway can sit at the edge of the VNet while the API servers stay in private subnets.

One common design combines Front Door and Application Gateway. Front Door handles the global public edge, managed domain, WAF at the edge, and optional global failover. Application Gateway handles regional VNet entry, regional WAF policy if the team needs it there, path routing inside the region, backend TLS settings, and backend health. The combination costs more and creates more moving parts, so the team should use it for requirements that really need both global and regional control.

Some traffic has no HTTP hostname, path, cookie, or header to inspect. A database listener, game server, message broker, or custom TCP protocol may only need transport-level distribution. That lower layer belongs to Azure Load Balancer.

## Azure Load Balancer
<!-- section-summary: Azure Load Balancer distributes TCP and UDP flows by transport information, so it fits lower-level protocols without HTTP routing. -->

**Azure Load Balancer** is a Layer 4 load balancer. Layer 4 means it works with transport details such as protocol, source and destination IP, and source and destination port. It can distribute TCP or UDP flows across backend instances. HTTP hostnames, paths, cookies, and TLS certificate names belong to Layer 7 services such as Front Door and Application Gateway.

That difference matters. If the requirement says "send `/api/*` to the orders pool and `/images/*` to the media pool," Load Balancer has no HTTP path to read. Application Gateway or Front Door fits that request. If the requirement says "distribute TCP `443` across three VM instances running the same service," Load Balancer can fit because the rule only needs transport-level information.

For the orders platform, a public Load Balancer could expose a custom TCP service running on VMs. A private Load Balancer could sit behind Application Gateway or Front Door Premium Private Link patterns for internal origin designs. In both cases, the Load Balancer has a frontend IP, a backend pool, load-balancing rules, and health probes.

Standard Load Balancer also has an important security behavior. Standard public IPs and Standard Load Balancers close inbound traffic by default. Network Security Groups must explicitly permit the allowed traffic to the backend subnet or network interface. That keeps the Layer 4 entry tied to the packet rules from the previous article.

The troubleshooting evidence also looks different at Layer 4. A Load Balancer issue asks about frontend IPs, backend pool membership, rules, probe status, and NSG allows for the protocol and port. HTTP path matches and browser certificate names sit above the layer Load Balancer understands.

Now we have three entry services. Each one needs a way to stop sending traffic to a broken backend. That is the job of health probes.

## Health Probes
<!-- section-summary: Health probes decide which backend targets should receive new traffic, and good probes test the app path that proves the instance can serve users. -->

A **health probe** is the entry service's repeated check against a backend target. It answers a narrow question: should this backend receive new traffic right now? A good probe keeps users away from an instance that crashed, lost a dependency, failed startup, or no longer serves the route that the entry point needs.

Health probes appear in each Azure entry service, but the exact behavior follows the service. Application Gateway monitors servers in its backend pool and stops sending traffic to a server it marks unhealthy. Load Balancer probes backend instances over protocols such as TCP, HTTP, or HTTPS. Front Door uses origin group probes to decide how it should route traffic across origins, and Microsoft recommends disabling Front Door health probes when an origin group has only one origin because the probe has no routing decision to change in that case.

For `orders-api`, the probe path might be `/healthz`. A shallow version returns `200` when the process runs. A stronger version returns `200` only after the API can load configuration, reach its database, and serve the main request path. The stronger probe gives better routing evidence, but the team should keep it cheap because probes run continuously.

Health probes can also create false failures. If Application Gateway probes `/` but the API only serves `/healthz`, the backend looks unhealthy even though the app can serve real traffic. If the backend requires a specific host header and the probe sends the default backend IP, the app can reject the probe. If the probe uses HTTPS and the backend certificate name differs from the configured SNI, the gateway can mark the target unhealthy before any user traffic arrives.

The evidence should name the exact backend and the exact reason. For Application Gateway, backend health output can show which IP is healthy, which IP is unhealthy, and why the probe failed. That output helps the team avoid random fixes.

```bash
az network application-gateway show-backend-health \
  --resource-group rg-devpolaris-network-prod \
  --name agw-orders-prod
```

If `10.30.2.11` fails with a probe timeout while `10.30.2.10` stays healthy, the next step focuses on that one instance, its NSG path, its app process, or its local health endpoint. DNS and TLS may already be fine. Health evidence keeps the investigation close to the failing layer.

We can now make the product choice with clearer language. A better product question is: "Which layer of the request does this entry point need to understand?" That question keeps the choice grounded in the evidence the team can inspect later.

## Choosing The Entry Point
<!-- section-summary: Choose the entry service from the layer of traffic it must understand: global HTTP, regional HTTP, or TCP and UDP flows. -->

The most useful way to choose an Azure public entry point is to ask what the service must understand about the request. A Layer 7 service understands HTTP. A Layer 4 service understands transport flows. A global service receives users at the edge. A regional service lives near the application in one Azure region.

Here is the practical chooser for the orders platform:

| Requirement | Azure entry point that usually fits | Why |
|---|---|---|
| Public web app with global users, custom domains, edge TLS, WAF, route rules, and origin groups | **Azure Front Door** | It receives HTTP/S traffic at the global edge and routes to origins |
| Regional web app with host/path routing, WAF, backend TLS settings, and private backend pools in a VNet | **Application Gateway** | It acts as the regional Layer 7 gateway for web workloads |
| TCP or UDP service that needs frontend IP, port rules, backend pool distribution, and transport health probes | **Azure Load Balancer** | It distributes Layer 4 flows without reading HTTP details |
| Global edge plus regional VNet gateway | **Front Door plus Application Gateway** | Front Door handles the public edge, and Application Gateway handles regional web entry |
| Front Door to a private internal origin | **Front Door Premium with Private Link where supported** | Private Link lets Front Door reach supported origins through private connectivity |

![Azure public entry chooser comparing Azure Front Door, Application Gateway, and Azure Load Balancer by traffic layer and routing job](/content-assets/articles/article-cloud-providers-azure-networking-connectivity-load-balancers-application-gateway-and-front-door/traffic-layer-chooser.png)

*The service choice follows the traffic layer: Front Door for global HTTP entry, Application Gateway for regional HTTP routing, and Load Balancer for TCP or UDP flow distribution.*

The layer distinction solves many design arguments. Layer 4 sees ports and protocols. Layer 7 sees HTTP requests. If a rule mentions hostnames, paths, redirects, cookies, WAF managed rules, or TLS certificates, the design has Layer 7 needs. If a rule only mentions TCP or UDP ports and backend instances, Layer 4 may be enough.

Cost and operational complexity matter too. A small internal admin tool in one region may only need Application Gateway. A global customer API may need Front Door. A fleet of VMs serving a non-HTTP protocol may need Load Balancer. A high-value public API may combine Front Door, Application Gateway, private backends, strict NSGs, and strong health probes.

The chooser becomes real when the team writes the actual entry shape. Let us make the orders API concrete.

## Sample Entry Shape
<!-- section-summary: A sample public entry shape names the DNS records, TLS ownership proof, route, backend pool, probe, and evidence commands before the cutover. -->

The sample production shape uses one public name: `orders.devpolaris.com`. The team wants a global edge, HTTPS, a regional gateway in `uksouth`, two private API instances, and evidence that the DNS and health checks are correct before the cutover.

The DNS zone `devpolaris.com` contains the public records:

| Record | Example value | Review note |
|---|---|---|
| `orders` CNAME | `fd-orders-prod.azurefd.net` | User traffic goes to Front Door |
| `_dnsauth.orders` TXT | Front Door validation token | Front Door can validate the custom domain |
| `asuid.orders` TXT | App Service validation token where needed | Some Azure origins use this ownership proof |
| TTL | `300` during cutover | Short cache window while traffic moves |

The Front Door profile contains a route for `orders.devpolaris.com`. The route accepts HTTPS, redirects HTTP to HTTPS, applies the public WAF policy, and sends traffic to an origin group named `og-orders-uksouth`. That origin group points at the regional Application Gateway. In Front Door Premium designs, supported origins can use Private Link. In public-origin designs, the origin should still restrict direct bypass traffic as much as the service supports.

The Application Gateway contains a listener for `orders.devpolaris.com` on port `443`, a routing rule for the orders API, backend HTTPS settings on port `443`, and a backend pool with the two private API targets:

| Backend target | Probe path | Expected state |
|---|---|---|
| `10.30.2.10` | `/healthz` | Healthy |
| `10.30.2.11` | `/healthz` | Healthy |

The NSG rule on `snet-orders-api` allows inbound TCP `443` from the Application Gateway subnet or the intended gateway source. The API instances can stay away from broad inbound internet access. That is the same private packet habit from the NSG article, now connected to the public entry design.

A release review can collect this evidence before changing traffic:

```bash
az network dns record-set cname show \
  --resource-group rg-devpolaris-dns-prod \
  --zone-name devpolaris.com \
  --name orders

az network dns record-set txt show \
  --resource-group rg-devpolaris-dns-prod \
  --zone-name devpolaris.com \
  --name asuid.orders

az network application-gateway show-backend-health \
  --resource-group rg-devpolaris-network-prod \
  --name agw-orders-prod
```

The CNAME output proves where users will go. The TXT output proves ownership validation. The backend health output proves whether the regional gateway sees healthy targets. Those three facts catch many failed cutovers before users feel them.

After the cutover, the same evidence helps during incidents. A user report saying "orders is down" becomes a layered question instead of a panic. Does public DNS return the expected target? Does TLS present the expected certificate? Does Front Door route to the expected origin group? Does Application Gateway show healthy backends? Does the NSG allow the gateway-to-API flow?

Those questions bring the whole article together. They keep the team focused on the first broken link in the request path instead of changing a layer that already works.

## Putting It All Together
<!-- section-summary: Public entry troubleshooting follows the request path from DNS to TLS to routing to health to private backend access. -->

A public Azure request has a chain of owners. DNS owns the public name. TLS owns trust and encryption. Front Door owns global HTTP entry. Application Gateway owns regional HTTP entry. Load Balancer owns Layer 4 distribution. Health probes own backend eligibility. NSGs and private network rules own the final packet path to the app.

For `orders.devpolaris.com`, a healthy request looks like this. The browser resolves the public name from Azure DNS, connects to Front Door over HTTPS, receives a certificate for the custom domain, passes any WAF checks, matches the orders route, reaches the Application Gateway origin, matches the regional listener, passes the backend health decision, and lands on a private API instance that the gateway can reach on port `443`.

That same chain gives a clean troubleshooting order:

| Symptom | Evidence layer that usually comes first |
|---|---|
| Some users still reach the old gateway | DNS TTL and public resolver answers |
| Browser warns about the certificate | TLS certificate, custom domain validation, and SNI |
| Front Door returns a routing or origin error | Route match, origin group, origin host header, and origin health |
| Application Gateway returns `502` or no backend response | Backend pool membership, backend settings, probe result, and backend TLS validation |
| One backend receives no traffic | Probe status, local app health, NSG flow, and instance readiness |
| TCP service accepts no connections | Load Balancer frontend, rule, backend pool, probe, and NSG allow |

![Azure public entry troubleshooting path showing DNS answer, TLS certificate, route match, origin health, and backend access checkpoints](/content-assets/articles/article-cloud-providers-azure-networking-connectivity-load-balancers-application-gateway-and-front-door/public-entry-debug-path.png)

*Use the same path for incidents: prove the public name, prove the certificate, prove the route, prove origin health, and then prove private backend access.*

The main beginner habit is to keep public entry separate from private app placement. Public users need a public path, and backend machines can stay private behind the entry layer. Azure gives you several entry products because different traffic layers need different controls.

Once the public request reaches the application, the app still needs to call databases, storage accounts, secrets, queues, and other managed services. That leads to the next Azure networking topic: private connectivity.

## What's Next

The next article moves from public ingress to private service access. We will follow `orders-api` as it reaches Azure SQL, Key Vault, and Blob Storage through private endpoints, Private Link, private DNS, service endpoints, and resource firewalls.

---

**References**

- [Azure Front Door overview](https://learn.microsoft.com/en-us/azure/frontdoor/front-door-overview) - Explains Front Door as a global entry service with edge security, WAF, custom domains, and origin connectivity.
- [Azure Front Door routing architecture](https://learn.microsoft.com/en-us/azure/frontdoor/front-door-routing-architecture) - Shows how Front Door resolves, matches hostnames, evaluates WAF, matches routes, selects origins, and forwards requests.
- [Azure Front Door domains](https://learn.microsoft.com/en-us/azure/frontdoor/domain) - Covers custom-domain requirements, CNAME behavior, apex-domain considerations, and domain validation issues.
- [Azure Front Door best practices](https://learn.microsoft.com/en-us/azure/frontdoor/best-practices) - Covers origin restriction, TLS guidance, managed certificates, WAF guidance, and health-probe recommendations.
- [Secure traffic to Azure Front Door origins](https://learn.microsoft.com/en-us/azure/frontdoor/origin-security) - Explains origin bypass risk and supported origin restriction approaches.
- [Azure Application Gateway overview](https://learn.microsoft.com/en-us/azure/application-gateway/overview) - Defines Application Gateway as a web traffic load balancer that routes by HTTP attributes such as host and path.
- [Application Gateway backend settings](https://learn.microsoft.com/en-us/azure/application-gateway/configuration-http-settings) - Documents backend port, backend HTTPS validation, trusted roots, SNI, and backend connection behavior.
- [Application Gateway health probes](https://learn.microsoft.com/en-us/azure/application-gateway/application-gateway-probe-overview) - Explains how Application Gateway monitors backend pool health and stops routing to unhealthy servers.
- [Azure Load Balancer overview](https://learn.microsoft.com/en-us/azure/load-balancer/load-balancer-overview) - Covers Layer 4 load balancing, frontend IPs, backend pools, rules, and Standard Load Balancer network access controls.
- [Azure Load Balancer health probes](https://learn.microsoft.com/en-us/azure/load-balancer/load-balancer-custom-probe-overview) - Explains probe protocols and backend health behavior for Load Balancer.
- [Azure DNS zones and records](https://learn.microsoft.com/en-us/azure/dns/dns-zones-records) - Defines record sets and TTL behavior in Azure DNS.
- [Azure DNS alias records](https://learn.microsoft.com/en-us/azure/dns/dns-alias) - Explains alias record sets that can reference supported Azure resources such as public IP addresses.
- [Set up an existing custom domain in Azure App Service](https://learn.microsoft.com/en-us/azure/app-service/app-service-web-tutorial-custom-domain) - Documents `asuid` TXT records and App Service domain ownership validation.
