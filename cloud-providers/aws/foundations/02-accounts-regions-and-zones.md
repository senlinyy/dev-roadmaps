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

1. [Why Placement Has Coordinates](#why-placement-has-coordinates)
2. [Accounts as Security Boundaries](#accounts-as-security-boundaries)
3. [Organizations and Guardrails](#organizations-and-guardrails)
4. [Regions](#regions)
5. [Availability Zones](#availability-zones)
6. [AZ Names and AZ IDs](#az-names-and-az-ids)
7. [VPCs and Subnets](#vpcs-and-subnets)
8. [Multi-AZ Placement](#multi-az-placement)
9. [Global, Regional, and Zonal Resources](#global-regional-and-zonal-resources)
10. [A Placement Review Checklist](#a-placement-review-checklist)
11. [References](#references)

## Why Placement Has Coordinates
<!-- section-summary: AWS placement has logical coordinates and physical coordinates, and both shape security, latency, resilience, cost, and operations. -->

The service map gave Northstar Shop a working chain: DNS, load balancer, private compute, database, object storage, IAM roles, logs, budgets, and backups. The next question is placement. Which account owns those resources? Which Region serves the users? Which Availability Zones hold the compute and database? Which subnets can receive internet traffic? Which resources need to exist once, and which resources need copies in multiple places?

Let's keep using a small ecommerce app as the working scenario. The team has a `storefront-api`, a background worker, a database, product image storage, and a reporting job. In development, everything can live in one local environment. In AWS, production needs stronger boundaries because one bad permission, one wrong Region, or one single-zone database can turn a small mistake into a real outage.

AWS placement has two kinds of coordinates. **Accounts** are logical security, billing, and management boundaries. **Regions and Availability Zones** are geographic and physical fault boundaries. **VPCs and subnets** connect those two worlds because they place network paths inside a Region and across specific zones.

The main habit is simple to say and important to practice: **place resources intentionally before traffic depends on them**. After customers use the app, moving a database to another Region, splitting a production account, or rebuilding subnets across zones can take serious migration work. A little placement review early saves a lot of repair work later.

We start with accounts because every resource has to belong to one.

![Infographic showing AWS placement coordinates nested from account to Region, Availability Zone, subnet, and resource](/content-assets/articles/article-cloud-providers-aws-foundations-accounts-regions-availability-zones/aws-placement-coordinates.png)

*Placement works from broad ownership to exact network location: account, Region, Availability Zone, subnet, and finally the resource that runs or stores part of the app.*

## Accounts as Security Boundaries
<!-- section-summary: An AWS account is the first strong ownership boundary for resources, permissions, billing, quotas, and audit records. -->

An **AWS account** is a container for AWS resources, identities, billing activity, service quotas, and CloudTrail events. It has a 12-digit account ID, its own root user, its own IAM resources, and its own set of service resources. A production database in one account uses separate IAM users, security groups, and CloudTrail event history from a development database in another account.

Think about the ecommerce team. A junior developer needs room to test a new reporting worker. The production checkout database holds real customer orders. Putting those two workloads in the same account means a broad development permission can accidentally touch production. Separate accounts create a stronger boundary: `storefront-dev` for experiments, `storefront-stage` for release rehearsal, and `storefront-prod` for customer traffic.

Accounts also help with cost and ownership. A bill from the production account tells a different story from a bill from a sandbox account. Service quotas also live at the account and Region level for many services, so a load test in a sandbox account is less likely to consume a quota that production needs. CloudTrail evidence stays separated by environment because the prod account records prod actions.

The first hands-on account check usually confirms where the current credentials point:

```bash
aws sts get-caller-identity
```

The output includes the account ID and ARN for the active caller. Teams often keep a small account map in their internal docs:

| Account name | Account ID | Purpose | Normal access path |
|---|---|---|---|
| `storefront-dev` | `111111111111` | Developer testing and early integration | Identity Center developer role |
| `storefront-stage` | `222222222222` | Release rehearsal with production-like settings | Identity Center release role |
| `storefront-prod` | `333333333333` | Customer traffic and customer data | Break-glass admin plus scoped operator roles |

That map is operationally useful. During an incident, a person can compare `aws sts get-caller-identity` with the map before touching infrastructure. During a review, the team can ask whether a new resource belongs in dev, stage, prod, or a shared services account.

As the number of accounts grows, the team needs a way to manage them together. That is where AWS Organizations enters the picture.

## Organizations and Guardrails
<!-- section-summary: AWS Organizations groups accounts under central management and uses guardrails such as SCPs to set maximum allowed behavior. -->

**AWS Organizations** is the AWS service for grouping accounts under central management. It gives the company a management account, member accounts, organizational units, consolidated billing, and policy controls. An **organizational unit**, usually called an OU, is a folder-like grouping for accounts such as `Sandbox`, `Workloads`, `Security`, or `Suspended`.

Organizations matters because account separation creates a new management question. The company may want every production account to keep CloudTrail enabled, block unapproved Regions, prevent public S3 buckets, and deny risky root-user actions. Manual checks in each account create fragile operations work as the account count grows.

The most common guardrail here is a **service control policy**, or **SCP**. An SCP sets the maximum permissions available to IAM users and roles in member accounts. IAM policies inside the account still grant the working permissions underneath that ceiling. If an SCP blocks leaving approved Regions, that Region request fails even when an IAM policy looks broad.

Here is a small SCP pattern that allows actions only in approved Regions while leaving global services room to operate. Real policies need testing because many AWS services call global endpoints or support only specific condition keys.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyOutsideApprovedRegions",
      "Effect": "Deny",
      "NotAction": [
        "iam:*",
        "organizations:*",
        "route53:*",
        "cloudfront:*",
        "support:*"
      ],
      "Resource": "*",
      "Condition": {
        "StringNotEquals": {
          "aws:RequestedRegion": [
            "us-east-1",
            "us-west-2"
          ]
        }
      }
    }
  ]
}
```

The production habit is to test guardrails carefully. A team can attach a new SCP to a sandbox OU first, run normal deployment and incident-response commands, then move the policy toward staging and production OUs after the evidence looks good. AWS documentation for SCP examples gives the same caution because a broad deny can block administrators and automation.

Useful Organizations checks include:

```bash
aws organizations list-accounts

aws organizations list-roots

aws organizations list-policies \
  --filter SERVICE_CONTROL_POLICY

aws organizations list-policies-for-target \
  --target-id ou-abcd-12345678 \
  --filter SERVICE_CONTROL_POLICY
```

Those commands show which accounts exist, which root or OU contains them, and which SCPs attach to a target. In real companies, a security or platform team usually owns the organization structure, while application teams own the resources inside their assigned workload accounts.

After account boundaries and guardrails, the next placement coordinate is geography. That is the Region.

## Regions
<!-- section-summary: A Region is a geographic area where AWS offers services, and the Region choice affects latency, data residency, service availability, cost, and disaster recovery. -->

An **AWS Region** is a geographic area where AWS runs multiple isolated Availability Zones and offers regional service endpoints. Examples include `us-east-1`, `us-west-2`, `eu-west-1`, and `ap-southeast-2`. Most AWS resources you create belong to one Region, and most AWS CLI commands use a Region to decide which endpoint to call.

For the ecommerce app, the first production Region might be `us-east-1` because most customers are in the eastern United States and the required services are available there. A European reporting product might choose `eu-west-1` or another European Region for latency and data residency. A global product might start with one primary Region and later add a second Region for disaster recovery or local user experience.

Region choice usually balances several practical questions:

| Question | Why it matters |
|---|---|
| Where are the users? | Shorter network distance usually helps latency-sensitive requests. |
| Where can the data legally live? | Privacy, contract, and regulatory rules may limit placement. |
| Which services and instance types exist there? | Newer services and capacity types can vary by Region. |
| How much does it cost there? | Service pricing and data transfer patterns vary. |
| What is the recovery plan? | A single-Region app needs a different outage plan from a multi-Region app. |

The CLI makes Region context visible:

```bash
aws configure get region

aws ec2 describe-regions \
  --query 'Regions[].RegionName' \
  --output table

aws account list-regions \
  --query 'Regions[].{Region:RegionName,Status:RegionOptStatus}' \
  --output table
```

The first command shows the default Region for the active profile. The second lists Regions known to the EC2 API. The third shows the account's Region opt-in status when the caller has permission to use the Account Management API. That last check helps when a team wonders why a newer Region is unavailable in one account.

Regions are large placement boundaries. Inside each Region, AWS gives a smaller fault boundary called an Availability Zone.

## Availability Zones
<!-- section-summary: Availability Zones are isolated locations inside a Region, and spreading resources across them helps an app continue through a single-zone failure. -->

An **Availability Zone**, or **AZ**, is an isolated location inside a Region. Each Region has multiple AZs, and AWS designs them with independent power, cooling, and physical separation while connecting them through low-latency networking. The usual production lesson is straightforward: a workload that matters should avoid depending on only one AZ.

For the `storefront-api`, a single-AZ layout might place one load balancer subnet, one API task subnet, and one database instance in `us-east-1a`. That can work for a demo. Production usually spreads the entry point and service capacity across at least two AZs, such as `us-east-1a` and `us-east-1b`. If one AZ has trouble, the app has already placed capacity in another zone.

The exact service decides how multi-AZ placement works. An Application Load Balancer uses subnets in multiple AZs. An ECS service can run tasks across subnets in multiple AZs. An RDS Multi-AZ deployment keeps a standby in a different AZ for higher availability. S3 is regional and stores data redundantly across multiple AZs behind the service, so object placement belongs to the service rather than to a chosen AZ.

A useful AZ check is:

```bash
aws ec2 describe-availability-zones \
  --region us-east-1 \
  --query 'AvailabilityZones[].{Name:ZoneName,Id:ZoneId,State:State}' \
  --output table
```

That command shows both the AZ name and the AZ ID. The name is the familiar value like `us-east-1a`. The ID is the stable cross-account coordinate like `use1-az1`. The difference matters enough to deserve its own section.

## AZ Names and AZ IDs
<!-- section-summary: AZ names are account-facing labels, while AZ IDs identify the same physical zone across accounts and remove cross-account placement confusion. -->

AWS shows AZs with friendly names such as `us-east-1a`, `us-east-1b`, and `us-east-1c`. Those names are easy to read inside one account. Across accounts, the same name can point to different physical locations in Regions where AWS independently maps AZ names. One account's `us-east-1a` may line up with another account's `us-east-1c`.

An **AZ ID** solves that coordination problem. The AZ ID is a stable identifier for the physical Availability Zone across accounts. For example, `use1-az1` refers to the same physical AZ for accounts that can use it. When teams coordinate networking, shared services, data replication, or multi-account placement, AZ IDs are the safer language.

Here is the kind of mistake AZ IDs prevent. The platform team builds shared networking in a central account. The application team builds private subnets in a workload account. Both teams say "place the first subnet in `us-east-1a`." If those account-facing names map differently, the two subnets may land in different physical zones. If both teams say "use the AZ ID `use1-az1` for the first subnet," they are talking about the same physical location.

The CLI can show the mapping for an account:

```bash
aws ec2 describe-availability-zones \
  --region us-east-1 \
  --query 'AvailabilityZones[].{ZoneName:ZoneName,ZoneId:ZoneId}' \
  --output table
```

A production habit is to record the intended AZ IDs for a workload, then let infrastructure code map them to the account's local zone names when it creates subnets. That habit helps multi-account teams keep "AZ 1" and "AZ 2" consistent without trusting letter names.

Most application teams first touch AZ placement through subnets. A VPC is regional, but each subnet sits inside one AZ.

![Infographic comparing Account A and Account B AZ names with stable AZ IDs across the same physical zones](/content-assets/articles/article-cloud-providers-aws-foundations-accounts-regions-availability-zones/az-name-id-mapping.png)

*AZ IDs give multi-account teams a stable way to talk about the same physical zone even when each account shows different letter names.*

## VPCs and Subnets
<!-- section-summary: A VPC spans a Region, while each subnet lives in one Availability Zone and gives resources a specific network placement. -->

A **VPC** is a virtual network inside one Region. It has an IP range, route tables, gateways, and network controls. A **subnet** is a range of IP addresses inside the VPC, and each subnet lives entirely within one Availability Zone. Each subnet stays inside a single zone.

This distinction is one of the most important placement facts in AWS networking. The VPC gives the `storefront-prod` app one regional network boundary. The subnets place resources into specific AZs. A common production layout creates matching subnet sets in at least two AZs:

| Subnet type | Example AZ ID | Purpose |
|---|---|---|
| Public subnet A | `use1-az1` | Load balancer node, NAT gateway if used |
| Private app subnet A | `use1-az1` | API tasks or instances |
| Private data subnet A | `use1-az1` | Database subnet group member |
| Public subnet B | `use1-az2` | Load balancer node, NAT gateway if used |
| Private app subnet B | `use1-az2` | API tasks or instances |
| Private data subnet B | `use1-az2` | Database subnet group member |

The route table decides what each subnet can reach. Public subnets usually have a route to an internet gateway. Private subnets usually avoid direct inbound internet access and may use a NAT gateway or VPC endpoints for outbound or private service access. Security groups then control which resources can talk to each other.

The subnet review uses these checks:

```bash
aws ec2 describe-vpcs \
  --query 'Vpcs[].{VpcId:VpcId,Cidr:CidrBlock,Default:IsDefault}'

aws ec2 describe-subnets \
  --filters Name=vpc-id,Values=vpc-1234567890abcdef0 \
  --query 'Subnets[].{SubnetId:SubnetId,AzName:AvailabilityZone,AzId:AvailabilityZoneId,Cidr:CidrBlock,PublicIp:MapPublicIpOnLaunch}' \
  --output table

aws ec2 describe-route-tables \
  --filters Name=vpc-id,Values=vpc-1234567890abcdef0 \
  --query 'RouteTables[].{RouteTableId:RouteTableId,Routes:Routes}'
```

Those commands answer where the network exists, which zones the subnets occupy, and which routes traffic can follow. For production, the app should have enough subnet coverage for the services that need multi-AZ placement. A load balancer with one subnet, a database subnet group with one AZ, or an ECS service pinned to one private subnet are all signs that the placement needs another look.

Now we can connect the subnet layout to the production pattern most teams use: multi-AZ placement.

## Multi-AZ Placement
<!-- section-summary: Multi-AZ placement spreads the entry point, application capacity, and stateful services so one zone failure has a smaller blast radius. -->

**Multi-AZ placement** means the workload has useful resources in more than one Availability Zone. The goal goes beyond drawing two boxes on a diagram. Real traffic can continue when one zone has trouble because the app already has a working entry point, compute capacity, network route, and data strategy outside that zone.

For the ecommerce app, the entry point is an Application Load Balancer with at least two enabled AZs. The API runs tasks in private subnets in those same AZs. The database uses RDS Multi-AZ or another service-specific high-availability pattern. The reporting worker can run in multiple app subnets, and its queue is regional, so a worker in another AZ can continue processing messages.

Verification should compare the intended diagram with the actual resources:

```bash
aws elbv2 describe-load-balancers \
  --names storefront-prod \
  --query 'LoadBalancers[].AvailabilityZones[].{ZoneName:ZoneName,SubnetId:SubnetId}'

aws ecs describe-services \
  --cluster storefront-prod \
  --services storefront-api \
  --query 'services[].networkConfiguration.awsvpcConfiguration.subnets'

aws rds describe-db-instances \
  --db-instance-identifier storefront-prod \
  --query 'DBInstances[].{MultiAZ:MultiAZ,AvailabilityZone:AvailabilityZone,SecondaryAZ:SecondaryAvailabilityZone}'
```

Those checks show whether the load balancer spans zones, whether ECS has multiple subnet choices, and whether RDS Multi-AZ is enabled for the database instance. For services with their own high-availability model, the check changes. DynamoDB is regional. S3 is regional. EBS volumes are zonal. The team needs to learn the scope of each service it chooses.

A strong multi-AZ review also looks for hidden single-zone dependencies. A NAT gateway in only one AZ can pull private subnet egress through that one zone. A manually chosen EC2 instance can sit alone in one subnet. A database read replica can live in the same AZ as the primary. A scheduled job can run on a single instance. These details matter because the app follows the weakest dependency during a zone event.

The next section names the scope categories directly so placement reviews have the right vocabulary.

## Global, Regional, and Zonal Resources
<!-- section-summary: AWS resources have different scopes, and that scope determines where they are created, how they fail, how they are addressed, and how teams duplicate them. -->

AWS resources usually fit into three placement scopes: **global**, **regional**, and **zonal**. The scope tells you where the resource lives and how your team should think about duplication, failover, CLI Regions, and naming.

**Global resources** are managed outside a single normal workload Region. IAM is a common example for identities and policies. Amazon Route 53 and Amazon CloudFront also operate as global services for DNS and content delivery use cases. Global resources still have AWS service architecture behind them, but your team usually manages them without choosing a normal workload Region for every resource.

**Regional resources** belong to one Region. VPCs, S3 buckets, SQS queues, DynamoDB tables, many Lambda functions, and many ECS clusters are regional concepts. A bucket name has global uniqueness rules within a partition, but the bucket itself has a Region. A regional resource usually needs a separate copy, replication plan, or failover design when the app expands to another Region.

**Zonal resources** belong to one Availability Zone. EC2 instances, EBS volumes, and subnets are common examples. If the app needs resilience across AZs, zonal resources need counterparts in other zones or a managed service that handles the multi-AZ behavior for the team.

Here is the placement cheat sheet for the ecommerce app:

| Resource | Typical scope | Review question |
|---|---|---|
| IAM role for the deploy pipeline | Global within the account | Which accounts can assume it, and what can it change? |
| Route 53 hosted zone | Global service | Which records point users to the app entry point? |
| CloudFront distribution | Global service | Which origins and cache behaviors send traffic to the Region? |
| VPC | Regional | Which Region owns this network boundary? |
| S3 bucket for product images | Regional bucket with globally unique name | Which Region stores the objects, and does replication matter? |
| SQS queue for order events | Regional | Does the worker run in the same Region as the queue? |
| Subnet | Zonal | Which AZ ID holds this IP range? |
| EC2 instance or EBS volume | Zonal | What replaces it if the zone fails? |

Scope also affects CLI habits. If a command returns nothing, the first question is often "am I looking in the right account and Region?" A developer can have valid credentials and still query an empty Region. Global services make that feel inconsistent at first because IAM may show data without a workload Region while EC2 or RDS needs the correct Region.

The final step is turning all of this into a checklist a beginner can use during design review.

## A Placement Review Checklist
<!-- section-summary: A good placement review checks account ownership, guardrails, Region choice, AZ spread, subnet scope, resource scope, and evidence before production traffic arrives. -->

A placement review works best when it has concrete answers. The team needs practical placement clarity more than perfect architecture language. It needs enough evidence to avoid obvious production traps and review the choices later.

**Account ownership:** The resource belongs to the right account for its risk level. Development experiments stay out of production. Production customer data stays in a production account. Shared networking, security tooling, and logging accounts have clear owners.

**Organization guardrails:** The account sits in the right OU. SCPs and other guardrails match the account's purpose. New guardrails receive sandbox testing before they reach production accounts. A person can list which guardrails apply to the target account.

**Region choice:** The Region matches users, data rules, service availability, cost expectations, and recovery plans. The team records why the Region was chosen, which Regions are allowed by policy, and whether the Region needs opt-in.

**AZ spread:** Customer-facing and stateful production paths use at least two AZs when the chosen service supports it. The team checks actual resource placement with CLI output rather than trusting names in a diagram.

**AZ ID coordination:** Multi-account designs use AZ IDs for consistent physical placement. The team records the intended AZ IDs and maps them to local AZ names per account.

**VPC and subnet scope:** The VPC is regional. Each subnet is zonal. Public subnets contain entry-point resources. Private app and data subnets hold internal compute and databases. Route tables and security groups match the intended traffic path.

**Resource scope:** The team knows which resources are global, regional, and zonal. Regional resources have replication or recovery plans if the business needs another Region. Zonal resources have replacements, managed failover, or accepted single-zone risk.

**Evidence and operations:** CloudTrail, logs, tags, and account maps make placement visible after the fact. A new engineer can answer "which account, which Region, which AZs, which subnets, and which role" without guessing.

This checklist gives beginners a strong first production habit. Before creating a resource, they ask where it belongs. Before approving a design, they ask what happens if the account, Region, or AZ assumption is wrong. AWS has many services, but placement discipline stays useful across all of them.

![Six-panel placement review summary infographic covering account, guardrails, Region, AZ spread, subnets, and resource scope](/content-assets/articles/article-cloud-providers-aws-foundations-accounts-regions-availability-zones/placement-review-summary.png)

*The placement review summary turns the article into a quick production checklist: ownership, guardrails, geography, zone spread, subnet tiers, and resource scope.*

## References

- [What is AWS Organizations](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_introduction.html) - Describes centralized management for multiple AWS accounts and organization policies.
- [Service control policies](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html) - Explains SCPs and their role as maximum permission guardrails.
- [SCP examples and testing guidance](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps_examples.html) - Provides SCP examples and cautions about testing before broad rollout.
- [AWS Regions and Availability Zones](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-availability-zones.html) - Defines Regions, Availability Zones, and AZ IDs.
- [AZ IDs](https://docs.aws.amazon.com/global-infrastructure/latest/regions/az-ids.html) - Explains why AZ IDs help coordinate physical zones across accounts.
- [Subnets for your VPC](https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html) - Documents that each subnet resides entirely within one Availability Zone.
- [What is Amazon VPC](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html) - Defines VPCs, subnets, route tables, gateways, and connectivity features.
- [Regional services](https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/regional-services.html) - Describes regional services built across multiple Availability Zones.
- [Global services](https://docs.aws.amazon.com/whitepapers/latest/aws-fault-isolation-boundaries/global-services.html) - Describes AWS global service scope and service design considerations.
- [Manage Amazon EC2 resources](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/resources.html) - Documents regional and zonal scope for EC2 resources such as AMIs and instances.
