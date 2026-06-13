---
title: "Security Groups and NACLs"
description: "Use security groups, network ACLs, and VPC Flow Logs to control and verify packet access in AWS VPC networks."
overview: "Route tables give packets a path. Security groups and network ACLs decide which packets may use that path, and VPC Flow Logs provide evidence when a connection succeeds or fails."
tags: ["aws", "vpc", "security-groups", "nacls", "flow-logs", "networking"]
order: 4
id: article-cloud-providers-aws-networking-connectivity-security-groups-vs-nacls
aliases:
  - security-groups-and-nacls
  - open-the-right-packet-path
  - article-cloud-providers-aws-networking-connectivity-security-groups-nacls
  - cloud-providers/aws/networking-connectivity/security-groups-and-nacls.md
  - security-groups-vs-nacls
  - cloud-providers/aws/networking-connectivity/security-groups-vs-nacls.md
  - cloud-providers/aws/networking-connectivity/02-security-groups-vs-nacls.md
---

## Table of Contents

1. [The Same Payments Path, Now With Packet Permissions](#the-same-payments-path-now-with-packet-permissions)
2. [Security Groups as Stateful Resource-Level Rules](#security-groups-as-stateful-resource-level-rules)
3. [Building the ALB-to-API-to-DB Rule Set](#building-the-alb-to-api-to-db-rule-set)
4. [Security Group References](#security-group-references)
5. [Network ACLs as Stateless Subnet Rules](#network-acls-as-stateless-subnet-rules)
6. [Return Traffic and Ephemeral Ports](#return-traffic-and-ephemeral-ports)
7. [Using NACLs Without Breaking the App](#using-nacls-without-breaking-the-app)
8. [How to Verify With CLI and Flow Logs](#how-to-verify-with-cli-and-flow-logs)
9. [Common Production Mistakes](#common-production-mistakes)
10. [Putting It All Together](#putting-it-all-together)
11. [References](#references)

## The Same Payments Path, Now With Packet Permissions
<!-- section-summary: The payments app already has routes, so this article adds the rules that allow or reject packets on that path. -->

Northstar Payments now has working route tables. Customer traffic can reach the public Application Load Balancer. The load balancer can route privately to API tasks. API tasks can reach PostgreSQL through the VPC local route and can start outbound HTTPS calls through a NAT gateway. The route table part answers, "Where should this packet go next?"

The next question is, "Should this packet be allowed at all?" A route can point to the right target while a firewall rule still blocks the packet. A database can have a private route from the API subnet while the database accepts traffic only from a specific application security group. A public ALB can have an internet route while still allowing only HTTPS from customers.

AWS gives VPC workloads two built-in packet filtering layers:

| Layer | Scope | Main behavior | Typical use |
|---|---|---|---|
| **Security group** | Resource network interface | Stateful allow rules | Precise workload-to-workload access |
| **Network ACL** | Subnet boundary | Stateless numbered allow and deny rules | Broad subnet guardrails and emergency blocks |

An **Elastic Network Interface**, often called an ENI, is the network card representation attached to many AWS resources. EC2 instances, ECS tasks in awsvpc mode, RDS instances, load balancers, NAT gateways, and VPC endpoints all use network interfaces in different ways. Security groups attach to supported resources at the network interface level. NACLs attach to subnets, so they apply as traffic enters and leaves subnet boundaries.

For the payments app, security groups should carry most of the day-to-day access design. The ALB security group allows customer HTTPS. The API security group allows traffic from the ALB security group. The database security group allows PostgreSQL from the API security group. NACLs stay broad enough for normal return traffic and narrow enough to add subnet-level guardrails when the team has a clear reason.

## Security Groups as Stateful Resource-Level Rules
<!-- section-summary: Security groups are stateful allow lists attached to resources, so return traffic for allowed connections is automatically handled. -->

A **security group** is a virtual firewall for supported AWS resources. It controls inbound traffic that can reach the resource and outbound traffic that can leave the resource. Security group rules name a protocol, a port range, and a source or destination. TCP port 443 means HTTPS. TCP port 5432 means PostgreSQL. A source can be a CIDR range like `203.0.113.0/24`, a prefix list, or another security group.

Security groups use **allow rules**. A new security group starts with no inbound rules, so inbound traffic needs an explicit allow rule. A new security group usually starts with an outbound rule that allows all outbound traffic, and many teams replace that with narrower outbound rules for sensitive workloads.

Security groups are **stateful**. Stateful means AWS remembers an allowed connection flow long enough to handle the response traffic automatically. If an API task is allowed to start an outbound HTTPS connection to a payment processor, the response traffic can return to the API task even though the response arrives at a temporary high-numbered port. If a customer request is allowed inbound to the ALB on port 443, the ALB's response traffic can leave without needing a separate outbound mirror rule for that same connection.

This stateful behavior keeps security group rules readable. The team describes who can start a conversation. AWS handles the normal return path for that conversation. The application team avoids opening thousands of return ports on security groups just because TCP clients use temporary ports.

Security groups also aggregate. If a resource has multiple security groups attached, AWS evaluates the combined set of rules. This can help in some shared patterns, but it can also hide broad access. A payments API task with both `sg-api` and a shared `sg-admin-anywhere` inherits rules from both groups. The effective result can allow more traffic than the application owner expects.

Security groups have a few platform boundaries to remember. AWS documents several built-in VPC services that sit outside security group filtering, such as AmazonProvidedDNS, DHCP, EC2 instance metadata, ECS task metadata endpoints, the Amazon Time Sync Service, and reserved addresses used by the default VPC router. Those services need their own controls, such as IMDS configuration, IAM, resolver rules, or application settings.

![Stateful versus stateless controls infographic comparing security groups with automatic return traffic to network ACLs with separate inbound and outbound rules and ephemeral port needs](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-security-groups-vs-nacls/stateful-vs-stateless-controls.png)

*Security groups describe who can start workload conversations. NACLs sit at the subnet boundary, so they need explicit thinking for both directions and temporary return ports.*

## Building the ALB-to-API-to-DB Rule Set
<!-- section-summary: A common production rule set follows the application conversation rather than whole subnets. -->

The best way to write security group rules is to name the real application conversations. Northstar Payments has three important inbound conversations:

| Conversation | Destination resource | Destination port | Allowed source |
|---|---|---:|---|
| Customer to ALB | Public ALB | 443 | `0.0.0.0/0` and, if using IPv6, `::/0` |
| ALB to API | Private ECS API tasks | 8080 | ALB security group |
| API to database | RDS PostgreSQL | 5432 | API security group |

![ALB to API to DB security group chain showing ALB SG allowing HTTPS from the internet, API SG allowing app traffic from ALB SG, DB SG allowing PostgreSQL from API SG, and stateful return traffic](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-security-groups-vs-nacls/alb-api-db-rules.png)

*The useful rule names follow the application path. The database trusts the API security group, the API trusts the ALB security group, and the ALB is the only public-facing resource in the chain.*

The ALB security group is the public edge:

| Direction | Protocol | Port | Source or destination | Purpose |
|---|---|---:|---|---|
| Inbound | TCP | 443 | `0.0.0.0/0` | Customer HTTPS |
| Outbound | TCP | 8080 | API security group | Forward requests to API tasks |

The API security group receives only from the ALB and starts only the outbound conversations the app needs:

| Direction | Protocol | Port | Source or destination | Purpose |
|---|---|---:|---|---|
| Inbound | TCP | 8080 | ALB security group | Application requests |
| Outbound | TCP | 5432 | DB security group | PostgreSQL queries |
| Outbound | TCP | 443 | `0.0.0.0/0` | Payment processor and public HTTPS calls through NAT |

The database security group stays small:

| Direction | Protocol | Port | Source or destination | Purpose |
|---|---|---:|---|---|
| Inbound | TCP | 5432 | API security group | PostgreSQL client connections |
| Outbound | TCP | 5432 | API security group | Optional narrow egress for stateful response visibility |

Many teams leave database outbound broader because security groups are stateful and return traffic for allowed inbound database connections is already handled. Sensitive environments often narrow it anyway so the intended database conversation is visible in both directions.

Here is the same idea as Terraform with modern rule resources:

```hcl
resource "aws_security_group" "alb" {
  name   = "payments-alb"
  vpc_id = aws_vpc.payments.id
}

resource "aws_security_group" "api" {
  name   = "payments-api"
  vpc_id = aws_vpc.payments.id
}

resource "aws_security_group" "db" {
  name   = "payments-db"
  vpc_id = aws_vpc.payments.id
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
}

resource "aws_vpc_security_group_ingress_rule" "db_from_api" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.api.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
```

The rule names match the application path. That is intentional. When a reviewer sees `db_from_api`, the rule explains which workload relationship it exists to support.

## Security Group References
<!-- section-summary: Security group references let dynamic workloads trust another workload group without hardcoding private IP addresses. -->

A **security group reference** means one security group rule names another security group as the source or destination. The referenced group represents the private IP addresses of network interfaces associated with that group. This is one of the most useful VPC features for applications that scale up and down.

In the payments app, ECS tasks can be replaced during every deployment. Their private IP addresses change. If the database allowed `10.40.10.88/32` because that was yesterday's task IP, today's task might fail to connect. If the database allows source `sg-api` on port 5432, the database rule follows the application group rather than one temporary IP address.

The AWS CLI form looks like this:

```bash
aws ec2 authorize-security-group-ingress \
  --group-id sg-db1234567890 \
  --protocol tcp \
  --port 5432 \
  --source-group sg-api1234567890
```

This says that resources associated with `sg-db1234567890` can receive TCP 5432 traffic from private IP addresses of network interfaces associated with `sg-api1234567890`. The database rule uses the API group as a source identity for network interfaces, while the API security group's own rules stay separate.

The same pattern works between the ALB and API:

```bash
aws ec2 authorize-security-group-ingress \
  --group-id sg-api1234567890 \
  --protocol tcp \
  --port 8080 \
  --source-group sg-alb1234567890
```

That rule lets the API receive application traffic from ALB nodes without allowing every private address in the VPC. If another team launches a test instance in the same VPC, the API port remains closed to that instance unless it is also associated with the allowed source security group or another matching rule exists.

Security group references are strongest when the group boundaries match application roles. `sg-alb`, `sg-api`, and `sg-db` are clearer than one shared group called `sg-private`. The shared group may feel convenient on day one, but it erases the difference between web entry points, application workers, and data stores.

## Network ACLs as Stateless Subnet Rules
<!-- section-summary: NACLs filter traffic at subnet boundaries with numbered allow and deny rules, and each direction must be handled separately. -->

A **network access control list**, usually called a **NACL**, is a subnet-level packet filter. Every subnet is associated with one NACL at a time, and one NACL can be associated with multiple subnets. The NACL evaluates packets as they enter and leave a subnet boundary.

NACLs have inbound rules and outbound rules. Each rule has a number from 1 to 32766, a protocol, a port range, a CIDR source or destination, and an action of allow or deny. AWS evaluates NACL rules in numeric order from the lowest number upward. The first matching rule wins. A final catch-all deny handles traffic that matched no earlier rule.

NACLs are **stateless**. Stateless means the NACL treats each packet independently. If the inbound request is allowed, the outbound response still needs its own matching outbound allow rule. If the outbound request is allowed, the inbound response still needs its own matching inbound allow rule.

That stateless behavior is the biggest difference from security groups. Security groups remember allowed connection state. NACLs check every packet direction independently. This is why narrow NACLs often break applications during the first attempt. The team allows the destination service port but forgets the return path to the client's temporary port.

NACLs can also use explicit deny rules. That gives them a role as broad subnet guardrails. For example, if security receives a confirmed malicious IPv4 range, a low-numbered deny rule on public subnet NACLs can block that range before it reaches resources in those subnets. The deny rule needs a lower number than any broader allow rule it should override.

For most application permissions, security groups should stay the primary tool. NACLs work best as coarse subnet controls, emergency denies, or compliance guardrails where subnet-level policy is genuinely useful.

## Return Traffic and Ephemeral Ports
<!-- section-summary: Stateless NACLs need rules for temporary client ports because TCP responses return to the client's ephemeral port. -->

An **ephemeral port** is a temporary port chosen by the client side of a network connection. When a browser connects to the payments ALB on HTTPS, the browser might use source port `51544` and destination port `443`. The ALB response goes from source port `443` back to destination port `51544`.

Security groups handle this return traffic through connection state. NACLs need explicit rules in both directions. For a public ALB subnet, a simplified NACL view for customer HTTPS might look like this:

| Direction | Rule number | Action | Protocol | Port range | CIDR | Purpose |
|---|---:|---|---|---:|---|---|
| Inbound | 100 | Allow | TCP | 443 | `0.0.0.0/0` | Customer HTTPS request to ALB |
| Outbound | 100 | Allow | TCP | 1024-65535 | `0.0.0.0/0` | ALB response to client ephemeral ports |

Now look at ALB-to-API traffic. The ALB starts a connection to the API task on port 8080. The ALB source port is ephemeral. The API destination port is 8080. The API response then returns to the ALB ephemeral port. The private API subnet NACL needs to allow inbound destination port 8080 from the public ALB subnet range and outbound destination ephemeral ports back to the ALB subnet range.

| Direction | Rule number | Action | Protocol | Port range | CIDR | Purpose |
|---|---:|---|---|---:|---|---|
| Inbound | 100 | Allow | TCP | 8080 | `10.40.0.0/23` | ALB nodes to API tasks |
| Outbound | 100 | Allow | TCP | 1024-65535 | `10.40.0.0/23` | API responses to ALB ephemeral ports |

For API-to-PostgreSQL, the API task starts the connection. The database subnet NACL needs inbound PostgreSQL from the API subnet range and outbound ephemeral return to the API subnet range. The API subnet NACL needs outbound PostgreSQL to the database subnet range and inbound ephemeral return from the database subnet range.

This is why production teams often keep NACLs broad inside trusted private tiers and use security groups for the precise relationships. A very narrow NACL for every application port and every return port can work, but it is easy to break during deployments, load balancer changes, operating system differences, and new service paths.

## Using NACLs Without Breaking the App
<!-- section-summary: A safe NACL design starts broad enough for normal stateful protocols, then adds narrow deny rules only with clear evidence. -->

The default NACL in a VPC allows all inbound and outbound traffic. A custom NACL starts with deny behavior until allow rules are added. That difference matters during migrations. Associating a fresh custom NACL with a live subnet before adding rules can immediately block traffic for every resource in that subnet.

For Northstar Payments, a practical NACL strategy is simple. Public subnets allow inbound customer HTTPS and health check traffic, allow outbound ephemeral responses, and include low-numbered denies only for confirmed blocked ranges. Private application subnets allow traffic within the VPC CIDR and outbound through the NAT path. Database subnets can allow database traffic from application subnet CIDRs plus return traffic, but security groups still carry the primary application identity rule.

The rule number design should leave gaps. Numbers like 100, 110, 120, and 200 leave space for a later emergency deny at 90 or a new allow at 115. Since the first match wins, an emergency deny for a malicious range needs a lower number than the general allow it should beat.

Here is a small NACL example for a public subnet that allows HTTPS while blocking one known bad range first:

| Direction | Rule number | Action | Protocol | Port range | CIDR | Meaning |
|---|---:|---|---|---:|---|---|
| Inbound | 90 | Deny | TCP | 443 | `198.51.100.0/24` | Block confirmed bad source range |
| Inbound | 100 | Allow | TCP | 443 | `0.0.0.0/0` | Allow customer HTTPS |
| Outbound | 100 | Allow | TCP | 1024-65535 | `0.0.0.0/0` | Allow responses to clients |

The same deny at rule 110 would have a different result because rule 100 would match first. Rule order is part of the behavior rather than a display detail.

NACLs also have platform limits similar to security groups. AWS documents several built-in VPC services that sit outside NACL filtering, including AmazonProvidedDNS, DHCP, instance metadata, ECS task metadata endpoints, the Time Sync Service, and reserved router addresses. A subnet NACL is valuable as a packet filter for normal subnet traffic, while AWS platform paths need their own controls.

## How to Verify With CLI and Flow Logs
<!-- section-summary: Verification compares configured rules with packet metadata so the team can separate route issues from filter issues. -->

When a connection fails, the team should separate four questions: Is DNS resolving to the expected target? Does the source subnet have a route to the destination? Do security groups allow the workload relationship? Do NACLs allow both directions across subnet boundaries?

The AWS CLI can show the configured rules. For security groups:

```bash
aws ec2 describe-security-groups \
  --group-ids sg-alb1234567890 sg-api1234567890 sg-db1234567890
```

For NACLs associated with a subnet:

```bash
aws ec2 describe-network-acls \
  --filters Name=association.subnet-id,Values=subnet-0123456789abcdef0
```

The configuration tells the team what should happen. **VPC Flow Logs** provide packet metadata about what did happen at network interfaces. Flow Logs can publish to CloudWatch Logs, Amazon S3, or Amazon Data Firehose. A flow log record can include source address, destination address, source port, destination port, protocol, packet count, byte count, action, log status, and newer optional fields such as flow direction and traffic path.

A useful custom format for debugging payments traffic could include these fields:

```bash
${version} ${account-id} ${interface-id} ${srcaddr} ${dstaddr} ${srcport} ${dstport} ${protocol} ${action} ${log-status} ${flow-direction}
```

If the API fails to reach PostgreSQL, the team can filter for the API task ENI and database port 5432. An `ACCEPT` record from the API ENI toward the database address suggests the packet filter allowed that flow at the monitored interface. A `REJECT` record for destination port 5432 suggests a security group or NACL blocked the packet. Flow Logs show the accept or reject action, but the team still compares the active security group and NACL rules to identify which layer caused the reject.

Flow Logs capture network metadata rather than application payloads. SQL text, HTTP headers, request bodies, and TLS contents stay outside these records, which makes Flow Logs appropriate for answering packet path questions without exposing application data.

For NAT egress debugging, Flow Logs can also show traffic from the API task ENI to external destinations and the action taken. NAT gateways have their own network behavior and metrics too, so a complete egress investigation may combine route table checks, NAT gateway state, CloudWatch NAT metrics, and Flow Logs from the source interfaces.

## Common Production Mistakes
<!-- section-summary: Access bugs usually come from broad security groups, missing return paths in NACLs, and unclear ownership of shared rules. -->

The first common mistake is allowing the database from the whole VPC CIDR, such as `10.40.0.0/16`, because it seems private. Private still means every workload in that VPC range can attempt the port. The tighter rule is database inbound TCP 5432 from the API security group.

The second mistake is using IP addresses for auto-scaled tasks. ECS tasks, replacement EC2 instances, and managed service ENIs can change addresses during routine operations. Security group references describe the application role and survive those changes.

The third mistake is forgetting that security groups attach to resources while NACLs attach to subnets. A subnet NACL rule affects subnet boundary traffic. A security group rule affects supported resources associated with that group. The two layers answer different questions.

The fourth mistake is writing a narrow NACL that allows destination port 443 or 5432 but blocks ephemeral return traffic. The first symptom can look strange: a client sends a request, the server sees something, and the response never reaches the client. Stateless filtering requires both directions.

The fifth mistake is placing a deny rule after a broad allow rule in a NACL. NACL rules stop at the first match. A deny rule for `198.51.100.0/24` at rule 200 loses to an allow rule for `0.0.0.0/0` at rule 100 for the same protocol and port.

The sixth mistake is letting shared security groups grow without ownership. A group called `shared-private-access` may start with one harmless rule and later accumulate database, admin, cache, and debug access. Role-specific groups like `payments-alb`, `payments-api`, and `payments-db` keep review and incident response much clearer.

## Putting It All Together
<!-- section-summary: The payments app uses route tables for paths, security groups for workload relationships, NACLs for subnet guardrails, and Flow Logs for evidence. -->

Northstar Payments now has both parts of the VPC network story. Route tables give packets a path. Security groups decide which workload relationships are allowed at the resource level. NACLs add stateless subnet-level guardrails. Flow Logs provide metadata when the team needs evidence about accepted and rejected flows.

The public ALB security group allows HTTPS from customers. The private API security group allows application traffic from the ALB security group. The database security group allows PostgreSQL from the API security group. NACLs stay broad enough to handle normal return traffic and precise enough to apply subnet-level denies when the team has a concrete reason.

This division keeps the system understandable. A failed connection can be investigated in order: DNS, route table, security group, NACL, then application listener and logs. Each layer has one job, and each layer leaves different evidence.

![Packet control checklist summary board covering security groups by workload, narrow ingress, NACLs both ways, ephemeral ports, Flow Log evidence, and rule owner](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-security-groups-vs-nacls/packet-control-checklist.png)

*Use packet controls as a reviewable chain: group rules by workload, keep ingress narrow, treat NACLs as two-direction filters, account for ephemeral ports, verify with Flow Logs, and keep rule ownership visible.*

**References**

- [Control traffic to your AWS resources using security groups - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)
- [Security group rules - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html)
- [Control subnet traffic with network access control lists - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html)
- [Network ACL rules - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/userguide/nacl-rules.html)
- [Logging IP traffic using VPC Flow Logs - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html)
- [Flow log records - Amazon Virtual Private Cloud](https://docs.aws.amazon.com/vpc/latest/userguide/flow-log-records.html)
