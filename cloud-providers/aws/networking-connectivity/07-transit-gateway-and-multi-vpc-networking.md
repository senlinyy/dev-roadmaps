---
title: "Transit Gateway and Multi-VPC Networking"
description: "Connect many AWS VPCs and accounts with VPC peering, AWS Transit Gateway, shared services, segmentation, inspection paths, and operational guardrails."
overview: "Multi-VPC networking is the work of connecting separate application, shared services, analytics, security, and on-premises networks without turning every private network into one flat space. This article explains when VPC peering is enough, why Transit Gateway is used as a regional router, and how attachments, route tables, association, propagation, return routes, inspection VPCs, and cross-account sharing fit together."
tags: ["aws", "vpc", "transit-gateway", "vpc-peering", "multi-vpc-networking"]
order: 7
id: article-cloud-providers-aws-networking-connectivity-connectivity-hybrid-networking
aliases:
  - connectivity-and-hybrid-networking
  - dns-domains-and-tls-entry-points
  - turn-a-domain-into-a-secure-aws-entry-point
  - load-balancers-and-target-health
  - make-the-front-door-trust-healthy-targets
  - article-cloud-providers-aws-networking-connectivity-dns-domains-tls-entry-points
  - article-cloud-providers-aws-networking-connectivity-load-balancers-target-health
  - cloud-providers/aws/networking-connectivity/dns-domains-and-tls-entry-points.md
  - cloud-providers/aws/networking-connectivity/load-balancers-and-target-health.md
  - vpc-connectivity
  - transit-gateway-and-multi-vpc-networking
  - cloud-providers/aws/networking-connectivity/connectivity-and-hybrid-networking.md
  - cloud-providers/aws/networking-connectivity/03-connectivity-and-hybrid-networking.md
---
## Table of Contents

1. [The Multi-VPC Scenario](#the-multi-vpc-scenario)
2. [When VPC Peering Fits](#when-vpc-peering-fits)
3. [Why Transit Gateway Works as the Hub](#why-transit-gateway-works-as-the-hub)
4. [Attachments and VPC Route Tables](#attachments-and-vpc-route-tables)
5. [Transit Gateway Route Tables](#transit-gateway-route-tables)
6. [Routing Blast Radius and Segmentation](#routing-blast-radius-and-segmentation)
7. [Ownership Across Accounts](#ownership-across-accounts)
8. [Troubleshooting Multi-VPC Paths](#troubleshooting-multi-vpc-paths)
9. [References](#references)

## The Multi-VPC Scenario
<!-- section-summary: Multi-VPC networking starts with separate networks for separate responsibilities, then adds only the private paths the business needs. -->

The receipts company has grown past one VPC. The production app VPC runs the receipts API and worker services in account `app-prod`. The shared services VPC runs deployment runners, an internal package mirror, and the inventory API in account `platform-shared`. The analytics VPC receives events and report exports in account `data-prod`. The security VPC runs inspection appliances and central network tooling in account `security-prod`. An on-premises support network still hosts a few admin tools connected through VPN or Direct Connect.

This split is healthy. Application teams can own application subnets. Platform teams can own shared services. Data teams can handle analytics without sitting inside the production app VPC. Security teams can operate inspection tooling in a dedicated account. The hard part is the private connectivity between these networks.

The business needs named flows instead of one flat private network. The receipts API needs `inventory.shared.internal` on TCP `443`. Deployment runners need access to app deployment endpoints. Analytics needs event ingestion while database subnet routes stay outside its table. On-premises support tools need a limited admin endpoint with narrow routes.

Advanced multi-VPC design starts by listing those flows. For each flow, write the source VPC, destination VPC, CIDR or service name, port, DNS owner, route owner, security group owner, and return path. That list keeps the architecture grounded while the route tables get more complex.

## When VPC Peering Fits
<!-- section-summary: VPC peering fits a small direct relationship between two non-overlapping VPCs when both sides can own routes and packet controls clearly. -->

**VPC peering** is a direct private connection between two VPCs. It works well for one clear relationship with non-overlapping CIDR ranges and owners who can coordinate both sides. The route tables, security groups, NACLs, and DNS records still decide whether application traffic succeeds.

For a small version of the receipts environment, the app VPC `10.20.0.0/16` might need the inventory API in the shared services VPC `10.40.0.0/16`. The app private route table sends `10.40.0.0/16` to the peering connection. The shared services route table sends `10.20.0.0/16` back to the peering connection. The inventory security group allows TCP `443` from the application security group or app CIDR.

That design stays readable when the relationship has two VPCs and one owner conversation. The review table is short:

| Item | Receipts app example |
| --- | --- |
| Source VPC CIDR | `10.20.0.0/16` |
| Destination VPC CIDR | `10.40.0.0/16` |
| Source route | App private subnets route `10.40.0.0/16` to the peering connection |
| Return route | Shared services subnets route `10.20.0.0/16` to the peering connection |
| Packet rule | Inventory security group allows TCP `443` from the app workload |
| DNS decision | `inventory.shared.internal` resolves to the private inventory address |

Peering has a major boundary: transitive routing is absent. If VPC A peers with VPC B, and VPC B peers with VPC C, VPC A has no automatic path to VPC C through VPC B. This boundary keeps peering relationships explicit, but it creates a lot of one-off route work as VPC count grows.

The point where peering starts to strain is usually ownership. Ten VPCs can create many separate route updates, DNS decisions, security group requests, and return path checks. The network team may have no central place to answer "which networks can reach production?" That is the point where a hub starts to help.

![The peering view shows the simple two-VPC case where direct routing can work without a central hub](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-connectivity-hybrid-networking/one-peering-relationship.png)

*The peering view shows the simple two-VPC case where direct routing can work without a central hub.*


## Why Transit Gateway Works as the Hub
<!-- section-summary: Transit Gateway gives many VPCs and hybrid links one regional routing hub with central route tables and segmentation controls. -->

**AWS Transit Gateway** is a regional network transit hub. VPCs, VPNs, Direct Connect gateways, and other supported attachments connect to it. Transit Gateway route tables decide which attachment can reach which destination CIDR through the hub.

For the receipts company, Transit Gateway can connect the app VPC, shared services VPC, analytics VPC, security VPC, and on-premises connection. The goal is central routing policy with narrow route tables for approved flows. Each attachment should receive only the routes it needs.

The hub gives the network team a place to review route blast radius. **Routing blast radius** means the set of networks that gain reachability when a route is added, propagated, or associated. A route to `10.40.0.0/16` in the app route table might only let the app VPC reach shared services. The same propagated route in a shared route table used by analytics and on-premises attachments could grant many more networks a path to shared services.

Transit Gateway design therefore needs two maps. One map shows the physical or logical attachments: app, shared services, analytics, security, and hybrid. The second map shows route table policy: which attachment uses which Transit Gateway route table, which prefixes enter each table, and which owners approve changes.

![The hub view shows how Transit Gateway reduces many separate peering relationships into shared attachments and route tables](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-connectivity-hybrid-networking/transit-gateway-hub.png)

*The hub view shows how Transit Gateway reduces many separate peering relationships into shared attachments and route tables.*


## Attachments and VPC Route Tables
<!-- section-summary: A Transit Gateway attachment connects a VPC to the hub, while VPC subnet route tables still decide which workload traffic enters the hub. -->

A **Transit Gateway VPC attachment** connects one VPC to the Transit Gateway. You select subnets in the VPC, usually one per Availability Zone, where AWS creates attachment ENIs. Many teams use dedicated small attachment subnets so the TGW connection point has clear routing and NACL behavior.

The attachment alone leaves application subnet routing unchanged. Application subnet route tables still need explicit routes. For example, the app private subnet route table needs a route for `10.40.0.0/16` to the Transit Gateway before the receipts API can reach shared services.

A Terraform attachment sketch looks like this:

```hcl
resource "aws_ec2_transit_gateway_vpc_attachment" "app" {
  transit_gateway_id = aws_ec2_transit_gateway.core.id
  vpc_id             = aws_vpc.app.id
  subnet_ids         = [
    aws_subnet.app_tgw_a.id,
    aws_subnet.app_tgw_b.id
  ]
}
```

This resource attaches the app VPC to the central Transit Gateway. `subnet_ids` selects the VPC subnets where TGW attachment ENIs live. These subnets should exist in the Availability Zones that the design supports, and they should have route and NACL behavior that matches the expected network path.

The workload route is a separate change:

```hcl
resource "aws_route" "app_to_shared_services" {
  route_table_id         = aws_route_table.app_private.id
  destination_cidr_block = "10.40.0.0/16"
  transit_gateway_id     = aws_ec2_transit_gateway.core.id
}
```

This route tells app private subnets to send shared services traffic to the Transit Gateway. The shared services VPC still needs a return route to `10.20.0.0/16`. If the request reaches the inventory API and the response has no route back to the app VPC, the application still sees a timeout.

An attachment inspection command can show the current AWS state:

```bash
aws ec2 describe-transit-gateway-vpc-attachments \
  --filters Name=transit-gateway-id,Values=tgw-0123456789abcdef0 \
  --region eu-west-2 \
  --query 'TransitGatewayVpcAttachments[].{Id:TransitGatewayAttachmentId,Vpc:VpcId,State:State,Subnets:SubnetIds}'
```

```json
[
  {
    "Id": "tgw-attach-0app1111111111111",
    "Vpc": "vpc-0appreceipts",
    "State": "available",
    "Subnets": [
      "subnet-0apptgwa",
      "subnet-0apptgwb"
    ]
  },
  {
    "Id": "tgw-attach-0shared2222222222",
    "Vpc": "vpc-0sharedservices",
    "State": "available",
    "Subnets": [
      "subnet-0sharedtgwa",
      "subnet-0sharedtgwb"
    ]
  }
]
```

This output proves the VPC attachments exist and AWS considers them available. The next checks still need to prove the app subnet route table points to the TGW and the TGW route table sends traffic to the destination attachment.

## Transit Gateway Route Tables
<!-- section-summary: Transit Gateway route tables decide which attached networks can reach which destination CIDRs through the hub. -->

Transit Gateway has its own route tables, separate from VPC subnet route tables. A packet needs both layers. The source VPC route table sends traffic to the Transit Gateway. The Transit Gateway route table associated with the source attachment sends traffic to the destination attachment.

Two words matter here: **association** and **propagation**. Association decides which Transit Gateway route table an attachment uses when it sends traffic into the hub. Propagation lets an attachment advertise its CIDRs into one or more Transit Gateway route tables.

For the receipts scenario, the app attachment can associate with `tgw-rtb-app`. The shared services attachment can propagate `10.40.0.0/16` into `tgw-rtb-app`, or the network team can add a static route for that CIDR. The analytics attachment can associate with `tgw-rtb-analytics`, which receives only event ingestion and logging destinations.

The Terraform for association and propagation can look like this:

```hcl
resource "aws_ec2_transit_gateway_route_table_association" "app" {
  transit_gateway_attachment_id  = aws_ec2_transit_gateway_vpc_attachment.app.id
  transit_gateway_route_table_id = aws_ec2_transit_gateway_route_table.app.id
}

resource "aws_ec2_transit_gateway_route_table_propagation" "shared_into_app" {
  transit_gateway_attachment_id  = aws_ec2_transit_gateway_vpc_attachment.shared_services.id
  transit_gateway_route_table_id = aws_ec2_transit_gateway_route_table.app.id
}
```

The association block says app traffic entering the hub uses the app TGW route table. The propagation block says the shared services attachment can advertise its routes into that same table. This propagation helps the app flow only when the app attachment is associated with this TGW route table.

Some teams prefer static TGW routes for stricter review:

```hcl
resource "aws_ec2_transit_gateway_route" "app_to_shared_services" {
  destination_cidr_block         = "10.40.0.0/16"
  transit_gateway_attachment_id  = aws_ec2_transit_gateway_vpc_attachment.shared_services.id
  transit_gateway_route_table_id = aws_ec2_transit_gateway_route_table.app.id
}
```

This static route sends `10.40.0.0/16` traffic from the app route table to the shared services attachment. Static routes make every destination explicit. Propagation can reduce manual route entries, but it needs guardrails because a newly attached or newly expanded VPC can advertise more prefixes than reviewers expected.

A route search command checks the TGW route table that the source attachment actually uses:

```bash
aws ec2 search-transit-gateway-routes \
  --transit-gateway-route-table-id tgw-rtb-0app \
  --filters Name=route-search.exact-match,Values=10.40.0.0/16 \
  --region eu-west-2
```

```json
{
  "Routes": [
    {
      "DestinationCidrBlock": "10.40.0.0/16",
      "Type": "static",
      "State": "active",
      "TransitGatewayAttachments": [
        {
          "TransitGatewayAttachmentId": "tgw-attach-0shared2222222222",
          "ResourceType": "vpc",
          "ResourceId": "vpc-0sharedservices"
        }
      ]
    }
  ],
  "AdditionalRoutesAvailable": false
}
```

This output says the app TGW route table has an active route to shared services through the shared services attachment. If this output is empty, the next action is adding or fixing propagation or a static TGW route in `tgw-rtb-0app`. If the route points to the security attachment instead, the next action is validating the inspection path and return route through the security VPC.

## Routing Blast Radius and Segmentation
<!-- section-summary: Segmentation keeps app, analytics, shared services, security, and hybrid networks from receiving broader routes than each flow needs. -->

Transit Gateway makes it easy to connect many networks, so the route table design must keep blast radius small. Every propagated prefix and every broad static route changes who can attempt to reach a network. Security groups still matter, and routing should give each attachment only the private CIDRs required for its approved flows.

The receipts environment can use route tables by intent:

| Attachment | Associated TGW route table | Allowed destinations |
| --- | --- | --- |
| App VPC | `tgw-rtb-app` | Shared services API, inspection path, selected on-premises admin systems |
| Shared services VPC | `tgw-rtb-shared` | App return routes, deployment targets, central logging |
| Analytics VPC | `tgw-rtb-analytics` | Event ingestion and reporting exports |
| Security VPC | `tgw-rtb-security` | Inspection targets and return paths |
| VPN or Direct Connect | `tgw-rtb-hybrid` | Approved admin endpoints and shared services |

That table separates "attached to the hub" from "allowed to reach every other attachment." A new analytics attachment should receive event and reporting routes while production database subnet routes stay out of its table. A new on-premises route needs an owner to approve each app, analytics, and shared services reachability change.

Inspection routing adds another layer. Suppose app-to-shared-services traffic must pass through a firewall in the security VPC. The app TGW route table can send `10.40.0.0/16` to the security attachment. The security TGW route table can send inspected traffic onward to shared services. The shared services return route must send `10.20.0.0/16` back through the security attachment. Stateful firewalls need to see both directions of a conversation.

| Flow stage | TGW route table decision | VPC route decision |
| --- | --- | --- |
| App to security | `tgw-rtb-app` sends `10.40.0.0/16` to the security attachment | App private route table sends `10.40.0.0/16` to TGW |
| Security to shared services | `tgw-rtb-security` sends `10.40.0.0/16` to the shared services attachment | Firewall subnet routes traffic through the appliance path |
| Shared services return | `tgw-rtb-shared` sends `10.20.0.0/16` to the security attachment | Shared services subnet sends `10.20.0.0/16` to TGW |
| Security return to app | `tgw-rtb-security` sends `10.20.0.0/16` to the app attachment | Firewall return path sends traffic back through the expected interface |

This is where ownership matters as much as route syntax. The network team owns TGW route tables and propagation. The application team owns app subnet route tables and app security groups. The shared services team owns the inventory listener and return routes. The security team owns firewall policy and inspection appliance health. A production change should name all owners before the route goes live.

![The inspected path shows how segmentation, shared services, inspection VPCs, and hybrid links change the packet route](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-connectivity-hybrid-networking/inspected-hybrid-path.png)

*The inspected path shows how segmentation, shared services, inspection VPCs, and hybrid links change the packet route.*


## Ownership Across Accounts
<!-- section-summary: AWS RAM lets a central network account share Transit Gateway access while application accounts keep ownership of their VPC attachments and subnet routes. -->

Large AWS environments usually put VPCs in separate accounts. A central networking account owns the Transit Gateway. Application accounts own their VPCs, subnets, route tables, and security groups. Security accounts own inspection VPCs and appliances. Data accounts own analytics networks.

**AWS Resource Access Manager**, or AWS RAM, lets the network account share the Transit Gateway with other accounts or with an AWS Organization. An application account can then create a VPC attachment to the shared Transit Gateway. The network account controls TGW route table association, propagation, and central guardrails.

This split needs a clear request pattern. Each attachment request should include account ID, VPC ID, CIDR, Region, attachment subnets, required destinations, ports, DNS names, return path owner, logging expectations, and the person who approves route blast radius. Without that detail, a route change can quietly grant broader reachability than the original application request needed.

A cross-account workflow can look like this:

1. The app team requests a flow from `app-prod` VPC `10.20.0.0/16` to `inventory.shared.internal` on TCP `443`.
2. The network team confirms the Transit Gateway share through AWS RAM and validates CIDR overlap.
3. The app account creates the VPC attachment using approved attachment subnets.
4. The network account associates the attachment with `tgw-rtb-app` and adds only the shared services route needed for the flow.
5. The app account updates the app private subnet route table.
6. The shared services account confirms return routes and inventory security group rules.
7. Both teams verify DNS, route tables, Flow Logs, and application health for the named flow.

The RAM share and attachment state can be inspected from the application side:

```bash
aws ram get-resource-shares \
  --resource-owner OTHER-ACCOUNTS \
  --region eu-west-2 \
  --query 'resourceShares[*].{Name:name,Status:status,OwningAccount:owningAccountId}'
```

```json
[
  {
    "Name": "central-networking-tgw",
    "Status": "ACTIVE",
    "OwningAccount": "111122223333"
  }
]
```

`ACTIVE` means the share exists from this account's view. The attachment still needs its own create step. The next check is the attachment state, followed by route table association and propagation in the network account.

## Troubleshooting Multi-VPC Paths
<!-- section-summary: TGW troubleshooting checks the source VPC route, source attachment association, TGW route, destination VPC return route, and packet controls in order. -->

A Transit Gateway timeout needs a path check in order. Start with the resolved destination IP. Then check the source subnet route table. After that, check the source attachment's TGW route table association, the route inside that TGW route table, the destination VPC route back to the source, and packet controls on both sides.

A source route table check can look like this:

```bash
aws ec2 describe-route-tables \
  --filters Name=association.subnet-id,Values=subnet-0appprivate \
  --region eu-west-2 \
  --query 'RouteTables[0].Routes[*].{Destination:DestinationCidrBlock,Target:TransitGatewayId,State:State}'
```

```json
[
  {
    "Destination": "10.40.0.0/16",
    "Target": "tgw-0123456789abcdef0",
    "State": "active"
  },
  {
    "Destination": "0.0.0.0/0",
    "Target": null,
    "State": "active"
  }
]
```

The first row says traffic from this app subnet to shared services enters the Transit Gateway. If that row is missing, the next action belongs to the app VPC route table owner. If that row exists, continue to the source attachment association and the TGW route table used by that attachment.

Attachment association output can look like this:

```bash
aws ec2 describe-transit-gateway-attachments \
  --filters Name=transit-gateway-id,Values=tgw-0123456789abcdef0 \
  --region eu-west-2 \
  --query 'TransitGatewayAttachments[].{Id:TransitGatewayAttachmentId,State:State,ResourceType:ResourceType,ResourceId:ResourceId,Association:Association}'
```

```json
[
  {
    "Id": "tgw-attach-0app1111111111111",
    "State": "available",
    "ResourceType": "vpc",
    "ResourceId": "vpc-0appreceipts",
    "Association": {
      "TransitGatewayRouteTableId": "tgw-rtb-0app",
      "State": "associated"
    }
  }
]
```

This output tells you which TGW route table to inspect. Many incidents last too long because the team searches a TGW route table that has the right route while the source attachment is associated with a different table. The association field tells you the table that matters for traffic entering from the app VPC.

For hybrid paths, add the customer network route. A perfect AWS route table still leaves a return-route gap when the corporate router lacks `10.20.0.0/16` or filters that prefix. If BGP carries the route, inspect advertised prefixes and route filters. If static routing carries the route, inspect the exact CIDR and next hop on both sides.

A concise TGW runbook can stay tied to one flow:

1. Resolve the destination name from the source workload and write down the destination IP.
2. Check the source subnet route table for the destination CIDR.
3. Check the source TGW attachment association.
4. Search that associated TGW route table for the destination CIDR.
5. Check the destination VPC subnet route table for the source return CIDR.
6. Check security groups, NACLs, DNS, and inspection firewall state.
7. Use VPC Flow Logs or Reachability Analyzer to compare packet evidence with the configuration review.

When the issue is intermittent, check attachment state changes, route propagation timing, appliance health in inspection VPCs, BGP route advertisements, and recent Terraform or console changes. Multi-VPC failures often show up to the app as a plain timeout, so the on-call note should name the exact hop that failed and the owner who fixed it.

![The routing checklist gives a multi-VPC investigation order across VPC route tables, Transit Gateway routes, security controls, DNS, and logs](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-connectivity-hybrid-networking/multi-vpc-routing-checklist.png)

*The routing checklist gives a multi-VPC investigation order across VPC route tables, Transit Gateway routes, security controls, DNS, and logs.*


## References

- [AWS Transit Gateway documentation: What is AWS Transit Gateway?](https://docs.aws.amazon.com/vpc/latest/tgw/what-is-transit-gateway.html)
- [AWS Transit Gateway documentation: Transit Gateway route tables](https://docs.aws.amazon.com/vpc/latest/tgw/tgw-route-tables.html)
- [Amazon VPC documentation: VPC peering](https://docs.aws.amazon.com/vpc/latest/peering/what-is-vpc-peering.html)
- [AWS Resource Access Manager documentation](https://docs.aws.amazon.com/ram/latest/userguide/what-is.html)
- [Share your transit gateway with other accounts using AWS RAM](https://docs.aws.amazon.com/vpc/latest/tgw/tgw-transit-gateways.html#transit-gateway-sharing)
