---
title: "Cloud Run Networking"
description: "Understand Cloud Run ingress, IAM authentication, outbound egress, Direct VPC egress, private ranges, all-traffic routing, and startup evidence."
overview: "Cloud Run removes server management, not network decisions. This article separates the inbound edge from the outbound path so a serverless service can be public, private, or connected to VPC resources on purpose."
tags: ["gcp", "cloud-run", "ingress", "egress", "vpc"]
order: 4
id: article-cloud-providers-gcp-networking-connectivity-cloud-run-networking-private-egress
aliases:
  - cloud-run-networking-and-private-egress
  - cloud-providers/gcp/networking-connectivity/cloud-run-networking-and-private-egress.md
---

## Table of Contents

1. [Cloud Run Ingress and Egress](#cloud-run-ingress-and-egress)
2. [Inbound Ingress Settings and Path Protection](#inbound-ingress-settings-and-path-protection)
3. [Outbound Egress Modes](#outbound-egress-modes)
4. [The IMDS Workload Token Exchange](#the-imds-workload-token-exchange)
5. [Putting It All Together](#putting-it-all-together)
6. [What's Next](#whats-next)

## Cloud Run Ingress and Egress

Cloud Run networking has two separate decisions: ingress controls which paths may invoke the service, and egress controls where outbound packets from the service are routed. Removing server management does not remove network planning; it moves the decision from VM interfaces to service-level ingress settings, IAM checks, and VPC egress configuration.

![Ingress controls who can reach the service. Egress controls where the service sends outbound traffic.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-cloud-run-networking-private-egress/ingress-egress-map.png)

*Read the two sides separately when debugging access.*

The inbound path is called ingress. It determines which network paths may invoke the service. For example, you can make the generated service URL reachable from the public internet, or restrict invocation so only internal paths or traffic routed through your global load balancer are accepted.

The outbound path is called egress. It dictates where packets go when your application opens an HTTP request or TCP socket. For example, when your application code needs to save data, it can use default internet egress for public endpoints or route private address traffic through your VPC to reach internal database paths.

By separating ingress from egress, you avoid mixing caller access with dependency access. A backend processing service can call private internal databases through VPC egress while rejecting direct public invocation on the raw service URL.

## Inbound Ingress Settings and Path Protection

Ingress settings are the service-level network gate for accepted invocation paths. When you deploy a Cloud Run service, the platform assigns it a default public URL (e.g. `https://orders-api-123.a.run.app`). To prevent clients from bypassing your public entry points (like load balancers or API gateways), you must configure **Ingress Settings**:

*   **All (Public)**: The default setting. The service is reachable directly from the public internet using the generated platform URL or any custom domain mapping.
*   **Internal**: The service is only reachable from resources within the same VPC network (via VPC connectors or Direct VPC egress) or other serverless services.
*   **Internal and Cloud Load Balancing**: The service is only reachable from your external Application Load Balancer (via Serverless NEGs) or from internal VPC resources.

These settings are the serverless equivalents of AWS Target Group path restrictions or Azure Container Apps Ingress Access Restrictions. They isolate your microservice, ensuring that public users cannot discover and invoke your raw container endpoints directly.

The setting is enforced by Cloud Run's ingress control. Google documents the outcome rather than a header algorithm: direct internet calls to the raw service URL are blocked, while traffic from the allowed load-balancer or internal paths can reach the service.

```mermaid
flowchart TD
    PublicUser["Public User Request"]
    AdminVPN["Admin VPN Route"]

    subgraph GoogleEdge["Cloud Run Ingress Gate"]
        IngressCheck{"Ingress Locked to<br/>Internal & LB?"}
    end

    subgraph CloudRunService["Cloud Run Service"]
        AppContainer["Application Container"]
    end

    PublicUser -->|1. Direct to a.run.app URL| IngressCheck
    AdminVPN -->|1. Through Internal VPC Path| IngressCheck

    IngressCheck -->|Direct public path not allowed| Denied["403 Forbidden"]
    IngressCheck -->|Allowed load balancer or internal path| AppContainer
```

This is separate from IAM authentication. A service can have public ingress but still require callers to have the Cloud Run Invoker permission. A service can also allow unauthenticated invocation but restrict which network paths are accepted. Read ingress and IAM as two gates, not one.

## Outbound Egress Modes

Outbound egress is the routing choice for packets leaving a Cloud Run instance. When your code makes an HTTP request or establishes a TCP socket, Cloud Run routes the packets based on your configured egress path:

*   **Default Internet Egress**: Outbound packets leave the container over Google's public shared routing fabric, assigning a dynamic public IP address to the connection. This works for calling external API endpoints but cannot reach private resources inside a VPC.
*   **VPC Egress**: Routes outbound packets through a dedicated subnet interface inside your VPC network.

When VPC Egress is active, you must choose a routing policy:

*   **Private Ranges Only**: The default VPC routing policy. Only packets destined for RFC 1918 private IP address blocks (such as `10.0.0.0/8`, `172.16.0.0/12`, or `192.168.0.0/16`) are routed through your VPC subnet. All other outbound traffic to the public internet or public Google APIs bypasses the VPC, routing over Google's default internet paths.
*   **All Traffic**: Forces every outbound packet (including public internet calls) to route through your VPC subnet. This policy is necessary when you must inspect all outbound traffic or route all public requests through a static IP address via a Cloud NAT gateway.

:::expand[Design Detail: Direct VPC Egress Behavior]{kind="design"}
Historically, serverless runtimes often routed outbound VPC traffic through a Serverless VPC Access connector, a dedicated managed connector that acted as a transit bridge. Direct VPC egress lets Cloud Run send outbound traffic to a VPC network without that connector.

The documented behavior is the important part. Cloud Run allocates ephemeral IP addresses from the selected subnet for outbound VPC traffic. During scale-up, the platform can reserve IP addresses in blocks, so subnet sizing matters. Google recommends allowing enough free IP space, and small subnets can become a scaling bottleneck.

Direct VPC egress affects outbound traffic only. It does not make a Cloud Run service reachable from your VPC by inbound TCP connections. Cloud Run services and jobs do not support Direct VPC ingress, so inbound access still uses Cloud Run ingress settings, load balancers, IAM, and service URLs.

```mermaid
flowchart LR
    subgraph CloudRun["Cloud Run Service"]
        AppCode["Application Code<br/>(e.g., Node/Go/Python)"]
        EgressSetting["Direct VPC egress setting"]
    end

    subgraph UserVPC["Customer VPC Network"]
        AppSubnet["Subnet: subnet-orders-app-us-central1"]
        PrivateDB["Private database IP"]
    end

    AppCode -->|1. Connect to private address| EgressSetting
    EgressSetting -->|2. Use subnet IP capacity| AppSubnet
    AppSubnet -->|3. Route to private target| PrivateDB
```

When your application initiates a socket connection to a private database, Cloud Run uses the configured egress mode to decide whether the connection should leave through the VPC subnet. With `private-ranges-only`, private address ranges go through the VPC and other traffic uses the default path. With `all-traffic`, all outbound traffic goes through the VPC, which is useful when you need Cloud NAT, inspection, or a controlled egress path.
:::

## The IMDS Workload Token Exchange

The IMDS workload token exchange is the local metadata path that lets a Cloud Run service obtain short-lived credentials for its attached service account. Securing serverless database and API connections requires you to avoid hardcoding static credentials inside container configurations. Cloud Run solves this by letting the service run as a service account and by exposing metadata access that Google client libraries can use to obtain short-lived credentials.

![Private network paths and metadata identity checks work together before managed services trust a request.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-cloud-run-networking-private-egress/private-egress-token.png)

*Network privacy does not replace IAM. Both paths must pass.*

Cloud Run supports metadata access through the local metadata hostname. The point is not the sandbox implementation; the point is that the workload can request credentials for its attached service account without storing a key file.

When your container code or SDK client attempts to access a resource (such as reading a database key or calling Secret Manager), it initiates a dynamic handshake:

1.  **Local Fetch**: The application issues an HTTP GET request to `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token` with the required header `Metadata-Flavor: Google`.
2.  **Runtime Identity Check**: The runtime knows which service account is attached to the Cloud Run revision.
3.  **Token Issuance**: Google returns a short-lived OAuth2 access token for that service account.

The application container injects this token into its outbound Bearer headers to access resources securely, ensuring that no static keys ever reside on disk or in environment variables.

This metadata path gives your container libraries a uniform lookup target, enabling passwordless authentication without local private keys.

## Putting It All Together

Let's trace how the inbound and outbound edges work together on a Cloud Run microservice.

By setting your service's ingress to `internal-and-cloud-load-balancing`, you ensure that inbound user traffic must arrive through the allowed load-balancer path or an allowed internal path, protecting your container from direct raw internet access.

For outbound traffic, you enable Direct VPC egress bound to your regional subnet. When the application container makes a private database call, Cloud Run routes that outbound connection through the configured VPC egress path and consumes subnet IP capacity during scaling.

Finally, the application uses Cloud Run service identity and metadata-backed credentials to acquire short-lived OAuth2 tokens. The private network path gets packets to the right place, and IAM decides whether the service account is allowed to use the target Google API.

## What's Next

Cloud Run can now send traffic into a VPC. However, many backing resources (such as relational databases or managed object storage) are managed services that do not simply sit in your subnet. In the next article, we detail Private Access, focusing on Private Services Access peering, Private Google Access DNS virtual IPs, and Private Service Connect proxy gateways.

![A six-part summary infographic for cloud run networking summary covering Ingress mode, Internal path, VPC connector, Private egress, Metadata token, IAM check](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-cloud-run-networking-private-egress/cloud-run-networking-summary.png)

*Use this summary as the quick mental checklist before designing or debugging the service.*


---

**References**

- [Google Cloud: Cloud Run ingress settings](https://cloud.google.com/run/docs/securing/ingress) - Core guide to restricting inbound access to serverless runtimes.
- [Google Cloud: Configure Direct VPC egress](https://cloud.google.com/run/docs/configuring/vpc-direct-vpc) - Specification for direct virtual network interface mounting.
- [Google Cloud: Cloud Run authentication overview](https://cloud.google.com/run/docs/authenticating/overview) - Explains Cloud Run Invoker checks and unauthenticated access.
- [Google Cloud: Cloud Run service identity](https://cloud.google.com/run/docs/securing/service-identity) - Explains service accounts and runtime credentials.
