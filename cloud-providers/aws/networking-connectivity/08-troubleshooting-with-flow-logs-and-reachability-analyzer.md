---
title: "Troubleshooting with Flow Logs and Reachability Analyzer"
description: "Troubleshoot AWS VPC connectivity with VPC Flow Logs, Reachability Analyzer, DNS checks, route-table review, NAT, internet gateways, endpoints, and Transit Gateway paths."
overview: "Network troubleshooting works best when configuration evidence and packet evidence are used together. This article teaches a repeatable AWS workflow for private and public connectivity issues across app, shared services, analytics, security, Transit Gateway, and on-premises paths."
tags: ["aws", "vpc", "flow-logs", "reachability-analyzer", "network-troubleshooting"]
order: 8
id: article-cloud-providers-aws-networking-connectivity-flow-logs-reachability-analyzer
aliases:
  - troubleshooting-with-flow-logs-and-reachability-analyzer
  - flow-logs-and-reachability-analyzer
  - network-troubleshooting
---

## Table of Contents

1. [The Troubleshooting Scenario](#the-troubleshooting-scenario)
2. [Name, Address, Port, and Protocol](#name-address-port-and-protocol)
3. [Flow Logs as Packet Evidence](#flow-logs-as-packet-evidence)
4. [Reading ACCEPT and REJECT Records](#reading-accept-and-reject-records)
5. [Reachability Analyzer as Configuration Evidence](#reachability-analyzer-as-configuration-evidence)
6. [A Repeatable No-Connectivity Flow](#a-repeatable-no-connectivity-flow)
7. [Wrong DNS Target](#wrong-dns-target)
8. [Security Group, NACL, and Route Blocks](#security-group-nacl-and-route-blocks)
9. [NAT, Internet Gateway, and Endpoint Paths](#nat-internet-gateway-and-endpoint-paths)
10. [Multi-VPC and Transit Gateway Paths](#multi-vpc-and-transit-gateway-paths)
11. [Using Both Tools Together](#using-both-tools-together)
12. [Common Production Mistakes](#common-production-mistakes)
13. [Final Runbook](#final-runbook)
14. [References](#references)

## The Troubleshooting Scenario
<!-- section-summary: The same app, shared services, analytics, security, and on-premises network gives us a realistic place to practice connectivity troubleshooting. -->

We will keep the production network from the previous article. The app VPC runs customer-facing workloads. The shared services VPC hosts internal tools. The analytics VPC receives event data. The security VPC contains inspection services. On-premises support systems connect through the regional network hub. AWS Transit Gateway routes between the VPCs and approved hybrid paths.

Now an incident arrives. The app team says the production API times out when calling the shared inventory service. A few minutes later, the analytics team says event delivery is delayed. The support team says an on-premises admin system times out when calling a private endpoint in AWS. Every team sees a timeout from its own side, and every timeout sounds the same in a chat message.

Network troubleshooting needs more detail than "it timed out." A timeout can come from DNS resolving the wrong IP, a missing route, a blocked security group, a blocked NACL, a missing return route, a stateful firewall seeing only half the flow, a NAT path issue, an internet gateway path issue, a VPC endpoint policy, or an application listener that is down.

AWS gives two very useful tools for this work.

**VPC Flow Logs** capture information about IP traffic going to and from network interfaces in a VPC. Flow Logs give packet evidence: source address, destination address, source port, destination port, protocol, packet counts, byte counts, action, and log status. They help answer, "Did packets appear on this network interface, and did the VPC packet layer accept or reject them?"

**Reachability Analyzer** is a configuration analysis tool. It checks whether a source resource can reach a destination resource over a protocol and port based on AWS network configuration. When the destination is reachable, it shows hop-by-hop path details. When the destination is unreachable, it identifies the component that blocks the path, such as a route table, security group, NACL, or load balancer.

These tools answer different questions. Flow Logs show observed traffic records after traffic exists. Reachability Analyzer checks whether the AWS configuration supports an intended path. A good troubleshooting flow uses both.

## Name, Address, Port, and Protocol
<!-- section-summary: Every investigation starts by writing down the exact hostname, resolved IP, source, destination, port, and protocol for the flow. -->

Before looking at Flow Logs or Reachability Analyzer, the team needs the shape of the packet. The most useful small concept is the **packet five-tuple**.

A **packet five-tuple** is the set of five values that identify a network flow:

| Field | Example | Plain meaning |
| --- | --- | --- |
| Source IP address | `10.20.12.45` | The private address of the caller. |
| Source port | `51544` | The temporary port chosen by the caller for this connection. |
| Destination IP address | `10.40.8.20` | The private address the caller is trying to reach. |
| Destination port | `443` | The service port, such as HTTPS. |
| Protocol | `6` for TCP | The transport protocol. TCP is protocol number `6`; UDP is protocol number `17`. |

![Five-tuple first infographic showing source IP, source port, destination IP, destination port, protocol, hostname resolution, and a reminder that DNS answers come before route checks](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-flow-logs-reachability-analyzer/five-tuple-first.png)

*A timeout becomes testable when the team names the exact flow. The five-tuple plus the DNS answer tells every later tool which route, rule, and log record to inspect.*

The five-tuple matters because route tables mostly care about destination IPs, security groups and NACLs care about IPs and ports, and Flow Logs record these values. A vague report like "app times out when calling inventory" turns into something testable when it says: source `10.20.12.45`, destination `10.40.8.20`, TCP destination port `443`.

DNS must be checked before route tables. **DNS** is the system that turns a hostname into an IP address. Application logs usually show a hostname, such as `inventory.internal.example.com`. The network path uses the IP address returned for that name. If the app resolves a public load balancer address instead of a private shared services address, the route-table investigation will follow the wrong path.

For our first incident, the app container tries to call `https://inventory.internal.example.com`. The team records:

| Item | Value |
| --- | --- |
| Caller | ECS task in app VPC private subnet |
| Source ENI | `eni-0app1234567890abc` |
| Source IP | `10.20.12.45` |
| Hostname | `inventory.internal.example.com` |
| Resolved destination IP | `10.40.8.20` |
| Destination ENI | `eni-0shared1234567890` |
| Destination port | TCP `443` |
| Expected path | App VPC subnet route -> TGW -> shared services VPC -> inventory service |

This table prevents random guessing. The rest of the investigation can now ask whether this exact path exists and whether packets matching this exact five-tuple were accepted or rejected.

## Flow Logs as Packet Evidence
<!-- section-summary: VPC Flow Logs record observed traffic metadata for network interfaces, subnets, or VPCs and can publish it to CloudWatch Logs, S3, or Data Firehose. -->

**VPC Flow Logs** capture metadata about IP traffic going to and from network interfaces. Metadata means facts about the traffic rather than the application payload. Flow Logs show network facts such as addresses, ports, protocol, packet counts, byte counts, and whether the VPC packet layer accepted or rejected the traffic.

Flow Logs can be created for a network interface, subnet, or VPC. In production, many teams enable VPC-level or subnet-level logs for broad coverage, then add network-interface-level logs for sensitive workloads or incident focus. Logs can be delivered to Amazon CloudWatch Logs, Amazon S3, or Amazon Data Firehose.

The default record format includes version 2 fields. Common fields include:

| Field | What it tells you |
| --- | --- |
| `version` | The Flow Logs record version. |
| `account-id` | The AWS account that owns the source network interface for the record. |
| `interface-id` | The network interface where the traffic was recorded. |
| `srcaddr` | The source IP address from the perspective of the recorded interface. |
| `dstaddr` | The destination IP address from the perspective of the recorded interface. |
| `srcport` | The source port. |
| `dstport` | The destination port. |
| `protocol` | The IANA protocol number, such as `6` for TCP or `17` for UDP. |
| `packets` | The number of packets in the aggregated record. |
| `bytes` | The number of bytes in the aggregated record. |
| `start` and `end` | The start and end time for the aggregation interval. |
| `action` | `ACCEPT` or `REJECT` for the traffic. |
| `log-status` | Whether the record was delivered normally, had no data, or had skipped data. |

An **aggregation interval** is the time window where Flow Logs collect and combine matching traffic into one record. The default maximum aggregation interval is ten minutes. A one-minute interval can be selected for faster investigation, and Nitro-based network interfaces use an interval of one minute or less. That means Flow Logs are near-real-time summaries rather than an instant packet capture.

For traffic that passes through NAT gateways, load balancers, container networking, or other intermediate layers, the normal `srcaddr` and `dstaddr` fields may show the address of the intermediate interface. Custom formats can include `pkt-srcaddr` and `pkt-dstaddr`, which preserve packet-level original source and destination details in cases where that distinction matters.

Here is a small CLI example for creating a focused Flow Log on one network interface and publishing it to CloudWatch Logs:

```bash
aws ec2 create-flow-logs \
  --resource-type NetworkInterface \
  --resource-ids eni-0app1234567890abc \
  --traffic-type ALL \
  --log-destination-type cloud-watch-logs \
  --log-group-name /aws/vpc/flowlogs/prod-app \
  --deliver-logs-permission-arn arn:aws:iam::123456789012:role/vpc-flow-logs-to-cloudwatch \
  --log-format '${version} ${account-id} ${interface-id} ${srcaddr} ${dstaddr} ${srcport} ${dstport} ${protocol} ${packets} ${bytes} ${start} ${end} ${action} ${log-status}'
```

The IAM role must allow VPC Flow Logs to publish to the CloudWatch Logs group. For long-term analytics, many teams publish Flow Logs to S3 and query them with Athena. For active incidents, CloudWatch Logs can be convenient because responders can search recent records quickly.

## Reading ACCEPT and REJECT Records
<!-- section-summary: ACCEPT means the VPC packet layer allowed the traffic at that interface, while REJECT means security groups or NACLs rejected it at that point. -->

The `action` field is one of the first things people look at. **ACCEPT** means the traffic was allowed by the VPC packet layer at the network interface where the record was captured. **REJECT** means the traffic was rejected by security groups or NACLs at that point.

This field needs careful reading. ACCEPT at the source interface proves only that the packet was allowed at that interface. The packet could still fail later because of a missing TGW route, a blocked destination security group, a destination host firewall, an application listener problem, or a missing return path. REJECT is more direct: it points to a packet filter at the recorded interface or subnet boundary.

For the app-to-inventory incident, a CloudWatch Logs Insights query might look for the five-tuple:

```sql
fields @timestamp, interfaceId, srcAddr, dstAddr, srcPort, dstPort, protocol, action, logStatus
| filter srcAddr = "10.20.12.45"
| filter dstAddr = "10.40.8.20"
| filter dstPort = 443
| sort @timestamp desc
| limit 20
```

A result like this tells a story:

| Interface | Source | Destination | Destination port | Action | Meaning |
| --- | --- | --- | --- | --- | --- |
| `eni-0app1234567890abc` | `10.20.12.45` | `10.40.8.20` | `443` | `ACCEPT` | The app ENI allowed the outbound packet. |
| `eni-0shared1234567890` | `10.20.12.45` | `10.40.8.20` | `443` | `REJECT` | The destination side rejected the packet, likely through its security group or NACL. |

That evidence narrows the problem. The source route may be good enough for packets to reach the destination VPC. The destination packet controls need review. The next useful checks are the inventory service security group inbound rules and the shared services subnet NACL inbound and outbound rules.

Another result tells a different story:

| Interface | Source | Destination | Destination port | Action | Meaning |
| --- | --- | --- | --- | --- | --- |
| `eni-0app1234567890abc` | `10.20.12.45` | `10.40.8.20` | `443` | `ACCEPT` | The app ENI allowed outbound traffic. |
| Destination ENI | No matching record | No matching record | No matching record | No record | The packet may have stopped before the destination interface or logging may be missing there. |

Now the team checks VPC route tables, TGW route tables, TGW association and propagation, and whether Flow Logs are enabled on the destination side. Missing evidence is also evidence, but it needs care. Flow Logs have limitations. They skip some traffic types, and some records may show `SKIPDATA` if records were skipped during the aggregation interval.

The `log-status` field helps explain whether a record has normal data. **OK** means data logged normally. **NODATA** means there was no network traffic during the interval. **SKIPDATA** means some records were skipped, often because of an internal capacity constraint or internal error.

Flow Logs also skip several traffic types, including traffic to the Amazon DNS server from instances, DHCP traffic, traffic to instance metadata at `169.254.169.254`, and some other reserved or service-specific traffic. That matters during DNS or metadata investigations because the absence of a Flow Log record for those paths may be expected.

## Reachability Analyzer as Configuration Evidence
<!-- section-summary: Reachability Analyzer checks AWS network configuration for an intended source, destination, protocol, and port, then shows the path or the blocking component. -->

**Reachability Analyzer** checks whether AWS network configuration supports a path from a source resource to a destination resource. It can analyze saved AWS configuration without live application traffic. It evaluates the configuration: routes, security groups, NACLs, gateways, load balancers, transit gateways, VPC endpoints, and other supported components.

For a beginner, the useful way to think about it is: Flow Logs answer what traffic was observed, while Reachability Analyzer answers what the configuration should allow.

The source and destination must be in the same Region. They can be in the same VPC, in VPCs connected by VPC peering, or in VPCs connected through Transit Gateway. Reachability Analyzer supports sources and destinations such as EC2 instances, network interfaces, internet gateways, transit gateways, transit gateway attachments, VPC endpoints, VPC peering connections, and IP addresses as destinations. It can also include or exclude intermediate components such as load balancers, NAT gateways, AWS Network Firewall, transit gateways, and peering connections.

For the app-to-inventory incident, a CLI path analysis might start like this:

```bash
aws ec2 create-network-insights-path \
  --source eni-0app1234567890abc \
  --destination eni-0shared1234567890 \
  --protocol tcp \
  --destination-port 443
```

Then the team starts the analysis:

```bash
aws ec2 start-network-insights-analysis \
  --network-insights-path-id nip-0123456789abcdef0
```

After the analysis finishes, the team describes the result:

```bash
aws ec2 describe-network-insights-analyses \
  --network-insights-analysis-ids nia-0123456789abcdef0
```

If the destination is reachable, the result includes a path with the components involved. If the destination is unreachable, the result includes explanations. AWS publishes explanation codes such as `CANNOT_ROUTE`, `BAD_STATE_ROUTE`, and many security group, NACL, load balancer, and route-related reasons. The exact code matters less than the habit: the analysis points to the part of the AWS configuration that prevents the path.

Reachability Analyzer has a boundary. It checks AWS network configuration. Application health still needs application evidence. If the route tables and security groups allow TCP `443` to an EC2 instance, Reachability Analyzer can show the network path as reachable even when the application process is down, the certificate is wrong, or the service returns HTTP `500`. Flow Logs and application logs still matter.

![Evidence pair workflow infographic comparing Reachability Analyzer configuration evidence with VPC Flow Logs packet evidence and showing a loop to compare config and traffic](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-flow-logs-reachability-analyzer/evidence-pair-workflow.png)

*Reachability Analyzer checks the intended AWS configuration. Flow Logs show observed packet metadata. Use both together so the team can tell the difference between a missing path, a rejected packet, and an unhealthy application.*

## A Repeatable No-Connectivity Flow
<!-- section-summary: A stable troubleshooting flow moves from exact packet identity, to DNS, to source route, to hub route, to destination controls, to return path, to runtime evidence. -->

A no-connectivity incident needs a calm sequence. The sequence below works for one VPC, multiple VPCs, and TGW paths.

1. Write down the caller, hostname, resolved destination IP, destination port, protocol, and expected path.
2. Check DNS from the caller's environment and confirm the IP belongs to the intended target.
3. Check the source subnet route table for the destination IP or CIDR.
4. Check any middle route table, such as a TGW route table, route-table association, propagation, inspection VPC route, NAT gateway route, internet gateway route, or VPC endpoint route.
5. Check the destination subnet route table for the return path to the source.
6. Check security groups on the source and destination network interfaces.
7. Check NACLs for both directions, including ephemeral reply ports.
8. Check Flow Logs near the source and destination.
9. Run Reachability Analyzer for the same source, destination, protocol, and destination port.
10. Compare the packet evidence and configuration evidence.

This sequence keeps the team from changing three things at once. If DNS resolves to the wrong IP, the route-table review should wait. If Reachability Analyzer says a route table has no path to the destination, changing a security group may waste time. If Flow Logs show `REJECT` at the destination ENI, the destination packet filters deserve attention before anyone changes Transit Gateway propagation.

For the app-to-inventory incident, the flow might find this:

| Check | Finding |
| --- | --- |
| DNS | `inventory.internal.example.com` resolves to `10.40.8.20`, the intended private IP. |
| Source route | App private subnet routes `10.40.0.0/16` to TGW. |
| TGW route | App attachment is associated with `prod-rt`; `prod-rt` routes `10.40.0.0/16` to shared services attachment. |
| Destination route | Shared service subnet routes `10.20.0.0/16` back to TGW. |
| Security groups | Inventory security group allows TCP `443` only from an old app CIDR. |
| Flow Logs | Destination ENI records `REJECT` for `10.20.12.45` to `10.40.8.20:443`. |
| Reachability Analyzer | Path blocked at destination security group. |

The fix is now specific. The inventory security group needs the current app source range or source security group reference where the architecture supports it. The route design can stay out of this incident's fix.

## Wrong DNS Target
<!-- section-summary: DNS mistakes send healthy packets toward the wrong destination, so the first real check is always the IP address returned to the caller. -->

DNS issues create some of the most confusing network symptoms because the packet path may be perfectly healthy for the wrong target.

Suppose the app team expects `inventory.internal.example.com` to resolve to a private IP in the shared services VPC, `10.40.8.20`. A recent private hosted zone change accidentally returns an old Network Load Balancer address in another VPC. The app still opens TCP `443`, and route tables may still have a path to that old address. Flow Logs might show ACCEPT records. Reachability Analyzer might prove reachability to the old endpoint. The business request still fails because the app reached the wrong service.

A DNS troubleshooting table should include:

| Check | What the team wants to know |
| --- | --- |
| Caller-side resolution | What IP does the actual workload receive for the hostname? |
| Hosted zone ownership | Which private hosted zone owns the name? |
| VPC associations | Which VPCs are associated with that private hosted zone? |
| Resolver rules | Are queries forwarded to an on-premises DNS server or another resolver endpoint? |
| Endpoint private DNS | Does an interface endpoint override a public AWS service name inside the VPC? |
| Split-horizon behavior | Do laptop, VPC, and on-premises DNS clients receive different answers by design? |

Flow Logs have an important limitation here. VPC Flow Logs skip traffic from instances to the Amazon DNS server. If the workload uses the Amazon-provided resolver, the DNS query itself may be absent from Flow Logs. The application logs, container shell, resolver query logs where enabled, or controlled test commands from the workload environment can provide the answer.

For AWS service access, DNS can also decide whether traffic uses a private endpoint path. An interface endpoint with private DNS can make a normal service hostname, such as `secretsmanager.us-east-1.amazonaws.com`, resolve to private endpoint ENI addresses inside the VPC. If private DNS is disabled or a custom DNS server resolves the public AWS hostname from outside the VPC, the workload may try a NAT path instead of the endpoint path.

The clean investigation order is: hostname, caller-side answer, intended destination, then routes. Route tables can only route the IP that DNS actually returned.

## Security Group, NACL, and Route Blocks
<!-- section-summary: Security groups, NACLs, and route tables block traffic in different ways, and Flow Logs plus Reachability Analyzer help separate them. -->

Security groups, NACLs, and routes are often mentioned together, but each one has a different job.

A **route table** decides the next hop for a destination IP range. If no matching route exists, the packet has no path to that destination. A route issue usually appears in Reachability Analyzer as a route-related block, and Flow Logs may show traffic leaving one ENI with no matching record near the intended destination.

A **security group** is a stateful packet filter attached to an ENI. Stateful means AWS automatically allows response traffic for an allowed request. If a destination security group allows inbound TCP `443` from `10.20.0.0/16`, replies for that connection are allowed by the stateful behavior.

A **network ACL** is a stateless packet filter attached to a subnet. Stateless means inbound and outbound rules are evaluated separately. If a NACL allows inbound TCP `443` but blocks outbound ephemeral ports, the first request may enter the subnet and the reply may fail. Ephemeral ports are temporary high-numbered ports used by clients for return traffic.

The tools give useful clues:

| Symptom | Likely area | Evidence |
| --- | --- | --- |
| Reachability Analyzer shows `CANNOT_ROUTE` | Route table or destination mismatch | Missing or wrong destination CIDR in VPC or TGW route table |
| Flow Logs show `REJECT` on destination ENI | Destination security group or subnet NACL | Packet reached the destination side and was rejected |
| Flow Logs show `ACCEPT` on source and no destination record | Middle path, logging gap, or wrong destination | TGW route table, peering route, inspection path, or Flow Logs coverage needs review |
| SYN packets appear, no reply appears | Return route, destination listener, NACL reply path, or host firewall | Source and destination logs need comparison |
| Reachability Analyzer says reachable, app still fails | Application layer or runtime state | Service listener, TLS, authentication, application logs, health checks |

For routes, the exact match matters. Route tables use longest-prefix matching. A route for `10.40.8.0/24` is more specific than a route for `10.40.0.0/16`. If both exist, the `/24` route wins. This can surprise teams when a broad route points to TGW and a more specific stale route points somewhere else.

For security groups, the source identity matters. In same-VPC designs, teams often reference a source security group. Across VPCs and Transit Gateway paths, security group referencing has specific support boundaries and configuration requirements. CIDR-based rules are common across VPCs, so CIDR changes need security group review as well as route-table review.

For NACLs, both directions matter. A locked-down NACL for an HTTPS service may need inbound TCP `443` from the caller range and outbound ephemeral ports back to the caller range. The caller subnet NACL may need outbound TCP `443` and inbound ephemeral reply ports. The exact ephemeral range depends on operating systems and policy, so teams should use their platform standard rather than guessing during an incident.

## NAT, Internet Gateway, and Endpoint Paths
<!-- section-summary: Public egress, internet ingress, and private AWS service access each use a different path, so the troubleshooting evidence must match the intended edge. -->

Not every connectivity problem is VPC-to-VPC. Some incidents involve public egress, public ingress, or private AWS service endpoints.

A **NAT gateway** lets resources in private subnets initiate outbound IPv4 connections while keeping those resources without public IPv4 addresses. The private subnet route table usually sends `0.0.0.0/0` to the NAT gateway. The NAT gateway lives in a public subnet, and that public subnet routes internet-bound traffic to an internet gateway. Return traffic comes back through the NAT gateway to the private source.

An **internet gateway** gives a VPC a path to and from the public internet for resources with public IP addressing and the right routes. Public subnets commonly have `0.0.0.0/0` to the internet gateway. A public load balancer uses this kind of edge path.

A **VPC endpoint** gives private access to supported AWS services or endpoint services. Gateway endpoints use route-table entries for services such as S3 and DynamoDB. Interface endpoints use private endpoint ENIs and usually private DNS for AWS service names.

Each path has a different troubleshooting shape:

| Intended path | Key checks |
| --- | --- |
| Private subnet to internet through NAT | Private subnet default route to NAT, NAT subnet route to internet gateway, NAT state, security group egress, NACLs, destination availability |
| Internet to public load balancer | Public DNS target, internet gateway route, load balancer listener, target group health, security groups, NACLs |
| Private subnet to S3 gateway endpoint | Route table contains S3 prefix-list route to gateway endpoint, endpoint policy allows the action, IAM and bucket policy allow the action |
| Private subnet to AWS API interface endpoint | DNS resolves service name to endpoint ENI private IP, endpoint security group allows caller, endpoint policy and IAM allow the action |
| Private subnet to on-premises through TGW | VPC route to TGW, TGW route to hybrid attachment or inspection, on-premises route back to VPC CIDR, firewall policy |

Flow Logs can show where packets appear. For NAT paths, records may appear on the workload ENI and NAT gateway-related interfaces, with source or destination fields reflecting the intermediate layer. Custom fields such as `pkt-srcaddr` and `pkt-dstaddr` can help preserve original packet addresses. Reachability Analyzer can include NAT gateways as intermediate components, which helps confirm whether a route is expected to traverse NAT.

For VPC endpoints, a common mistake is checking only the route and missing policy. An S3 gateway endpoint route can send packets to S3 privately, while IAM, bucket policy, or endpoint policy still denies the API request. Flow Logs can show accepted network traffic, and the application still receives an AWS `AccessDenied` error. Network evidence and service authorization evidence both matter.

## Multi-VPC and Transit Gateway Paths
<!-- section-summary: TGW troubleshooting checks the source VPC route, source attachment association, TGW route, destination VPC return route, and propagation on the tables that need to know the prefixes. -->

Multi-VPC troubleshooting adds a hub to the path. The packet starts in a VPC subnet route table, enters a transit gateway attachment, uses the TGW route table associated with that attachment, exits another attachment, and then uses the destination VPC route tables.

For the app-to-shared-services flow, the investigation follows this map:

| Layer | Question |
| --- | --- |
| Source VPC subnet route | Does the app private subnet route `10.40.0.0/16` to TGW? |
| Source TGW attachment | Which attachment represents the app VPC? |
| TGW association | Which TGW route table is associated with the app attachment? |
| TGW route | Does that associated table route `10.40.0.0/16` to the shared services attachment? |
| Destination VPC route | Does the shared service subnet route `10.20.0.0/16` back to TGW? |
| Destination packet filters | Does the inventory ENI security group and subnet NACL allow the flow? |
| Return TGW path | Does the shared services attachment's associated route table contain a route back to `10.20.0.0/16`? |

Association and propagation deserve special care. The app attachment may propagate its `10.20.0.0/16` CIDR into `shared-rt`, but traffic from app uses only the route table associated with the app attachment. Propagation simply installs routes into route tables where other attachments may need them.

For hybrid paths, the on-premises side adds another route domain. The corporate router or firewall must know how to return traffic to the AWS VPC CIDRs. If Direct Connect or VPN uses BGP, route advertisements and filters need review. If static routing is used, the static route on the customer gateway side must match the AWS CIDR. A perfect TGW route table still leaves an outage when the on-premises return route points somewhere else.

Inspection VPCs add symmetry requirements. If the intended path sends app-to-on-premises traffic through security inspection, the return path should come back through the same inspection design. Reachability Analyzer can include or exclude intermediate components, which helps test whether the path goes through the intended Transit Gateway, attachment, firewall, or NAT component.

## Using Both Tools Together
<!-- section-summary: Flow Logs and Reachability Analyzer work best as a pair: one shows observed traffic, and the other checks intended configuration. -->

The strongest troubleshooting pattern is pairing evidence.

Flow Logs can say, "I saw traffic from `10.20.12.45` to `10.40.8.20` on TCP `443`, and the action was REJECT at the destination ENI." Reachability Analyzer can say, "The path from the app ENI to the inventory ENI on TCP `443` is blocked by this security group rule." Those two facts point to the same fix.

Flow Logs can also say, "I saw outbound ACCEPT records at the source, but nothing at the destination." Reachability Analyzer can say, "The source attachment's associated TGW route table has no route to the destination CIDR." Those two facts move the investigation toward Transit Gateway routing.

Sometimes the tools disagree in a useful way:

| Flow Logs | Reachability Analyzer | Likely meaning |
| --- | --- | --- |
| No traffic observed | Reachable | The application might be idle, DNS may point elsewhere, or logging is enabled on the wrong interface. |
| ACCEPT at source and destination | Reachable | The network path likely works; application listener, TLS, auth, or health should be checked. |
| REJECT at destination | Blocked by security group or NACL | Packet filter fix is likely. |
| ACCEPT at source only | Blocked by route or middle component | Route, TGW, peering, inspection, or NAT path needs review. |
| SKIPDATA | Any result | Flow Log data may be incomplete for that interval; another source of evidence helps. |

During a production incident, a written note with three lines is often enough to keep everyone aligned:

| Evidence type | Current finding |
| --- | --- |
| Five-tuple | `10.20.12.45:51544 -> 10.40.8.20:443`, TCP |
| Flow Logs | Source ACCEPT, destination REJECT |
| Reachability Analyzer | Blocked at inventory service security group |

This note prevents the team from debating NAT gateways, DNS, and TGW propagation after the evidence has narrowed the issue to a destination security group.

## Common Production Mistakes
<!-- section-summary: Most AWS connectivity incidents come from wrong DNS answers, missing return routes, stale CIDRs, incomplete Flow Log coverage, and treating accepted packets as application success. -->

**Wrong DNS answer** sends traffic to the wrong IP. The fix starts with caller-side DNS evidence. The hostname must resolve to the intended private endpoint, load balancer, service endpoint, or on-premises target from the workload's actual environment.

**Missing return route** makes one-way traffic look like a timeout. The source route can be correct while the destination VPC, TGW route table, or on-premises router lacks the path back to the source CIDR.

**Destination security group drift** appears after CIDR changes or service migrations. A new app VPC CIDR may be routed correctly but still blocked because the destination security group allows the old range.

**NACL ephemeral port blocks** happen when subnet ACLs are locked down without allowing return traffic. Security groups are stateful. NACLs are stateless. That difference matters every time a reply uses an ephemeral port.

**TGW association confusion** happens when teams look at the wrong route table. Traffic from an attachment uses the route table associated with that attachment. A route in another TGW route table helps only if the source attachment uses that table or another attachment needs that propagated return route.

**Endpoint policy confusion** happens when private AWS service access is treated as only networking. S3 gateway endpoint policy, interface endpoint policy, IAM policy, and resource policy can all participate in the final allow or deny decision.

**Flow Log coverage gaps** slow incidents. If only source VPC logs exist, the destination side may stay invisible. Critical paths should have Flow Logs enabled on the VPCs, subnets, or ENIs where responders need evidence.

**Treating ACCEPT as application success** sends people in the wrong direction. ACCEPT means the VPC packet layer allowed the traffic at that point. The service can still reject the request at TLS, HTTP, IAM, database authentication, or application authorization layers.

**Ignoring log limitations** creates false assumptions. Flow Logs skip some traffic, including traffic to the Amazon DNS server, DHCP, instance metadata, and other reserved paths. `SKIPDATA` means the interval may have incomplete records.

## Final Runbook
<!-- section-summary: The final runbook turns the article into a short investigation pattern for AWS VPC, endpoint, NAT, internet, hybrid, and TGW incidents. -->

Here is the repeatable runbook for the last article in this networking module.

1. Capture the exact caller, hostname, resolved destination IP, destination port, protocol, and expected path.
2. Confirm DNS from the caller's environment and verify that the returned IP belongs to the intended target.
3. Review the source subnet route table for the resolved destination IP.
4. Review middle routing components: Transit Gateway route table association, propagation, static routes, peering routes, NAT routes, internet gateway routes, endpoint routes, inspection paths, and hybrid advertisements.
5. Review the destination subnet route table and return route to the source CIDR.
6. Review source and destination security groups.
7. Review subnet NACLs for both request and reply directions.
8. Query Flow Logs near the source and destination for the same five-tuple.
9. Run Reachability Analyzer for the same source, destination, protocol, and port.
10. Compare observed packet evidence with configuration analysis.
11. Apply the smallest fix that matches the evidence.
12. Record the corrected route, rule, DNS answer, or policy so the next responder can use the same evidence.

This workflow works because it treats AWS networking as connected pieces with separate evidence. DNS gives the IP. Route tables pick the next hop. Transit Gateway route tables pick the next attachment. Security groups and NACLs filter packets. NAT, internet gateways, VPC endpoints, inspection appliances, VPNs, and Direct Connect add path-specific details. Flow Logs show packet evidence. Reachability Analyzer shows configuration evidence. Together, they give a practical way to move from "it timed out" to the exact component that needs attention.

![AWS connectivity runbook summary board covering DNS answer, source route, hub route, packet controls, return path, and runtime evidence](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-flow-logs-reachability-analyzer/aws-connectivity-runbook.png)

*The final troubleshooting habit is steady and small: confirm the DNS answer, follow the source route, inspect the hub route, verify packet controls, prove the return path, and then check runtime evidence.*

**References**

- [Logging IP traffic using VPC Flow Logs - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html)
- [Flow log records - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/userguide/flow-log-records.html)
- [Flow log limitations - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs-limitations.html)
- [What is Reachability Analyzer? - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/reachability/what-is-reachability-analyzer.html)
- [How Reachability Analyzer works - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/reachability/how-reachability-analyzer-works.html)
- [Getting started with Reachability Analyzer - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/reachability/getting-started.html)
- [Reachability Analyzer explanation codes - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/reachability/explanation-codes.html)
