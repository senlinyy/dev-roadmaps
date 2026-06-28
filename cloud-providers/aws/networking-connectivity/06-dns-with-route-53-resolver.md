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

1. [Names Choose the First Destination](#names-choose-the-first-destination)
2. [The VPC DNS Resolver](#the-vpc-dns-resolver)
3. [DNS Attributes and DHCP Options](#dns-attributes-and-dhcp-options)
4. [Private Hosted Zones](#private-hosted-zones)
5. [PrivateLink Service Names](#privatelink-service-names)
6. [Hybrid DNS with Resolver Endpoints](#hybrid-dns-with-resolver-endpoints)
7. [Query Logs and Troubleshooting](#query-logs-and-troubleshooting)
8. [References](#references)

## Names Choose the First Destination
<!-- section-summary: Private network paths depend on DNS because applications usually connect to names before packets reach route tables. -->

The receipts API now has private endpoints for S3, Secrets Manager, and CloudWatch Logs. The network path can look carefully designed, and the app can still fail before it sends a useful packet. The reason is simple: the application usually starts with a name.

**DNS**, the Domain Name System, maps names to addresses. The app asks for names like `secretsmanager.us-east-1.amazonaws.com`, `receipts-db.prod.internal`, or `fraud.partner.internal`. After DNS returns an IP address, route tables, security groups, NACLs, firewalls, and load balancers get their turn.

This is why many private networking incidents start as DNS incidents. A PrivateLink endpoint can exist and stay healthy while the app resolves a public AWS service address. A private hosted zone can contain the correct record while the VPC lacks the association that lets workloads see it. A hybrid forwarding rule can send a corporate name to the wrong DNS server and make a private service look offline.

For the receipts app, start a timeout review with one question: "which name did the app ask for, and which IP address did it receive?" If `inventory.shared.internal` resolves to `10.40.8.20`, routing and packet controls can focus on that target. If it resolves to an old `10.70.x.x` address, the route review follows the wrong destination.

## The VPC DNS Resolver
<!-- section-summary: Route 53 Resolver is the default DNS service inside a VPC and answers VPC, private hosted zone, public recursive, and endpoint private DNS queries. -->

Every VPC has access to an AWS-managed DNS resolver. AWS documentation uses a few names for this path: **Route 53 Resolver**, **Amazon DNS server**, and **AmazonProvidedDNS**. In day-to-day VPC work, they all point to the resolver service that VPC resources use for DNS.

The resolver is reachable at the VPC CIDR base address plus two. In a VPC with CIDR `10.40.0.0/16`, workloads can use `10.40.0.2`. AWS also documents link-local addresses `169.254.169.253` for IPv4 and `fd00:ec2::253` for IPv6. Most workloads receive the right resolver through DHCP options, so application teams rarely type these addresses directly.

The resolver can answer EC2 private DNS names, Route 53 private hosted zone records, public recursive DNS queries, and private DNS records for interface endpoints. For the receipts app, the same resolver can answer `receipts-db.prod.internal` from a private hosted zone and `secretsmanager.us-east-1.amazonaws.com` through interface endpoint private DNS.

A runtime check can look like this from an instance, debug container, or task shell:

```bash
getent hosts secretsmanager.us-east-1.amazonaws.com
getent hosts receipts-db.prod.internal
```

Example output:

```console
10.20.14.83 secretsmanager.us-east-1.amazonaws.com
10.20.28.91 secretsmanager.us-east-1.amazonaws.com
10.30.6.25 receipts-db.prod.internal
```

These answers tell a story. The Secrets Manager name returns private `10.20.x.x` endpoint IPs, so private DNS for the interface endpoint is working from this runtime. The database name returns `10.30.6.25`, which looks like an internal database address. If the second command returned no result, the next action would be the private hosted zone record and VPC association. If the first command returned public AWS addresses, the next action would be the endpoint private DNS setting, VPC DNS attributes, and DHCP or forwarding path.

Run the DNS check as close to the failing workload as practical. A laptop, bastion host, Lambda function, ECS task, and EC2 instance can use different resolvers, subnets, security groups, and DHCP option sets. DNS evidence from the wrong runtime can send the investigation in the wrong direction.

![The DNS answer path shows how a workload receives private service answers from the VPC resolver before it ever opens a network connection](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-dns-route-53-resolver/dns-answer-packet-path.png)

*The DNS answer path shows how a workload receives private service answers from the VPC resolver before it ever opens a network connection.*


## DNS Attributes and DHCP Options
<!-- section-summary: VPC DNS attributes and DHCP options decide whether workloads can use the AWS resolver and private DNS features. -->

Two VPC attributes appear in many AWS DNS problems: `enableDnsSupport` and `enableDnsHostnames`. `enableDnsSupport` lets queries to the Amazon-provided resolver succeed. `enableDnsHostnames` supports DNS hostnames for instances with public addresses and works with DNS support for private hosted zones and interface endpoint private DNS.

For the receipts app, both attributes should be enabled. Private hosted zones, EC2 names, and PrivateLink private DNS all rely on the VPC resolver path. A private hosted zone can contain perfect records, and workloads can still receive wrong answers when these settings or the resolver path have drifted.

The AWS CLI checks each attribute separately:

```bash
aws ec2 describe-vpc-attribute \
  --vpc-id vpc-0abc1234receipts \
  --attribute enableDnsSupport

aws ec2 describe-vpc-attribute \
  --vpc-id vpc-0abc1234receipts \
  --attribute enableDnsHostnames
```

```json
{
  "VpcId": "vpc-0abc1234receipts",
  "EnableDnsSupport": {
    "Value": true
  }
}
```

```json
{
  "VpcId": "vpc-0abc1234receipts",
  "EnableDnsHostnames": {
    "Value": true
  }
}
```

The important field is `Value`. For this VPC, both outputs should show `true`. A `false` value gives the next action: enable the missing VPC DNS attribute, then retest the same hostname from the workload path.

DHCP option sets decide which DNS servers instances learn. The default AWS option set sends instances to `AmazonProvidedDNS`. Some enterprises replace that with corporate DNS servers. That can work, but the corporate DNS servers need forwarding rules back to Route 53 Resolver for AWS private names such as private hosted zone records and interface endpoint private DNS names.

Custom DNS should be specific. A common healthy pattern forwards corporate zones such as `corp.internal` to corporate DNS and keeps AWS private names on the VPC resolver path. A risky pattern sends every DNS query out to corporate DNS first, then relies on corporate DNS to understand every AWS private name. That design adds latency, broad dependency, and confusing failure modes.

## Private Hosted Zones
<!-- section-summary: Private hosted zones let associated VPCs resolve internal names without publishing those records to public DNS. -->

A **Route 53 private hosted zone** stores DNS records that only associated VPCs can resolve through the Route 53 Resolver path. This gives teams internal names such as `receipts-db.prod.internal`, `api.prod.internal`, or `inventory.shared.internal` without publishing those records to the public internet.

For the receipts app, a private hosted zone named `prod.internal` can hold `receipts-db.prod.internal`. The record can point to the RDS endpoint or to a stable internal load balancer name. Application config then uses a readable service name rather than a long provider-generated endpoint string.

A record change uses a JSON change batch. The command can look like this:

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123PRIVATE \
  --change-batch file://db-record-change.json
```

The `file://db-record-change.json` value tells the AWS CLI to read the change request from a local file. The file contains the action, record name, type, TTL, and value. A simple UPSERT for the database name can look like this:

```json
{
  "Changes": [
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "receipts-db.prod.internal.",
        "Type": "CNAME",
        "TTL": 60,
        "ResourceRecords": [
          {
            "Value": "receipts-prod-db.abc123.us-east-1.rds.amazonaws.com."
          }
        ]
      }
    }
  ]
}
```

`UPSERT` creates the record when it is missing and updates it when it already exists. `TTL` controls how long resolvers can cache the answer. A short TTL such as `60` seconds helps during migrations, while mature steady-state records can often use longer values after the team understands the operational tradeoff.

The Route 53 response includes the change status:

```json
{
  "ChangeInfo": {
    "Id": "/change/C0123456789ABC",
    "Status": "PENDING",
    "SubmittedAt": "2026-06-27T10:15:42.000Z"
  }
}
```

`PENDING` means Route 53 accepted the request and propagation is still in progress. After propagation, `get-change` should show `INSYNC`. If the record is `INSYNC` and the workload still receives no answer, the next action is the private hosted zone association, VPC DNS attributes, and custom forwarding path.

Private hosted zones can associate with multiple VPCs, including VPCs in other accounts when the correct authorization flow exists. Treat those associations as production access. If a shared services VPC can resolve `receipts-db.prod.internal`, the route tables and security groups should match that intended access path.

Private hosted zones can also create **split-horizon DNS**. The same name can have a public answer outside AWS and a private answer inside associated VPCs. This is useful for names such as `api.example.com` during migrations, but support teams need clear documentation because a laptop and an ECS task may receive different answers for the same name.

## PrivateLink Service Names
<!-- section-summary: Interface endpoint private DNS maps normal AWS service names to endpoint private IPs inside the VPC. -->

Interface endpoints often support **private DNS**. When enabled, a normal service name such as `secretsmanager.us-east-1.amazonaws.com` resolves to private endpoint IPs inside the VPC. The application keeps standard AWS SDK configuration, and the VPC resolver gives the private answer.

This matters because service endpoint names appear in code, SDK defaults, environment variables, and third-party libraries. If every app had to use endpoint-specific hostnames, endpoint migrations would turn into application releases. Private DNS keeps the service name stable and moves the private path decision into infrastructure.

A private DNS check compares the endpoint configuration with the runtime DNS answer:

```bash
aws ec2 describe-vpc-endpoints \
  --vpc-endpoint-ids vpce-0secretsreceipts \
  --query 'VpcEndpoints[0].{Service:ServiceName,State:State,PrivateDns:PrivateDnsEnabled,DnsEntries:DnsEntries[*].DnsName}'
```

```json
{
  "Service": "com.amazonaws.us-east-1.secretsmanager",
  "State": "available",
  "PrivateDns": true,
  "DnsEntries": [
    "vpce-0secretsreceipts-abc123.secretsmanager.us-east-1.vpce.amazonaws.com",
    "vpce-0secretsreceipts-abc123-us-east-1a.secretsmanager.us-east-1.vpce.amazonaws.com",
    "vpce-0secretsreceipts-abc123-us-east-1b.secretsmanager.us-east-1.vpce.amazonaws.com"
  ]
}
```

This output says the endpoint exists, private DNS is enabled, and AWS created endpoint-specific DNS names. If the app still resolves public addresses for `secretsmanager.us-east-1.amazonaws.com`, the next action is the VPC resolver path rather than the endpoint itself. Check VPC DNS attributes, DHCP options, custom DNS forwarding, and whether the test ran inside the associated VPC.

Also check endpoint placement. DNS can return multiple endpoint IPs. A production design usually places interface endpoints in the Availability Zones where callers run, so zonal failure behavior and cross-zone dependencies stay predictable during an incident.

## Hybrid DNS with Resolver Endpoints
<!-- section-summary: Inbound and outbound Resolver endpoints connect VPC DNS with corporate or shared DNS systems through explicit forwarding rules. -->

Hybrid networks add two more DNS needs. AWS workloads may need corporate names such as `corp.internal`, and corporate support tools may need AWS private names such as `inventory.shared.internal`. Route tables and VPNs only move packets after DNS has chosen an address, so hybrid DNS needs its own design.

**Route 53 Resolver inbound endpoints** let DNS clients outside the VPC send queries into the VPC resolver. **Outbound endpoints** let the VPC resolver forward selected domains to DNS servers outside AWS. **Resolver rules** decide which domains get forwarded and which target IPs receive them.

For example, the receipts VPC can use an outbound rule for `corp.internal` that forwards queries to corporate DNS over VPN or Direct Connect. Corporate DNS can use an inbound endpoint when on-premises support tools need to resolve `prod.internal` names inside AWS. Resolver endpoint ENIs live in subnets, so they need route and security group access to the DNS peers.

A resolver rule inspection can look like this:

```bash
aws route53resolver list-resolver-rules \
  --query 'ResolverRules[*].{Id:Id,Domain:DomainName,Type:RuleType,Targets:TargetIps[*].Ip}'
```

```json
[
  {
    "Id": "rslvr-rr-0corpinternal",
    "Domain": "corp.internal.",
    "Type": "FORWARD",
    "Targets": [
      "172.16.10.10",
      "172.16.10.11"
    ]
  },
  {
    "Id": "rslvr-rr-0system",
    "Domain": ".",
    "Type": "SYSTEM",
    "Targets": []
  }
]
```

The `FORWARD` rule says queries for `corp.internal` go to the corporate DNS servers. The `SYSTEM` rule keeps normal resolver behavior for other names. If `inventory.shared.internal` accidentally matches a broad forwarding rule, the next action is rule priority and domain scope. Make forwarding rules as narrow as the domains that truly live outside AWS.

Resolver endpoint security groups need DNS rules. Inbound endpoint security groups usually allow UDP and TCP `53` from approved corporate DNS servers. Outbound endpoints need a route to the target DNS servers and security rules that permit DNS traffic. DNS can fail because of ordinary network controls around those endpoint ENIs.

![The forwarding map shows how inbound endpoints, outbound endpoints, and forwarding rules connect VPC DNS with on-premises DNS](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-dns-route-53-resolver/resolver-forwarding-map.png)

*The forwarding map shows how inbound endpoints, outbound endpoints, and forwarding rules connect VPC DNS with on-premises DNS.*


## Query Logs and Troubleshooting
<!-- section-summary: Resolver query logging records DNS questions from VPC resources and helps separate naming problems from routing problems. -->

**Route 53 Resolver query logging** records DNS queries from VPC resources. It helps answer which name a workload asked for, which VPC sent the query, which record type was requested, and where the log was delivered. Query logs show DNS questions rather than the later TCP result, and they give the first piece of evidence in many private networking incidents.

Production teams usually enable query logs before an incident. The destination can be CloudWatch Logs, S3, or Kinesis Data Firehose, depending on retention and analysis needs. A CloudWatch Logs setup can look like this:

```bash
aws route53resolver create-resolver-query-log-config \
  --name receipts-prod-dns-queries \
  --destination-arn arn:aws:logs:us-east-1:123456789012:log-group:/aws/route53resolver/receipts-prod \
  --region us-east-1

aws route53resolver associate-resolver-query-log-config \
  --resolver-query-log-config-id rqlc-0123456789abcdef0 \
  --resource-id vpc-0abc1234receipts \
  --region us-east-1
```

`create-resolver-query-log-config` creates the logging destination link. `associate-resolver-query-log-config` attaches that logging config to the VPC that should produce DNS evidence. The returned IDs matter because the on-call team will use them to confirm logging status later.

An inspection command can show whether the VPC has query logging:

```bash
aws route53resolver list-resolver-query-log-config-associations \
  --filters Name=ResourceId,Values=vpc-0abc1234receipts \
  --query 'ResolverQueryLogConfigAssociations[*].{ConfigId:ResolverQueryLogConfigId,ResourceId:ResourceId,Status:Status,Error:Error}'
```

```json
[
  {
    "ConfigId": "rqlc-0123456789abcdef0",
    "ResourceId": "vpc-0abc1234receipts",
    "Status": "ACTIVE",
    "Error": null
  }
]
```

`ACTIVE` means Route 53 Resolver should deliver query logs for this VPC. If the list is empty, DNS history for this VPC may be unavailable, and the next action is live runtime resolution plus enabling query logging for future incidents.

During an incident, query log evidence can drive the next step:

| Evidence | Meaning | Next action |
| --- | --- | --- |
| Hostname is missing from query logs | The workload may use a different name, resolver, VPC, or cache | Check app config, runtime resolver, and test location |
| Hostname appears with an old answer | DNS data or forwarding source is stale | Check private hosted zone record, Resolver rule, or corporate DNS |
| Hostname appears with the expected private answer | DNS likely did its job for this flow | Move to route tables, security groups, NACLs, Flow Logs, or service health |
| Queries show repeated `NXDOMAIN` | Resolver returned a name-not-found answer | Check zone name, record spelling, and VPC association |

A practical DNS runbook starts with one name. Resolve it from the workload path, compare the answer to the intended private address, check VPC DNS attributes, check private hosted zone association, check endpoint private DNS, and inspect Resolver rules for hybrid names. Once DNS returns the expected IP, move to routing and packet controls. If DNS returns the wrong IP, security group changes will only hide the real problem.

![The private DNS checklist helps compare resolver settings, hosted zone association, endpoint private DNS, forwarding rules, and query logs](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-dns-route-53-resolver/private-dns-checklist.png)

*The private DNS checklist helps compare resolver settings, hosted zone association, endpoint private DNS, forwarding rules, and query logs.*


## References

- [Amazon VPC documentation: Understanding Amazon DNS](https://docs.aws.amazon.com/vpc/latest/userguide/AmazonDNS-concepts.html)
- [Route 53 documentation: Working with private hosted zones](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/hosted-zones-private.html)
- [Route 53 Resolver documentation: Resolver endpoints and forwarding rules](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver.html)
- [Route 53 Resolver documentation: Resolver query logging](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resolver-query-logs.html)
