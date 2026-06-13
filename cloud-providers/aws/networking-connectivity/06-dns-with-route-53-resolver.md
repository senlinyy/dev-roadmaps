---
title: "DNS with Route 53 Resolver"
description: "Use Route 53 Resolver, private hosted zones, inbound endpoints, outbound endpoints, and forwarding rules to control private DNS in AWS."
overview: "Private connectivity only works when names resolve to the right private addresses. This article explains VPC DNS, AmazonProvidedDNS, Route 53 Resolver, private hosted zones, split-horizon names, Resolver endpoints, forwarding rules, query logging, and practical troubleshooting for wrong DNS answers."
tags: ["aws", "route-53", "dns", "resolver", "hybrid-networking", "vpc"]
order: 6
id: article-cloud-providers-aws-networking-connectivity-dns-route-53-resolver
aliases:
  - dns-with-route-53-resolver
  - route-53-resolver
  - vpc-dns-resolver
---

## Table of Contents

1. [Why DNS Is Part of Private Networking](#why-dns-is-part-of-private-networking)
2. [The VPC DNS Resolver](#the-vpc-dns-resolver)
3. [VPC DNS Attributes and DHCP Options](#vpc-dns-attributes-and-dhcp-options)
4. [Private Hosted Zones](#private-hosted-zones)
5. [Split-Horizon Private Names](#split-horizon-private-names)
6. [PrivateLink and AWS Service Names](#privatelink-and-aws-service-names)
7. [Inbound Resolver Endpoints](#inbound-resolver-endpoints)
8. [Outbound Resolver Endpoints and Forwarding Rules](#outbound-resolver-endpoints-and-forwarding-rules)
9. [Cross-VPC and Multi-Account DNS Patterns](#cross-vpc-and-multi-account-dns-patterns)
10. [Resolver Query Logging](#resolver-query-logging)
11. [Troubleshooting Wrong DNS Answers](#troubleshooting-wrong-dns-answers)
12. [Putting It All Together](#putting-it-all-together)
13. [References](#references)

## Why DNS Is Part of Private Networking
<!-- section-summary: Private network paths depend on DNS because applications usually connect to names before route tables ever see packets. -->

The payments app from the endpoint article now has a good private service path. Private ECS tasks can write receipts to S3 through a gateway endpoint, call Secrets Manager and CloudWatch Logs through interface endpoints, pull images from ECR, and reach a partner fraud API through PrivateLink.

That sounds like a routing story, but the application rarely starts with a route. It starts with a name. The code asks for `secretsmanager.us-east-1.amazonaws.com`, `api.ecr.us-east-1.amazonaws.com`, `fraud.partner.internal`, or `db.corp.internal`. **DNS**, which stands for Domain Name System, turns those names into IP addresses. After DNS returns an answer, the route table and packet filters can do their work.

This is why DNS belongs in the AWS networking module. A private endpoint can be perfectly built, and the application can still use the wrong path if the name resolves to a public address or to an on-premises address outside the VPC route plan. A hybrid network can have a healthy VPN, while `corp.internal` still needs a forwarding rule that tells AWS where to send those DNS queries.

The practical question for this article is simple: when a workload asks for a name, which resolver answers, which zone or rule controls the answer, and which private network path can reach the returned IP address?

![DNS answer shapes packet path infographic showing an app resolving a service name through Route 53 Resolver to either a private endpoint IP or a public service edge](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-dns-route-53-resolver/dns-answer-packet-path.png)

*A private network path starts with a name answer. If DNS returns a private endpoint IP, packets follow the private endpoint path; if DNS returns a public answer, the route-table investigation follows a different direction.*

## The VPC DNS Resolver
<!-- section-summary: Route 53 Resolver is the default DNS service inside a VPC and answers VPC, private hosted zone, and public recursive DNS queries. -->

Every VPC gets access to a default AWS DNS service. AWS documentation calls it the **Route 53 Resolver**, the **VPC Resolver**, the **Amazon DNS server**, and **AmazonProvidedDNS** in different contexts. For beginners, these names refer to the same built-in resolver path that resources in a VPC commonly use for DNS.

The resolver is reachable at the VPC base address plus two. If the payments VPC uses `10.40.0.0/16`, the resolver is reachable at `10.40.0.2`. AWS also exposes it at `169.254.169.253` for IPv4 and `fd00:ec2::253` for IPv6. Instances and many managed compute runtimes learn the DNS server through the VPC DHCP configuration.

The default VPC resolver can answer several kinds of names:

| Name type | Example | Where the answer comes from |
| --- | --- | --- |
| **EC2 private names** | `ip-10-40-20-15.ec2.internal` | VPC-provided DNS records. |
| **Private hosted zone records** | `api.payments.internal` | Route 53 private hosted zone associated with the VPC. |
| **AWS service private DNS names** | `secretsmanager.us-east-1.amazonaws.com` | Interface endpoint private DNS when enabled. |
| **Public internet names** | `example.com` | Recursive lookup through public DNS. |

The resolver gives the VPC one local place to ask DNS questions. You treat it as an AWS-managed resolver service built into the VPC networking environment. AWS handles the host placement, patching, and scaling underneath that service.

For the payments app, this means a container can ask the VPC resolver for both AWS service names and internal application names. The answer might come from an interface endpoint's private DNS configuration, a private hosted zone, or a forwarding rule that sends the question to corporate DNS.

## VPC DNS Attributes and DHCP Options
<!-- section-summary: VPC DNS attributes and DHCP options decide whether workloads use the AWS resolver and whether private hosted zones and endpoint private DNS work as expected. -->

Two VPC attributes show up in almost every private DNS troubleshooting session: **DNS resolution** and **DNS hostnames**. In API and Terraform names, these are usually `enableDnsSupport` and `enableDnsHostnames`.

**DNS resolution**, or `enableDnsSupport`, controls whether DNS queries to the Amazon-provided DNS server succeed. **DNS hostnames**, or `enableDnsHostnames`, controls whether public DNS hostnames are assigned to instances with public IPv4 addresses, and it is also required with DNS resolution for private hosted zones and PrivateLink private DNS patterns.

For private hosted zones and interface endpoint private DNS, both attributes should be enabled. If either setting is wrong, records that look correct in Route 53 can fail from inside the VPC. The failure often appears as an unexpected public answer, an NXDOMAIN response, or an application timeout after DNS sends the caller to the wrong place.

A small AWS CLI check can look like this:

```bash
aws ec2 describe-vpc-attribute \
  --vpc-id vpc-0abc1234payments \
  --attribute enableDnsSupport

aws ec2 describe-vpc-attribute \
  --vpc-id vpc-0abc1234payments \
  --attribute enableDnsHostnames
```

A Terraform VPC shape usually sets both explicitly:

```hcl
resource "aws_vpc" "payments" {
  cidr_block           = "10.40.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
}
```

**DHCP options** are the network settings that instances receive when they join the VPC. The default DHCP option set uses `AmazonProvidedDNS` as the domain name server. Some companies replace it with custom DNS servers, often Active Directory DNS servers or centralized security resolvers. That can work, but the custom resolvers need conditional forwarding back to the VPC resolver for AWS-private names that only the VPC resolver can answer.

The important production habit is to record which resolver the workload actually uses. A private hosted zone attached to a VPC helps only if the query reaches the VPC resolver or a DNS server that forwards the right name to it.

## Private Hosted Zones
<!-- section-summary: A private hosted zone stores DNS records for one or more associated VPCs, letting internal names resolve without publishing them on the internet. -->

A **hosted zone** is a container for DNS records for a domain. A public hosted zone answers internet DNS queries. A **private hosted zone** answers DNS queries only from the VPCs associated with that zone. It gives AWS workloads private names such as `api.payments.internal`, `ledger.payments.internal`, or `fraud.partner.internal` without publishing those names to the public internet.

For the payments app, the platform team creates a private hosted zone named `payments.internal`. The zone is associated with the production payments VPC. Inside the zone, the team can create records that point to internal load balancers, private API endpoints, or alias records that lead to endpoint DNS names.

A small Terraform example looks like this:

```hcl
resource "aws_route53_zone" "payments_internal" {
  name = "payments.internal"

  vpc {
    vpc_id = aws_vpc.payments.id
  }
}

resource "aws_route53_record" "api" {
  zone_id = aws_route53_zone.payments_internal.zone_id
  name    = "api.payments.internal"
  type    = "A"

  alias {
    name                   = aws_lb.internal_api.dns_name
    zone_id                = aws_lb.internal_api.zone_id
    evaluate_target_health = true
  }
}
```

Private hosted zone associations are the access boundary for the DNS records. If the staging VPC also needs `payments.internal`, the zone must be associated with that VPC or shared through a managed multi-account pattern. If a developer laptop asks public DNS for `api.payments.internal`, public DNS has no reason to know that private name.

Private hosted zones also interact with resolver rules. When a private hosted zone and a forwarding rule cover the same domain, rule precedence can change where the query goes. That detail matters in hybrid networks because a domain like `corp.internal` might exist in an on-premises DNS system while a subdomain like `aws.corp.internal` exists in Route 53.

## Split-Horizon Private Names
<!-- section-summary: Split-horizon DNS uses the same name in different DNS views so internal callers can receive private answers while external callers receive public answers. -->

**Split-horizon DNS** means the same domain name can produce different DNS answers depending on where the query comes from. An internal caller might receive a private IP address, while an internet caller receives a public load balancer address. The name is the same, but the DNS view is different.

The payments company may have a public API at `api.payments.example.com` for customer-facing requests and an internal API at the same name for private worker-to-worker calls. Public Route 53 can host the public zone for `payments.example.com`, while a private hosted zone associated with the VPC can host private records for selected names. Workloads inside the VPC receive the private answer from the VPC resolver. Internet users receive the public answer from public DNS.

This pattern is powerful because application configuration can stay stable. The application asks for `api.payments.example.com` in every environment, and DNS decides the address based on the network view. That same convenience can create confusion during incidents because two engineers in different places may see different answers for the same name.

A careful split-horizon design documents three things:

| Question | Production answer to record |
| --- | --- |
| **Which views exist?** | Public hosted zone, production private hosted zone, staging private hosted zone, corporate DNS zone. |
| **Which VPCs or networks can see each view?** | VPC associations, inbound endpoint forwarding, outbound endpoint rules. |
| **What happens for missing records?** | NXDOMAIN from private zone, public fallback, or forwarding to corporate DNS depending on the matching zone and rule. |

The missing-record behavior is important. If a private hosted zone matches a domain but lacks the specific record, the resolver can return NXDOMAIN, and public lookup fallback may never happen for that query. That is often the reason a name works from a laptop but fails inside the VPC.

## PrivateLink and AWS Service Names
<!-- section-summary: Interface endpoint private DNS changes AWS service and provider service names into private endpoint ENI addresses inside the VPC. -->

The endpoint article introduced private DNS for interface endpoints. This topic deserves one more pass from the DNS side because it explains many wrong-path incidents.

An **interface endpoint** creates endpoint ENIs with private IPs. When private DNS is enabled for an AWS service endpoint, the normal service hostname can resolve to those private endpoint IPs inside the VPC. For example, `secretsmanager.us-east-1.amazonaws.com` can resolve to private addresses in the payments VPC. The SDK keeps using the standard service name, and the packet path goes to the endpoint ENI.

That means a DNS answer can reveal whether the application is using the endpoint path. If the ECS task resolves Secrets Manager to private IP addresses from the endpoint subnets, the DNS half looks good. If it resolves to public AWS addresses, the workload may use NAT or fail in an isolated subnet.

Provider services add one more naming layer. A partner PrivateLink service may give the payments team a generated endpoint DNS name, and it may also support a private DNS name such as `api.fraudpartner.example.com`. The consumer can also create its own private hosted zone record such as `fraud.partner.internal` that points at the endpoint DNS name. In each case, the production goal is the same: application code gets a stable name, and the VPC resolver returns private endpoint addresses from inside the VPC.

Custom DNS servers need special care here. If the payments VPC DHCP options point tasks to corporate DNS servers, those servers may resolve AWS service names using public DNS unless they forward the right names back to the VPC resolver. The endpoint can exist, the security group can allow traffic, and the app can still miss the endpoint because DNS took a different resolver path.

## Inbound Resolver Endpoints
<!-- section-summary: Inbound Resolver endpoints let DNS resolvers outside the VPC ask the VPC resolver for private hosted zone and VPC names over a private network link. -->

A **Resolver inbound endpoint** lets DNS queries enter a VPC resolver from another network. The endpoint has private IP addresses in subnets you choose. Corporate DNS servers, another VPC, or another connected network can forward selected queries to those IPs over private connectivity such as VPN, Direct Connect, Transit Gateway, or another routed private path.

For the payments company, the corporate network has internal tools that need to resolve `api.payments.internal`. That name lives in a Route 53 private hosted zone associated with the payments VPC. Corporate DNS sends that private question to AWS through an inbound Resolver endpoint in the payments VPC, then receives the answer from the VPC resolver.

The flow looks like this:

1. A corporate workstation asks corporate DNS for `api.payments.internal`.
2. Corporate DNS has a conditional forwarder for `payments.internal`.
3. Corporate DNS forwards the query over the private network to the inbound endpoint IPs.
4. The VPC resolver answers from the private hosted zone.
5. The workstation receives the private IP answer and uses the hybrid network path to connect.

The endpoint IPs are private IPs from the VPC. Corporate DNS reaches them through private connectivity, with routing to those IPs, firewall rules that allow DNS traffic, and a return path. Most production inbound endpoints use IPs in at least two Availability Zones for resilience.

Inbound delegation is a related pattern. A corporate DNS team can delegate a subdomain such as `aws.corp.internal` to inbound endpoint IPs by using NS records in the corporate DNS system. That gives Route 53 private hosted zones authority for a specific subdomain while the parent corporate domain stays on-premises.

## Outbound Resolver Endpoints and Forwarding Rules
<!-- section-summary: Outbound Resolver endpoints and forwarding rules let AWS workloads resolve domains that live in corporate or other private DNS systems. -->

A **Resolver outbound endpoint** lets DNS queries leave a VPC resolver toward another DNS system. A **forwarding rule** tells the resolver which domain names should be sent to which target DNS server IPs. Together, they let AWS workloads resolve names hosted outside Route 53.

The payments app needs to connect to `ledger.corp.internal`, an internal finance service in the corporate datacenter. That name lives in corporate DNS. The VPC resolver can answer AWS names and private hosted zones, but it needs a forwarding rule for `corp.internal` so those queries go to corporate DNS servers.

The flow looks like this:

1. The ECS task asks the VPC resolver for `ledger.corp.internal`.
2. The resolver sees a forwarding rule for `corp.internal`.
3. The resolver sends the query from the outbound endpoint IPs to the corporate DNS target IPs.
4. Corporate DNS answers with the private address for the ledger service.
5. The application uses the VPN or Direct Connect path to reach that address.

![Resolver forwarding map showing corporate DNS, Route 53 Resolver, inbound endpoint, outbound endpoint, private hosted zone, and forwarding rules for corp.internal names](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-dns-route-53-resolver/resolver-forwarding-map.png)

*Inbound endpoints let outside resolvers ask AWS private DNS questions. Outbound endpoints and forwarding rules let AWS workloads ask corporate DNS questions without hardcoding resolver behavior into applications.*

A small Terraform shape can look like this:

```hcl
resource "aws_route53_resolver_endpoint" "outbound" {
  name      = "payments-outbound-dns"
  direction = "OUTBOUND"

  security_group_ids = [aws_security_group.resolver_outbound.id]

  ip_address {
    subnet_id = aws_subnet.shared_services_a.id
  }

  ip_address {
    subnet_id = aws_subnet.shared_services_b.id
  }
}

resource "aws_route53_resolver_rule" "corp_internal" {
  domain_name          = "corp.internal"
  name                 = "forward-corp-internal"
  rule_type            = "FORWARD"
  resolver_endpoint_id = aws_route53_resolver_endpoint.outbound.id

  target_ip {
    ip = "172.16.10.10"
  }

  target_ip {
    ip = "172.16.20.10"
  }
}

resource "aws_route53_resolver_rule_association" "payments" {
  resolver_rule_id = aws_route53_resolver_rule.corp_internal.id
  vpc_id           = aws_vpc.payments.id
}
```

The forwarding rule association is easy to miss. Creating the rule defines the behavior, but associating it with the payments VPC applies that behavior to queries from that VPC. In multi-account environments, a networking account may share resolver rules with application accounts through AWS Resource Access Manager so VPCs can reuse centrally managed behavior.

## Cross-VPC and Multi-Account DNS Patterns
<!-- section-summary: Shared DNS designs usually centralize resolver endpoints and share private zones or forwarding rules, while keeping VPC associations explicit. -->

As AWS usage grows, every VPC creating its own private zones, inbound endpoints, and outbound endpoints can turn DNS into a scattered system. A common production pattern uses a **shared services VPC** or networking account for central DNS plumbing. Application VPCs then associate with private hosted zones, share resolver rules, or forward through central endpoints depending on the organization's routing model.

For the payments company, the production account owns the payments workload VPC. A networking account owns Transit Gateway, VPN, Direct Connect, and shared Resolver endpoints. The corporate DNS team owns `corp.internal`. The platform team needs these systems to cooperate without hiding ownership.

There are three common building blocks:

| Pattern | How it works | Payments example |
| --- | --- | --- |
| **Associate private hosted zones with multiple VPCs** | The private zone directly answers from each associated VPC. | `payments.internal` is associated with production and operations VPCs. |
| **Share outbound forwarding rules** | A central rule for `corp.internal` is shared and associated with application VPCs. | Payments, billing, and reporting VPCs all forward `corp.internal` to corporate DNS. |
| **Use inbound endpoints for external resolvers** | Corporate or another VPC resolver forwards AWS-private domains to inbound endpoint IPs. | Corporate workstations resolve `api.payments.internal` through the inbound endpoint. |

Cross-VPC DNS still needs network reachability after the answer comes back. Resolving `api.payments.internal` to `10.40.20.50` only helps if the caller has a routed and allowed path to `10.40.20.50`. DNS gives the address. VPC routing, Transit Gateway route tables, security groups, network ACLs, and firewalls decide whether the connection works.

The cleanest designs write down ownership at the domain boundary. Route 53 private hosted zones can own AWS application domains. Corporate DNS can own employee and datacenter domains. Resolver rules connect the two with explicit suffixes such as `corp.internal`, `aws.corp.internal`, or `payments.internal`.

## Resolver Query Logging
<!-- section-summary: Resolver query logs show which VPC resources asked which DNS questions and what answers or response codes they received. -->

**Resolver query logging** records DNS queries handled by Route 53 Resolver for selected VPCs and resolver endpoint paths. It can log queries that originate in VPCs, queries from on-premises resources that use an inbound endpoint, queries that use an outbound endpoint, and DNS Firewall-related query results.

For the payments app, query logs help answer incident questions. Did the ECS task ask for `secretsmanager.us-east-1.amazonaws.com`? Did it receive private endpoint IPs or public addresses? Did `ledger.corp.internal` return `NoError`, `NXDOMAIN`, or `ServFail`? Which VPC and source IP made the query?

Resolver query logs can be sent to CloudWatch Logs, S3, or Firehose. CloudWatch Logs works well for live investigation. S3 works well for retention and analytics. Firehose works well when the security team sends DNS telemetry into a larger logging platform.

One detail matters during troubleshooting: DNS resolvers cache answers according to TTL values. Route 53 Resolver query logging records unique queries that reach the resolver, and cached repeat answers can be absent from new log entries. A missing second query in the log may simply mean the application received a cached answer.

Query logs are evidence alongside direct tests from the workload environment. During a production issue, combine logs with a query from a shell inside the same subnet, security group, and DNS configuration as the failing workload.

## Troubleshooting Wrong DNS Answers
<!-- section-summary: Wrong DNS answers usually come from the wrong resolver, missing VPC associations, overlapping zones, rule precedence, disabled DNS attributes, or stale caches. -->

DNS failures often look like network failures. The application says timeout, TLS error, connection refused, or access denied. Before changing route tables, it helps to prove the DNS answer from the same place where the application runs.

For the payments app, the team can compare three names:

| Name | Expected private behavior |
| --- | --- |
| `secretsmanager.us-east-1.amazonaws.com` | Returns interface endpoint private IPs from the payments VPC. |
| `fraud.partner.internal` | Returns a private endpoint or internal record for the partner service. |
| `ledger.corp.internal` | Forwards to corporate DNS through the outbound Resolver endpoint. |

A small investigation from an ECS debug task or EC2 instance in the same subnets can use tools such as `dig` or `nslookup`:

```bash
dig secretsmanager.us-east-1.amazonaws.com
dig fraud.partner.internal
dig ledger.corp.internal
```

The useful checks are practical:

| Check | What it tells you |
| --- | --- |
| **Resolver path** | The workload may be using AmazonProvidedDNS, a custom corporate resolver, or a container-level DNS setting. |
| **VPC DNS attributes** | Private hosted zones and endpoint private DNS need DNS support and DNS hostnames enabled. |
| **Private hosted zone association** | The zone must be associated with the VPC asking the question. |
| **Forwarding rule association** | The resolver rule must be associated with the VPC asking the question. |
| **Rule and zone overlap** | More specific zones and resolver rule precedence can send a name somewhere unexpected. |
| **Endpoint private DNS setting** | The interface endpoint may exist while private DNS remains disabled. |
| **Inbound or outbound endpoint reachability** | DNS target IPs need routes, security group rules, firewall rules, and return paths. |
| **Cache and TTL** | Old answers can persist until caches expire. |

Wrong DNS answers also create security surprises. If a name expected to resolve privately returns a public address, the application may use NAT and bypass the intended endpoint policy. If a private hosted zone accidentally captures a public domain without all needed records, internal clients may receive NXDOMAIN for names that work everywhere else.

The steady debugging sequence is to prove the answer, prove the resolver that gave the answer, prove the rule or zone that matched, and then prove the network path to the returned address. That sequence keeps DNS and routing separate enough to fix the right layer.

## Putting It All Together
<!-- section-summary: Route 53 Resolver connects private names, AWS endpoint names, corporate DNS, and hybrid forwarding into one DNS path that must match the packet path. -->

Private networking depends on names. The payments app can have correct VPC endpoints, correct route tables, and correct security groups, while a wrong DNS answer still sends traffic to the wrong destination. Route 53 Resolver is the AWS-managed DNS service that ties the private name story together inside a VPC.

**AmazonProvidedDNS** is the default VPC resolver path exposed through the VPC DNS configuration. **Private hosted zones** give VPCs private records such as `api.payments.internal`. **Split-horizon DNS** lets internal and external callers use the same name while receiving different answers. **Interface endpoint private DNS** lets normal AWS service names resolve to endpoint ENI private IPs inside the VPC.

Hybrid environments add **inbound Resolver endpoints**, **outbound Resolver endpoints**, and **forwarding rules**. Inbound endpoints let corporate DNS ask AWS for private VPC names. Outbound endpoints and forwarding rules let AWS workloads ask corporate DNS for names such as `corp.internal`.

The production rule is to pair every DNS design with the packet path that follows it. A name that resolves to a private IP still needs routing, security groups, network ACLs, and firewalls. A PrivateLink endpoint still needs the right private DNS answer. When the name answer and packet path agree, the team can trace private connectivity with DNS evidence and packet evidence.

![Private DNS checklist summary board covering resolver source, VPC DNS flags, zone association, private DNS, forwarding rule, and query logs](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-dns-route-53-resolver/private-dns-checklist.png)

*Private DNS reviews should prove the resolver source, VPC DNS attributes, zone associations, endpoint private DNS, forwarding rules, and query logs before changing route tables or packet filters.*

**References**

- [DNS attributes for your VPC - Amazon VPC](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-dns.html)
- [Understanding Amazon DNS - Amazon VPC](https://docs.aws.amazon.com/vpc/latest/userguide/AmazonDNS-concepts.html)
- [What is Route 53 VPC Resolver? - Amazon Route 53](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver.html)
- [Working with private hosted zones - Amazon Route 53](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/hosted-zones-private.html)
- [Considerations when working with a private hosted zone - Amazon Route 53](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/hosted-zone-private-considerations.html)
- [Forwarding inbound DNS queries to your VPCs - Amazon Route 53](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver-forwarding-inbound-queries.html)
- [Forwarding outbound DNS queries to your network - Amazon Route 53](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver-forwarding-outbound-queries.html)
- [Resolver query logging - Amazon Route 53](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver-query-logs.html)
- [AWS PrivateLink concepts - Amazon VPC](https://docs.aws.amazon.com/vpc/latest/privatelink/concepts.html)
