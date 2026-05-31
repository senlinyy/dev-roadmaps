---
title: "Accounts, Regions, and Zones"
description: "Place cloud resources intentionally across account security barriers, geographic regions, and physical availability zones."
overview: "Physical and logical coordinates are the first decisions you make in AWS. This article details how to organize resources by account isolation, regional latency, and zone resilience."
tags: ["aws", "foundations", "accounts", "regions", "availability-zones"]
order: 2
id: article-cloud-providers-aws-foundations-accounts-regions-availability-zones
aliases:
  - cloud-providers/aws/foundations/accounts-regions-and-availability-zones.md
  - cloud-providers/aws/foundations/accounts-regions-availability-zones.md
---

## Table of Contents

1. [Collaborating with Your Team: Logical Account Perimeters](#collaborating-with-your-team-logical-account-perimeters)
2. [Isolating Environments by Risk Profiles](#isolating-environments-by-risk-profiles)
3. [Geographic Regional Placements for User Latency](#geographic-regional-placements-for-user-latency)
4. [Availability Zones and Physical Resiliency](#availability-zones-and-physical-resiliency)
5. [Zonal Subnets and Multi-AZ Design](#zonal-subnets-and-multi-az-design)
6. [Global, Regional, and Zonal Scopes](#global-regional-and-zonal-scopes)
7. [The Placement Review Habit](#the-placement-review-habit)
8. [What's Next](#whats-next)

## Collaborating with Your Team: Logical Account Perimeters

When you are the only developer working on a local laptop app, team collaboration is not a concern. You write code, test configurations, and modify local databases at will because your mistakes cannot affect anyone else.

However, the moment you move your application to the cloud to share it with users, your team begins to grow. You invite other developers, testers, and operations engineers to help manage the workload. In this shared environment, giving everyone direct access to a single cloud sandbox leads to immediate friction and critical errors. A developer attempting to clean up a staging test environment can accidentally delete the live, customer-facing database if all resources reside in the same flat area.

To prevent these accidents, you must establish logical boundaries. The strongest everyday boundary you can create in AWS is the AWS account. An account has its own unique 12-digit account ID, identity namespace, billing ledger, service quotas, and policy boundary. It is not a physical wall around servers, and it is not impossible to cross. Cross-account access is common in mature AWS environments, but it must be configured deliberately through trust policies, resource policies, organizations, or shared networking.

AWS makes this logical coordinate visible in every CLI session. Before running any command, you must verify which account ID and role your terminal is actively targeting:

```bash
$ aws sts get-caller-identity
{
  "Account": "123456789012",
  "Arn": "arn:aws:sts::123456789012:assumed-role/orders-prod-deployer/maya"
}
```

The Account field shows the exact logical container targeted by your session. The Arn field shows the assumed identity role.

Understanding this boundary changes how your team collaborates. By treating the account as a strong logical security perimeter, you ensure that raw developer experiments do not share the same default administrative space as production. A developer can run testing scripts or break databases in a development account without a default path to live customer transactions, because cross-account access has to be granted on purpose.

In a larger organization, these accounts should not be loose islands. AWS Organizations groups accounts into organizational units, and service control policies can set guardrails that accounts cannot opt out of. IAM Identity Center is the usual workforce access layer, giving humans temporary role sessions instead of long-lived IAM user keys. This keeps the beginner account model simple while matching how production AWS environments are normally governed.

![An infographic showing AWS placement as nested coordinates from account to Region to Availability Zone to subnet](/content-assets/articles/article-cloud-providers-aws-foundations-accounts-regions-availability-zones/aws-coordinate-nesting.png)

*AWS placement starts with logical isolation, then physical geography, then physical resilience. Check the account first, then the Region, then the Availability Zone and subnet where the resource actually lives.*

## Isolating Environments by Risk Profiles

Because the account is a strong logical perimeter, you should use separate accounts to isolate different stages of your application lifecycle. You do not need a separate account for every individual microservice, but you should split environments that require different administrative permissions or operate under different threat vectors.

At a minimum, keep production and non-production environments in completely isolated accounts. In a development account, developers need wide administrative access to experiment, destroy databases, and spin up new services. In a production account, permissions must be tightly restricted, allowing changes only through automated, audited deployment pipelines.

If you combine development and production in the same account, you rely on human tags and complex permissions to keep them separated. A simple credential leak or a developer targeting the wrong database URL can immediately corrupt live business data. Walled off in separate accounts (such as `orders-dev` and `orders-prod`), the dev environment can fail completely without affecting the stability of customer transactions.

## Geographic Regional Placements for User Latency

Once your team is collaborating safely within isolated logical accounts, you must decide where your application's servers will physically reside. AWS does not host all its servers in a single building. It organizes its global physical infrastructure into separate geographic Regions cabled in specific countries, such as `eu-west-2` in London, `us-east-1` in Virginia, or `ap-southeast-2` in Sydney.

Each Region is physically isolated and independent from other Regions. Most AWS services are Regional, meaning when you create a resource like a private network or database, it exists physically within the data centers of that chosen Region. Its Regional service endpoint is completely isolated from other territories.

Selecting your primary Region is a critical architectural decision based on user proximity and operational requirements:

* **User Latency**: Place your compute systems close to where your primary customer base is physically located to minimize round-trip packet times.
* **Compliance Regulations**: Ensure your data resides in physical territories that satisfy legal rules, such as European data residency laws.
* **Service Availability**: Confirm that the specific services and feature tiers your systems require are supported in the target Region. Some Regions or features require opt-in or have different availability.
* **Disaster Recovery**: Establish standbys in a secondary Region only for critical recovery objectives, rather than splitting resources across Regions by accident.

A common point of confusion is S3 object storage. While S3 bucket names are globally unique across all AWS accounts, you must still select a specific Region when creating a bucket. Your data remains physically locked to the data centers of that Region unless you explicitly configure replication rules.

## Availability Zones and Physical Resiliency

Within every geographic Region, AWS physical infrastructure is divided into isolated data center clusters called Availability Zones, commonly abbreviated as AZs. A Region typically contains three or more AZs, identified in your account by letters at the end of the Region name, such as `eu-west-2a`, `eu-west-2b`, and `eu-west-2c`.

An Availability Zone is not a single server rack. AWS describes each AZ as one or more discrete data centers with independent power, networking, and connectivity. AZs are physically separated inside a Region and connected by high-bandwidth, low-latency private links. That separation is the reason a well-designed workload can survive a localized infrastructure problem in one zone.

One cross-account gotcha matters early: AZ names are account-mapped. `us-east-1a` in one AWS account may not be the same physical zone as `us-east-1a` in another account. AWS also exposes stable AZ IDs, such as `use1-az1`, so platform teams can coordinate the same physical zone across accounts when they design shared networks or disaster recovery layouts.

Availability Zones address physical infrastructure survivability. While a Region asks which geographic country or territory your resources should inhabit, the Availability Zone asks how many physically isolated locations you should spread your app across to withstand local failures. If you run all application compute tasks in a single zone, your system has a single point of physical failure.

## Zonal Subnets and Multi-AZ Design

Start with the placement rule: a VPC is Regional, but a subnet is zonal. A Virtual Private Cloud (VPC) is the private network boundary you create inside one AWS Region. It can contain subnets in several Availability Zones in that Region. A subnet is smaller. It is one range of private IP addresses, and AWS attaches that range to exactly one Availability Zone.

That means choosing a subnet also chooses the physical zone where the resource lands. If you launch an EC2 instance, ECS task, load balancer node, or database network interface into a subnet in `eu-west-2a`, that network placement is tied to `eu-west-2a`. The VPC can still span the whole Region, but the resource's actual network doorway sits inside one zone.

This is why a Regional VPC by itself does not make an application resilient. If production has only one public subnet and one private subnet, both in the same Availability Zone, every important network path is still concentrated in that one physical location. When that zone has a power, cooling, fiber, or control-plane problem, the VPC may still exist, but your application has no healthy second subnet tier to use.

The beginner-friendly Multi-AZ pattern is to repeat the role of each subnet tier across zones. Create a public subnet in AZ A and another public subnet in AZ B for load balancer entry points. Create a private application subnet in AZ A and another private application subnet in AZ B for compute. Then configure the service with the full subnet list, so AWS can place healthy copies in more than one zone and stop sending traffic to the failed zone.

| Design object | Scope | Beginner rule |
| --- | --- | --- |
| VPC | Region | One private network boundary for the Region. |
| Subnet | One Availability Zone | Choosing the subnet chooses the physical zone. |
| Public/private tier | Repeated per zone | Copy the same tier role into at least two AZs. |
| Load-balanced service | Uses a subnet list | Give the service subnets in multiple AZs so it has somewhere healthy to run. |

![An infographic showing a Regional VPC duplicated across two Availability Zones with traffic continuing through the healthy zone when one zone fails](/content-assets/articles/article-cloud-providers-aws-foundations-accounts-regions-availability-zones/multi-az-placement.png)

*A VPC gives you one Regional network, but each subnet is still inside one AZ. Multi-AZ design means repeating the same public and private subnet roles in multiple AZs, then giving services the full subnet list so traffic can move to the healthy zone.*

## Global, Regional, and Zonal Scopes

As you build your cloud inventory, you will interact with resources that operate at different physical scales. AWS categorizes resources into three distinct scopes, which dictates how they fail, where they are visible in the console, and how you target them:

* **Zonal Scope**: Resources physically tied to a single Availability Zone, such as an EC2 instance, an EBS volume, or an individual subnet. If that zone has a physical outage, the zonal resource is directly impacted.
* **Regional Scope**: Resources owned by one Region, such as a VPC, an Application Load Balancer, an RDS database, or an S3 bucket. Regional scope means the resource is found through that Region's control plane. It does not automatically mean every deployment survives an AZ failure; RDS needs Multi-AZ configuration, and load balancers need enabled zones and healthy targets.
* **Global Scope**: Resources that operate across the entire global AWS partition, such as IAM roles, Route 53 DNS records, and CloudFront CDN distributions. They support your Regional workloads but are not owned by any single Region.

A common beginner mistake is searching for a Regional database while the console Region selector is set to the wrong Region, leading the developer to believe the resource has been deleted. Aligning your documentation with these scopes ensures you always target the correct resource coordinate.

![An infographic comparing AWS global, Regional, and zonal resource scopes with examples and failure boundaries](/content-assets/articles/article-cloud-providers-aws-foundations-accounts-regions-availability-zones/resource-scope-levels.png)

*Scope tells you where to look and how a resource fails. Some resources are global, most application resources are Regional, and the most failure-sensitive building blocks are tied to a single Availability Zone.*

## The Placement Review Habit

Establish a formal placement review as a standard engineering habit before creating any cloud resource. This review acts as an active sanity check to ensure that all logical and physical coordinate decisions are deliberate:

* **Logical Container**: Confirm that the target environment matches the correct account name and ID (e.g. `orders-prod` vs. `orders-dev`).
* **Geographic Home**: Verify that all Regional resources share a primary geographic Region (e.g. `eu-west-2`) to avoid cross-region latency and billing surprises.
* **Physical Resiliency**: Spread compute instances, load balancers, and database standbys across at least two physically isolated Availability Zones.
* **Scope Tracking**: Record global resources (like IAM roles) and zonal subnets in your architecture inventory to keep your topology auditable.

By documenting and validating logical perimeters, geographic regions, and physical zones at launch, you establish a resilient, organized coordinate system that keeps your cloud architecture stable and secure.

![A six-part summary infographic for AWS accounts, Regions, and zones covering account isolation, environment separation, Regional placement, Multi-AZ resilience, zonal subnets, and scope tracking](/content-assets/articles/article-cloud-providers-aws-foundations-accounts-regions-availability-zones/accounts-regions-zones-summary.png)

*Use this as the short placement checklist: isolate risk with accounts, split dev and prod, choose Regions deliberately, use AZ IDs for cross-account physical placement, spread resilient systems across AZs, remember subnets are zonal, and track every resource by scope.*

## What's Next

After you know which account, Region, and zone a system belongs in, you need a precise way to name the things you create there. The next article explains AWS resource identifiers, ARNs, tags, and naming habits so you can find the exact bucket, role, database, or subnet before changing it.

---

**References**

- [AWS Global Infrastructure](https://aws.amazon.com/about-aws/global-infrastructure/) - Detailed guide on the geographic regions, physical availability zones, and private network lines that form the AWS cloud.
- [AWS Account Isolation Boundaries](https://docs.aws.amazon.com/whitepapers/latest/organizing-your-aws-environment/aws-account-isolation-boundaries.html) - Best practices on using multiple accounts to establish strong logical security and billing perimeters.
- [AWS Regions and Availability Zones](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Subnets.html) - Documentation on Regional service endpoints, zonal subnets, and multi-zone deployment paths.
- [AZ IDs in AWS](https://docs.aws.amazon.com/RAM/latest/userguide/working-with-az-ids.html) - Guide on using AZ IDs for consistent physical zone identification across separate AWS accounts.
- [Service control policies](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html) - Explains organization-level permission guardrails.
- [AWS IAM Identity Center](https://docs.aws.amazon.com/singlesignon/latest/userguide/what-is.html) - Documents the recommended workforce access service for AWS accounts.
