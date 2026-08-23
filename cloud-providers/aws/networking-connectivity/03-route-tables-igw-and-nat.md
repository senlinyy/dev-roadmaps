---
title: "Route Tables, IGW, and NAT"
description: "Follow packets through AWS route tables, local routes, internet gateways, NAT gateways, service endpoints, and private-network targets."
overview: "AWS routing becomes easier when every problem starts with a destination IP. This article shows how the applicable subnet route table selects the most-specific destination and sends the packet to a local, internet, NAT, endpoint, transit, peering, or VPN target."
tags: ["aws", "vpc", "route-tables", "internet-gateway", "nat-gateway", "networking"]
order: 3
id: article-cloud-providers-aws-networking-connectivity-route-tables-igw-nat
aliases:
  - route-tables-igw-and-nat
  - route-tables-internet-gateway-nat
  - route-tables-internet-gateways-and-nat
---

## Table of Contents

1. [What Question Does a Route Table Answer?](#what-question-does-a-route-table-answer)
2. [Which Route Table Does a Subnet Use?](#which-route-table-does-a-subnet-use)
3. [How Does an Internet Gateway Provide a Direct Internet Path?](#how-does-an-internet-gateway-provide-a-direct-internet-path)
4. [How Does a NAT Gateway Provide Private IPv4 Egress?](#how-does-a-nat-gateway-provide-private-ipv4-egress)
5. [Why Does the Most-Specific Route Win?](#why-does-the-most-specific-route-win)
6. [How Do VPC Endpoints Avoid the NAT Path?](#how-do-vpc-endpoints-avoid-the-nat-path)
7. [How Do You Trace a Route With the AWS CLI?](#how-do-you-trace-a-route-with-the-aws-cli)
8. [How Do You Debug One Packet From Start to Finish?](#how-do-you-debug-one-packet-from-start-to-finish)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

The cleanest way to reason about AWS routing is to follow one packet. Suppose an EC2 instance sends:

```text
Source:      10.0.2.15
Destination: 8.8.8.8
```

The first network question is not whether the packet is trusted. It is, **"Given this destination address, where should the packet go next?"** The route table answers that question.

The sections below answer these questions in order:

1. **What Question Does a Route Table Answer?**
2. **Which Route Table Does a Subnet Use?**
3. **How Does an Internet Gateway Provide a Direct Internet Path?**
4. **How Does a NAT Gateway Provide Private IPv4 Egress?**
5. **Why Does the Most-Specific Route Win?**
6. **How Do VPC Endpoints Avoid the NAT Path?**
7. **How Do You Trace a Route With the AWS CLI?**
8. **How Do You Debug One Packet From Start to Finish?**

## What Question Does a Route Table Answer?
<!-- section-summary: A route maps a destination address range to the target that should receive matching packets. -->

Conceptually, a route table acts like this function:

```text
route(destination_ip) → next_hop
```

Examples might be:

```text
route(10.0.1.50) → local
route(10.0.2.33) → local
route(1.1.1.1)   → NAT gateway
```

Each route has two central fields:

```text
Destination       Target
10.0.0.0/16       local
0.0.0.0/0         nat-abc123
```

The **destination** defines which packets match. The **target** is the next AWS networking object or path that receives those packets. Targets can include `local`, an internet gateway, NAT gateway, gateway endpoint, Transit Gateway, VPC peering connection, VPN gateway, or network interface.

![The route table decision view shows how destination CIDRs choose between local VPC routing, internet gateways, NAT gateways, and endpoints](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-route-tables-igw-nat/route-table-decision.png)

*The destination selects the route; the route's target determines the next network path.*

A VPC route normally does not match an HTTP path, user name, application process, source port, or destination TCP port. Routing primarily answers **where** the packet should travel. Other controls answer whether it is allowed.

```text
Route table     → Where should this packet go next?
Security group  → Is this connection permitted at the resource?
Network ACL     → Is this packet permitted at the subnet boundary?
```

This separation explains why a route table can be perfectly correct while the connection still times out.

## Which Route Table Does a Subnet Use?
<!-- section-summary: Traffic from a subnet follows its one effective route table, which may be explicitly associated or inherited from the VPC main table. -->

An EC2 instance does not normally choose a private VPC route table for itself. The relationship is:

```text
EC2 network interface
        ↓ belongs to
subnet
        ↓ associated with
route table
```

If EC2 `10.0.2.15` is in `subnet-private-a`, traffic originating there uses that subnet's effective route table. One route table can serve multiple subnets, but each subnet has one effective route table at a time.

An explicit association names the route table for that subnet. Without one, the subnet implicitly uses the VPC's **main route table**. This default matters during troubleshooting: a query that filters route tables by a subnet association can return nothing even though the subnet still has effective routes through the main table.

The association is also the basis of the public/private distinction. AWS does not create a different resource type named `PublicSubnet`. A subnet is normally called public when its effective route table has a direct route to an internet gateway. A private subnet can instead use NAT for default IPv4 egress or have no internet default route.

Consider a small VPC:

```text
VPC: 10.0.0.0/16

Public subnet:  10.0.1.0/24
  └── public NAT gateway with an Elastic IP

Private subnet: 10.0.2.0/24
  └── EC2 10.0.2.15
```

The public table contains `10.0.0.0/16 → local` and `0.0.0.0/0 → IGW`. The private table contains `10.0.0.0/16 → local` and `0.0.0.0/0 → NAT`. Much of everyday AWS VPC routing follows from understanding those four entries and which subnet uses each table.

### How Do the Local and Default Routes Work?
<!-- section-summary: The local route keeps VPC-destination traffic inside the VPC, while the default route handles destinations without a more-specific match. -->

A route table in a VPC with CIDR `10.0.0.0/16` normally includes:

```text
10.0.0.0/16 → local
```

The route means that a destination inside a VPC CIDR should stay on the VPC routing fabric. Suppose Server A is `10.0.1.20` and Server B is `10.0.2.30`. A packet from A to B matches `10.0.0.0/16`, so it does not go through an internet gateway or NAT gateway.

```text
10.0.1.20
  ↓ destination 10.0.2.30
subnet route table
  ↓ match 10.0.0.0/16
local VPC routing
  ↓
10.0.2.30
```

The local route creates a routing path. Security groups, network ACLs, the operating-system firewall, and the destination service still decide whether the connection succeeds.

`0.0.0.0/0` has zero fixed prefix bits, so every IPv4 address matches it. It is the **default route**. In a simple table, it handles destinations outside the more-specific VPC range:

```text
10.0.2.50 → local
10.0.9.20 → local
8.8.8.8   → default target
1.1.1.1   → default target
```

The route does not say what the fallback architecture is until you read its target:

```text
0.0.0.0/0 → internet gateway   direct internet path
0.0.0.0/0 → NAT gateway        translated private egress
```

That target difference creates the public and private subnet patterns.

## How Does an Internet Gateway Provide a Direct Internet Path?
<!-- section-summary: An internet gateway is a VPC route target for direct internet-routable traffic, but IPv4 resources still need a public mapping and security permission. -->

An **internet gateway**, or IGW, attaches to a VPC and can be the target for internet-routable traffic. A public subnet normally includes:

```text
10.0.0.0/16 → local
0.0.0.0/0   → igw-1234
```

The IGW is the VPC's direct internet edge. The route does not automatically make every EC2 instance internet-accessible.

For direct IPv4 connectivity, an instance also needs a public IPv4 address or Elastic IP and suitable security controls. Suppose an instance has:

```text
Private IP: 10.0.1.20
Public IP:  203.0.113.50
```

Applications on the instance normally use the private address. For internet traffic, AWS's internet-gateway behavior provides the mapping between the public and private IPv4 identities.

```text
EC2 10.0.1.20
  ↓ destination 8.8.8.8
0.0.0.0/0 → IGW
  ↓ public mapping
internet sees source 203.0.113.50
```

For an inbound connection, a laptop addresses `203.0.113.50:443`. The internet path reaches the IGW, the mapping identifies the private instance address, and the security group must permit the request. Network ACL, host firewall, and application-listener behavior still apply.

One correction is vital: `0.0.0.0/0 → IGW` does not mean "allow all internet traffic in." It is a routing rule, not a firewall statement. It provides a possible internet and return path for properly addressed resources. Packet permission belongs to security controls.

## How Does a NAT Gateway Provide Private IPv4 Egress?
<!-- section-summary: A public NAT gateway translates private source addresses and ports so workloads can start IPv4 internet connections and receive their responses. -->

A private application server may need `apt update`, `pip install`, package downloads, antivirus definitions, or a public API, while remaining unavailable for direct internet-originated connections.

The classic AWS solution is a **public NAT gateway**. NAT stands for Network Address Translation. It rewrites the private source address and, in practice, the source port.

Suppose EC2 creates this connection:

```text
Source:      10.0.2.15:50000
Destination: 93.184.216.34:443
```

The NAT gateway creates and remembers a translation similar to:

```text
10.0.2.15:50000 ↔ NAT-public-address:62001
```

The internet server sees the NAT public address and port. When the response arrives for that translated flow, NAT looks up the saved mapping and returns the packet to `10.0.2.15:50000`.

The traditional public NAT gateway sits in a public subnet and has an Elastic IP. Two route tables cooperate:

```text
Private subnet table
10.0.0.0/16 → local
0.0.0.0/0   → NAT gateway

NAT's public subnet table
10.0.0.0/16 → local
0.0.0.0/0   → internet gateway
```

Follow the packet completely:

```text
EC2 10.0.2.15
  ↓ packet for 1.1.1.1
private route table
  ↓ default → NAT
NAT gateway
  ↓ source and port translation
public subnet route table
  ↓ default → IGW
internet gateway
  ↓
1.1.1.1
```

The response returns through the internet gateway to NAT. NAT recognizes the existing translation and sends the response back to the private instance. A random internet client cannot normally use this to initiate an unrelated new connection to the private address.

![The private egress view compares NAT and endpoint paths so private workloads can reach updates, APIs, and AWS services deliberately](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-route-tables-igw-nat/private-egress-paths.png)

*A private IPv4 workload sends general public traffic to NAT, while service-specific traffic can take an endpoint route.*

IGW and NAT solve different problems:

| Question | Internet gateway | Public NAT gateway |
|---|---|---|
| Acts as a VPC internet route target? | Yes | Indirectly, through its own public subnet |
| Typical target from a public subnet? | Yes | No |
| Typical target from a private subnet? | No | Yes |
| Gives a workload direct public identity? | Supports it with a public mapping | No |
| Translates many private flows behind public egress? | No | Yes |
| Allows unsolicited inbound connections to the private instance? | Depends on direct public identity and policy | No |
| Needs an IGW for classic public IPv4 egress? | Not applicable | Yes |

An IGW is the internet doorway for the VPC. NAT is an outbound, proxy-like address translator for resources that should not have their own direct public identity. The word "proxy-like" is only an intuition: NAT is not an HTTP proxy.

A private subnet can reach the internet through NAT and remain private in this routing sense because its subnet does not have a direct IGW route.

## Why Does the Most-Specific Route Win?
<!-- section-summary: Longest-prefix matching selects narrow internal and service paths before broad fallback routes such as `0.0.0.0/0`. -->

Suppose the app at `10.0.2.15` connects to the database at `10.0.3.50`. Its table has:

```text
10.0.0.0/16 → local
0.0.0.0/0   → NAT gateway
```

The database address matches both entries, but AWS selects the **most specific matching route**, also called longest-prefix matching. `/16` fixes more address bits than `/0`, so local wins. Database traffic never reaches NAT.

The same rule applies to this set:

```text
10.0.0.0/8
10.10.0.0/16
10.10.20.0/24
10.10.20.37/32
0.0.0.0/0
```

Destination `10.10.20.37` matches all five, but `/32` is the most specific. In general:

```text
/32 more specific than /24
/24 more specific than /16
/16 more specific than /8
/8  more specific than /0
```

After longest-prefix matching, AWS can apply further priority rules where matching routes have the same prefix. The first principle remains: begin by finding every matching destination and select the longest prefix.

This makes a realistic private table expressive:

| Destination | Target |
|---|---|
| `10.0.0.0/16` | `local` |
| `10.50.0.0/16` | Transit Gateway |
| `172.16.0.0/16` | VPC peering |
| S3 prefix list | S3 gateway endpoint |
| `0.0.0.0/0` | NAT gateway |

Traffic to the VPC stays local. `10.50.9.20` uses the Transit Gateway. `172.16.4.8` uses peering. An S3 address covered by the prefix list uses the endpoint. Everything else falls back to NAT.

The default route is useful because it is evaluated as the least-specific fallback after every narrower exception.

## How Do VPC Endpoints Avoid the NAT Path?
<!-- section-summary: Gateway endpoints add service-prefix routes, while interface endpoints use private ENIs and DNS to reach supported AWS services. -->

Suppose the private EC2 instance frequently calls Amazon S3. Without an endpoint, that request may follow:

```text
EC2 → NAT → IGW → public S3 service endpoint
```

A **gateway endpoint** creates a private service path:

```text
EC2 → S3 gateway endpoint → S3
```

Gateway endpoints support S3 and DynamoDB. AWS adds a route to the selected route tables using an AWS-managed **prefix list**, which represents the regional service address ranges.

```text
Destination       Target
10.0.0.0/16       local
pl-S3             vpce-S3
0.0.0.0/0         NAT gateway
```

An S3 destination matches the prefix-list entry and uses the gateway endpoint. A public GitHub destination does not match the service list and falls back to NAT.

An **interface endpoint** works differently. It creates endpoint network interfaces with private IP addresses in your VPC. Private DNS can make the normal AWS service hostname resolve to those private addresses.

```text
application calls service.amazonaws.com
          ↓ DNS resolves
private endpoint address 10.0.4.73
          ↓ normal VPC routing
endpoint ENI
          ↓ AWS PrivateLink
AWS service
```

The distinction is compact:

```text
Gateway endpoint   → special service route in route tables
Interface endpoint → private network interface plus DNS
```

Put the full private table together:

```text
If destination belongs to the VPC:
    use local routing
else if destination belongs to S3:
    use the gateway endpoint
else if destination has a private endpoint DNS answer:
    route to that endpoint ENI
else:
    use NAT for the outside IPv4 destination
```

NAT is not needed for every private connection. Another EC2 instance and RDS in the VPC use local routing. S3 can use a gateway endpoint. Only destinations whose best route points to NAT use NAT.

### What Do Route Tables Not Decide?
<!-- section-summary: Route tables neither authorize traffic nor resolve domain names, so security and DNS remain separate troubleshooting layers. -->

A local route between `10.0.2.15` and `10.0.3.20` means a path exists at the routing layer. Communication can still fail because a security group rejects TCP `5432`, a network ACL rejects a packet, the host firewall blocks it, or the database is not listening.

Use this analogy carefully:

```text
Route table  = a road exists to the building.
Security group = the building's guard.
Network ACL  = checkpoint on the road.
Application  = someone answers the door.
```

Route tables also do not contain domain names. When an application requests `https://example.com`, DNS happens before route selection:

```text
example.com
  ↓ DNS
93.184.216.34
  ↓ route lookup
0.0.0.0/0 → NAT
```

The useful diagnostic sequence is:

```text
name → DNS → destination IP → route table → next hop
     → security controls → destination application
```

An incorrect DNS answer can make the network select a perfectly valid route to the wrong destination. A correct route can lead to a target whose policy rejects the packet. Keep the layers separate.

## How Do You Trace a Route With the AWS CLI?
<!-- section-summary: CLI evidence identifies the source subnet, effective route table, selected target, target health, and alternate endpoint paths. -->

Begin with the source, not with a general question such as "Why is the internet broken?" Find the instance's private address, public address, subnet, and VPC:

```bash
aws ec2 describe-instances \
  --instance-ids i-0123456789abcdef0 \
  --query 'Reservations[].Instances[].{
    Instance:InstanceId,
    PrivateIP:PrivateIpAddress,
    PublicIP:PublicIpAddress,
    Subnet:SubnetId,
    VPC:VpcId
  }' \
  --output table
```

Suppose the result says the instance is `10.0.2.15`, has no public IP, belongs to `subnet-private`, and is inside `vpc-1234`. You now know it has no direct public IPv4 identity.

Find an explicitly associated route table:

```bash
aws ec2 describe-route-tables \
  --filters Name=association.subnet-id,Values=subnet-private
```

If this returns nothing, check the VPC's main table because an implicit main association does not include the subnet ID in the same way:

```bash
aws ec2 describe-route-tables \
  --filters \
    Name=vpc-id,Values=vpc-1234 \
    Name=association.main,Values=true
```

Inspect destinations, targets, and route state:

```bash
aws ec2 describe-route-tables \
  --route-table-ids rtb-1234 \
  --query 'RouteTables[].Routes[].{
    IPv4:DestinationCidrBlock,
    IPv6:DestinationIpv6CidrBlock,
    PrefixList:DestinationPrefixListId,
    Gateway:GatewayId,
    NAT:NatGatewayId,
    Peering:VpcPeeringConnectionId,
    State:State
  }' \
  --output table
```

A route whose state is `blackhole` has an unavailable target. A table may contain the expected destination text while the path is still unusable, so state belongs in the inspection.

If the best route selects NAT, inspect it:

```bash
aws ec2 describe-nat-gateways \
  --nat-gateway-ids nat-abc123 \
  --query 'NatGateways[].{
    State:State,
    VPC:VpcId,
    Subnet:SubnetId,
    Connectivity:ConnectivityType,
    Addresses:NatGatewayAddresses
  }'
```

The relevant gateway should be available. For the classic public NAT design, identify its subnet, find that subnet's route table, and verify `0.0.0.0/0 → igw-...`. Otherwise the path is effectively `EC2 → NAT → nowhere`.

Verify the IGW attachment:

```bash
aws ec2 describe-internet-gateways \
  --filters Name=attachment.vpc-id,Values=vpc-1234
```

Then check endpoints before assuming a service request should use NAT:

```bash
aws ec2 describe-vpc-endpoints \
  --filters Name=vpc-id,Values=vpc-1234 \
  --query 'VpcEndpoints[].{
    ID:VpcEndpointId,
    Type:VpcEndpointType,
    Service:ServiceName,
    State:State,
    RouteTables:RouteTableIds
  }' \
  --output table
```

The result distinguishes gateway and interface endpoints. If S3 fails while general internet access works, investigate the S3 endpoint route, endpoint policy, DNS behavior, and resource policy before changing NAT.

Only after the intended path is clear should the investigation proceed through the instance security group, source and NAT-subnet network ACLs, host firewall, DNS, and remote service. Those layers can block a packet even when the route targets are healthy.

![The route debug checklist shows how subnet association, route target, NAT health, endpoint policy, and DNS evidence fit together](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-route-tables-igw-nat/route-debug-checklist.png)

*Route debugging starts with the source subnet and most-specific destination, then proves each selected target before moving to policy and application layers.*

## How Do You Debug One Packet From Start to Finish?
<!-- section-summary: Becoming the packet turns a vague connectivity problem into a sequence of destination, route, target, policy, and response checks. -->

Suppose a private EC2 instance cannot reach `https://example.com`. Walk the flow:

```text
1. DNS resolves example.com to 93.x.x.x.
2. Source is 10.0.2.15.
3. Destination is 93.x.x.x.
4. Find the effective route table for the source subnet.
5. The destination matches 0.0.0.0/0 → nat-123.
6. Verify nat-123 is available.
7. Verify the NAT subnet's route selects an attached IGW.
8. Check security groups and both relevant NACL paths.
9. Check host policy and DNS behavior.
10. Verify the remote service accepts and responds.
```

Change the destination and the route reasoning changes naturally:

```text
RDS at 10.0.3.40
  → local route

S3 address covered by pl-S3
  → gateway endpoint

Corporate host 10.100.5.20
  → Transit Gateway or VPN route

General public server 151.x.x.x
  → NAT default route
```

The method scales because it does not depend on memorizing one architecture diagram. It asks four routing questions every time:

1. What is the destination IP?
2. Which route table applies to the source subnet?
3. What is the most-specific matching route?
4. Which target does that route select?

Then it checks that the target forms a usable path and that security and application layers permit the connection.

The whole routing system reduces to four rules:

| First principle | AWS consequence |
|---|---|
| A packet needs a next hop | The route table chooses a target |
| Route selection is destination-based | CIDRs and prefix lists represent destinations |
| The most-specific matching prefix wins | `/24` beats `/16`, and `/16` beats `/0` |
| Different targets create different architectures | IGW provides direct public paths, NAT provides private egress, and endpoints provide private service paths |

The canonical pattern is:

```text
PUBLIC SUBNET
VPC CIDR  → local
0.0.0.0/0 → IGW

PRIVATE SUBNET
VPC CIDR  → local
S3 prefix → gateway endpoint
0.0.0.0/0 → NAT

PUBLIC NAT
receives private egress
translates source address and port
reaches the internet through the IGW
remembers mappings for response traffic
```

The most important sentence is: **a route table does not decide whether a packet is trustworthy; it decides where the packet should go next.** IGWs, NAT gateways, endpoints, peering, Transit Gateways, and VPNs are different targets inside that shared model.

## Check Your Answers
<!-- section-summary: Verify the route-selection, gateway, translation, endpoint, and diagnostic ideas that control packet paths. -->

:::expand[What Question Does a Route Table Answer?]{kind="recap"}
A route maps a destination address range to the target that should receive matching packets.

The destination identifies the address range or prefix list whose packets match. The target identifies the next AWS networking path, such as local routing, an IGW, NAT gateway, endpoint, Transit Gateway, peering connection, or VPN gateway.

DNS resolves the name into an IP address first. The route table then matches that destination IP or prefix. Routing works with network destinations, not domain-name intent.
:::

:::expand[Which Route Table Does a Subnet Use?]{kind="recap"}
Traffic from a subnet follows its one effective route table, which may be explicitly associated or inherited from the VPC main table.

Traffic uses the effective route table of the subnet containing the source network interface. An explicit subnet association selects a table; otherwise the subnet implicitly uses the VPC main route table.

The local route keeps VPC-destination traffic inside the VPC, while the default route handles destinations without a more-specific match.

It keeps packets whose destination belongs to a VPC CIDR on the VPC routing fabric. It creates a path between subnets but does not override security groups, NACLs, host firewalls, or application behavior.

No. VPC destinations use local routing, matching service addresses can use endpoint routes, private-network ranges can use transit, peering, or VPN targets, and only destinations whose best route is the default NAT route use NAT.
:::

:::expand[How Does an Internet Gateway Provide a Direct Internet Path?]{kind="recap"}
An internet gateway is a VPC route target for direct internet-routable traffic, but IPv4 resources still need a public mapping and security permission.

The resource needs a public IPv4 address or Elastic IP mapping, a matching route and return path, security controls that permit the flow, and a service that listens and responds.
:::

:::expand[How Does a NAT Gateway Provide Private IPv4 Egress?]{kind="recap"}
A public NAT gateway translates private source addresses and ports so workloads can start IPv4 internet connections and receive their responses.

NAT creates state when the private workload initiates a flow. It translates the source address and port and uses the stored mapping for replies. An unrelated inbound packet has no matching translation to a private session.
:::

:::expand[Why Does the Most-Specific Route Win?]{kind="recap"}
Longest-prefix matching selects narrow internal and service paths before broad fallback routes such as `0.0.0.0/0`.

Every IPv4 address matches `/0`, but AWS selects the longest, most-specific matching prefix. A VPC `/16` destination therefore uses the local route instead of the `/0` fallback.

Write down the source, resolved destination, applicable route table, most-specific route, and selected next hop. Prove each hop in order before moving to security and application layers instead of treating the timeout as one undivided problem.
:::

:::expand[How Do VPC Endpoints Avoid the NAT Path?]{kind="recap"}
Gateway endpoints add service-prefix routes, while interface endpoints use private ENIs and DNS to reach supported AWS services.

The private subnet needs a default route to NAT. NAT's public subnet needs a default route to an attached IGW. Missing the second path produces a working next-hop selection that cannot reach the internet.

A gateway endpoint adds a route for an AWS-managed service prefix list. An interface endpoint creates private endpoint ENIs, and DNS can make the normal service hostname resolve to their private addresses.

Route tables neither authorize traffic nor resolve domain names, so security and DNS remain separate troubleshooting layers.
:::

:::expand[How Do You Trace a Route With the AWS CLI?]{kind="recap"}
CLI evidence identifies the source subnet, effective route table, selected target, target health, and alternate endpoint paths.

Identify the source instance, VPC, and subnet; find the explicit or main route table; select the most-specific route; inspect its state and target; then verify NAT, IGW attachment, or endpoint configuration for that selected path.
:::

:::expand[How Do You Debug One Packet From Start to Finish?]{kind="recap"}
Becoming the packet turns a vague connectivity problem into a sequence of destination, route, target, policy, and response checks.
:::

## References

- [Configure route tables](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html) - Explains destination-to-target routes in Amazon VPC.
- [Route table concepts](https://docs.aws.amazon.com/vpc/latest/userguide/RouteTables.html) - Covers subnet associations, main tables, and local routes.
- [Internet gateways](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html) - Documents direct internet-route and public IPv4 requirements.
- [Routing options](https://docs.aws.amazon.com/vpc/latest/userguide/route-table-options.html) - Provides common route-target patterns.
- [NAT devices](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat.html) - Explains address and port translation behavior.
- [NAT gateway use cases](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-scenarios.html) - Documents public NAT paths for private subnets.
- [Route priority](https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html) - Explains longest-prefix matching and route priority.
- [Gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html) - Describes S3 and DynamoDB prefix-list routes.
- [Interface endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/interface-endpoints.html) - Describes endpoint ENIs and private DNS.
- [describe-route-tables](https://docs.aws.amazon.com/cli/latest/reference/ec2/describe-route-tables.html) - Documents subnet-association filters and route states.
- [describe-nat-gateways](https://docs.aws.amazon.com/cli/latest/reference/ec2/describe-nat-gateways.html) - Documents NAT state, subnet, connectivity type, and addresses.
- [Troubleshoot NAT gateways](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-troubleshooting.html) - Covers private route, public NAT subnet, IGW, security-group, and NACL checks.
- [describe-internet-gateways](https://docs.aws.amazon.com/cli/latest/reference/ec2/describe-internet-gateways.html) - Documents VPC attachment filtering.
- [describe-vpc-endpoints](https://docs.aws.amazon.com/cli/latest/reference/ec2/describe-vpc-endpoints.html) - Documents endpoint types, services, states, and route tables.
