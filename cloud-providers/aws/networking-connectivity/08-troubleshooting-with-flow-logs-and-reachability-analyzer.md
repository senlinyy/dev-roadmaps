---
title: "Troubleshooting with Flow Logs and Reachability Analyzer"
description: "Use exact packet flows, VPC Flow Logs, Reachability Analyzer, and application evidence to diagnose AWS connectivity without guessing."
overview: "Flow Logs record traffic AWS observed, while Reachability Analyzer models what supported AWS configuration should permit. This article combines those evidence types with DNS, routes, return paths, security controls, load balancers, NAT, Transit Gateway, and application diagnostics."
tags: ["aws", "vpc", "flow-logs", "reachability-analyzer", "network-troubleshooting"]
order: 8
id: article-cloud-providers-aws-networking-connectivity-flow-logs-reachability-analyzer
aliases:
  - troubleshooting-with-flow-logs-and-reachability-analyzer
  - flow-logs-and-reachability-analyzer
  - network-troubleshooting
---

## Table of Contents

1. [How Do You Turn a Timeout Into a Packet?](#how-do-you-turn-a-timeout-into-a-packet)
2. [What Must Be True for the Connection to Work?](#what-must-be-true-for-the-connection-to-work)
3. [What Does Reachability Analyzer Prove?](#what-does-reachability-analyzer-prove)
4. [How Do the Two Evidence Sources Work Together?](#how-do-the-two-evidence-sources-work-together)
5. [What Is a Repeatable Investigation?](#what-is-a-repeatable-investigation)
6. [Which Routing and Filtering Failures Are Common?](#which-routing-and-filtering-failures-are-common)
7. [When Should You Stop Changing the Network?](#when-should-you-stop-changing-the-network)
8. [What Is the Final Troubleshooting Runbook?](#what-is-the-final-troubleshooting-runbook)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

AWS connectivity is easier to diagnose when you replace the broad question "Can A talk to B?" with:

> What exact packet did the client try to send, which decisions should AWS make for it, and at which decision does observed reality differ from the model?

That distinction explains why two tools complement one another:

- **VPC Flow Logs** provide evidence about traffic AWS networking actually observed.
- **Reachability Analyzer** reasons about whether supported AWS configuration permits a hypothetical packet to travel from a source to a destination.

Reachability Analyzer builds a configuration model. It does not transmit test packets through the data plane.

The sections below answer these questions in order:

1. **How Do You Turn a Timeout Into a Packet?**
2. **What Must Be True for the Connection to Work?**
3. **What Does Reachability Analyzer Prove?**
4. **How Do the Two Evidence Sources Work Together?**
5. **What Is a Repeatable Investigation?**
6. **Which Routing and Filtering Failures Are Common?**
7. **When Should You Stop Changing the Network?**
8. **What Is the Final Troubleshooting Runbook?**

## How Do You Turn a Timeout Into a Packet?
<!-- section-summary: A useful incident statement records the exact source and destination addresses, source and destination ports, and protocol. -->

Suppose an application on `10.0.1.25` needs TCP `443` on `10.0.8.40`. AWS networking does not reason about a product label such as "frontend calls payments." At the IP layer, it sees values like:

```text
Source IP:        10.0.1.25
Source port:      49152
Destination IP:   10.0.8.40
Destination port: 443
Protocol:         TCP
```

Together, these values form the **5-tuple**:

```text
(source IP, destination IP,
 source port, destination port,
 protocol)
```

![The five-tuple view shows the exact source, destination, ports, and protocol that should be written down before opening every AWS console page](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-flow-logs-reachability-analyzer/five-tuple-first.png)

*An exact tuple gives route tables, policies, logs, and analyzers one consistent question to answer.*

Different AWS components use different parts of that tuple. A route table selects a next hop primarily from the destination IP. A security group compares protocol, port, and source or destination permission. A NACL evaluates packet fields at a subnet boundary. NAT can change source address and port. A load balancer terminates one connection and starts another toward a target.

Before opening AWS consoles, write the exact flow:

```text
SOURCE
Resource: i-client
IP:       10.0.1.25

DESTINATION
Resource: i-server
IP:       10.0.8.40
Port:     443
Protocol: TCP
```

If the application starts with a hostname, resolve it from the failing runtime. Do not assume the name maps to the address in your diagram.

Then write the expected packet path. A same-VPC path might be:

```text
client ENI → source subnet → local VPC routing
           → destination subnet → server ENI
```

A cross-VPC path might be:

```text
client ENI → source subnet route table
           → TGW attachment → TGW route table
           → destination attachment → destination subnet
           → server ENI
```

This is the **expected packet story**. It is a logical troubleshooting model, not a claim that physical appliances are lined up in exactly that visual order.

## What Must Be True for the Connection to Work?
<!-- section-summary: DNS, routes, filtering, intermediate systems, destination state, and an independently valid return path must all agree. -->

A successful connection can depend on many independent conditions:

```text
name
  ↓
address
  ↓
route
  ↓
network policy
  ↓
intermediate devices
  ↓
destination policy
  ↓
destination host
  ↓
application
  ↓
return path
```

Failure anywhere can appear as `connection timed out`. The symptom does not inherently mean a security-group problem. It can mean a wrong DNS answer, wrong address or port, missing or misassociated route, SG or NACL rejection, NAT issue, TGW route error, unhealthy load-balancer target, host firewall, closed listener, overload, or broken return path.

TCP requires both directions. The client sends:

```text
10.0.1.25:49152 → 10.0.8.40:443  SYN
```

The server must return:

```text
10.0.8.40:443 → 10.0.1.25:49152  SYN-ACK
```

The client completes:

```text
10.0.1.25:49152 → 10.0.8.40:443  ACK
```

Connectivity is `A → B` **and** `B → A`.

Security groups are stateful, so they recognize return traffic for an allowed connection. NACLs are stateless, so the reply independently needs a matching direction and often an ephemeral destination-port rule.

A NACL can allow inbound TCP `443` yet block the server response to client port `49152`. The forward packet arrives, the reply disappears, and the client reports a timeout. This is why an investigation must describe a conversation, not only the server destination.

### What Do VPC Flow Logs Prove?
<!-- section-summary: Flow Logs provide aggregated metadata about observed flows and their ACCEPT or REJECT result at a logging point, not packet payloads or application success. -->

Imagine standing beside a VPC interface and recording:

```text
AWS observed traffic from A to B
using this protocol and these ports
during this interval
and accepted or rejected it here.
```

That is approximately the role of a VPC Flow Log.

It is not a packet-capture tool such as Wireshark. Flow Logs normally do not contain HTTP paths, request bodies, authorization headers, or TLS payloads. They provide flow metadata such as source and destination addresses, ports, protocol, packet and byte counts, times, interface information, and action. Custom formats can include richer metadata.

A conceptual record is:

```text
srcaddr  = 10.0.1.25
dstaddr  = 10.0.8.40
srcport  = 49152
dstport  = 443
protocol = 6
action   = ACCEPT
```

Protocol `6` represents TCP.

`ACCEPT` establishes that AWS networking accepted the observed flow at the point represented by the record. It does not establish that:

- the complete end-to-end conversation succeeded;
- a process was listening on port `443`;
- TLS negotiation succeeded;
- the application returned HTTP `200`; or
- the application processed the request correctly.

A packet can reach a host that has no listener and receive a TCP reset. Network policy accepted the flow while the website still failed.

`REJECT` narrows the investigation more strongly:

```text
10.0.1.25:49152 → 10.0.8.40:443 REJECT
```

AWS rejected that traffic at the logged VPC layer. Security groups and NACLs are common causes, although other conditions can also produce rejected records. Inspect the exact source, destination, port, protocol, direction, and interface.

The exact source matters because the architecture diagram can differ from the packet. A proxy, load balancer, NAT device, or firewall can make the destination observe a different source than the engineer expected.

Flow Logs are aggregated, delayed, and delivered on a best-effort basis. Records can be skipped. Some traffic, including certain AWS-provided DNS, DHCP, instance-metadata, and other special traffic, is excluded.

Therefore no log entry does not prove no packet existed. It can mean the application sent nothing, DNS chose another address, the wrong ENI or time was searched, the traffic type was excluded, the record has not arrived, delivery skipped it, or logging was not enabled at the relevant scope.

> Flow Logs are evidence, not omniscience.

## What Does Reachability Analyzer Prove?
<!-- section-summary: Reachability Analyzer performs static reasoning over supported AWS network configuration for a hypothetical source, destination, protocol, and port. -->

Reachability Analyzer begins with a different question:

> Given current AWS configuration, should this modeled flow have a valid path?

Specify a source, destination, protocol, and destination port. The analyzer builds a model of supported AWS network components and evaluates the constraints along the path. It does not send packets or inspect the live data plane.

Think of it as a compiler for the network design. Connectivity requires constraints such as:

```text
route exists
AND source policy permits the flow
AND intermediate path exists
AND destination policy permits the flow
AND required gateway and attachment configuration is valid
```

When a constraint fails, the analyzer tries to identify the blocking component, such as a route table, security group, NACL, NAT gateway, load balancer, Transit Gateway, Network Firewall, or peering resource within its supported model.

```text
source
  ↓ route table
Transit Gateway
  X missing TGW route
destination
```

This can replace a long manual search through several route tables with an explanation that the modeled path stops at that route.

`REACHABLE` means the supported AWS configuration is compatible with the specified connection. It does not prove that the application runs, the operating-system firewall permits it, the process listens, the service is healthy, TLS is correct, DNS returned the modeled destination, or no transient data-plane problem exists.

Reachability Analyzer also does not account for load-balancer target health. A network path to the load balancer can be modeled as reachable while every registered target is unhealthy.

There is no contradiction when Reachability Analyzer says reachable and `curl` fails. The tools are making different claims.

## How Do the Two Evidence Sources Work Together?
<!-- section-summary: Analyzer output describes configuration implications, while Flow Logs describe observed traffic, so their combinations eliminate different hypotheses. -->

The tools answer complementary questions:

| Question | Best evidence |
|---|---|
| Should supported AWS configuration permit the path? | Reachability Analyzer |
| Which modeled component blocks it? | Reachability Analyzer |
| Did AWS observe traffic at a logging point? | Flow Logs |
| Was that observed flow accepted or rejected? | Flow Logs |
| Did DNS return the expected destination? | DNS tools and Resolver evidence |
| Was a service listening? | Host and service diagnostics |
| Did TLS or HTTP succeed? | Client, TLS, access, and application logs |

The important question is not which one tool to choose. It is which uncertainty you are removing.

### Not reachable

If Reachability Analyzer reports not reachable, focus on the modeled AWS configuration. Follow its blocking explanation: missing route, SG mismatch, NACL restriction, TGW route, peering, or firewall policy.

### Reachable plus REJECT

First prove that the analyzer and log describe the same packet. Compare source and destination IPs, ports, protocol, direction, time, and actual ENIs. One may model `frontend → backend` while the log shows a different destination produced by DNS or a different connection made by a load balancer. Unsupported or dynamic aspects can also create differences.

Compare exact tuples, not vague service labels.

### Reachable plus ACCEPT

Basic AWS routing and filtering become a weaker hypothesis. Move upward: listener, host firewall, target health, TLS, HTTP, application behavior, and dependencies.

![The evidence pair view shows how Flow Logs and Reachability Analyzer answer different parts of the same connectivity question](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-flow-logs-reachability-analyzer/evidence-pair-workflow.png)

*Configuration analysis predicts a supported path; observed flow evidence tests whether a matching packet appeared and how AWS treated it.*

### Reachable with no Flow Logs

Ask whether the client actually sent traffic. Verify DNS, application configuration, environment, destination, logging scope, excluded traffic, and delivery timing. This combination often reveals that the presumed network request never occurred or went somewhere else.

## What Is a Repeatable Investigation?
<!-- section-summary: A controlled test compares one exact packet prediction with static analysis and observed flow evidence before moving to higher layers. -->

Suppose users report, "The frontend cannot reach the API." Turn it into:

```text
source ENI 10.0.1.25
must establish TCP
to destination 10.0.8.40
port 443
```

Then follow a repeatable sequence.

### Confirm the intended tuple

Identify source, destination, protocol, and destination port. Resolve the hostname from the source runtime. Do not assume `api.internal.example.com` means the IP in a document.

### Write the expected path

For example:

```text
frontend ENI
  → frontend subnet route
  → TGW attachment and TGW table
  → API VPC attachment
  → API subnet and ENI
```

Include the response path.

### Analyze the configuration

Ask Reachability Analyzer whether the supported AWS model allows this exact source, destination, protocol, and port. If it reports a blocker such as no route, subnet ACL restriction, or security-group mismatch, fix that component and analyze again.

### Generate controlled traffic

Run an appropriate test from the actual or equivalent source:

```bash
curl -v https://api.internal.example.com
```

or:

```bash
nc -vz 10.0.8.40 443
```

Record the time so the flow can be correlated.

### Search the logs

Use the exact tuple or as much of it as known:

```text
srcaddr = 10.0.1.25
dstaddr = 10.0.8.40
dstport = 443
protocol = TCP
```

Ask whether the request appears, where it appears, whether the action is ACCEPT or REJECT, and whether response traffic appears.

### Move to the correct layer

If AWS configuration permits the path and accepted traffic arrives, stop broadening VPC network policy. Inspect the host firewall, listener, load-balancer target health, TLS, HTTP, application logs, and dependencies.

This prevents troubleshooting changes from expanding access without addressing the real failure.

## Which Routing and Filtering Failures Are Common?
<!-- section-summary: Common failures include SG and NACL mismatches, wrong route associations, more-specific routes, mistaken NAT expectations, and labels that do not match configuration. -->

### Security-group mismatch

The client uses `sg-client`, but the server group has no matching inbound TCP `443` permission. Reachability Analyzer can identify the configuration mismatch, while a destination Flow Log can show `REJECT`. Together they form a high-confidence diagnosis.

### NACL return traffic

The inbound NACL permits client ephemeral port `49152 → server 443`, but its outbound side does not permit `server 443 → client 49152`. The SYN arrives, the SYN-ACK is blocked, and the client waits. Checking only "443 is allowed" misses the response's ephemeral destination port.

### Wrong route-table association

A route table contains `10.20.0.0/16 → TGW`, but the source subnet uses a different table or the VPC main table. Inspecting a correct-looking object is not enough. Prove that the source traffic actually uses it.

### A more-specific route wins

Suppose:

```text
10.0.0.0/8   → Transit Gateway
10.20.0.0/16 → VPC peering
```

Traffic to `10.20.5.10` selects the `/16` peering route. Ask which route wins for the exact destination, not whether any broad route appears relevant.

### NAT confusion

The normal private egress path is:

```text
private EC2 → private default route → NAT gateway
            → public subnet route → internet gateway → internet
```

NAT supports connections initiated outward and their responses. It does not publish the private EC2 instance for arbitrary inbound connections.

### "Public subnet" misunderstanding

A name such as `public-subnet` has no network effect. For IPv4, the subnet normally needs `0.0.0.0/0 → IGW`, and the resource needs suitable public addressing and security. Follow the configuration, not the label.

### How Do Load Balancer and Transit Paths Change the Flow?
<!-- section-summary: Load balancers create separate client and target connections, while Transit Gateway adds independent VPC and TGW routing decisions in both directions. -->

A load balancer splits one apparent application path into at least two network connections:

```text
Connection 1: client → load balancer
Connection 2: load balancer → target
```

The first can work while the second fails. Troubleshoot the listener, listener rules, target group, target registration, target health, load-balancer security group, target security group, NACLs, application listener, and health-check path and port.

Treat the two tuples independently. The client might connect to the load balancer's address on `443`, while the load balancer opens a new connection from one of its network interfaces to a target on `8080`. A Flow Log for the second connection will not necessarily show the original client address or original destination port. Comparing that target record with a Reachability Analyzer path that models the client directly to the target would compare two different questions.

Target health is also active evidence. A listener can accept connections while the target group contains no healthy destination. Confirm that the registered target uses the expected address and port, that its process listens there, and that the health-check protocol, port, and path match the service. The load balancer and target security groups must allow the load-balancer-to-target connection, while NACLs must also permit the return ephemeral ports.

Reachability Analyzer does not account for registered target health, so a modeled path does not replace load-balancer health diagnostics.

Transit Gateway adds two routing decisions per direction:

```text
VPC A route table
  → TGW attachment A
  → TGW route table associated with A
  → attachment B
  → VPC B delivery
```

A route in VPC A does not prove TGW knows the destination. A correct TGW route does not prove VPC B has a return route. The response independently uses VPC B's route and the TGW table associated with attachment B.

Reachability Analyzer is valuable for supported TGW paths because it can expose route and attachment blockers across the modeled sequence. Flow evidence still reveals whether the live packet followed the expected addresses and interfaces.

The same separation helps with other middleboxes. NAT can translate the source tuple, a firewall can create an inspected path whose return must remain symmetric, and a proxy can establish a new connection on behalf of the client. At every boundary, rewrite the expected source, destination, and ports as AWS will observe them. A diagram arrow that says `app → internet` or `VPC A → VPC B` is not precise enough to correlate with a log record.

## When Should You Stop Changing the Network?
<!-- section-summary: Once configuration analysis and accepted traffic support the path, investigation should move up through host, transport, TLS, HTTP, application, and dependency layers. -->

Suppose the evidence says:

```text
Reachability Analyzer → REACHABLE
Flow Logs             → ACCEPT
destination host      → observed connection
```

Yet the user still gets an error. Basic VPC networking is now a weaker cause.

The failure may be:

```text
HTTP 500 or 503
TLS certificate or handshake error
application timeout
database timeout
bad credentials
crashed process
CPU or memory starvation
wrong virtual host
wrong health-check path
```

Progress up the stack:

```text
network → transport → TLS → HTTP → application → dependencies
```

Continuing to modify routes or security groups can make the system less secure without fixing the service. A good debugger knows when the evidence has cleared one layer.

The deeper distinction is between configuration and observation.

Reachability Analyzer provides **declarative knowledge**: the blueprint says this traffic should be possible under supported AWS configuration. Flow Logs provide **empirical knowledge**: sensors observed this traffic and recorded how the VPC layer treated it. Application logs describe what happened after delivery.

Predict before observing. Write what you expect to see:

```text
source ENI:
10.0.1.25 → 10.0.8.40:443 ACCEPT

destination ENI:
same request ACCEPT

return:
10.0.8.40:443 → 10.0.1.25:49152 ACCEPT
```

Then compare with reality. If the log shows `10.0.9.17` as the destination, the client is not calling the server you modeled. DNS or application configuration has produced a new hypothesis.

This is first-principles troubleshooting:

```text
model → prediction → controlled experiment
      → observation → comparison → new hypothesis
```

## What Is the Final Troubleshooting Runbook?
<!-- section-summary: The final runbook moves from one exact flow through configuration analysis and observed evidence, then deliberately hands off to higher layers. -->

When someone says, "A cannot connect to B," use this sequence:

1. **Turn the complaint into a packet.** Identify the real source resource and IP, destination resource and IP, protocol, destination port, and resolved hostname.
2. **Write the expected path and return.** Include source and destination subnets, route tables, peering or TGW, NAT, firewalls, load balancers, destination ENI, and reverse routing.
3. **Run Reachability Analyzer.** Model the same tuple. If not reachable, investigate the reported supported configuration blocker. Remember that this is analysis, not test traffic.
4. **Generate controlled traffic.** Make one known attempt from the source and record its time.
5. **Inspect Flow Logs.** Search for the tuple. REJECT focuses on network policy or path. ACCEPT means traffic passed that observation point, not that the application succeeded. Account for aggregation, delay, best-effort delivery, and exclusions.
6. **Check both directions.** Return routing and stateless NACLs are especially important for TGW, VPN, and middlebox paths.
7. **Move upward when the network checks out.** Inspect host policy, listening processes, load-balancer target health, TLS, HTTP, application behavior, and dependencies.

![The runbook summary turns DNS, routes, Flow Logs, Reachability Analyzer, security controls, and service health into a repeatable debugging path](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-flow-logs-reachability-analyzer/aws-connectivity-runbook.png)

*The runbook uses configuration evidence to predict the path, observed flow evidence to test it, and application diagnostics after delivery.*

The compact decision is:

```text
What should happen?
  ↓ Reachability Analyzer
not reachable → fix the modeled AWS configuration
reachable     → generate controlled traffic
                  ↓ Flow Logs
               REJECT → investigate network policy/path
               ACCEPT → investigate host, TLS, and application
               no log → prove traffic, tuple, scope, and exclusions
```

Reachability Analyzer tells you what the supported configuration implies. Flow Logs tell you what AWS networking observed. Application diagnostics tell you what happened after the traffic arrived. Keeping those claims separate turns networking incidents into hypothesis elimination rather than guessing.

## Check Your Answers
<!-- section-summary: Review the tuple, evidence, configuration, return-path, middlebox, and handoff concepts. -->

:::expand[How Do You Turn a Timeout Into a Packet?]{kind="recap"}
A useful incident statement records the exact source and destination addresses, source and destination ports, and protocol.

It is source IP, destination IP, source port, destination port, and protocol. Writing it turns a vague service complaint into one network flow that routes, policies, logs, and analysis can compare.

A written expected tuple and forward/return observation gives reality something precise to contradict. A different destination, source, port, or direction immediately produces a better hypothesis than random rule changes.
:::

:::expand[What Must Be True for the Connection to Work?]{kind="recap"}
DNS, routes, filtering, intermediate systems, destination state, and an independently valid return path must all agree.

The source VPC route must choose TGW, and the source attachment's associated TGW table must choose the next attachment. The destination independently needs VPC and TGW return routes.

Flow Logs provide aggregated metadata about observed flows and their ACCEPT or REJECT result at a logging point, not packet payloads or application success.

AWS networking accepted that observed flow at the logging point. It does not prove end-to-end completion, a listening process, healthy targets, successful TLS, or an application response.

It is strong evidence that the observed VPC packet path was rejected, commonly by security-group or NACL conditions. Inspect the exact tuple, direction, interface, and attached controls rather than the service label.

The wrong ENI or time may have been searched, DNS may have selected another destination, logging may be absent, delivery may be delayed or skipped, and some traffic categories are excluded.
:::

:::expand[What Does Reachability Analyzer Prove?]{kind="recap"}
Reachability Analyzer performs static reasoning over supported AWS network configuration for a hypothetical source, destination, protocol, and port.

It statically models supported AWS networking configuration for a hypothetical source, destination, protocol, and port. It reports whether a path exists in that model and can identify a blocking component without sending data-plane packets.

First prove both pieces of evidence describe the same tuple, direction, destination ENI, and time. Service labels can hide different connections or addresses, and unsupported dynamic behavior can differ from the static model.
:::

:::expand[How Do the Two Evidence Sources Work Together?]{kind="recap"}
Analyzer output describes configuration implications, while Flow Logs describe observed traffic, so their combinations eliminate different hypotheses.
:::

:::expand[What Is a Repeatable Investigation?]{kind="recap"}
A controlled test compares one exact packet prediction with static analysis and observed flow evidence before moving to higher layers.
:::

:::expand[Which Routing and Filtering Failures Are Common?]{kind="recap"}
Common failures include SG and NACL mismatches, wrong route associations, more-specific routes, mistaken NAT expectations, and labels that do not match configuration.

Load balancers create separate client and target connections, while Transit Gateway adds independent VPC and TGW routing decisions in both directions.

TCP needs packets in both directions. Return traffic can select different VPC and TGW routes or be blocked by stateless NACL ephemeral-port rules even when the first packet reaches the server.

The AWS configuration can permit the path while a host firewall, closed listener, unhealthy load-balancer target, TLS problem, application overload, or other unsupported or runtime condition causes failure.

It separates client-to-load-balancer and load-balancer-to-target into distinct connections, each with its own addresses, ports, security rules, health, and evidence.
:::

:::expand[When Should You Stop Changing the Network?]{kind="recap"}
Once configuration analysis and accepted traffic support the path, investigation should move up through host, transport, TLS, HTTP, application, and dependency layers.

When the supported path is reachable and matching traffic is accepted and arrives, move to host, transport, TLS, HTTP, application, and dependency evidence. Continued network widening is unlikely to fix those layers.
:::

:::expand[What Is the Final Troubleshooting Runbook?]{kind="recap"}
The final runbook moves from one exact flow through configuration analysis and observed evidence, then deliberately hands off to higher layers.
:::

## References

- [How Reachability Analyzer works](https://docs.aws.amazon.com/vpc/latest/reachability/how-reachability-analyzer-works.html) - Explains static configuration analysis, supported components, and limitations.
- [Route priority](https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html) - Documents longest-prefix route selection.
- [Network ACLs](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html) - Explains stateful security groups, stateless NACLs, and return traffic.
- [Flow Log records](https://docs.aws.amazon.com/vpc/latest/userguide/flow-log-records.html) - Defines flow metadata fields and ACCEPT or REJECT actions.
- [Flow Log limitations](https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs-limitations.html) - Documents aggregation, delivery delay, best-effort behavior, and exclusions.
- [Network Load Balancer troubleshooting](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/load-balancer-troubleshooting.html) - Covers target listeners, health checks, security groups, and NACL issues.
- [Reachability Analyzer explanation codes](https://docs.aws.amazon.com/vpc/latest/reachability/explanation-codes.html) - Defines blocker explanations returned by analyses.
- [Create a VPC route table](https://docs.aws.amazon.com/vpc/latest/userguide/create-vpc-route-table.html) - Covers explicit and main route-table associations.
- [Routing options](https://docs.aws.amazon.com/vpc/latest/userguide/route-table-options.html) - Documents IGW and NAT gateway paths.
