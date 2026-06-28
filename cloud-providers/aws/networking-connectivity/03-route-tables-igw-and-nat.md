---
title: "Route Tables, IGW, and NAT"
description: "Understand how AWS VPC route tables send traffic through local routes, internet gateways, NAT gateways, VPC endpoints, and IPv6 egress paths."
overview: "Route tables decide the next hop for packets leaving each subnet. This article follows the receipts application through public load balancer routes, private API egress through NAT gateways, endpoint routes for AWS services, longest-prefix routing, and practical route debugging."
tags: ["aws", "vpc", "route-tables", "internet-gateway", "nat-gateway", "networking"]
order: 3
id: article-cloud-providers-aws-networking-connectivity-route-tables-igw-nat
aliases:
  - route-tables-igw-and-nat
  - route-tables-internet-gateway-nat
  - route-tables-internet-gateways-and-nat
---
## Table of Contents

1. [The App Needs Packet Paths](#the-app-needs-packet-paths)
2. [Route Tables and Subnet Associations](#route-tables-and-subnet-associations)
3. [The Local Route](#the-local-route)
4. [Internet Gateway Route for Public Entry](#internet-gateway-route-for-public-entry)
5. [NAT Gateway Route for Private Updates](#nat-gateway-route-for-private-updates)
6. [Endpoint Routes for AWS Services](#endpoint-routes-for-aws-services)
7. [Most Specific Route Wins](#most-specific-route-wins)
8. [Diagnostic Walkthrough With AWS CLI](#diagnostic-walkthrough-with-aws-cli)
9. [References](#references)

## The App Needs Packet Paths
<!-- section-summary: The receipts app already has subnet tiers, and route tables now explain how packets leave each tier. -->

The receipts app now has three places: public subnets for the load balancer, private app subnets for API tasks, and data subnets for the database. The next question is packet movement. A subnet can have the right name and the right CIDR range, but packets still need a route table that tells them where to go next.

A **route table** is a list of destination ranges and targets. When a resource sends traffic out of a subnet, AWS checks the route table associated with that subnet and chooses the matching route. The destination might be another private address in the VPC, a public IP address on the internet, an IPv6 range, or an AWS-managed prefix list for a service such as S3.

The route story follows the app. Customer traffic reaches the public load balancer through an internet gateway route. The load balancer reaches private API tasks through the local VPC route. The API reaches the database through the local route, reaches S3 through an endpoint route, and reaches a public payment provider through NAT.

That sequence keeps routes tied to a need. The public tier needs an internet entry path. The private app tier needs outbound updates and third-party calls. The database tier needs private app traffic and very little else. Route tables turn those needs into concrete subnet behavior.

## Route Tables and Subnet Associations
<!-- section-summary: A subnet uses one route table, and explicit associations make public, private app, and data behavior easier to review. -->

Every subnet uses one route table. A subnet can have an explicit route table association, or it can fall back to the VPC main route table. Production teams usually make subnet associations explicit because a reviewer can see which table serves each tier.

A route has two important parts. The **destination** is the CIDR block, IPv6 range, or prefix list that the packet is trying to reach. The **target** is the next hop, such as `local`, an internet gateway, a NAT gateway, a VPC endpoint, a Transit Gateway, or a peering connection.

A private app route table for the receipts app may look like this:

| Destination | Target | Why it exists |
| --- | --- | --- |
| `10.40.0.0/16` | `local` | API tasks can reach private resources in the VPC. |
| S3 prefix list | S3 gateway endpoint | Receipt uploads use the private AWS service path. |
| `0.0.0.0/0` | NAT gateway in the same AZ | Payment provider and public update calls use controlled IPv4 egress. |

The main route table deserves extra care. Any subnet that lacks an explicit association uses it. A safe pattern is to keep the main route table minimal and explicitly associate the public, private app, data, endpoint, and attachment subnets with named route tables.

![The route table decision view shows how destination CIDRs choose between local VPC routing, internet gateways, NAT gateways, and endpoints](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-route-tables-igw-nat/route-table-decision.png)

*The route table decision view shows how destination CIDRs choose between local VPC routing, internet gateways, NAT gateways, and endpoints.*


## The Local Route
<!-- section-summary: Every VPC route table includes a local route that lets private addresses inside the VPC talk to each other. -->

Every VPC route table includes a local route for the VPC CIDR. For the receipts VPC, `10.40.0.0/16 -> local` lets the load balancer, API tasks, database, and endpoints use private addresses inside the VPC. AWS adds this route so subnets in the same VPC can reach each other at the routing layer.

The local route gives a path, and traffic controls still matter. The API can route to the database private IP, but the database security group must allow the API security group on the database port. Network ACLs and service listeners also take part in the final result.

The local route also explains the role of subnet tiers. A data subnet is still inside the VPC CIDR, so a private app subnet can route to it. The database stays protected because the route, security group rules, NACLs, database listener, credentials, and application authorization all line up around a narrow path.

If the VPC has additional IPv4 CIDR blocks or IPv6 ranges, those routes need the same review. The local route covers the VPC address space, and security controls decide which resources can actually use the path.

## Internet Gateway Route for Public Entry
<!-- section-summary: Public subnets use an internet gateway route for direct internet traffic, and public-facing resources still need suitable addresses and security rules. -->

An **internet gateway** is the VPC target for direct internet traffic. The public route table for the receipts load balancer usually has `0.0.0.0/0 -> igw-...` for IPv4 and may also have `::/0 -> igw-...` for IPv6. That route gives public subnets a direct internet path.

The route alone gives only the possible path. A public-facing resource also needs an internet-routable address and traffic rules that allow the connection. In this app, the internet-facing load balancer is the public resource. The API tasks and database stay in private tiers with private addresses.

A small Terraform shape shows the internet gateway and the public default route:

```hcl
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.receipts.id

  tags = {
    Name = "receipts-igw"
  }
}

resource "aws_route" "public_default_ipv4" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}
```

The `vpc_id` field attaches the internet gateway to the receipts VPC. The route's `route_table_id` chooses the public route table. `destination_cidr_block = "0.0.0.0/0"` means every IPv4 destination outside more specific routes, and `gateway_id` points that traffic at the internet gateway.

The review question is association as much as existence. An internet gateway can be attached to the VPC while the private app route table still avoids it. A risk appears when a route table with `0.0.0.0/0 -> igw-...` is associated with a subnet intended to stay private.

## NAT Gateway Route for Private Updates
<!-- section-summary: A public NAT gateway lets private IPv4 workloads start outbound connections while avoiding direct inbound internet reachability. -->

A **NAT gateway** lets private IPv4 resources start outbound connections to public IPv4 destinations. The private resource keeps its private address, and the outside service sees the NAT gateway's Elastic IP. This is a common path for payment providers, public package repositories, update services, or other public endpoints.

For the receipts app, place a public NAT gateway in each public subnet that serves a zone. Private app subnet A routes its default IPv4 traffic to NAT gateway A, and private app subnet B routes to NAT gateway B. This pattern keeps each zone's private egress close to the workloads in that zone.

The Terraform shape usually has an Elastic IP, a NAT gateway, and a private route:

```hcl
resource "aws_eip" "nat_a" {
  domain = "vpc"

  tags = {
    Name = "receipts-nat-a"
  }
}

resource "aws_nat_gateway" "public_a" {
  allocation_id = aws_eip.nat_a.id
  subnet_id     = aws_subnet.public_a.id

  tags = {
    Name = "receipts-nat-a"
  }
}

resource "aws_route" "private_a_default_ipv4" {
  route_table_id         = aws_route_table.private_a.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.public_a.id
}
```

The Elastic IP is the public source address that outside IPv4 services will see. The NAT gateway's `subnet_id` should point to a public subnet with a route to the internet gateway. The private route uses `nat_gateway_id`, which means private app subnet traffic can start outbound IPv4 connections through NAT.

NAT gateways cost money for running time and data processing, so each one needs a clear job. AWS service traffic often fits VPC endpoints. Public third-party traffic usually remains NAT traffic unless the provider supports a private connection such as PrivateLink. A good egress review separates those two groups instead of sending everything through NAT by habit.

## Endpoint Routes for AWS Services
<!-- section-summary: Gateway endpoints add service prefix-list routes, while interface endpoints place private ENIs for supported AWS service APIs. -->

The private API needs AWS services as well as public destinations. It may upload receipt files to S3, read secrets from Secrets Manager, send logs to CloudWatch Logs, pull container images from ECR, and call STS. Many of these calls can stay on private AWS paths through **VPC endpoints**.

An S3 gateway endpoint adds routes to selected route tables. The destination is an AWS-managed prefix list for the regional S3 service, and the target is the endpoint. The app code still calls normal S3 APIs, but the route table sends matching S3 traffic through the endpoint path.

```hcl
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.receipts.id
  service_name      = "com.amazonaws.us-east-1.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private_a.id, aws_route_table.private_b.id]

  tags = {
    Name = "receipts-s3-endpoint"
  }
}
```

The `service_name` includes the Region and service name. `vpc_endpoint_type = "Gateway"` selects the gateway endpoint pattern used by services such as S3 and DynamoDB. `route_table_ids` chooses which subnets receive the endpoint route, so the private app route tables can send S3 traffic privately while other route tables remain unchanged.

Interface endpoints work differently. They create private ENIs in subnets for service APIs such as Secrets Manager, CloudWatch Logs, ECR API, and STS. Those endpoints use security groups, private DNS, and endpoint policies, so the review includes both routing and packet rules.

![The private egress view compares NAT and endpoint paths so private workloads can reach updates, APIs, and AWS services deliberately](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-route-tables-igw-nat/private-egress-paths.png)

*The private egress view compares NAT and endpoint paths so private workloads can reach updates, APIs, and AWS services deliberately.*


## Most Specific Route Wins
<!-- section-summary: AWS chooses the most specific matching destination route, which lets broad defaults and narrow private service paths work together. -->

When more than one route matches a destination, AWS uses the most specific matching route. A narrow service prefix-list route can beat `0.0.0.0/0`, so S3 traffic can use a gateway endpoint while other public IPv4 traffic uses NAT. This is how a private app route table can have both an endpoint route and a NAT default route.

The same rule matters in connected networks. If a route table has `10.0.0.0/8 -> tgw-...` and `10.40.20.0/24 -> pcx-...`, traffic to `10.40.20.15` follows the `/24` route. A stale specific route can break traffic even while a broader route looks correct.

| Destination IP or service | Matching routes | Chosen target |
| --- | --- | --- |
| `10.40.20.15` | `10.40.0.0/16 -> local` and `0.0.0.0/0 -> nat-...` | `local`, because the VPC CIDR is more specific. |
| S3 regional address | S3 prefix list route and `0.0.0.0/0 -> nat-...` | S3 gateway endpoint, because the service route is more specific. |
| `203.0.113.50` | `0.0.0.0/0 -> nat-...` | NAT gateway, because only the default route matches. |

During debugging, a reviewer writes down the destination address before changing routes. A timeout from the API to the database, a timeout from the API to S3, and a timeout from the API to a payment provider can all start in the same subnet and still choose different targets.

## Diagnostic Walkthrough With AWS CLI
<!-- section-summary: Route debugging starts with the source ENI, subnet association, matching route, and target state. -->

A route investigation starts from the source network interface. The command below asks AWS for the ENI attached to an API task and reshapes the output to the fields needed for routing:

```bash
aws ec2 describe-network-interfaces \
  --network-interface-ids eni-0api1234567890ab \
  --query 'NetworkInterfaces[*].{eni:NetworkInterfaceId,subnet:SubnetId,privateIp:PrivateIpAddress,groups:Groups[*].GroupId}'
```

The `--network-interface-ids` flag selects the specific ENI. The `--query` expression keeps the ENI ID, source subnet, private IP, and security groups so the route and filter checks can start from the same object.

```json
[
  {
    "eni": "eni-0api1234567890ab",
    "subnet": "subnet-0privatea",
    "privateIp": "10.40.10.48",
    "groups": [
      "sg-0receiptsapi"
    ]
  }
]
```

Now the route table associated with that source subnet can be inspected:

```bash
aws ec2 describe-route-tables \
  --filters Name=association.subnet-id,Values=subnet-0privatea \
  --query 'RouteTables[*].{table:RouteTableId,subnets:Associations[?SubnetId!=`null`].SubnetId,routes:Routes[*].{destination:DestinationCidrBlock || DestinationIpv6CidrBlock || DestinationPrefixListId,target:GatewayId || NatGatewayId || VpcEndpointId || TransitGatewayId || VpcPeeringConnectionId,state:State}}'
```

The `--filters` flag selects the table associated with the private subnet. The `--query` expression shows each destination, the target chosen by that route, and the route state.

```json
[
  {
    "table": "rtb-0privatea",
    "subnets": [
      "subnet-0privatea"
    ],
    "routes": [
      {
        "destination": "10.40.0.0/16",
        "target": "local",
        "state": "active"
      },
      {
        "destination": "pl-63a5400a",
        "target": "vpce-0s3gateway",
        "state": "active"
      },
      {
        "destination": "0.0.0.0/0",
        "target": "nat-0publica",
        "state": "active"
      }
    ]
  }
]
```

This output says three useful things. Database traffic inside `10.40.0.0/16` uses the local route. S3 traffic uses the endpoint route. Other IPv4 destinations use the NAT gateway, so a payment provider timeout should lead to NAT state and partner allowlist checks.

For the public entry path, the internet gateway should be attached to the VPC:

```bash
aws ec2 describe-internet-gateways \
  --filters Name=attachment.vpc-id,Values=vpc-0receipts \
  --query 'InternetGateways[*].{id:InternetGatewayId,attachments:Attachments[*].{vpc:VpcId,state:State}}'
```

```json
[
  {
    "id": "igw-0receipts",
    "attachments": [
      {
        "vpc": "vpc-0receipts",
        "state": "available"
      }
    ]
  }
]
```

The NAT gateway evidence for private outbound IPv4 needs `available` state and public-subnet placement:

```bash
aws ec2 describe-nat-gateways \
  --filter Name=vpc-id,Values=vpc-0receipts \
  --query 'NatGateways[*].{id:NatGatewayId,state:State,subnet:SubnetId,publicIp:NatGatewayAddresses[0].PublicIp}'
```

```json
[
  {
    "id": "nat-0publica",
    "state": "available",
    "subnet": "subnet-0publica",
    "publicIp": "198.51.100.24"
  },
  {
    "id": "nat-0publicb",
    "state": "available",
    "subnet": "subnet-0publicb",
    "publicIp": "198.51.100.87"
  }
]
```

The NAT output gives the state, placement subnet, and public source IP. If a payment provider allowlist contains the old NAT IP, the route table can look perfect while the provider still drops the connection. Route debugging should include both AWS targets and the destination system's rules.

Flow Logs can then confirm whether packets reached the VPC packet layer and whether AWS accepted or rejected them. A route table shows intended next hops. Flow Logs show observed packet metadata, which helps separate route issues from security group, NACL, listener, or external dependency issues.

![The route debug checklist shows how subnet association, route target, NAT health, endpoint policy, and DNS evidence fit together](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-route-tables-igw-nat/route-debug-checklist.png)

*The route debug checklist shows how subnet association, route target, NAT health, endpoint policy, and DNS evidence fit together.*


## References

- [Amazon VPC documentation: Route tables](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html)
- [Amazon VPC documentation: Route priority](https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html)
- [Amazon VPC documentation: Internet gateways](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html)
- [Amazon VPC documentation: NAT gateways](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html)
- [Amazon VPC documentation: Gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html)
