---
title: "VPC Endpoints and PrivateLink"
description: "Learn how gateway endpoints, interface endpoints, private DNS, endpoint policies, and AWS PrivateLink create service-specific private connectivity."
overview: "A private workload may need one AWS or provider service without needing general internet egress or full access to another network. This article separates DNS, routing, and authorization, then derives the endpoint type and policy layers for each service path."
tags: ["aws", "vpc", "privatelink", "vpc-endpoints", "private-networking"]
order: 5
id: article-cloud-providers-aws-networking-connectivity-vpc-endpoints-privatelink
aliases:
  - vpc-endpoints-and-privatelink
  - private-aws-service-access
  - private-link
---

## Table of Contents

1. [What Problem Does a VPC Endpoint Solve?](#what-problem-does-a-vpc-endpoint-solve)
2. [How Does a Gateway Endpoint Work?](#how-does-a-gateway-endpoint-work)
3. [How Does an Interface Endpoint Work?](#how-does-an-interface-endpoint-work)
4. [How Are Gateway and Interface Endpoints Different?](#how-are-gateway-and-interface-endpoints-different)
5. [What Is AWS PrivateLink?](#what-is-aws-privatelink)
6. [How Do Endpoint Policies, IAM, and Resource Policies Work Together?](#how-do-endpoint-policies-iam-and-resource-policies-work-together)
7. [How Do Endpoint Design and Cost Trade Off?](#how-do-endpoint-design-and-cost-trade-off)
8. [How Do You Troubleshoot a VPC Endpoint?](#how-do-you-troubleshoot-a-vpc-endpoint)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A private workload often needs a service such as S3, DynamoDB, Secrets Manager, STS, a company API, or a vendor API. The basic network problem is:

> How can a machine in a private network reach one required service without giving the machine general internet access or joining the service provider's whole network?

VPC endpoints and AWS PrivateLink answer different versions of that problem.

The sections below answer these questions in order:

1. **What Problem Does a VPC Endpoint Solve?**
2. **How Does a Gateway Endpoint Work?**
3. **How Does an Interface Endpoint Work?**
4. **How Are Gateway and Interface Endpoints Different?**
5. **What Is AWS PrivateLink?**
6. **How Do Endpoint Policies, IAM, and Resource Policies Work Together?**
7. **How Do Endpoint Design and Cost Trade Off?**
8. **How Do You Troubleshoot a VPC Endpoint?**

## What Problem Does a VPC Endpoint Solve?
<!-- section-summary: A VPC endpoint replaces broad generic egress for a supported dependency with a private, service-specific path. -->

Every service connection involves at least three mechanisms:

1. **DNS** turns a service name into an address.
2. **Routing** sends packets toward that address.
3. **Authorization** decides whether the application may perform the requested operation.

These mechanisms are independent. An application can resolve `secretsmanager.eu-west-1.amazonaws.com` to a private endpoint address and establish TCP `443`, yet receive `AccessDenied` because its role cannot read the secret. The IAM policy can be perfect while broken DNS prevents any packet from reaching the service.

```text
Application requests a secret
       ↓ DNS
service name becomes 10.0.20.17
       ↓ networking
packet reaches VPC endpoint
       ↓ authorization
Secrets Manager accepts or denies API request
```

Without an endpoint, a private EC2 instance may use this path to a normal public AWS service endpoint:

```text
private EC2
  ↓ default route
NAT gateway
  ↓
internet gateway
  ↓
public-facing AWS service endpoint
```

That path works, but it is broader than the requirement. The application needed `EC2 → Secrets Manager`; the VPC supplied infrastructure capable of `EC2 → arbitrary public destinations`.

A VPC endpoint creates a private entry for a particular supported service. It can remove the need for NAT and an internet gateway for that service traffic. This applies the least-privilege idea to networking:

```text
IAM least privilege:
Only grant the API operations required.

Network least privilege:
Only create paths to the destinations required.
```

A workload whose dependencies all have private paths may be able to operate without general internet egress. That does not remove IAM or application authorization; it narrows the reachable network surface.

### What Is a VPC Endpoint?
<!-- section-summary: A VPC endpoint is a private entry associated with your VPC for one supported service, resource, or endpoint service. -->

A **VPC endpoint** is an entry point inside or associated with a VPC through which traffic reaches a particular destination privately.

```text
application → VPC endpoint → private service path → service
```

This differs from:

```text
application → NAT → generic public egress → service
```

The VPC endpoint is the resource you create. **AWS PrivateLink** is the underlying technology for certain endpoint types, especially interface endpoints. A gateway endpoint does not use PrivateLink.

AWS supports several endpoint categories, including interface, gateway, Gateway Load Balancer, resource, and service-network endpoints. The two foundations for this lesson are:

- **Gateway endpoints**, which create route-table paths to S3 and DynamoDB.
- **Interface endpoints**, which create private network interfaces for supported AWS and privately published services and use PrivateLink.

The endpoint type follows the destination and desired access model. Calling every private service path "PrivateLink" hides an important difference: an S3 gateway endpoint works through route selection, while a Secrets Manager interface endpoint works through private IP addresses, DNS, security groups, and PrivateLink.

## How Does a Gateway Endpoint Work?
<!-- section-summary: A gateway endpoint sends S3 or DynamoDB prefix-list traffic through a route-table target without creating endpoint ENIs. -->

Gateway endpoints support Amazon S3 and DynamoDB. They do not use AWS PrivateLink.

Suppose the private app route table originally contains:

```text
10.0.0.0/16 → local
0.0.0.0/0   → NAT gateway
```

The application calls S3. With no narrower route, the public S3 address can fall through the NAT path. Create an S3 gateway endpoint and associate it with that route table. AWS manages a service prefix list and inserts the endpoint route:

```text
Destination             Target
10.0.0.0/16             local
S3 managed prefix list  vpce-abc123
0.0.0.0/0               NAT gateway
```

An S3 destination matches the service prefix list, which is more specific than the default route, and uses the gateway endpoint. Other public destinations continue to use NAT.

![The S3 gateway endpoint route shows how private subnets can reach S3 through route tables without sending that traffic through NAT](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-vpc-endpoints-privatelink/s3-gateway-endpoint-route.png)

*The S3 prefix-list route selects the gateway endpoint before the general NAT fallback.*

The endpoint does not create an endpoint ENI inside the subnet. It is fundamentally a routing mechanism:

```text
packet destination belongs to S3
          ↓
workload subnet route table
          ↓ matches managed S3 prefix list
gateway endpoint
          ↓
Amazon S3
```

DNS remains ordinary. The application can keep using `s3.eu-west-1.amazonaws.com`. DNS resolves a service destination; the route table changes how that destination is reached. The application does not need to call a special VPC-endpoint hostname.

The full packet flow is:

```text
App 10.0.10.25
  ↓ HTTPS to S3 hostname
DNS returns an S3 destination
  ↓
subnet route table matches S3 prefix list
  ↓
S3 gateway endpoint
  ↓
Amazon S3
```

There is no NAT gateway, internet gateway, or EC2 public address in that path. This is especially useful for substantial S3 or DynamoDB traffic originating in the VPC. The raw material also notes that gateway endpoints themselves have no additional endpoint charge.

Gateway endpoints do not solve arbitrary service access. You cannot use the S3-style gateway route for Secrets Manager, STS, KMS, CloudWatch, ECR, SNS, SQS, or an internal vendor API. Those requirements lead to interface endpoints.

## How Does an Interface Endpoint Work?
<!-- section-summary: An interface endpoint creates private ENIs in selected subnets, and PrivateLink carries traffic from those addresses to a supported service. -->

An **interface VPC endpoint** creates requester-managed endpoint ENIs in subnets that you select. Each interface receives private IP addresses from its subnet.

For a Secrets Manager endpoint across two Availability Zones:

```text
AZ A                         AZ B
Subnet 10.0.10.0/24          Subnet 10.0.20.0/24
Endpoint ENI 10.0.10.80      Endpoint ENI 10.0.20.93
```

The application connects over HTTPS to one of those private addresses, and PrivateLink carries the connection to Secrets Manager:

```text
Application 10.0.1.25
        ↓ HTTPS
endpoint ENI 10.0.10.80
        ↓ AWS PrivateLink
Secrets Manager
```

This produces the central difference: the application is effectively connecting to a private IP inside its own VPC.

You normally do not add a special endpoint route to reach an interface endpoint. The endpoint address belongs to the VPC, so the existing local route already covers it.

```text
Gateway endpoint:
service prefix → special endpoint route

Interface endpoint:
DNS → private endpoint address → VPC local route
```

Because the interface endpoint has ENIs, you can attach security groups. A common rule allows inbound TCP `443` from the application security group:

```text
application SG
     ↓ TCP 443
endpoint SG
     ↓ PrivateLink
service
```

This provides a network choke point for which workloads can reach the endpoint. A gateway endpoint has no endpoint ENI and therefore no endpoint security group. With restrictive egress, workloads using an S3 or DynamoDB gateway endpoint can permit the AWS-managed service prefix list instead.

Interface endpoints can support many AWS service APIs as well as compatible privately published services. Unlike gateway endpoints, they are also much more suitable for access from hybrid networks or through other VPC connectivity because they present actual private destination addresses.

### Why Does Private DNS Matter?
<!-- section-summary: Private DNS makes a normal service hostname resolve to endpoint private addresses inside the VPC, keeping network topology out of application code. -->

Without private DNS, AWS provides endpoint-specific names resembling:

```text
vpce-....secretsmanager.eu-west-1.vpce.amazonaws.com
```

Hard-coding that name would couple every application to one network deployment. Existing SDK code already expresses the correct intent:

```python
client = boto3.client("secretsmanager")
```

The SDK uses the normal service hostname. With **private DNS** enabled for the interface endpoint, that same hostname resolves to endpoint ENI addresses for clients inside the VPC.

```text
Inside VPC:
secretsmanager.eu-west-1.amazonaws.com
    → 10.0.10.80 and 10.0.20.93

Outside VPC:
same hostname
    → normal service DNS behavior
```

This is a split-horizon effect: the same name has a private answer in the VPC context. Application intent remains "connect to Secrets Manager," while DNS and networking decide that this VPC uses PrivateLink.

The separation supports a sound systems principle: application intent should not depend on network implementation. Infrastructure can move service access from a public endpoint path to an interface endpoint without rewriting all the clients.

Private DNS for an AWS-service interface endpoint depends on VPC DNS resolution and DNS hostnames being enabled. Custom corporate DNS and Route 53 Resolver forwarding can also influence the answer. If the endpoint exists but the application resolves a public service address, start with DNS rather than changing security groups.

## How Are Gateway and Interface Endpoints Different?
<!-- section-summary: Gateway endpoints are route-table-centric and limited to S3 and DynamoDB, while interface endpoints are private-ENI-and-DNS-centric and use PrivateLink. -->

The fundamental comparison is:

| Property | Gateway endpoint | Interface endpoint |
|---|---|---|
| Main mechanism | Routing | Private ENI plus PrivateLink |
| Private IP in selected subnet | No | Yes |
| Endpoint security group | No | Yes |
| Traffic selection | Managed service prefix-list route | DNS resolving to private ENI |
| Uses PrivateLink | No | Yes |
| Foundational service fit | S3 and DynamoDB | Many AWS and private services |
| Normal application hostname | Yes | Yes, with private DNS |
| Hybrid and connected-network use | Limited | More suitable |

S3 and DynamoDB support both gateway and interface endpoint models. A normal same-VPC workload commonly starts with the gateway endpoint. An interface option becomes relevant for requirements such as private IP addressing, on-premises access, connectivity from other networks, or functionality specific to PrivateLink.

Gateway endpoints are not transitive. If an on-premises network connects to a VPC through VPN, it cannot simply treat that VPC's S3 gateway endpoint as a proxy. The same limitation applies to extending gateway endpoint connectivity through peering, Transit Gateway, VPN, or Direct Connect.

This makes sense when you remember that the endpoint is a route-table feature in a particular VPC, not a server that forwards requests for other networks. Interface endpoints present routable private destination IPs; with deliberately designed hybrid routing and DNS, those addresses can participate in broader architectures.

The two packet flows show the difference clearly.

Gateway endpoint:

```text
application → normal S3 DNS → S3 destination
            → prefix-list route → gateway endpoint → S3
```

Interface endpoint:

```text
application → normal Secrets Manager DNS
            → private ENI address → local route
            → interface endpoint → PrivateLink → service
```

## What Is AWS PrivateLink?
<!-- section-summary: PrivateLink connects a consumer to one provider service through private endpoints without creating general routed access between their networks. -->

AWS PrivateLink exposes a specific service through private endpoints without exposing the provider's entire network.

Compare it with VPC peering.

```text
VPC peering:
consumer VPC ← routed relationship → provider VPC

PrivateLink:
consumer endpoint → specific provider service
```

Peering connects networks. Routes determine which addresses can communicate. PrivateLink connects a consumer to a service. The consumer does not need general routed access into the provider VPC.

This makes PrivateLink useful for SaaS providers, multi-account platforms, shared internal services, and APIs consumed by many independent VPCs. Connections remain on AWS networking rather than traversing the public internet.

The memorable phrase is:

> PrivateLink provides service connectivity without network adjacency.

It is deliberately one-sided. The consumer initiates a connection toward the exposed service. The provider does not receive arbitrary routing access back into the consumer VPC. The two networks are not merged; the provider has exposed one door.

For a SaaS platform with 500 customers, network-level connectivity could require customer CIDRs, non-overlapping ranges, route propagation, and transitive-boundary reasoning. The actual requirement may be only `500 customers → HTTPS API`. PrivateLink models that smaller relationship directly.

### How Does a Provider Publish a PrivateLink Service?
<!-- section-summary: A provider places a Network Load Balancer in front of its service, creates an endpoint service, and lets approved consumers create interface endpoints. -->

Suppose a provider owns an internal payments API in VPC `10.50.0.0/16`. A traditional PrivateLink endpoint-service architecture places its application targets behind a Network Load Balancer, or NLB:

```text
payment servers
      ↓
Network Load Balancer
      ↓
PrivateLink endpoint service
```

The usual endpoint-service model requires an NLB. Gateway Load Balancer endpoint services are a separate model for network appliances.

A consumer creates an interface endpoint that names the provider endpoint service:

```text
Consumer VPC                         Provider VPC

application
  ↓ HTTPS
interface endpoint 10.1.5.47
  ╰══════ AWS PrivateLink ══════► NLB → API targets
```

The consumer sees a private address in its own VPC. It does not need a route to the provider's `10.50.0.0/16` range. PrivateLink transports the connection from the endpoint to the service.

Provider controls answer two network-relationship questions:

1. Which AWS principals may request endpoints for this service?
2. Must the provider approve each requested connection?

Service permissions establish eligible consumers. Connection acceptance can require an explicit provider decision before the endpoint becomes usable.

These controls do not replace application identity. The private payment API may still require TLS, mutual TLS, OAuth, JWT, an API key, or IAM authentication. Private network reachability proves only that the consumer can reach the service endpoint.

Provider services can also use private DNS. The provider associates and verifies ownership of a name such as `payments.example.com`; consumers enable private DNS on their endpoints. Their application continues to use the stable name while private DNS returns the consumer endpoint address.

```text
payments.example.com
  ↓ consumer private DNS
10.1.5.47
  ↓ interface endpoint
PrivateLink
  ↓ provider NLB
payment API
```

DNS again hides the network-specific endpoint name from application code.

## How Do Endpoint Policies, IAM, and Resource Policies Work Together?
<!-- section-summary: The endpoint path, caller identity, and destination resource can each apply an independent policy that vetoes the request. -->

Private connectivity does not equal service authorization. For an EC2 role calling S3 through a VPC endpoint, several policy layers can participate:

```text
application principal
  ↓ IAM identity policy
VPC endpoint
  ↓ endpoint policy
S3 bucket
  ↓ bucket resource policy
requested object
```

An **IAM identity policy** says what the principal may request—for example, `s3:GetObject` on `arn:aws:s3:::financial-reports/*`.

A **VPC endpoint policy** says which principals, actions, and resources may pass through that endpoint. It is a policy-controlled network choke point. It does not give the EC2 role permission and does not replace the identity or resource policies. Endpoint-policy support also differs by AWS service.

A **resource policy** belongs to the destination. An S3 bucket policy can decide which principals may use the bucket and can require requests to arrive from a particular VPC endpoint or VPC.

For one financial reports workload, the layers can agree:

```text
IAM role:
Allow GetObject on financial-reports/*

Endpoint policy:
Only let this endpoint carry approved operations
to financial-reports

Bucket policy:
Accept the approved principal and path,
potentially requiring the expected VPC endpoint
```

This is defense in depth. A compromised app must stay within the IAM grant, endpoint restriction, and bucket rule.

An endpoint `Allow` does not guarantee success. It means the endpoint layer is not vetoing the request. The principal must still satisfy the destination service's authorization.

Think of the layers as:

```text
IAM policy       → employee badge
endpoint policy  → security desk at the building entrance
resource policy  → lock on the particular room
```

The security desk cannot grant access to a locked finance room.

This also separates three meanings of "private":

- A **private subnet** lacks a direct IGW route for its workload, but may use NAT.
- A **private IP** belongs to ranges such as `10.0.0.0/8`, `172.16.0.0/12`, or `192.168.0.0/16`.
- **Private connectivity** uses a controlled non-public-internet service path.

None of these terms alone proves IAM authorization or application security.

## How Do Endpoint Design and Cost Trade Off?
<!-- section-summary: Endpoint choice balances service support, reachability model, Availability Zone placement, address use, and endpoint charges. -->

Gateway endpoints for S3 and DynamoDB have no additional endpoint charge in the raw source's documented model. Interface endpoints have hourly provisioning and data-processing charges. The natural same-VPC starting point for S3 or DynamoDB is therefore often a gateway endpoint.

An interface endpoint becomes useful when the requirement needs a private IP, hybrid or connected-network reachability, or specific PrivateLink behavior. Cost is only one input; the network path must still fit the users of the service.

Interface endpoint ENIs consume subnet addresses. AWS lets you select one subnet per Availability Zone for an endpoint. A production design can place endpoint ENIs in multiple zones:

```text
AZ A                         AZ B
application A                application B
    ↓                            ↓
endpoint ENI A               endpoint ENI B
    ╰────────── PrivateLink ─────╯
                    ↓
                 service
```

This avoids making a single endpoint ENI an unnecessary dependency and supplies local endpoint capacity across the chosen Availability Zones.

Create endpoints from a complete dependency list rather than enabling services by guesswork. One product can use multiple service endpoints internally. A private container workload may need the service API, a data-plane endpoint, an object-storage path for layers, logging, identity token calls, and secret retrieval. Creating only the endpoint named after the product can produce partial startup failures.

When a VPC has no NAT or internet egress, review every external dependency documented by each AWS service. "The application needs service X" may translate into endpoint paths for X plus dependency A and dependency B.

### How Do You Choose the Right Private Connection?
<!-- section-summary: The destination and required scope determine whether to use a gateway endpoint, interface endpoint, PrivateLink service, or network-to-network routing. -->

Use a decision tree grounded in the actual access requirement.

For S3 or DynamoDB:

```text
Can a same-VPC gateway endpoint meet the requirement?
  ├─ yes → gateway endpoint
  └─ no  → consider an interface endpoint
```

For another AWS service API:

```text
Does the service support PrivateLink?
  └─ yes → interface VPC endpoint
```

For your own or a partner service:

```text
Do consumers in other VPCs or accounts
need private access to one specific service?
  └─ yes → provider NLB → endpoint service
           → consumer interface endpoints
```

For broad communication:

```text
Do many hosts, subnets, and protocols need
bidirectional network access?
  └─ yes → consider VPC peering, Transit Gateway,
           VPN, or another routed network connection
```

The deepest distinction is between routing to a network and attaching to a service.

Traditional private networking says, "I need access to addresses in that network." It uses VPN, VPC peering, Transit Gateway, Direct Connect, and routing.

PrivateLink says, "I do not need their network; I need their service." The consumer endpoint attaches privately to that service. This shift from network connectivity to service connectivity is the reason PrivateLink is a useful primitive.

![The endpoint chooser separates gateway endpoints, interface endpoints, and PrivateLink provider services by the job each one solves](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-vpc-endpoints-privatelink/endpoint-type-chooser.png)

*Choose the endpoint or routed connection from the scope of access: one service, one AWS API, or an entire network.*

## How Do You Troubleshoot a VPC Endpoint?
<!-- section-summary: Endpoint debugging moves from DNS and packet reachability to endpoint policy, IAM, resource policy, and service behavior. -->

Walk through the layers rather than opening unrelated console pages.

### 1. Resolve the name

Ask which address the application actually uses:

```bash
dig service.region.amazonaws.com
```

or:

```bash
nslookup service.region.amazonaws.com
```

For an interface endpoint with private DNS, expect private endpoint addresses. A public answer points toward private-DNS settings, VPC DNS support, VPC DNS hostnames, custom corporate DNS, Route 53 Resolver forwarding, or the wrong endpoint service.

### 2. Prove reachability

For an interface endpoint, the destination is a private endpoint ENI. Check normal VPC routing, the endpoint subnet, NACLs, and both sides' security groups. Do not look for a gateway-style `vpce` route, and do not use ICMP `ping` as the main test because interface endpoints do not respond to ping. Test the actual TCP service.

### 3. Check the endpoint security group

For an HTTPS API, the endpoint security group needs inbound TCP `443` from the expected application source. The application group needs corresponding outbound permission. If DNS is private but TCP times out, inspect this layer immediately.

### 4. Check the gateway endpoint route

For S3 or DynamoDB, switch models. Identify the route table used by the workload subnet and prove that the endpoint is associated with it. The AWS-managed service prefix list should target the gateway endpoint.

### 5. Read the endpoint policy

If the service responds with `AccessDenied`, ask whether the caller principal, API action, and requested resource pass the endpoint policy.

### 6. Read IAM controls

Inspect the workload role, identity policy, permissions boundary, applicable SCP, and session policy. Determine whether the principal is allowed to make that exact API request.

### 7. Read the resource policy

Inspect the S3 bucket, KMS key, Secrets Manager secret, or other service-specific resource policy. A working private network does not prevent the resource from rejecting the caller.

The resulting debugging stack is:

```text
DNS
 ↓
destination IP
 ↓
routing
 ↓
security groups and NACLs
 ↓
endpoint policy
 ↓
IAM authorization
 ↓
resource policy
 ↓
application or service behavior
```

A timeout or connection error initially suggests DNS or network reachability. An AWS API `AccessDenied` initially suggests authorization. This is not an absolute law, but it is a strong first triage rule.

![The private access summary connects endpoint type, DNS, route tables, security groups, endpoint policy, IAM, and service logs](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-vpc-endpoints-privatelink/private-service-access-summary.png)

*The endpoint type determines whether route tables or private ENIs lead the investigation, after which policy layers can be checked in order.*

The compact model is:

```text
VPC endpoints
├── gateway endpoint
│   └── route-table mechanism → S3 or DynamoDB
└── interface endpoint
    └── private ENI + DNS → AWS PrivateLink
                            → AWS or private service
```

Five rules capture the topic:

1. A VPC endpoint gives a VPC service-specific private connectivity without generic internet egress for that path.
2. Gateway endpoints use route tables for S3 and DynamoDB and do not use PrivateLink.
3. Interface endpoints create private ENIs and use PrivateLink.
4. Private DNS lets ordinary service hostnames resolve through interface endpoints.
5. PrivateLink exposes a service rather than the provider's full network; network reachability and authorization remain separate.

## Check Your Answers
<!-- section-summary: Review the DNS, routing, endpoint, service-connectivity, and authorization distinctions. -->

:::expand[What Problem Does a VPC Endpoint Solve?]{kind="recap"}
A VPC endpoint replaces broad generic egress for a supported dependency with a private, service-specific path.

A VPC endpoint is a private entry associated with your VPC for one supported service, resource, or endpoint service.

It creates a private path for one supported service or resource instead of relying on a default NAT path capable of reaching arbitrary public destinations.
:::

:::expand[How Does a Gateway Endpoint Work?]{kind="recap"}
A gateway endpoint sends S3 or DynamoDB prefix-list traffic through a route-table target without creating endpoint ENIs.

AWS adds a managed S3 or DynamoDB prefix-list route to associated route tables. Destinations in that list use the endpoint before the broader NAT default route.
:::

:::expand[How Does an Interface Endpoint Work?]{kind="recap"}
An interface endpoint creates private ENIs in selected subnets, and PrivateLink carries traffic from those addresses to a supported service.

Private DNS can resolve the normal service hostname to private endpoint ENIs. Existing local VPC routing reaches those addresses, and PrivateLink carries the connection to the service.

The provider grants selected AWS principals permission to request endpoints and can require acceptance of each connection. The service still needs its own TLS and application authentication or authorization.

Private DNS makes a normal service hostname resolve to endpoint private addresses inside the VPC, keeping network topology out of application code.

The application keeps expressing "connect to this service" with the standard hostname or SDK. Infrastructure can change the network path to PrivateLink without endpoint-specific names in application code.
:::

:::expand[How Are Gateway and Interface Endpoints Different?]{kind="recap"}
Gateway endpoints are route-table-centric and limited to S3 and DynamoDB, while interface endpoints are private-ENI-and-DNS-centric and use PrivateLink.

No. It is a route-table mechanism, so there is no endpoint interface or endpoint security group. The application can keep using the normal service hostname.

It is a route-table feature for its VPC, not a private proxy with an address that forwards traffic from peering, transit, VPN, Direct Connect, or on-premises clients.
:::

:::expand[What Is AWS PrivateLink?]{kind="recap"}
PrivateLink connects a consumer to one provider service through private endpoints without creating general routed access between their networks.

Peering creates routed network-to-network connectivity. PrivateLink gives the consumer an endpoint to one provider service without exposing general provider-VPC routing or giving the provider reverse network access.

A provider places a Network Load Balancer in front of its service, creates an endpoint service, and lets approved consumers create interface endpoints.
:::

:::expand[How Do Endpoint Policies, IAM, and Resource Policies Work Together?]{kind="recap"}
The endpoint path, caller identity, and destination resource can each apply an independent policy that vetoes the request.

No. It limits which principals, operations, and resources may pass through that endpoint. The caller still needs IAM permission, and the destination resource policy can still deny the request.
:::

:::expand[How Do Endpoint Design and Cost Trade Off?]{kind="recap"}
Endpoint choice balances service support, reachability model, Availability Zone placement, address use, and endpoint charges.

The destination and required scope determine whether to use a gateway endpoint, interface endpoint, PrivateLink service, or network-to-network routing.

DNS identifies an address, routing and packet controls provide a path, and authorization decides whether the principal may perform the service operation. A success at one layer does not prove the others.

Use peering, Transit Gateway, VPN, or another routed option when many hosts, subnets, protocols, and bidirectional paths need network-level communication. PrivateLink is strongest when consumers need one service.
:::

:::expand[How Do You Troubleshoot a VPC Endpoint?]{kind="recap"}
Endpoint debugging moves from DNS and packet reachability to endpoint policy, IAM, resource policy, and service behavior.

Resolve DNS, identify the destination, prove routing and packet permission, inspect endpoint policy, then IAM and resource policies, and finally application behavior. Gateway endpoints emphasize route tables; interface endpoints emphasize private ENIs and DNS.
:::

## References

- [What is AWS PrivateLink?](https://docs.aws.amazon.com/vpc/latest/privatelink/what-is-privatelink.html) - Introduces private connectivity to AWS services, resources, and endpoint services.
- [AWS PrivateLink concepts](https://docs.aws.amazon.com/vpc/latest/privatelink/concepts.html) - Defines endpoint types and PrivateLink components.
- [Gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html) - Describes S3 and DynamoDB prefix-list routes, charges, and security-group considerations.
- [Create an interface endpoint](https://docs.aws.amazon.com/vpc/latest/privatelink/create-interface-endpoint.html) - Documents endpoint ENIs, subnet selection, security groups, DNS requirements, and testing behavior.
- [Interface VPC endpoints for IAM](https://docs.aws.amazon.com/en_gb/IAM/latest/UserGuide/reference_interface_vpc_endpoints.html) - Shows interface-endpoint access through PrivateLink.
- [Configure an interface endpoint](https://docs.aws.amazon.com/vpc/latest/privatelink/interface-endpoints.html) - Covers private DNS for standard service names.
- [AWS PrivateLink for Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/privatelink-interface-endpoints.html) - Explains when S3 interface endpoints fit connected or hybrid access.
- [Gateway endpoints for Amazon S3](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html) - Documents gateway endpoint non-transitivity.
- [Create an endpoint service](https://docs.aws.amazon.com/vpc/latest/privatelink/create-endpoint-service.html) - Covers NLB-backed services, allowed principals, acceptance, and private DNS verification.
- [Endpoint policies](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-access.html) - Explains policy scope and its relationship to identity and resource policies.
- [S3 bucket policies for VPC endpoints](https://docs.aws.amazon.com/AmazonS3/latest/userguide/example-bucket-policies-vpc-endpoint.html) - Shows resource-side restriction by VPC or endpoint.
