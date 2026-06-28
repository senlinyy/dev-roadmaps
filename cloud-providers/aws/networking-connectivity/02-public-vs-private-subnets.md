---
title: "Public vs Private Subnets"
description: "Understand how AWS public, private app, and data subnets behave through route tables, public addresses, load balancers, NAT, endpoints, and placement checks."
overview: "Public and private subnet labels come from routing behavior and resource placement. This article follows the receipts app as the public load balancer, private API tier, database tier, NAT path, and AWS service endpoints land in the right subnet tiers."
tags: ["aws", "vpc", "subnets", "route-tables", "internet-gateway", "nat-gateway", "alb"]
order: 2
id: article-cloud-providers-aws-networking-connectivity-public-private-subnets
aliases:
  - public-vs-private-subnets
  - public-private-subnets
---
## Table of Contents

1. [The App Splits Into Places](#the-app-splits-into-places)
2. [What Public Means](#what-public-means)
3. [Public Addresses Are a Separate Choice](#public-addresses-are-a-separate-choice)
4. [The Public Entry Tier](#the-public-entry-tier)
5. [The Private App Tier](#the-private-app-tier)
6. [The Data Tier](#the-data-tier)
7. [Outbound Paths From Private Code](#outbound-paths-from-private-code)
8. [A Guided Layout](#a-guided-layout)
9. [References](#references)

## The App Splits Into Places
<!-- section-summary: Public, private app, and data subnets separate the customer entry point from application code and database resources. -->

The receipts app now has a VPC, and the team needs to decide where each part should live. Customers should reach the app over HTTPS. The API should run on private addresses. The database should receive traffic only from the API and should have the quietest network placement.

That gives us three subnet tiers. A **public subnet** holds resources that need a direct internet path, such as an internet-facing load balancer. A **private app subnet** holds workload code that receives traffic from trusted paths and starts controlled outbound calls. A **data subnet** holds databases and other stateful services that should avoid broad internet routes.

The labels help only when the route tables and resource settings match them. Naming a subnet `private-a` expresses intent for humans. The subnet behavior comes from its route table, the addresses assigned to resources, and the security rules around those resources.

The app story keeps the design grounded. Public subnets serve customer entry. Private app subnets serve API tasks and workers. Data subnets serve RDS or cache resources. Each tier exists because one part of the app needs a different kind of reachability.

## What Public Means
<!-- section-summary: A subnet is public when its route table has a direct internet gateway route, while private and data subnets use NAT, endpoints, private routes, or only the local route. -->

A subnet acts public when its associated route table has a default route to an **internet gateway**. For IPv4, that route usually looks like `0.0.0.0/0 -> igw-...`. For IPv6, it may look like `::/0 -> igw-...`. This route gives resources in that subnet a possible direct path to and from the internet.

A private app subnet has a different route story. It keeps the local VPC route so the API can reach the database and other private resources. It may also route `0.0.0.0/0` to a NAT gateway for outbound IPv4 calls, and it may use VPC endpoint routes for AWS services such as S3.

A data subnet usually keeps the route table small. It has the local VPC route, and it may have private routes for backups, monitoring, or private network connections if the design requires them. Broad internet egress needs a named requirement, because databases rarely need that path for normal managed-service operation.

| Subnet tier | Typical route pattern | Typical resources | Review question |
| --- | --- | --- | --- |
| Public | Default route to internet gateway | Internet-facing ALB, NAT gateway | Which resources are supposed to face the internet? |
| Private app | Local route, endpoint routes, optional NAT route | API tasks, workers, internal services | Which outbound dependencies does the app actually need? |
| Data | Local and narrow private routes | RDS, cache, data services | Which app security group can connect to the data port? |

This is why route tables matter more than names. The next article goes deep on route tables, internet gateways, and NAT. Here, the goal is to place the app pieces into tiers that match the access they need.

![The subnet type view shows how public, private app, and data subnets differ mainly by route path and public address exposure](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-public-private-subnets/subnet-type-routes.png)

*The subnet type view shows how public, private app, and data subnets differ mainly by route path and public address exposure.*


## Public Addresses Are a Separate Choice
<!-- section-summary: A public subnet gives a route path, while public IPv4 or IPv6 addressing decides whether a specific resource can use that path directly. -->

The public route is only part of internet reachability. A resource also needs an address that internet clients can route to, and traffic rules must allow the packets. For IPv4, that usually means a public IPv4 address or Elastic IP on the resource or on a service such as a load balancer or NAT gateway.

This distinction prevents a lot of beginner confusion. An EC2 instance in a public subnet needs a public IPv4 address before direct IPv4 internet traffic can reach it. An instance with a public IPv4 address in a private subnet still follows the private subnet route table, so the route table remains part of the path.

For the receipts app, the public address belongs at the edge. The internet-facing Application Load Balancer has public-facing DNS and public subnet placement. The API tasks and database use private addresses, and customers reach the API through the load balancer rather than by connecting to task addresses directly.

IPv6 needs the same care. IPv6 addresses are globally routable, so route tables and security rules carry a lot of responsibility. A dual-stack design should review IPv4 and IPv6 paths separately instead of assuming the IPv4 subnet label explains both.

## The Public Entry Tier
<!-- section-summary: The internet-facing load balancer belongs in public subnets across multiple Availability Zones and forwards to private targets. -->

The receipts app accepts customer HTTPS, so the Application Load Balancer belongs in public subnets in at least two Availability Zones. The load balancer receives traffic on port `443`, applies its listener and certificate configuration, and forwards requests to private API targets on the application port.

The API can stay private because the load balancer is the public entry point. The load balancer target group points to private IP targets, and the API security group allows traffic from the load balancer security group. That keeps the public surface small and gives the team one clear place for customer entry rules.

A small Terraform example shows the important placement fields:

```hcl
resource "aws_lb" "receipts" {
  name               = "receipts-prod"
  load_balancer_type = "application"
  internal           = false
  subnets            = [aws_subnet.public_a.id, aws_subnet.public_b.id]
  security_groups    = [aws_security_group.alb.id]
}
```

The `internal = false` field makes the load balancer internet-facing. The `subnets` field places load balancer nodes in public subnets across zones. The `security_groups` field attaches the rules that allow customer HTTPS into the load balancer and allow forwarding toward the private API tier.

## The Private App Tier
<!-- section-summary: Private app subnets run workload code on private addresses while allowing controlled inbound traffic from the load balancer and controlled outbound dependencies. -->

The API tasks run in private app subnets. They receive requests from the load balancer, call the database, read secrets, write logs, and maybe call a payment provider. Customers reach the API through the load balancer, so private task addresses are enough.

This tier still needs outbound planning. The API may pull container images from ECR, send logs to CloudWatch Logs, read database credentials from Secrets Manager, upload receipt files to S3, and call a public payment provider. Some of those dependencies are AWS services that can use VPC endpoints. Some are public internet destinations that may need NAT.

The private app tier is where quick fixes often create long-term risk. A startup script fails while reaching a dependency, and someone tries moving the task into a public subnet. A cleaner review names the missing dependency, then adds the right endpoint, NAT path, or private provider connection for that dependency.

Security groups describe the app conversation. The API allows inbound traffic from the load balancer security group on the app port, such as `8080`. The API allows outbound traffic to the database security group on `5432`, to endpoint security groups for AWS APIs, and to approved public destinations through NAT if the design keeps outbound rules narrow.

## The Data Tier
<!-- section-summary: Data subnets keep databases on private addresses and avoid broad default routes unless a specific data service needs a documented private or outbound path. -->

The database tier should have the quietest network placement. For Amazon RDS, the DB subnet group should include private data subnets in at least two Availability Zones. RDS then places database network interfaces in those subnets and gives the database a private endpoint name.

The database security group should allow only the API security group on the database port, such as PostgreSQL `5432` or MySQL `3306`. Subnet placement helps, but the security group relationship carries the precise workload permission. That relationship stays stable even when API tasks scale and receive new private IP addresses.

Data subnets usually avoid broad `0.0.0.0/0` routes. Managed database backups, patching, and service operations happen through the service control plane, so the database itself rarely needs public internet egress. If a database extension, replication path, or monitoring agent needs network access, that requirement should be named and reviewed as its own path.

This tier gives the app a clear failure checklist. If the customer reaches the load balancer and the API times out on the database, the team reviews the private app subnet, the data subnet, the local VPC route, the API security group, the database security group, DNS, and the database listener.

## Outbound Paths From Private Code
<!-- section-summary: Private app subnets use NAT for public IPv4 destinations and VPC endpoints for supported AWS services. -->

Private workloads often need outbound calls. The receipts API may need software updates, payment provider calls, logs, secrets, image pulls, and S3 uploads. The subnet should stay private while those dependencies still work.

For public IPv4 destinations, the common pattern is a **NAT gateway** in a public subnet. Private app subnet route tables send internet-bound IPv4 traffic to the NAT gateway, and the outside service sees the NAT gateway's Elastic IP. Production designs often use one NAT gateway per Availability Zone so each zone's private workloads use local egress.

For supported AWS services, a **VPC endpoint** is often cleaner. An S3 gateway endpoint adds private S3 routes to selected route tables. Interface endpoints create private network interfaces for service APIs such as Secrets Manager, CloudWatch Logs, STS, ECR API, and ECR Docker. Endpoints reduce NAT traffic and give the team endpoint policies and endpoint security groups to review.

IPv6 has its own pattern. Private IPv6-only outbound internet access can use an egress-only internet gateway. Dual-stack apps should test IPv4 and IPv6 separately because routes, DNS records, and security rules can differ between the two families.

## A Guided Layout
<!-- section-summary: A simple subnet layout gives each app tier a clear placement, route story, and review question. -->

A first layout for the receipts app can stay small and still be useful:

| Tier | Zone A | Zone B | Route story |
| --- | --- | --- | --- |
| Public | `receipts-public-a` | `receipts-public-b` | Local VPC route plus default route to internet gateway |
| Private app | `receipts-app-a` | `receipts-app-b` | Local VPC route plus endpoints and approved NAT egress |
| Data | `receipts-data-a` | `receipts-data-b` | Local VPC route and narrow private routes only |

The review follows the request path. Customer traffic reaches the public load balancer on `443`. The load balancer forwards to API tasks on private addresses. The API connects to the database on the data port. The API reaches AWS services through endpoints and reaches a public payment provider through NAT if that dependency is approved.

Before the next article, the important subnet idea is this: subnet names describe intent, and route tables prove behavior. A beginner design can be good while advanced enterprise features stay for later, as long as public entry, private app work, data placement, and outbound dependencies are separated deliberately.

![The guided layout shows a public load balancer sending traffic to private app tasks while the database remains in private data subnets](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-public-private-subnets/public-alb-private-api.png)

*The guided layout shows a public load balancer sending traffic to private app tasks while the database remains in private data subnets.*

![The placement checks summarize the questions a reviewer asks before approving subnet placement for a production workload](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-public-private-subnets/subnet-placement-checks.png)

*The placement checks summarize the questions a reviewer asks before approving subnet placement for a production workload.*



## References

- [Amazon VPC documentation: VPCs and subnets](https://docs.aws.amazon.com/vpc/latest/userguide/how-it-works.html#vpc-subnets)
- [Amazon VPC documentation: Route tables](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html)
- [Amazon VPC documentation: NAT gateways](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html)
- [Amazon VPC documentation: VPC endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints.html)
- [Elastic Load Balancing documentation: Availability Zones for your Application Load Balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html#availability-zones)
