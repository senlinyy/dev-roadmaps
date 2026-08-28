---
title: "Accounts, Regions, and Availability Zones"
description: "Understand how AWS accounts, Regions, Availability Zones, VPCs, and subnets create separate ownership, location, failure, and network boundaries."
overview: "An AWS resource has several coordinates. Learn which boundary owns it, where it runs, which failures it is exposed to, which private network it uses, and how to confirm that scope before making a change."
tags: ["aws", "foundations", "accounts", "regions", "availability-zones"]
order: 2
id: article-cloud-providers-aws-foundations-accounts-regions-availability-zones
aliases:
  - cloud-providers/aws/foundations/accounts-regions-and-availability-zones.md
  - cloud-providers/aws/foundations/accounts-regions-availability-zones.md
---

## Table of Contents

1. [Which Question Does Each AWS Boundary Answer?](#which-question-does-each-aws-boundary-answer)
2. [What Does an AWS Account Own and Control?](#what-does-an-aws-account-own-and-control)
3. [How Does a Region Choose the Workload's Location?](#how-does-a-region-choose-the-workloads-location)
4. [Why Does a Workload Use More Than One Availability Zone?](#why-does-a-workload-use-more-than-one-availability-zone)
5. [How Do VPCs and Subnets Place Resources on a Network?](#how-do-vpcs-and-subnets-place-resources-on-a-network)
6. [How Do Global, Regional, and Zonal Scopes Differ?](#how-do-global-regional-and-zonal-scopes-differ)
7. [How Do Separate Accounts Share Access and Services?](#how-do-separate-accounts-share-access-and-services)
8. [What Should You Check Before Changing a Resource?](#what-should-you-check-before-changing-a-resource)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

AWS infrastructure is often drawn as a tree: accounts contain Regions, Regions contain Availability Zones, and Availability Zones contain networks and resources. The picture is useful, but treating every term as another folder hides the engineering reason each boundary exists.

The boundaries answer different questions:

```text
AWS account
Who owns, controls, and pays for the resource?

Region
In which geographic AWS location does it run?

Availability Zone
In which local infrastructure failure domain does it run?

VPC
Which private network is it attached to?

Subnet
Which Availability Zone-specific part of that network is it attached to?
```

An application also needs answers to several independent design questions. Who may create or control it? Who receives the bill? Where in the world should it run? What happens if part of that location fails? Which network carries its traffic? How does it communicate with systems owned by other teams? AWS uses different boundaries because one boundary cannot answer all of those questions well.

Keep these questions in view as you work through the lesson:

1. **Which Question Does Each AWS Boundary Answer?**
2. **What Does an AWS Account Own and Control?**
3. **How Does a Region Choose the Workload's Location?**
4. **Why Does a Workload Use More Than One Availability Zone?**
5. **How Do VPCs and Subnets Place Resources on a Network?**
6. **How Do Global, Regional, and Zonal Scopes Differ?**
7. **How Do Separate Accounts Share Access and Services?**
8. **What Should You Check Before Changing a Resource?**

## Which Question Does Each AWS Boundary Answer?
<!-- section-summary: Accounts, Regions, Availability Zones, VPCs, and subnets are separate coordinates that answer ownership, geography, failure, network, and placement questions. -->

A simplified organization can be pictured like this:

```text
AWS Organization
│
├── Production account
│   ├── Region: eu-west-2
│   │   ├── VPC: production-vpc
│   │   │   ├── AZ A
│   │   │   │   └── Subnet A
│   │   │   ├── AZ B
│   │   │   │   └── Subnet B
│   │   │   └── AZ C
│   │   │       └── Subnet C
│   │   └── other regional resources
│   └── Region: us-east-1
│       └── other resources
│
├── Development account
│   └── resources in its chosen Regions
│
└── Shared Services account
    └── shared resources
```

The drawing must be read carefully. The production account does not physically sit inside one Region. The same account can own resources in `eu-west-2`, `eu-west-1`, `us-east-1`, and other Regions at the same time. The account supplies the ownership coordinate; the Region supplies the geographic coordinate.

Together, these boundaries control **blast radius**: the amount of the organization or workload that one mistake, credential problem, network change, or infrastructure failure can affect.

![The placement coordinates show how account, Region, Availability Zone, VPC, subnet, and resource ID answer different parts of the same scope question](/content-assets/articles/article-cloud-providers-aws-foundations-accounts-regions-availability-zones/aws-placement-coordinates.png)

*A resource has several coordinates because ownership, geography, failure isolation, and network placement are different concerns.*

## What Does an AWS Account Own and Control?
<!-- section-summary: An AWS account is a strong ownership, security, billing, governance, and operational blast-radius boundary around resources. -->

An **AWS account** is primarily an ownership, security, and administrative boundary. Resources such as EC2 instances, S3 buckets, RDS databases, IAM roles, VPCs, and CloudWatch resources normally belong to a particular account.

A company could place production applications, development environments, security tools, central networking, and finance systems in one account. That design creates one large blast radius. A developer with excessive permissions could affect production. Billing is harder to separate. Service quotas are shared. A faulty automation run can touch unrelated workloads. Security policy and audit evidence become harder to reason about because many responsibilities occupy the same boundary.

Organizations therefore commonly separate responsibilities:

```text
AWS Organization
├── Production account
├── Development account
├── Security account
├── Networking account
├── Logging account
└── Shared Services account
```

The account split provides several independent benefits.

### Accounts separate permissions

A developer might receive broad permissions in a development account but only read access or a narrowly scoped operational role in production:

```text
Developer
   ├── Development account → broad development permissions
   └── Production account  → restricted or read-only permissions
```

An error made with development permissions remains on the development side of the account boundary unless cross-account access was deliberately granted.

### Accounts separate billing and quotas

Costs can be attributed to the account that owns the resources:

```text
Development account → £20,000
Production account  → £100,000
Security account    → £10,000
```

This separation makes ownership visible and reduces the number of unrelated workloads competing within the same account-level limits.

### Accounts limit operational blast radius

If automation deletes or changes resources in one account, a correct account boundary makes it less likely that the same mistake reaches another. The boundary is not a guarantee by itself—cross-account roles and organization-wide automation still need careful design—but it creates a strong default separation.

### Organizations govern accounts

AWS Organizations groups member accounts and can apply organization policies to them. This allows a company to maintain separate owners while still enforcing central controls. A production account, development account, and security account can have different daily permissions while remaining governed by the same organization.

The account should therefore be read as the answer to: **which administrative owner controls this resource?** It is not the physical location of a server.

### The owner and the acting identity are different

An account owns resources. An IAM identity determines who can act on those resources. For example:

```text
Production AWS account
├── production database
├── application VPC
└── IAM role: ProductionOperator
```

Alice may authenticate through the company's identity system and then assume `ProductionOperator` in that account:

```text
human identity
    ↓ assumes
IAM role
    ↓ receives permission to change
resources
    ↓ owned by
AWS account
```

This distinction becomes essential in multi-account environments. Alice does not become the account, and the account is not an identity. She crosses the ownership boundary through a role that states what she may do there.

## How Does a Region Choose the Workload's Location?
<!-- section-summary: A Region is a major geographic deployment boundary chosen for latency, legal obligations, service support, recovery strategy, cost, and system proximity. -->

After selecting the account that owns the workload, the team still needs to choose where the infrastructure runs. An AWS **Region** is a major geographic deployment boundary. Region codes include `eu-west-2`, `us-east-1`, and `ap-southeast-2`.

The code is less important than the decision behind it. A team may choose a Region because of:

- latency to users;
- legal or regulatory requirements;
- data-residency obligations;
- availability of the AWS services the application needs;
- a disaster-recovery plan;
- cost; or
- proximity to other systems that exchange data with the application.

If most users are in the United Kingdom, placing the application in London can provide a shorter network path than placing it in a distant Region. If regulated data must remain in an approved geography, that obligation may determine the choice even before latency and cost are compared.

An account and a Region remain independent dimensions:

```text
Production account
├── London Region
│   └── primary application
└── Ireland Region
    └── disaster-recovery resources
```

The account answers **who owns these resources**. The Region answers **where these resources run**. The same production account can use both Regions.

AWS uses Regions because one worldwide infrastructure location would create an enormous shared failure domain. A sufficiently large power failure, network failure, natural disaster, software fault, or regulatory problem could affect everything placed there. Geographic separation allows an organization to design for a whole-Region problem:

```text
Region 1                    Region 2
┌────────────────┐          ┌────────────────┐
│ infrastructure │          │ infrastructure │
│ infrastructure │          │ infrastructure │
└────────────────┘          └────────────────┘

         separate geographic failure boundaries
```

Choosing a second Region does not automatically create a working disaster-recovery system. Data, configuration, networking, DNS, permissions, and operating procedures must also support the recovery path. The Region boundary simply gives the architecture a separate geographic place in which that path can exist.

## Why Does a Workload Use More Than One Availability Zone?
<!-- section-summary: Availability Zones create local infrastructure failure boundaries inside one Region, allowing a workload to keep capacity outside the failed zone. -->

Selecting the production account and London Region still leaves the application exposed to local infrastructure failure. Power, cooling, networking, or physical infrastructure can fail in one part of the Region. If the whole workload occupies that one location, the local failure can remove the whole application.

AWS divides a Region into multiple **Availability Zones**, usually called **AZs**:

```text
Region
├── Availability Zone A
├── Availability Zone B
└── Availability Zone C
```

An AZ is a local infrastructure failure boundary within a Region. AZs are close enough to communicate over high-speed regional networking while being isolated so that many local failures should not affect all zones at the same time.

Consider a workload placed entirely in AZ A:

```text
AZ A
├── web server
├── application server
└── database
```

If AZ A becomes unavailable, every listed component becomes unavailable with it. A Multi-AZ architecture instead distributes the application:

```text
                 Load Balancer
                      │
             ┌────────┴────────┐
             ▼                 ▼

          AZ A                AZ B
     ┌────────────┐      ┌────────────┐
     │ app server │      │ app server │
     └────────────┘      └────────────┘

              database design
                spanning AZs
```

If AZ A fails, capacity in AZ B can continue serving traffic. Multi-AZ architecture is therefore primarily a resilience strategy for local infrastructure failure. It is not mainly a performance feature.

Failure protection must match the size of the failure:

| Failure | Example | Protection model |
|---|---|---|
| Machine or component failure | One server stops | Multiple instances or managed-service redundancy |
| Availability Zone failure | One local AWS location is unavailable | Multi-AZ architecture |
| Regional failure | A major geographic AWS location is unavailable | Multi-Region architecture |

An AZ is sometimes described as one data center to make the idea approachable. The safer model is an independently operated infrastructure location or failure domain. Application design should rely on the logical boundary AWS exposes rather than assumptions about individual physical buildings.

### AZ names can differ between accounts

Names such as `eu-west-2a`, `eu-west-2b`, and `eu-west-2c` look universal, but the letter can map differently in different accounts. `eu-west-2a` in account A does not necessarily identify the same physical AZ as `eu-west-2a` in account B.

AWS provides stable **Availability Zone IDs** for cross-account correlation. The same physical AZ may appear as `AZ a` in one account and `AZ c` in another while both names refer to the same AZ ID:

```text
Account A                 Account B
"AZ a"                    "AZ c"
   │                          │
   └──────── same AZ ID ──────┘
```

Friendly AZ names are normally sufficient inside one account. AZ IDs matter when network or infrastructure teams coordinate physical placement across accounts.

![The AZ mapping view explains why teams compare Availability Zone IDs when account-specific AZ names may differ](/content-assets/articles/article-cloud-providers-aws-foundations-accounts-regions-availability-zones/az-name-id-mapping.png)

*An AZ ID gives cross-account teams a stable way to refer to the same local failure domain.*

## How Do VPCs and Subnets Place Resources on a Network?
<!-- section-summary: A VPC is a regional private network, while each subnet places resources in one Availability Zone-specific segment of that network. -->

Accounts answer ownership, Regions answer geography, and AZs answer local failure placement. Resources still need an address space, routes, and controlled network relationships. AWS provides a **Virtual Private Cloud**, or **VPC**, for that job.

A VPC is a private, logically isolated network defined inside one AWS Region. It includes IP address ranges, routing, connectivity, and network security relationships. For example:

```text
Production account
└── London Region
    └── VPC 10.0.0.0/16
```

The VPC belongs to one account and one Region. It is not global, and it is not limited to one AZ. A VPC can span several AZs within its Region:

```text
Production account
└── London Region
    └── VPC 10.0.0.0/16
        ├── subnets in AZ A
        ├── subnets in AZ B
        └── subnets in AZ C
```

A **subnet** is an AZ-specific section of the VPC. The relationship is worth memorizing:

```text
VPC    → regional
subnet → zonal
```

Suppose the VPC address range is `10.0.0.0/16`. It can be divided into public and private subnets in two AZs:

```text
London Region
└── VPC 10.0.0.0/16
    ├── AZ A
    │   ├── public-a  10.0.1.0/24
    │   └── private-a 10.0.11.0/24
    └── AZ B
        ├── public-b  10.0.2.0/24
        └── private-b 10.0.12.0/24
```

A subnet cannot span AZs because the AZ is supposed to remain an explicit placement and failure boundary. The architecture must be able to say that one resource is in AZ A and another is in AZ B. Without zonal subnets, the team could not deliberately distribute network placement across those failure domains.

An EC2 instance can now be described across every dimension:

```text
Owner
  → AWS account

Geography
  → Region

Local failure domain
  → Availability Zone

Private network
  → VPC

Network segment
  → subnet

Compute resource
  → EC2 instance
```

A concrete placement might be:

```text
Production account
└── eu-west-2
    └── production-vpc
        ├── private-subnet-a → AZ A
        │   └── EC2 instance app-01
        └── private-subnet-b → AZ B
            └── EC2 instance app-02
```

The account owns the instances, the Region places them geographically, the AZs separate local failure, the VPC gives them a private network, and the subnets give them zonal network placement.

## How Do Global, Regional, and Zonal Scopes Differ?
<!-- section-summary: AWS resources have different scopes, so operators must identify whether a resource is global, regional, or tied to one Availability Zone. -->

The placement model is useful, but not every AWS resource fits into a single literal tree. AWS services expose resources at different scopes.

Some concepts are global or global-like within their service model. Others exist in a particular Region. Some are associated with one AZ. The exact behavior depends on the service, so an operator should ask: **what is the scope of this resource?**

```text
Global or global-like scope
Account
└── resource not selected through one normal regional view

Regional scope
Account
└── Region
    └── resource

Zonal scope
Account
└── Region
    └── Availability Zone
        └── resource
```

This matters because AWS consoles, CLI commands, and APIs are frequently scoped by account and Region. When an engineer says, “The database is not here,” several explanations are possible:

```text
correct account + wrong Region
wrong account   + correct Region
wrong account   + wrong Region
```

The resource may still exist. The engineer may be looking through the wrong coordinates.

For many resources, a useful mental address is:

```text
(account, Region, resource identifier)
```

For a networked resource, the address often needs more detail:

```text
(account, Region, VPC, subnet or AZ, resource identifier)
```

Names alone can be misleading. Two accounts may each contain a resource called `production-database`. Several Regions in the same account may contain similar stacks. The account ID, Region, VPC, subnet, AZ, and exact resource identifier disambiguate the target.

This scope model also prevents a common diagram mistake. The account does not belong to a Region. Instead, the account can own many resources, and each regional resource carries its own Region coordinate. A VPC belongs to one of those Regions, spans AZs inside it, and contains zonal subnets.

## How Do Separate Accounts Share Access and Services?
<!-- section-summary: Multi-account systems keep boundaries strong while crossing them deliberately through roles, network connections, and shared-service designs. -->

Account separation reduces blast radius, but an organization still needs shared services. Production, development, analytics, and security accounts may all need central DNS. Many accounts may send audit data to a central logging account. Many VPCs may connect through a networking account. This creates a productive tension: accounts should remain isolated enough to limit failure, yet connected enough to operate as one organization.

### Cross-account access uses explicit roles

A foundational access pattern begins with a person or workload authenticated through an identity system. That identity receives access in one account and deliberately assumes a role in another:

```text
user
  ↓
identity system
  ↓
Account A
  ↓ assume role
Account B
```

An engineer might assume a Developer role in the development account and a ReadOnly role in production. This is safer and clearer than creating unrelated long-lived users and credentials in every account.

The important principle is: **cross-account work should be explicit.** The boundary is a control to cross deliberately, not an inconvenience to erase.

### Network connection and permission are separate

Suppose an application in account A must reach a database in account B. Two independent conditions must be satisfied:

```text
a network path exists
AND
security and authorization permit the interaction
```

Creating an IAM role does not connect two VPCs. Connecting two networks does not authorize the application to use every reachable resource. The recurring distinction is:

```text
Can packets reach the destination?
                ≠
Is the caller authorized to use it?
```

Cross-account network mechanisms solve the reachability problem. IAM roles, resource policies, and service-specific authorization solve the permission problem.

### Mature environments group account responsibilities

A larger environment may organize accounts by responsibility:

```text
AWS Organization
├── Security OU
│   ├── Security Tooling account
│   └── Log Archive account
├── Infrastructure OU
│   ├── Networking account
│   └── Shared Services account
├── Production OU
│   ├── Payments Production account
│   └── Website Production account
└── Development OU
    ├── Payments Development account
    └── Website Development account
```

Inside the Payments Production account, a London VPC may contain public and private subnets in AZ A, AZ B, and AZ C. Each layer now has one reason:

| Boundary | Problem it addresses |
|---|---|
| Organization | Governance across accounts |
| Account | Ownership, security, billing, and administrative blast radius |
| Region | Geographic placement and regional failure |
| Availability Zone | Local infrastructure failure |
| VPC | Private network isolation |
| Subnet | AZ-specific network placement |
| IAM | Who may perform an action |

AWS exposes many boundaries because production systems face many different risks. Collapsing them into one boundary would remove the ability to isolate a developer mistake, a regional outage, a local infrastructure failure, a network relationship, and an authorization decision independently.

## What Should You Check Before Changing a Resource?
<!-- section-summary: A short scope and blast-radius check confirms the account, Region, network, placement, resource identity, action, and consequence before a change. -->

The most useful operational habit in AWS is to establish scope before touching anything. Begin with four words:

```text
ACCOUNT
REGION
RESOURCE
ACTION
```

When network placement matters, expand the check:

```text
ACCOUNT
REGION
VPC
AZ / SUBNET
RESOURCE
ACTION
```

For example, an operator should be able to state:

```text
Account: production
Region: eu-west-2
VPC: production-vpc
Subnet: private-b in AZ B
Resource: app-server-03
Action: replace its security group
```

That short statement catches many wrong-account, wrong-Region, wrong-network, and wrong-resource mistakes before they become production incidents.

A practical scope check asks:

1. Which account am I authenticated into?
2. Which Region am I operating in?
3. Is the service or resource global, regional, or zonal?
4. If networking is involved, which VPC contains the resource?
5. If placement matters, which subnet and AZ contain it?
6. Am I changing the intended resource ID rather than a familiar-looking name?
7. What happens if this action is wrong?

The last question combines scope with blast radius. Replacing a security group on one test instance has a different consequence from changing a central route used by fifty production accounts.

### One architecture through every boundary

Imagine an online shop. The company first separates development from production:

```text
AWS Organization
├── shop-dev account
└── shop-prod account
```

That answers the administrative-isolation question. The team then selects the London Region for production because it needs geographic placement near UK users:

```text
shop-prod account
└── London Region
```

To tolerate a local infrastructure failure, the team uses two AZs:

```text
London Region
├── AZ A
└── AZ B
```

The application needs a private network, so the team defines `shop-vpc`. It then creates one private subnet in each AZ:

```text
shop-vpc
├── private-subnet-a → AZ A
└── private-subnet-b → AZ B
```

Finally, the workload places application capacity in both subnets:

```text
                 Load Balancer
                      │
              ┌───────┴───────┐
              ▼               ▼

        private-a         private-b
           AZ A              AZ B
             │                 │
          app-01             app-02
```

Every AWS object exists because the team answered a different question: the account isolates owners, the Region sets geography, the AZs set local failure domains, the VPC isolates the private network, and the subnets place networked resources in each AZ.

A rough office analogy can reinforce the dimensions. The account resembles the administrative business unit that owns something. The Region resembles the city. The AZ resembles an independently operated campus within that city. The VPC resembles a private corporate network. The subnet resembles a local network segment at one campus. The analogy is imperfect, but it prevents the boundaries from collapsing into one idea.

The compact hierarchy is:

```text
AWS Organization
└── AWS account
    └── Region
        ├── VPC ───────────────────┐
        │                          │
        │       AZ A              AZ B
        │        │                 │
        │     Subnet A          Subnet B
        │        │                 │
        │     resources         resources
        └── other regional services
```

The meanings are more important than the nesting:

```text
Organization      → governance
Account           → ownership and security boundary
Region            → geographic deployment boundary
Availability Zone → local failure boundary
VPC               → regional private network
Subnet            → AZ-specific network segment
```

At first principles, all of these concepts help control blast radius. Account isolation asks how much of the organization a credential or automation error can affect. AZ isolation asks how much application capacity disappears during a local failure. Region isolation asks whether the business can continue after a geographic failure. Network isolation asks which systems can communicate. IAM asks which identities can perform which actions.

![The review summary turns placement into a short check of account, Region, VPC, subnet, AZ, resource, and intended action](/content-assets/articles/article-cloud-providers-aws-foundations-accounts-regions-availability-zones/placement-review-summary.png)

*Naming the boundary and the failure it contains makes AWS placement an engineering decision instead of a vocabulary exercise.*

The question to carry into daily AWS work is: **which boundary am I operating inside, and which ownership, failure, or security problem is that boundary meant to contain?**

## Check Your Answers

:::expand[Which Question Does Each AWS Boundary Answer?]{kind="recap"}
Accounts, Regions, Availability Zones, VPCs, and subnets are separate coordinates that answer ownership, geography, failure, network, and placement questions.

The account answers ownership and control, the Region answers geographic location, the Availability Zone answers local failure placement, the VPC answers private-network membership, and the subnet answers AZ-specific network placement.

A VPC is a private network in one account and Region that can span several AZs. Each subnet belongs to one AZ, making network placement and local failure placement explicit.
:::

:::expand[What Does an AWS Account Own and Control?]{kind="recap"}
An AWS account is a strong ownership, security, billing, governance, and operational blast-radius boundary around resources.

An account owns resources and creates a strong boundary for security, administration, billing, quotas, governance, and operational blast radius. IAM identities and roles determine who may act inside that boundary.
:::

:::expand[How Does a Region Choose the Workload's Location?]{kind="recap"}
A Region is a major geographic deployment boundary chosen for latency, legal obligations, service support, recovery strategy, cost, and system proximity.

A Region is a major geographic deployment boundary chosen for user latency, data rules, service availability, recovery strategy, cost, and proximity to other systems. One account can use many Regions.
:::

:::expand[Why Does a Workload Use More Than One Availability Zone?]{kind="recap"}
Availability Zones create local infrastructure failure boundaries inside one Region, allowing a workload to keep capacity outside the failed zone.

AZs are separate local infrastructure failure domains within a Region. Placing capacity in several AZs lets the workload continue when one local location fails, while multi-Region design addresses a larger regional failure.
:::

:::expand[How Do VPCs and Subnets Place Resources on a Network?]{kind="recap"}
A VPC is a regional private network, while each subnet places resources in one Availability Zone-specific segment of that network.
:::

:::expand[How Do Global, Regional, and Zonal Scopes Differ?]{kind="recap"}
AWS resources have different scopes, so operators must identify whether a resource is global, regional, or tied to one Availability Zone.

AWS resources can have global-like, regional, or zonal scope depending on the service. Operators must identify the account, Region, and any VPC, subnet, or AZ context before assuming a resource is missing or changing it.
:::

:::expand[How Do Separate Accounts Share Access and Services?]{kind="recap"}
Multi-account systems keep boundaries strong while crossing them deliberately through roles, network connections, and shared-service designs.

Accounts remain isolated by default and cross the boundary deliberately through assumed roles, resource policies, network connections, and shared-service designs. Network reachability and authorization remain separate requirements.
:::

:::expand[What Should You Check Before Changing a Resource?]{kind="recap"}
A short scope and blast-radius check confirms the account, Region, network, placement, resource identity, action, and consequence before a change.

Confirm the account, active identity, Region, service scope, VPC, subnet or AZ, exact resource identifier, intended action, and blast radius. This short check prevents many wrong-target changes.
:::

## References

- [AWS Regions and Availability Zones](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions-availability-zones.html)
- [Regions and Zones for Amazon EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-regions-availability-zones.html)
- [Availability Zone IDs for AWS resources](https://docs.aws.amazon.com/ram/latest/userguide/working-with-az-ids.html)
- [What is Amazon VPC?](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html)
- [How AWS Organizations works](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_introduction.html)
- [Service control policies](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html)
- [Temporary security credentials in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html)
- [AWS services that work with IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_aws-services-that-work-with-iam.html)
