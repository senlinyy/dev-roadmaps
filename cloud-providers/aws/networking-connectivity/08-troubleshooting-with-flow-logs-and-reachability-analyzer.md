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

1. [Start With One Timeout](#start-with-one-timeout)
2. [Write the Flow Down](#write-the-flow-down)
3. [Flow Logs Show Packet Evidence](#flow-logs-show-packet-evidence)
4. [Reachability Analyzer Checks Configuration](#reachability-analyzer-checks-configuration)
5. [A Repeatable Investigation](#a-repeatable-investigation)
6. [Common AWS Network Failures](#common-aws-network-failures)
7. [Final Runbook](#final-runbook)
8. [References](#references)

## Start With One Timeout
<!-- section-summary: Network incidents become easier to investigate when the team reduces a broad outage report to one exact source, destination, port, and protocol. -->

The receipts company now has an app VPC, shared services VPC, analytics VPC, security VPC, and on-premises support network. One morning, the receipts API starts timing out when it calls `inventory.shared.internal`. The app team sees a timeout. The network team sees many possible causes: DNS, source routes, Transit Gateway route tables, return routes, security groups, NACLs, firewall inspection, endpoint policy, or a listener problem on the inventory service.

The first move is to shrink the incident to one failed flow. We will use the API task in the app VPC calling the inventory service in the shared services VPC on TCP `443`. That single flow can be checked in DNS, route tables, Flow Logs, Reachability Analyzer, security groups, and application logs.

Two AWS tools help here. **VPC Flow Logs** show packet metadata that AWS observed at a network interface, subnet, or VPC. **Reachability Analyzer** reads supported AWS network configuration and reports whether that configuration permits a path between a source and a destination. Flow Logs show what happened during traffic. Reachability Analyzer explains what the current configuration allows.

These tools work best after the flow is named. A vague inventory timeout report leaves too much room for guessing. "`eni-0app1234567890abc` at `10.20.12.45` tried to reach `10.40.8.20` on TCP `443`" gives everyone a flow that can be checked hop by hop.

## Write the Flow Down
<!-- section-summary: Every investigation starts by recording the hostname, resolved IP, source ENI, source IP, destination port, and protocol. -->

Before opening five AWS console tabs, write the flow down. DNS names and chat messages are useful hints, but troubleshooting needs the actual source and destination that the network sees.

For the inventory incident, the evidence sheet can look like this:

| Item | Example |
| --- | --- |
| Source runtime | ECS task in app private subnet |
| Source ENI | `eni-0app1234567890abc` |
| Source IP | `10.20.12.45` |
| Hostname | `inventory.shared.internal` |
| Resolved IP | `10.40.8.20` |
| Destination port | `443` |
| Protocol | TCP |
| Expected route path | App VPC to Transit Gateway to shared services VPC |

The source port will be temporary, often in an ephemeral range such as `51544`. Flow Logs record it, and stateless NACLs may need to allow return traffic to that ephemeral port range. Security groups track connection state, while NACLs evaluate inbound and outbound rules independently.

The DNS check should come from the workload path:

```bash
getent hosts inventory.shared.internal
```

Example output:

```console
10.40.8.20 inventory.shared.internal
```

This output tells you the app sees the intended private inventory address. The next action is route and packet evidence. If the output returned a public address, an old private address, or no answer, the next action would be Route 53 private hosted zones, Resolver rules, endpoint private DNS, or the application resolver path.

For containers and serverless workloads, the closest test usually wins. A bastion in the same VPC can help, but it may use a different subnet, security group, DHCP option set, or resolver path. When the test location differs from the failing runtime, write that difference down so later evidence stays honest.

![The five-tuple view shows the exact source, destination, ports, and protocol that should be written down before opening every AWS console page](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-flow-logs-reachability-analyzer/five-tuple-first.png)

*The five-tuple view shows the exact source, destination, ports, and protocol that should be written down before opening every AWS console page.*


## Flow Logs Show Packet Evidence
<!-- section-summary: VPC Flow Logs show packet metadata such as addresses, ports, action, and log status after traffic reaches the VPC network layer. -->

**VPC Flow Logs** capture metadata about IP traffic going to and from network interfaces, subnets, or VPCs. They can publish to CloudWatch Logs, S3, or Kinesis Data Firehose. A record can include source address, destination address, ports, protocol, packet count, byte count, action, and log status.

The two fields people look at first are `action` and `logStatus`. `ACCEPT` means the VPC packet layer accepted the packet. The application can still fail after that because TLS, listener health, credentials, or service logic can reject the request. `REJECT` means the VPC packet layer rejected the packet, commonly because of security groups or NACLs. `SKIPDATA` means AWS skipped some records during the capture interval, so the evidence has a gap.

A CloudWatch Logs Insights query for the inventory destination can look like this:

```sql
fields @timestamp, interfaceId, srcAddr, srcPort, dstAddr, dstPort, protocol, action, logStatus
| filter dstAddr = '10.40.8.20' and dstPort = 443
| sort @timestamp desc
| limit 20
```

This query asks CloudWatch Logs for recent records where the destination is the inventory IP and the destination port is HTTPS. It includes the interface ID so you can tell whether the record came from the source ENI, destination ENI, NAT, firewall, or another network interface.

Healthy request records might look like this in Logs Insights:

| @timestamp | interfaceId | srcAddr | srcPort | dstAddr | dstPort | protocol | action | logStatus |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-06-27 10:20:18 | `eni-0app1234567890abc` | `10.20.12.45` | `51544` | `10.40.8.20` | `443` | `6` | `ACCEPT` | `OK` |
| 2026-06-27 10:20:18 | `eni-0inv9876543210def` | `10.40.8.20` | `443` | `10.20.12.45` | `51544` | `6` | `ACCEPT` | `OK` |

Protocol `6` means TCP. These two rows show request and response packet metadata accepted by the VPC layer. If the application still times out with evidence like this, the next action moves away from basic network filtering and toward inventory listener health, TLS negotiation, target group health, firewall inspection state, or application logs.

A rejected destination record points to a different next action:

| @timestamp | interfaceId | srcAddr | srcPort | dstAddr | dstPort | protocol | action | logStatus |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-06-27 10:22:41 | `eni-0inv9876543210def` | `10.20.12.45` | `51602` | `10.40.8.20` | `443` | `6` | `REJECT` | `OK` |

This row says the packet reached the inventory ENI and the VPC layer rejected it there. The next action is the destination security group and destination subnet NACL. If the source record is `ACCEPT` and no destination record appears, the next action is route path, Transit Gateway routing, inspection VPC logging coverage, or whether Flow Logs exist on the destination side.

Flow Logs show metadata rather than payload. They can tell you that TCP `443` was accepted. HTTP request paths, TLS certificate matching, IAM authorization, and application `500` responses need service logs and application evidence.

## Reachability Analyzer Checks Configuration
<!-- section-summary: Reachability Analyzer checks supported AWS network configuration and reports the path or blocking component for a specific source and destination. -->

**Reachability Analyzer** analyzes AWS network configuration for a source, destination, protocol, and port. It can show a hop-by-hop reachable path or explain which component blocks the path. It is useful when traffic is hard to generate, intermittent, or missing from Flow Logs.

For the inventory incident, create a path from the API task ENI to the inventory service ENI on TCP `443`. The source and destination can be ENIs, instances, gateways, load balancers, Transit Gateway attachments, and other supported resources depending on the path. The more precise the resources, the more useful the result.

A CLI flow has two steps. First, define the path:

```bash
aws ec2 create-network-insights-path \
  --source eni-0app1234567890abc \
  --destination eni-0inv9876543210def \
  --protocol tcp \
  --destination-port 443 \
  --region eu-west-2
```

```json
{
  "NetworkInsightsPath": {
    "NetworkInsightsPathId": "nip-0123456789abcdef0",
    "Source": "eni-0app1234567890abc",
    "Destination": "eni-0inv9876543210def",
    "Protocol": "tcp",
    "DestinationPort": 443
  }
}
```

The path ID is the reusable definition of the question. It says "can this source ENI reach this destination ENI on TCP `443`?" Second, start an analysis for that path:

```bash
aws ec2 start-network-insights-analysis \
  --network-insights-path-id nip-0123456789abcdef0 \
  --region eu-west-2
```

```json
{
  "NetworkInsightsAnalysis": {
    "NetworkInsightsAnalysisId": "nia-0abc1111222233334",
    "NetworkInsightsPathId": "nip-0123456789abcdef0",
    "Status": "running"
  }
}
```

After the analysis finishes, inspect the result:

```bash
aws ec2 describe-network-insights-analyses \
  --network-insights-analysis-ids nia-0abc1111222233334 \
  --region eu-west-2 \
  --query 'NetworkInsightsAnalyses[0].{Status:Status,Found:NetworkPathFound,Explanations:Explanations[*].ExplanationCode}'
```

```json
{
  "Status": "succeeded",
  "Found": false,
  "Explanations": [
    "ENI_SG_RULES_MISMATCH"
  ]
}
```

This result says the analysis completed and did not find a permitted path. `ENI_SG_RULES_MISMATCH` points to security group rules on one of the ENIs. The next action is comparing the app source and inventory destination security groups for TCP `443`, then rerunning the same analysis after the rule change.

A reachable result drives a different next action:

```json
{
  "Status": "succeeded",
  "Found": true,
  "Explanations": []
}
```

This result says the supported AWS network configuration permits the path. If users still see a timeout, check live packet evidence, service listener health, target group health, TLS, application logs, and any appliances or systems outside Reachability Analyzer's supported modeling for your path.

The pairing is powerful. Flow Logs can show `REJECT` while Reachability Analyzer names the blocking security group. Reachability Analyzer can say a path is reachable while Flow Logs show no traffic, which points back to DNS, application behavior, missing traffic generation, or logging scope.

![The evidence pair view shows how Flow Logs and Reachability Analyzer answer different parts of the same connectivity question](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-flow-logs-reachability-analyzer/evidence-pair-workflow.png)

*The evidence pair view shows how Flow Logs and Reachability Analyzer answer different parts of the same connectivity question.*


## A Repeatable Investigation
<!-- section-summary: A repeatable investigation separates DNS, source route, hub route, return route, packet filters, endpoint policy, and service health. -->

Use the same order each time. Start with the name and resolved IP. Then find the source ENI and source subnet. Inspect the source subnet route table and match the destination IP to the best route. Inspect the Transit Gateway, peering, endpoint, NAT, or internet gateway path if the route points to one. Then inspect the return path from destination back to source.

A source route table command can look like this:

```bash
aws ec2 describe-route-tables \
  --filters Name=association.subnet-id,Values=subnet-0appprivate \
  --region eu-west-2 \
  --query 'RouteTables[0].Routes[*].{Destination:DestinationCidrBlock,PrefixList:DestinationPrefixListId,Gateway:GatewayId,Nat:NatGatewayId,Tgw:TransitGatewayId,Endpoint:VpcEndpointId,State:State}'
```

```json
[
  {
    "Destination": "10.40.0.0/16",
    "PrefixList": null,
    "Gateway": null,
    "Nat": null,
    "Tgw": "tgw-0123456789abcdef0",
    "Endpoint": null,
    "State": "active"
  },
  {
    "Destination": "0.0.0.0/0",
    "PrefixList": null,
    "Gateway": null,
    "Nat": "nat-0egress111111111",
    "Tgw": null,
    "Endpoint": null,
    "State": "active"
  }
]
```

The destination IP `10.40.8.20` fits `10.40.0.0/16`, so the next hop is the Transit Gateway. The `0.0.0.0/0` NAT route is less specific, so this private shared services flow should use the TGW route. The next action is the source TGW attachment association and TGW route table entry for `10.40.0.0/16`.

For endpoint paths, DNS and endpoint policy join the route review. A Secrets Manager endpoint can have healthy ENIs while the endpoint policy blocks the task role's action. An S3 gateway endpoint can exist while the app subnet route table lacks the endpoint association. A service error such as `AccessDeniedException` points to policy layers; a timeout points to route, DNS, security group, NACL, endpoint ENI, or listener behavior.

For NAT and internet gateway paths, include the edge resource. A private subnet egress issue needs the private subnet route, NAT gateway state, NAT public subnet route, internet gateway attachment, security group egress, NACLs, and any external allowlist. An internet-facing load balancer issue needs public DNS, listener config, target group health, public subnet routes, security groups, NACLs, and application health.

For Transit Gateway paths, add the hub route check. The source VPC route table must point to the Transit Gateway. The source attachment must be associated with the TGW route table you inspect. That TGW route table must send the destination CIDR to the destination or inspection attachment. The destination VPC route table must return traffic to the source CIDR.

## Common AWS Network Failures
<!-- section-summary: Common AWS connectivity failures come from wrong DNS answers, missing return routes, security group mismatches, stale CIDRs, and overreading ACCEPT records. -->

Wrong DNS answers are common. The app asks for the right name, but the VPC resolver returns a public address because endpoint private DNS is off, a private hosted zone lacks the VPC association, or a forwarding rule sends the query to the wrong DNS server. DNS evidence comes before route table edits.

Missing return routes are common in peering, Transit Gateway, VPN, Direct Connect, and inspection designs. The request route exists, and the response route points somewhere else or nowhere useful. Flow Logs may show request records without matching response records. The next action is the destination subnet route table, TGW return route table, VPN route, Direct Connect advertisement, or firewall return path.

Security group and NACL mismatches often show up as Flow Log `REJECT` records. NACL problems frequently involve ephemeral ports because NACLs are stateless. Security group problems often involve a missing inbound rule on the destination or a missing egress rule on locked-down sources. The next action is matching the Flow Log interface ID to the ENI, then reading the rules attached to that ENI and subnet.

Accepted packets can still end in failure. The listener might be closed. TLS might fail. The database might reject credentials. The application might have no healthy targets. Treat `ACCEPT` as network-layer evidence, then continue into service-level checks instead of stopping the investigation early.

Transit Gateway association confusion is another common failure. Teams sometimes inspect a TGW route table that contains the correct destination route while the source attachment uses a different associated route table. The next action is always the source attachment association, then the route search inside that exact TGW route table.

Flow Log coverage can also mislead responders. Flow Logs may exist on the app VPC while shared services VPC lacks destination logging. The next action is checking Flow Log scope before using missing records as evidence.

## Final Runbook
<!-- section-summary: The final runbook gives a short investigation pattern for VPC, endpoint, NAT, internet, hybrid, and TGW incidents. -->

Use this runbook for each incident:

1. Name one flow with source runtime, source ENI, source IP, hostname, resolved IP, destination port, and protocol.
2. Confirm DNS from the same runtime path as the workload.
3. Find the source subnet route table and match the destination IP to the best route.
4. Check the destination return route, including Transit Gateway, peering, VPN, Direct Connect, or inspection route tables.
5. Check security groups and NACLs in both directions.
6. Check endpoint policy, NAT gateway state, internet gateway attachment, firewall policy, or load balancer target health when those services sit in the path.
7. Query Flow Logs for `ACCEPT`, `REJECT`, and `SKIPDATA` evidence on the relevant ENIs or subnets.
8. Run Reachability Analyzer for configuration evidence on the same source, destination, protocol, and port.
9. When the network path is accepted, continue to listener health, TLS, credentials, target health, and application logs.

Record the final fix with the evidence. A useful incident note might say: "API task `eni-0app1234567890abc` at `10.20.12.45` to inventory `10.40.8.20:443` failed because `tgw-rtb-app` lacked a route to `10.40.0.0/16`. Added static route to the shared services attachment, verified Reachability Analyzer found a path, and confirmed Flow Logs `ACCEPT` in both directions."

That note helps the next responder. It names the flow, the failed hop, the exact fix, and the verification evidence. After one flow is understood, repeat the same steps for the next timeout instead of making broad route or security changes across the network.

![The runbook summary turns DNS, routes, Flow Logs, Reachability Analyzer, security controls, and service health into a repeatable debugging path](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-flow-logs-reachability-analyzer/aws-connectivity-runbook.png)

*The runbook summary turns DNS, routes, Flow Logs, Reachability Analyzer, security controls, and service health into a repeatable debugging path.*


## References

- [Amazon VPC documentation: VPC Flow Logs](https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html)
- [Amazon VPC documentation: Flow log records](https://docs.aws.amazon.com/vpc/latest/userguide/flow-log-records.html)
- [Amazon VPC documentation: Reachability Analyzer](https://docs.aws.amazon.com/vpc/latest/reachability/what-is-reachability-analyzer.html)
- [Amazon VPC documentation: Reachability Analyzer explanation codes](https://docs.aws.amazon.com/vpc/latest/reachability/explanation-codes.html)
- [AWS Transit Gateway documentation](https://docs.aws.amazon.com/vpc/latest/tgw/what-is-transit-gateway.html)
