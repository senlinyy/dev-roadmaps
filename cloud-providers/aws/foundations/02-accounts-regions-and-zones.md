---
title: "Accounts, Regions, and Availability Zones"
description: "AWS resources placed across account security boundaries, geographic Regions, and isolated Availability Zones."
overview: "Every AWS resource has a place. This article teaches how accounts, Organizations, Regions, Availability Zones, VPCs, subnets, and resource scope shape that placement before production traffic arrives."
tags: ["aws", "foundations", "accounts", "regions", "availability-zones"]
order: 2
id: article-cloud-providers-aws-foundations-accounts-regions-availability-zones
aliases:
  - cloud-providers/aws/foundations/accounts-regions-and-availability-zones.md
  - cloud-providers/aws/foundations/accounts-regions-availability-zones.md
---

## Table of Contents

1. [Start With the Place of the App](#start-with-the-place-of-the-app)
2. [Accounts: Who Owns the Workload](#accounts-who-owns-the-workload)
3. [Regions: Where the Workload Runs](#regions-where-the-workload-runs)
4. [Availability Zones: Local Failure Boundaries](#availability-zones-local-failure-boundaries)
5. [VPCs and Subnets: The Private Network Layout](#vpcs-and-subnets-the-private-network-layout)
6. [Shared Services and Cross-Account Work](#shared-services-and-cross-account-work)
7. [Daily Scope Checks Before Changes](#daily-scope-checks-before-changes)
8. [What's Next](#whats-next)
9. [References](#references)

## Start With the Place of the App
<!-- section-summary: AWS placement starts with account, Region, Availability Zone, VPC, and subnet scope. -->

Keep following the small photo app from the previous article. `northstar-photos` has a web service, a PostgreSQL database, a private S3 bucket for uploaded profile images, and a few CloudWatch alarms. The app may look like one system to users, but AWS places each part inside several boundaries before the first production request arrives.

Those boundaries answer different questions. An **AWS account** answers who owns the workload, who pays for it, which IAM rules apply, and where audit events land. A **Region** answers which geographic AWS area hosts the workload. An **Availability Zone**, often shortened to **AZ**, answers which isolated location inside that Region holds a subnet or a resource. A **VPC** answers which private network the workload uses inside the Region.

We will keep the examples focused on account, Region, AZ, VPC, subnet, and one cross-account role. A later operations or landing-zone article can handle full multi-account and network design. The goal here is to help a beginner look at an AWS resource and say, **which account, Region, AZ, VPC, and subnet does this belong to?**

| Layer | Simple definition | Photo app example |
|---|---|---|
| **Account** | Security, billing, IAM, quota, and audit boundary | The `prod` account owns production ECS, RDS, S3, and alarms |
| **Region** | Geographic AWS area | `eu-west-2` hosts the UK production workload |
| **Availability Zone** | Isolated location inside a Region | App subnets exist in `euw2-az1` and `euw2-az2` |
| **VPC** | Private regional network | `vpc-0123456789abcdef0` with CIDR `10.40.0.0/16` |
| **Subnet** | AZ-scoped slice of the VPC | One public and one private app subnet in each AZ |

These names connect directly to the first production design for the photo app. The production database belongs in the production account. The app runs in the Region approved for its users and data rules. The load balancer and app tasks spread across more than one AZ. The database sits in private subnets, while the load balancer receives public HTTPS traffic.

That placement also shapes troubleshooting. A missing subnet, wrong Region, wrong account, or full AZ subnet can look like an application problem at first. The operator needs the placement map before changing code, policies, or network rules.

![The placement coordinates show how account, Region, Availability Zone, VPC, subnet, and resource ID answer different parts of the same production-scope question](/content-assets/articles/article-cloud-providers-aws-foundations-accounts-regions-availability-zones/aws-placement-coordinates.png)

*The placement coordinates show how account, Region, Availability Zone, VPC, subnet, and resource ID answer different parts of the same production-scope question.*


## Accounts: Who Owns the Workload
<!-- section-summary: AWS accounts separate security, billing, permissions, quotas, and audit history. -->

An **AWS account** is the strongest everyday ownership boundary in AWS. It holds IAM identities and roles, billing records, many service quotas, CloudTrail events, and the resources for one scope of work. If a developer deletes a test database in a development account, the account split keeps that action away from the production database in the production account.

Real teams usually manage accounts through **AWS Organizations**. A simple company setup may include `dev`, `staging`, `prod`, `security`, `logging`, and `tooling` accounts. The production account hosts customer traffic and customer data. The logging account can receive organization-wide CloudTrail records. The security account can host GuardDuty, Security Hub, audit roles, and investigation tooling. The tooling account can host CI/CD systems that deploy into application accounts through tightly scoped roles.

This split gives teams practical control over blast radius. A sandbox experiment can have a short retention window and a small budget. Production can require stricter IAM roles, alarms, backups, and change review. Central logging can keep audit records away from day-to-day application roles that have no reason to erase evidence.

AWS Organizations can also apply **service control policies**, or **SCPs**, to accounts or groups of accounts. An SCP sets an outer guardrail for what member accounts can do. For example, the organization can deny resource creation outside approved Regions, deny disabling CloudTrail, or deny public S3 bucket policies except through a reviewed path. IAM policies inside the account still grant normal permissions, but the SCP can block actions even if an IAM policy would otherwise allow them.

For `northstar-photos`, a beginner-friendly account split may look like this:

| Account | Job | Example controls |
|---|---|---|
| `dev` | Safe experiments and feature testing | Small budget, synthetic data, short log retention |
| `staging` | Release rehearsal | Same deployment path as prod, production-like alarms |
| `prod` | Customer traffic and customer data | Strict roles, backups, change review, alerting |
| `security` | Central security tooling | GuardDuty, Security Hub, audit access roles |
| `logging` | Central audit and log archive | Organization CloudTrail and retained access logs |
| `tooling` | CI/CD and shared automation | Pipeline roles that assume limited deploy roles |

The account boundary matters every time a person opens a terminal. A profile name such as `prod` is only a local label. The command still needs proof of the active account ID and role before a production change.

```bash
aws sts get-caller-identity --profile prod
```

Example output:

```json
{
  "UserId": "AROAXAMPLEID:senlin",
  "Account": "123456789012",
  "Arn": "arn:aws:sts::123456789012:assumed-role/ProdReadOnly/senlin"
}
```

The important field is **Account** because it confirms the twelve-digit account ID receiving the command. The **Arn** field tells you which role or identity the credentials use. In this example, the caller has an assumed role named `ProdReadOnly`, so a write command should fail unless another approved role gets used.

The same account ID can also be checked against AWS Organizations when the caller has permission:

```bash
aws organizations describe-account --account-id 123456789012
```

Example output:

```json
{
  "Account": {
    "Id": "123456789012",
    "Arn": "arn:aws:organizations::999999999999:account/o-a1b2c3d4e5/123456789012",
    "Email": "aws-prod@example.com",
    "Name": "prod",
    "Status": "ACTIVE",
    "JoinedMethod": "CREATED"
  }
}
```

The **Name** and **Email** fields help humans verify that the account ID points to the expected account. The **Status** field confirms that the account is active. This command supports access review by giving a beginner one concrete habit before touching security groups, databases, ECS services, or bucket policies.

The account choice leads naturally to the next placement question. Once the team knows the production account owns the workload, it still has to choose the geographic AWS area where that account will run the app.

## Regions: Where the Workload Runs
<!-- section-summary: A Region places resources near users, data obligations, dependent systems, and platform support. -->

An **AWS Region** is a separate geographic area such as `us-east-1`, `eu-west-2`, or `ap-southeast-2`. A Region has its own service endpoints, control planes for many services, pricing details, and local availability characteristics. The Region choice affects user latency, data residency, service availability, compliance reviews, and operational support.

For `northstar-photos`, the team may choose `eu-west-2` because most users are in the United Kingdom, data handling has already been approved there, and the platform team already has networking, deployment, logging, and backup patterns in that Region. A Region with slightly lower latency on paper can create real operational trouble if the organization has no monitoring, support process, or recovery practice there.

Regions are intentionally separate. A VPC in `eu-west-2` contains resources in that Region. An RDS database in `eu-west-2` has its own endpoint, backups, maintenance window, and event history. CloudWatch log groups and ECS clusters are regional. S3 bucket names are globally unique, and a bucket still has a Region that matters for data placement, latency, and some policy decisions.

Some AWS services are **global** or have global control-plane pieces. IAM identities are global within an account. Route 53 hosted zones are global. CloudFront is a global edge service. Most runtime resources that host an app, such as ECS services, EC2 instances, subnets, load balancers, RDS databases, and CloudWatch log groups, are regional.

A beginner can check the default Region for a profile, then ask the same service for resources in two different Regions:

```bash
aws configure get region --profile prod
aws ecs list-clusters --profile prod --region eu-west-2
aws ecs list-clusters --profile prod --region us-east-1
```

Example output:

```console
eu-west-2

{
  "clusterArns": [
    "arn:aws:ecs:eu-west-2:123456789012:cluster/prod-booking"
  ]
}

{
  "clusterArns": []
}
```

The first line shows the profile default Region. The second response shows an ECS cluster in `eu-west-2`. The third response shows an empty cluster list in `us-east-1` for the same account because the command is looking at a different regional control plane.

Good runbooks and infrastructure code write the Region directly instead of relying on a hidden laptop default. A ticket that says "prod account `123456789012`, Region `eu-west-2`, ECS cluster `prod-booking`" gives the responder a clear target. The next question is how that Region spreads the workload across local failure boundaries.

## Availability Zones: Local Failure Boundaries
<!-- section-summary: Availability Zones let one Region host redundant resources in separate isolated locations. -->

An **Availability Zone** is an isolated location inside a Region. AWS designs AZs with independent power, networking, and connectivity. A production system often places resources in at least two AZs so one local infrastructure problem has less chance of stopping the whole app.

For `northstar-photos`, the Application Load Balancer can use public subnets in two AZs. ECS tasks can run in private app subnets in those same AZs. RDS can use a Multi-AZ deployment so AWS maintains standby capacity or cluster capacity in another AZ, depending on the database engine and deployment type. S3 Standard already stores data across multiple AZs inside a Region, so the app usually leaves AZ placement to S3.

AZ names need one careful beginner note. Names such as `eu-west-2a` can map differently in different accounts. Your `eu-west-2a` can point to a different physical AZ than another account's `eu-west-2a`. AWS also exposes **AZ IDs**, such as `euw2-az1`, and those IDs stay consistent across accounts. Platform teams use AZ IDs when they coordinate subnet placement across multiple accounts.

AZs also matter for capacity. A subnet lives in one AZ, and many resources consume private IP addresses from subnets. Fargate tasks, EC2 instances, Lambda functions attached to a VPC, load balancer nodes, databases, and network interfaces all need addresses. A deployment can stall because one AZ subnet has too few available IPs even while another AZ has plenty.

For the booking app, the starter subnet layout may look like this:

| AZ ID | Public subnet | Private app subnet | Private database subnet |
|---|---|---|---|
| `euw2-az1` | `10.40.0.0/24` | `10.40.10.0/24` | `10.40.20.0/24` |
| `euw2-az2` | `10.40.1.0/24` | `10.40.11.0/24` | `10.40.21.0/24` |

The exact CIDR ranges are examples. The useful shape is the repeated pattern across AZs. The load balancer gets public subnets in multiple AZs, the app gets private subnets in multiple AZs, and the database subnet group gets private database subnets in multiple AZs.

A small inspection command can show the AZ name and AZ ID mapping in one Region:

```bash
aws ec2 describe-availability-zones \
  --region eu-west-2 \
  --query 'AvailabilityZones[].{Name:ZoneName,Id:ZoneId,State:State}'
```

Example output:

```json
[
  {
    "Name": "eu-west-2a",
    "Id": "euw2-az1",
    "State": "available"
  },
  {
    "Name": "eu-west-2b",
    "Id": "euw2-az2",
    "State": "available"
  }
]
```

The **Name** field is the account-specific AZ name that appears in many console views and CLI outputs. The **Id** field is the stable cross-account AZ ID. The **State** field should be `available` for normal placement planning.

Subnets show the same placement plus remaining IP capacity:

```bash
aws ec2 describe-subnets \
  --region eu-west-2 \
  --filters Name=vpc-id,Values=vpc-0123456789abcdef0 \
  --query 'Subnets[].{Subnet:SubnetId,Cidr:CidrBlock,AZ:AvailabilityZone,AZID:AvailabilityZoneId,AvailableIPs:AvailableIpAddressCount}'
```

Example output:

```json
[
  {
    "Subnet": "subnet-0aaa1111",
    "Cidr": "10.40.10.0/24",
    "AZ": "eu-west-2a",
    "AZID": "euw2-az1",
    "AvailableIPs": 218
  },
  {
    "Subnet": "subnet-0bbb2222",
    "Cidr": "10.40.11.0/24",
    "AZ": "eu-west-2b",
    "AZID": "euw2-az2",
    "AvailableIPs": 221
  }
]
```

The **Subnet** field is the exact ID used by many deployments. The **Cidr** field shows the subnet's IP range. The **AvailableIPs** field gives an early warning before a rollout that increases task count. If one app subnet has only a few addresses left, the team should fix capacity before blaming ECS or the app code.

Now the app has an account, a Region, and AZ spread. The next layer is the private network that holds those subnets together.

![The AZ mapping view explains why teams compare Availability Zone IDs when accounts may use different AZ names for the same physical location](/content-assets/articles/article-cloud-providers-aws-foundations-accounts-regions-availability-zones/az-name-id-mapping.png)

*The AZ mapping view explains why teams compare Availability Zone IDs when accounts may use different AZ names for the same physical location.*


## VPCs and Subnets: The Private Network Layout
<!-- section-summary: A VPC is the regional private network where subnets, routes, gateways, and security controls connect application resources. -->

A **VPC** is a private network that you create inside one AWS Region. It has an IP range, route tables, gateways, security groups, network ACLs, and subnets. A **subnet** belongs to one AZ, so a two-AZ app needs at least two subnets for each layer that should keep running through an AZ problem.

The common starter layout has public subnets for the load balancer and private subnets for application tasks and databases. An **internet gateway** lets public subnet resources, such as load balancer nodes, receive internet traffic. A **NAT gateway** can let private subnet resources start outbound internet connections for updates or external APIs. A **VPC endpoint** can give private access to supported AWS services, such as S3, without sending that traffic through a NAT gateway.

This layout keeps the database away from direct public access. The browser talks to the load balancer over HTTPS. The load balancer talks to private app tasks. The app talks to the database through a private database endpoint and talks to S3 through IAM permission plus a network path.

Security groups and network ACLs both affect traffic, but beginners should understand **security groups** first. A security group attaches to resources such as load balancers, task network interfaces, EC2 instances, and databases. It is stateful, so AWS handles return traffic for an allowed connection. A **network ACL** attaches to a subnet and is stateless, so inbound and outbound rules both need attention. Many app teams use security groups for normal workload boundaries and keep network ACLs simple unless the platform team has a specific reason.

For `northstar-photos`, the intended connection policy may look like this:

| From | To | Port | Reason |
|---|---|---|---|
| Internet | ALB security group | `443` | Users reach the public HTTPS endpoint |
| ALB security group | App security group | `3000` | Load balancer reaches the web service |
| App security group | DB security group | `5432` | App connects to PostgreSQL |
| App tasks | S3 endpoint or NAT path | `443` | App reads and writes uploaded profile images |

This is where placement and permissions meet. The network can allow the app task to reach S3 over HTTPS, and IAM still decides whether the task role can call `s3:PutObject` on the upload bucket. A working AWS design usually needs both the network path and the IAM permission.

A lightweight database placement check can show the endpoint, port, subnet group, and Multi-AZ flag:

```bash
aws rds describe-db-instances \
  --db-instance-identifier prod-photos-db \
  --region eu-west-2 \
  --query 'DBInstances[].{Status:DBInstanceStatus,Endpoint:Endpoint.Address,Port:Endpoint.Port,SubnetGroup:DBSubnetGroup.DBSubnetGroupName,MultiAZ:MultiAZ}'
```

Example output:

```json
[
  {
    "Status": "available",
    "Endpoint": "prod-photos-db.abc123.eu-west-2.rds.amazonaws.com",
    "Port": 5432,
    "SubnetGroup": "prod-photos-db-subnets",
    "MultiAZ": true
  }
]
```

The **Status** field tells you whether the database is available. The **Endpoint** and **Port** fields tell the app where to connect. The **SubnetGroup** field points to the group of subnets RDS can use. The **MultiAZ** field tells you whether this DB instance has Multi-AZ enabled for that deployment type.

When the app connection fails, the responder can then inspect the database security group:

```bash
aws ec2 describe-security-groups \
  --group-ids sg-photos-db \
  --region eu-west-2 \
  --query 'SecurityGroups[].IpPermissions'
```

Example output:

```json
[
  [
    {
      "IpProtocol": "tcp",
      "FromPort": 5432,
      "ToPort": 5432,
      "UserIdGroupPairs": [
        {
          "GroupId": "sg-photos-app",
          "UserId": "123456789012"
        }
      ]
    }
  ]
]
```

The **FromPort** and **ToPort** fields show PostgreSQL port `5432`. The **UserIdGroupPairs** field shows that inbound traffic comes from the app security group rather than the whole internet. If the app logs show timeouts, connection refused errors, DNS failures, or authentication errors, these placement fields help the team choose the next layer to inspect.

The VPC section finishes the single-workload placement story. Real companies often add shared services around the workload, and those shared services introduce cross-account access.

## Shared Services and Cross-Account Work
<!-- section-summary: Central accounts and shared platform services let teams reuse security, logging, networking, and deployment capabilities without mixing ownership boundaries. -->

As `northstar-photos` grows, shared platform services start to matter. A security team may own centralized CloudTrail, GuardDuty, Security Hub, IAM Identity Center, and audit roles. A platform team may own shared DNS, container base images, deployment pipelines, or network connectivity. These shared pieces help application teams while the production account still owns the application resources.

Cross-account access usually uses **IAM roles**. A CI pipeline in the tooling account can assume a deployment role in the production account. The production role grants only the deployment actions needed for `northstar-photos`. CloudTrail records the assumed role session, so the team can trace the change back to a pipeline run, ticket, or person.

```bash
aws sts assume-role \
  --role-arn arn:aws:iam::123456789012:role/deploy-photos-prod \
  --role-session-name photos-release-2026-06-24
```

Example output:

```json
{
  "Credentials": {
    "AccessKeyId": "ASIAEXAMPLE",
    "Expiration": "2026-06-24T13:15:00Z"
  },
  "AssumedRoleUser": {
    "AssumedRoleId": "AROAXAMPLEID:photos-release-2026-06-24",
    "Arn": "arn:aws:sts::123456789012:assumed-role/deploy-photos-prod/photos-release-2026-06-24"
  }
}
```

The **role-arn** names the production role that the caller wants to use. The **role-session-name** appears as part of the assumed-role identity in logs, so it should point back to the release or pipeline run. The **Expiration** field reminds beginners that assumed-role credentials are temporary.

Shared networking can use AWS Transit Gateway, VPC peering, or AWS PrivateLink depending on the communication pattern. The important point here is the ownership layer: the app account owns app resources, the logging account owns retained audit logs, the security account owns security tooling, and the network account may own shared network attachments.

Shared DNS gives another practical example. The platform team may own the public hosted zone for `example.com`, while the app team receives permission to manage records under `photos.example.com` through an approved pipeline. The app team gets a service name it can deploy, and the platform team keeps control of the larger domain.

With shared services in place, daily AWS work needs a small scope checklist. That checklist keeps account, Region, network, and resource identity visible before anyone changes production.

## Daily Scope Checks Before Changes
<!-- section-summary: Repeating account, Region, network, AZ, and resource checks prevents many wrong-target production changes. -->

Many AWS mistakes are scope mistakes. An engineer updates staging while the incident is in production. A security group gets created in one Region and attached in another Region. A rollout fails because one private subnet has almost no free IP addresses. A responder reads CloudTrail in the logging account but forgets the app change happened in the production account.

The fix is a small habit with a short checklist. Before a production change, make account, role, Region, VPC, subnet, AZ spread, and resource ID visible in the ticket or runbook. The person doing the work can still move quickly, and the reviewer can see the exact target.

```bash
aws sts get-caller-identity --profile prod
aws configure get region --profile prod
aws ec2 describe-subnets --region eu-west-2 --profile prod --filters Name=vpc-id,Values=vpc-0123456789abcdef0
```

Example output:

```console
{
  "Account": "123456789012",
  "Arn": "arn:aws:sts::123456789012:assumed-role/ProdOperator/senlin"
}

eu-west-2

{
  "Subnets": [
    {
      "SubnetId": "subnet-0aaa1111",
      "VpcId": "vpc-0123456789abcdef0",
      "AvailabilityZone": "eu-west-2a",
      "AvailabilityZoneId": "euw2-az1",
      "CidrBlock": "10.40.10.0/24",
      "AvailableIpAddressCount": 218
    }
  ]
}
```

The account output answers who the command is acting as. The Region output answers which regional control plane the next commands will target. The subnet output answers which VPC and AZ the network placement uses, and the available IP count hints at rollout capacity.

A good production note for `northstar-photos` may say: "prod account `123456789012`, Region `eu-west-2`, VPC `vpc-0123456789abcdef0`, ECS service `photos-web`, private app subnets in `euw2-az1` and `euw2-az2`, database subnet group `prod-photos-db-subnets`." That sentence gives future responders a real target instead of a vague service name.

Here is the foundations-level checklist:

| Check | Why it matters |
|---|---|
| Account ID and active role | Prevents staging, sandbox, and prod confusion |
| Region | Prevents looking at the wrong regional control plane |
| VPC and subnet IDs | Confirms the private network placement |
| AZ IDs and available subnet IPs | Confirms spread and rollout capacity |
| Resource ARN or service ID | Confirms the exact object the change will touch |
| Owner and environment tags | Confirms the team and workload context |

During incidents, the same scope words help people divide work. One responder can inspect ALB and ECS in the app account and Region. Another can inspect central CloudTrail in the logging account. A database owner can inspect RDS in the same Region. The conversation stays grounded because everyone names the same account, Region, AZ, VPC, subnet, and resource.

![The review summary turns placement into a short pre-change checklist for account, Region, VPC, subnets, AZ spread, and shared-service access](/content-assets/articles/article-cloud-providers-aws-foundations-accounts-regions-availability-zones/placement-review-summary.png)

*The review summary turns placement into a short pre-change checklist for account, Region, VPC, subnets, AZ spread, and shared-service access.*


## What's Next
<!-- section-summary: After placement scope, the next foundation is exact resource identity through names, ARNs, and tags. -->

You now have the placement map for a first AWS workload. The app belongs to an account, runs in a Region, spreads across AZs, uses a VPC, and places resources in subnets that match their job.

The next article uses that placement map to identify the exact resources inside it. It explains friendly names, service IDs, ARNs, tags, ownership metadata, and the small checks that keep alerts, tickets, policies, and changes pointed at the same object.

## References

- [AWS Regions and Availability Zones](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions-availability-zones.html)
- [Regions and Zones for Amazon EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-regions-availability-zones.html)
- [Availability Zone IDs for your AWS resources](https://docs.aws.amazon.com/ram/latest/userguide/working-with-az-ids.html)
- [What is Amazon VPC?](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html)
- [How AWS Organizations works](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_introduction.html)
- [Service control policies](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html)
- [Temporary security credentials in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html)
- [AWS services that work with IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_aws-services-that-work-with-iam.html)
