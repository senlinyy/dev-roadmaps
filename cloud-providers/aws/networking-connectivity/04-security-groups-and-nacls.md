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

1. [Routes Need Traffic Rules](#routes-need-traffic-rules)
2. [Security Groups](#security-groups)
3. [Security Group Rules for the App](#security-group-rules-for-the-app)
4. [Inspecting Security Groups](#inspecting-security-groups)
5. [Network ACLs](#network-acls)
6. [Ephemeral Ports](#ephemeral-ports)
7. [A Safe NACL Pattern](#a-safe-nacl-pattern)
8. [Verification With Flow Logs](#verification-with-flow-logs)
9. [References](#references)

## Routes Need Traffic Rules
<!-- section-summary: The receipts app already has routes, and now each packet path needs rules that allow only the intended traffic. -->

The receipts app has a route from the public load balancer to private API tasks, and the API has a local VPC route to the database. Routes answer where packets can go next. Traffic rules answer whether those packets may pass.

AWS gives two common VPC packet controls: **security groups** and **network ACLs**, often called NACLs. Security groups attach to resources such as ENIs, load balancers, EC2 instances, database interfaces, and interface endpoints. NACLs attach to subnets and evaluate packets as they enter or leave the subnet boundary.

For most application access, security groups carry the main design because they sit close to the workload. NACLs usually act as broad subnet guardrails. That split keeps daily app permissions tied to the app and keeps subnet-level deny rules rare, visible, and documented.

The running packet path stays the same. Customer traffic reaches the load balancer on TCP `443`. The load balancer reaches the API on TCP `8080`. The API reaches PostgreSQL on TCP `5432`. Each hop needs a route, a source, a destination, a port, a security group decision, and a NACL decision.

## Security Groups
<!-- section-summary: Security groups are stateful allow lists attached to resources, so allowed connections automatically include their response traffic. -->

A **security group** is a stateful allow list. You add inbound and outbound allow rules. When a connection is allowed in one direction, response traffic for that connection is automatically allowed by the security group state tracking.

Security groups deny inbound traffic unless a rule allows it. Many tools create security groups with broad outbound access, but production teams should still review egress. An API that only needs the database, S3, CloudWatch Logs, Secrets Manager, and one payment provider should have those outbound needs named.

Security group rules can use CIDR ranges or other security groups as sources and destinations. CIDR rules work for fixed networks such as office IP ranges or partner ranges. Security group references work well for dynamic AWS workloads because the rule follows the group rather than a changing private IP address.

For the receipts app, the useful relationships are small. Customers reach the load balancer. The load balancer reaches the API. The API reaches the database and approved outbound dependencies. Each rule should describe one of those relationships in plain language.

![The control comparison shows why security groups track connection state while network ACLs require separate inbound and outbound thinking](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-security-groups-vs-nacls/stateful-vs-stateless-controls.png)

*The control comparison shows why security groups track connection state while network ACLs require separate inbound and outbound thinking.*


## Security Group Rules for the App
<!-- section-summary: A practical security group design follows the app conversation instead of trusting whole subnet ranges. -->

A simple rule set can use three security groups: `receipts-alb-sg`, `receipts-api-sg`, and `receipts-db-sg`. The load balancer security group receives HTTPS from customer ranges. The API security group receives app traffic from the load balancer security group. The database security group receives database traffic from the API security group.

| Security group | Inbound rule | Why it exists |
| --- | --- | --- |
| `receipts-alb-sg` | TCP `443` from approved customer ranges, often `0.0.0.0/0` for a public web app | Customers reach the public entry point. |
| `receipts-api-sg` | TCP `8080` from `receipts-alb-sg` | The load balancer forwards requests to the API. |
| `receipts-db-sg` | TCP `5432` from `receipts-api-sg` | The API reaches PostgreSQL. |

Terraform can express the API-to-database relationship with dedicated security group rule resources:

```hcl
resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.api.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
  description                  = "Receipts ALB to API"
}

resource "aws_vpc_security_group_ingress_rule" "db_from_api" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.api.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "Receipts API to PostgreSQL"
}
```

The `security_group_id` field is the group receiving the inbound rule. The `referenced_security_group_id` field names the trusted source group. `ip_protocol`, `from_port`, and `to_port` define the TCP port range, and `description` gives reviewers the app reason behind the rule.

This style avoids hardcoding API task IP addresses. If the API scales from two tasks to twenty tasks, new tasks get the API security group and the database rule still applies. The network trust follows the workload group instead of a list of private addresses.

Outbound rules need the same owner. Some teams allow broad outbound traffic during early discovery and then narrow it after logs show the real dependencies. Other teams start narrow from day one. Either path should name the expected destinations and create a follow-up for broad egress.

![The app rule map shows the intended ALB-to-API-to-database path and where each security group rule belongs](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-security-groups-vs-nacls/alb-api-db-rules.png)

*The app rule map shows the intended ALB-to-API-to-database path and where each security group rule belongs.*


## Inspecting Security Groups
<!-- section-summary: AWS CLI security group output shows sources, destinations, protocols, and ports, which makes broad or missing rules visible. -->

The AWS CLI can show the security group relationships that matter for the receipts app:

```bash
aws ec2 describe-security-groups \
  --group-ids sg-0receiptsapi sg-0receiptsdb \
  --query 'SecurityGroups[*].{name:GroupName,id:GroupId,ingress:IpPermissions[*].{protocol:IpProtocol,from:FromPort,to:ToPort,sourceGroups:UserIdGroupPairs[*].GroupId,cidrs:IpRanges[*].CidrIp},egress:IpPermissionsEgress[*].{protocol:IpProtocol,from:FromPort,to:ToPort,destinationGroups:UserIdGroupPairs[*].GroupId,cidrs:IpRanges[*].CidrIp}}'
```

The `--group-ids` flag selects the exact groups under review. The `--query` expression keeps the group name, group ID, ingress rules, egress rules, security group references, CIDR ranges, protocols, and ports.

```json
[
  {
    "name": "receipts-api-sg",
    "id": "sg-0receiptsapi",
    "ingress": [
      {
        "protocol": "tcp",
        "from": 8080,
        "to": 8080,
        "sourceGroups": [
          "sg-0receiptsalb"
        ],
        "cidrs": []
      }
    ],
    "egress": [
      {
        "protocol": "tcp",
        "from": 5432,
        "to": 5432,
        "destinationGroups": [
          "sg-0receiptsdb"
        ],
        "cidrs": []
      }
    ]
  },
  {
    "name": "receipts-db-sg",
    "id": "sg-0receiptsdb",
    "ingress": [
      {
        "protocol": "tcp",
        "from": 5432,
        "to": 5432,
        "sourceGroups": [
          "sg-0receiptsapi"
        ],
        "cidrs": []
      }
    ],
    "egress": []
  }
]
```

The database rule should show `sourceGroups` with the API security group and port `5432`. A database ingress rule with `cidrs` containing `0.0.0.0/0` would mean a very different exposure. For the API group, broad outbound egress would appear as protocol `-1` and CIDR `0.0.0.0/0`, so reviewers can spot it quickly.

Security groups control network reachability. IAM, TLS, database credentials, and application authorization still protect identity and data after the network path opens. A good network rule narrows the path, and the application still authenticates the caller.

## Network ACLs
<!-- section-summary: Network ACLs filter traffic at subnet boundaries with ordered allow and deny rules, and each direction is evaluated separately. -->

A **network ACL** is a subnet-level packet filter. It has numbered inbound and outbound rules. AWS evaluates the lowest rule number first and stops at the first matching rule. NACLs can allow and deny traffic.

NACLs are stateless, so inbound and outbound directions need separate rules. Security group state tracking handles response traffic for allowed connections, but a NACL still needs rules that allow the response packets at the subnet boundary. This is the detail that makes NACLs easy to break during a rushed change.

Because a NACL applies to a whole subnet, it affects every resource in that subnet. A deny rule can be useful for blocking a confirmed malicious range at a public subnet boundary. The same deny rule can also break future resources that land in the subnet. That is why most teams keep NACLs broad and use security groups for precise workload relationships.

Rule numbers are part of the behavior. If an allow for TCP `443` from `0.0.0.0/0` is rule `100`, a deny for a known bad range on TCP `443` at rule `120` will never match that traffic. Number gaps such as `100`, `110`, and `120` leave room for emergency rules above or below the normal rule.

## Ephemeral Ports
<!-- section-summary: Stateless NACLs need temporary client ports because TCP responses return to the client's ephemeral port. -->

**Ephemeral ports** are temporary client-side ports used by TCP connections. A customer may connect from source port `51544` to the load balancer destination port `443`. The response goes back to destination port `51544`, so subnet-level rules must allow that return path.

This matters because NACLs are stateless. A public subnet NACL that allows inbound destination port `443` also needs outbound ephemeral ports for responses to customers. A private app subnet that allows inbound destination port `8080` from the load balancer also needs outbound ephemeral ports back to the load balancer nodes.

Many AWS examples use the range `1024-65535` for ephemeral ports, although operating systems can use different ranges. A strict production NACL review checks the operating system defaults and the protocols in use before narrowing those ports. For a beginner app, broad NACL ephemeral ranges plus precise security groups often produce fewer accidental outages.

For the receipts database path, the data subnet NACL may need inbound destination port `5432` from app subnet CIDRs and outbound ephemeral ports back to app subnet CIDRs. The security group can still use the API security group as the trusted source, which is more precise than the subnet CIDR.

## A Safe NACL Pattern
<!-- section-summary: A safe NACL design starts broad enough for normal stateful protocols, then adds narrow deny rules only with evidence and rollback. -->

A safe beginner pattern keeps NACLs simple and lets security groups carry the workload relationships. Public load balancer subnets allow customer HTTPS and return traffic. Private app subnets allow traffic from the load balancer and responses to approved outbound calls. Data subnets allow the app-to-database path and response traffic.

When a NACL deny rule is needed, the change record should name the reason. Blocking a confirmed malicious source range at a public subnet boundary can be reasonable. Blocking a broad internal range because one service misbehaved usually creates hidden outages for other services in the same subnet.

A small public-subnet NACL pattern might look like this:

| Direction | Rule | Action | Port range | CIDR | Purpose |
| --- | ---: | --- | --- | --- | --- |
| Inbound | 90 | Deny | `443` | `198.51.100.0/24` | Block a confirmed malicious range. |
| Inbound | 100 | Allow | `443` | `0.0.0.0/0` | Allow customer HTTPS. |
| Outbound | 100 | Allow | `1024-65535` | `0.0.0.0/0` | Allow responses to customer ephemeral ports. |

The CLI can show the actual NACL entries for a subnet:

```bash
aws ec2 describe-network-acls \
  --filters Name=association.subnet-id,Values=subnet-0publica \
  --query 'NetworkAcls[*].{acl:NetworkAclId,entries:Entries[?RuleNumber < `32767`].{rule:RuleNumber,egress:Egress,action:RuleAction,protocol:Protocol,cidr:CidrBlock,from:PortRange.From,to:PortRange.To}}'
```

The `--filters` flag finds the NACL associated with the public subnet. The `--query` expression removes the default catch-all rule and keeps rule number, direction, action, protocol, CIDR, and port range. In NACL output, protocol `6` means TCP.

```json
[
  {
    "acl": "acl-0public",
    "entries": [
      {
        "rule": 90,
        "egress": false,
        "action": "deny",
        "protocol": "6",
        "cidr": "198.51.100.0/24",
        "from": 443,
        "to": 443
      },
      {
        "rule": 100,
        "egress": false,
        "action": "allow",
        "protocol": "6",
        "cidr": "0.0.0.0/0",
        "from": 443,
        "to": 443
      },
      {
        "rule": 100,
        "egress": true,
        "action": "allow",
        "protocol": "6",
        "cidr": "0.0.0.0/0",
        "from": 1024,
        "to": 65535
      }
    ]
  }
]
```

The `egress` value separates inbound and outbound entries. `false` means the rule applies to traffic entering the subnet, and `true` means the rule applies to traffic leaving the subnet. The lower deny rule number makes the malicious range match before the general HTTPS allow rule.

## Verification With Flow Logs
<!-- section-summary: Flow Logs provide packet metadata that helps separate route problems from security group, NACL, listener, and application problems. -->

VPC Flow Logs record metadata about IP traffic at a VPC, subnet, or network interface level. They can publish to CloudWatch Logs, S3, or Data Firehose. Flow Logs include packet facts such as source address, destination address, source port, destination port, protocol, action, and log status, while application payloads stay outside the log record.

The first state check confirms that Flow Logs exist for the VPC:

```bash
aws ec2 describe-flow-logs \
  --filter Name=resource-id,Values=vpc-0receipts \
  --query 'FlowLogs[*].{id:FlowLogId,resource:ResourceId,destination:LogDestinationType,status:FlowLogStatus,traffic:TrafficType}'
```

The `--filter` flag selects Flow Logs for the receipts VPC. The `--query` expression shows the Flow Log ID, resource, destination type, delivery status, and whether it records accepted traffic, rejected traffic, or both.

```json
[
  {
    "id": "fl-0receipts",
    "resource": "vpc-0receipts",
    "destination": "cloud-watch-logs",
    "status": "ACTIVE",
    "traffic": "ALL"
  }
]
```

During an incident, a useful Flow Logs query focuses on one destination port and one interface. In CloudWatch Logs Insights, the database path might be inspected like this:

```console
fields @timestamp, interfaceId, srcAddr, dstAddr, srcPort, dstPort, protocol, action, flowDirection
| filter interfaceId = "eni-0db1234567890ab" and dstPort = 5432
| sort @timestamp desc
| limit 20
```

Example results can point the investigation in different directions:

```console
@timestamp              interfaceId           srcAddr       dstAddr       srcPort  dstPort  protocol  action  flowDirection
2026-06-27T10:15:08Z   eni-0db1234567890ab   10.40.10.48  10.40.20.35  53144    5432     6         ACCEPT  ingress
2026-06-27T10:11:42Z   eni-0db1234567890ab   10.40.12.77  10.40.20.35  51220    5432     6         REJECT  ingress
```

The first row shows the API reaching the database ENI on PostgreSQL and being accepted. The second row shows another source address being rejected on the same port. A `REJECT` at the VPC packet layer points toward security group or NACL review, while an `ACCEPT` followed by an application timeout points toward the database listener, TLS, credentials, connection pool, or application behavior.

The safest review uses one packet path at a time. Source IP, destination IP, destination port, route table, security groups, subnet NACLs, and Flow Logs should all describe the same story. That habit prevents random rule changes and keeps the public entry, private app tier, database tier, outbound updates, and safe filtering aligned.

![The packet checklist turns security group, NACL, route, DNS, and Flow Logs evidence into a repeatable access review](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-security-groups-vs-nacls/packet-control-checklist.png)

*The packet checklist turns security group, NACL, route, DNS, and Flow Logs evidence into a repeatable access review.*


## References

- [Amazon VPC documentation: Security groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)
- [Amazon VPC documentation: Security group rules](https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html)
- [Amazon VPC documentation: Network ACLs](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html)
- [Amazon VPC documentation: Network ACL rules](https://docs.aws.amazon.com/vpc/latest/userguide/nacl-rules.html)
- [Amazon VPC documentation: VPC Flow Logs](https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html)
