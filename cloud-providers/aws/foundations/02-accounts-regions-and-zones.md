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

## Collaborating with Your Team: Logical Account Perimeters

When you are the only developer working on a local laptop app, team collaboration is not a concern. You write code, test configurations, and modify local databases at will because your mistakes cannot affect anyone else.

However, the moment you move your application to the cloud to share it with users, your team begins to grow. You invite other developers, testers, and operations engineers to help manage the workload. In this shared environment, giving everyone direct access to a single cloud sandbox leads to immediate friction and critical errors. A developer attempting to clean up a staging test environment can accidentally delete the live, customer-facing database if all resources reside in the same flat area.

To prevent these accidents, you must establish logical boundaries. The strongest logical boundary you can create in AWS is the AWS account. An account is a completely self-contained digital container. It features its own unique 12-digit account ID, independent identity namespace, separate billing ledger, dedicated service quotas, and absolute isolation from every other account.

AWS makes this logical coordinate visible in every CLI session. Before running any command, you must verify which account ID and role your terminal is actively targeting:

```bash
$ aws sts get-caller-identity
{
  "Account": "123456789012",
  "Arn": "arn:aws:sts::123456789012:assumed-role/orders-prod-deployer/maya"
}
```

The Account field shows the exact logical container targeted by your session. The Arn field shows the assumed identity role.

Understanding this wall changes how your team collaborates. By treating the account as a solid security perimeter, you ensure that raw developer experiments are physically isolated at the account edge. A developer can run testing scripts or break databases in their private workspace without any risk of affecting live customer transactions, because the account wall has no default administrative path across it.

![An infographic showing AWS placement as nested coordinates from account to Region to Availability Zone to subnet](/content-assets/articles/article-cloud-providers-aws-foundations-accounts-regions-availability-zones/aws-coordinate-nesting.png)

*AWS placement starts with logical isolation, then physical geography, then physical resilience. Check the account first, then the Region, then the Availability Zone and subnet where the resource actually lives.*

## Isolating Environments by Risk Profiles

Because the account is a solid perimeter, you must use separate accounts to isolate different stages of your application lifecycle. You do not need a separate account for every individual microservice, but you must split environments that require different administrative permissions or operate under different threat vectors.

At a minimum, keep production and non-production environments in completely isolated accounts. In a development account, developers need wide administrative access to experiment, destroy databases, and spin up new services. In a production account, permissions must be tightly restricted, allowing changes only through automated, audited deployment pipelines.

If you combine development and production in the same account, you rely on human tags and complex permissions to keep them separated. A simple credential leak or a developer targeting the wrong database URL can immediately corrupt live business data. Walled off in separate accounts (such as `orders-dev` and `orders-prod`), the dev environment can fail completely without affecting the stability of customer transactions.

## Geographic Regional Placements for User Latency

Once your team is collaborating safely within isolated logical accounts, you must decide where your application's servers will physically reside. AWS does not host all its servers in a single building. It organizes its global physical infrastructure into separate geographic Regions cabled in specific countries, such as `eu-west-2` in London, `us-east-1` in Virginia, or `ap-southeast-2` in Sydney.

Each Region is physically isolated and independent from other Regions. Most AWS services are Regional, meaning when you create a resource like a private network or database, it exists physically within the data centers of that chosen Region. Its Regional service endpoint is completely isolated from other territories.

Selecting your primary Region is a critical architectural decision based on user proximity and operational requirements:

* **User Latency**: Place your compute systems close to where your primary customer base is physically located to minimize round-trip packet times.
* **Compliance Regulations**: Ensure your data resides in physical territories that satisfy legal rules, such as European data residency laws.
* **Service Availability**: Confirm that the specific services and feature tiers your systems require are supported in the target Region.
* **Disaster Recovery**: Establish standbys in a secondary Region only for critical recovery objectives, rather than splitting resources across Regions by accident.

A common point of confusion is S3 object storage. While S3 bucket names are globally unique across all AWS accounts, you must still select a specific Region when creating a bucket. Your data remains physically locked to the data centers of that Region unless you explicitly configure replication rules.

## Availability Zones and Physical Resiliency

Within every geographic Region, AWS physical infrastructure is divided into isolated data center clusters called Availability Zones, commonly abbreviated as AZs. A Region typically contains three or more AZs, identified by letters at the end of the Region name, such as `eu-west-2a`, `eu-west-2b`, and `eu-west-2c`.

An Availability Zone is not a single server rack. It is a physically separate cluster of data centers, sitting on distinct flood plains, utilizing independent power grids, and featuring dedicated cooling systems and backup generators. AZs are cabled together with high-bandwidth, redundant, low-latency private fiber lines, but they are physically distant enough that a localized disaster (like a grid outage or flood) in one zone will not affect the others.

Availability Zones address physical infrastructure survivability. While a Region asks which geographic country or territory your resources should inhabit, the Availability Zone asks how many physically isolated locations you should spread your app across to withstand local failures. If you run all application compute tasks in a single zone, your system has a single point of physical failure.

## Zonal Subnets and Multi-AZ Design

To achieve physical resilience, you must understand how network design interacts with physical zones. While a Virtual Private Cloud (VPC) spans the entire Region, an individual subnet is strictly bound to a single Availability Zone.

This zonal nature means that simply having a regional VPC is not enough to survive failures. You must actively duplicate your subnet tiers across multiple Availability Zones and instruct your compute and database engines to deploy resources into those dynamic subnets.

![An infographic showing a Regional VPC duplicated across two Availability Zones with traffic continuing through the healthy zone when one zone fails](/content-assets/articles/article-cloud-providers-aws-foundations-accounts-regions-availability-zones/multi-az-placement.png)

*A VPC is Regional, but subnets are zonal. Multi-AZ designs repeat public and private subnet tiers across AZs so traffic can keep flowing when one physical zone fails.*

## Global, Regional, and Zonal Scopes

As you build your cloud inventory, you will interact with resources that operate at different physical scales. AWS categorizes resources into three distinct scopes, which dictates how they fail, where they are visible in the console, and how you target them:

* **Zonal Scope**: Resources physically tied to a single Availability Zone, such as an EC2 instance, an EBS volume, or an individual subnet. If that zone has a physical outage, the zonal resource is directly impacted.
* **Regional Scope**: Resources distributed across multiple zones in a single Region, such as a VPC, an Application Load Balancer, an RDS database, or an S3 bucket. They can survive zonal failures but remain isolated within the geographic Region boundary.
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

*Use this as the short placement checklist: isolate risk with accounts, split dev and prod, choose Regions deliberately, spread resilient systems across AZs, remember subnets are zonal, and track every resource by scope.*

---

**References**

- [AWS Global Infrastructure](https://aws.amazon.com/about-aws/global-infrastructure/) - Detailed guide on the geographic regions, physical availability zones, and private network lines that form the AWS cloud.
- [AWS Account Isolation Boundaries](https://docs.aws.amazon.com/whitepapers/latest/organizing-your-aws-environment/aws-account-isolation-boundaries.html) - Best practices on using multiple accounts to establish strong logical security and billing perimeters.
- [AWS Regions and Availability Zones](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Subnets.html) - Documentation on Regional service endpoints, zonal subnets, and multi-zone deployment paths.
- [AZ IDs in AWS](https://docs.aws.amazon.com/RAM/latest/userguide/working-with-az-ids.html) - Guide on using AZ IDs for consistent physical zone identification across separate AWS accounts.
