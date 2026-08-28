---
title: "Resources, ARNs, and Tags"
description: "Understand AWS resources, service IDs, ARNs, tags, and Infrastructure as Code identities as separate parts of one resource model."
overview: "A resource is the AWS object, an ARN identifies it precisely, and tags add your organization's meaning. Learn how those layers support permissions, cost allocation, inventory, Infrastructure as Code, and safer production changes."
tags: ["aws", "foundations", "resources", "arns", "tags", "cost-allocation"]
order: 3
id: article-cloud-providers-aws-foundations-resources-arns-tags
aliases:
  - resource-names-tags-and-arns
  - article-cloud-providers-aws-foundations-resource-names-tags-arns
  - cloud-providers/aws/foundations/resource-names-tags-and-arns.md
---

## Table of Contents

1. [What Is an AWS Resource?](#what-is-an-aws-resource)
2. [Why Can One Resource Have Several Identifiers?](#why-can-one-resource-have-several-identifiers)
3. [How Does an ARN Identify One AWS Resource?](#how-does-an-arn-identify-one-aws-resource)
4. [How Do ARNs Define Permission Scope and Connect Evidence?](#how-do-arns-define-permission-scope-and-connect-evidence)
5. [What Meaning Do Tags Add to a Resource?](#what-meaning-do-tags-add-to-a-resource)
6. [How Should a Team Design Its Tagging Rules?](#how-should-a-team-design-its-tagging-rules)
7. [How Does Infrastructure as Code Add Another Identity?](#how-does-infrastructure-as-code-add-another-identity)
8. [How Do You Find and Verify the Exact Resource?](#how-do-you-find-and-verify-the-exact-resource)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

AWS is a large collection of service APIs. When an application, command-line tool, console, or Infrastructure as Code system calls those APIs, it creates, reads, changes, and deletes **resources**.

Each service exposes its own resource types:

```text
EC2    → instance
S3     → bucket
IAM    → role
RDS    → database
Lambda → function
VPC    → subnet
KMS    → key
SQS    → queue
```

A resource is an AWS entity with some combination of identity, configuration, state, lifecycle, permissions, and relationships. Consider one EC2 instance:

```text
identity       i-0ab123...
configuration  t3.medium, AMI, security groups
state          running
lifecycle      create → stop → start → terminate
permissions    IAM and EC2 authorization
relationships  subnet, VPC, EBS volumes, IAM role
```

The EC2 instance is the thing that exists. Its instance type and security groups describe its configuration. `running` describes its current state. Its lifecycle includes actions that create, stop, start, and terminate it. Policies decide who can perform those actions. Its subnet, storage volumes, and IAM role connect it to other resources.

Keep these questions in view as you work through the lesson:

1. **What Is an AWS Resource?**
2. **Why Can One Resource Have Several Identifiers?**
3. **How Does an ARN Identify One AWS Resource?**
4. **How Do ARNs Define Permission Scope and Connect Evidence?**
5. **What Meaning Do Tags Add to a Resource?**
6. **How Should a Team Design Its Tagging Rules?**
7. **How Does Infrastructure as Code Add Another Identity?**
8. **How Do You Find and Verify the Exact Resource?**

## What Is an AWS Resource?
<!-- section-summary: A resource is the actual AWS object, with its own identity, configuration, state, lifecycle, permissions, and relationships. -->

The resource-plus-context model also applies to a Lambda function, an S3 bucket, or an RDS database even though the exact configuration, lifecycle, and relationships differ. The central rule is: **the resource is the actual AWS object. Names, IDs, ARNs, tags, and code addresses are information used to identify, describe, authorize, classify, or manage that object.**

The simplest summary is:

```text
Resource → what actual thing exists?
ARN      → exactly which AWS thing is it?
Tag      → what does the thing mean to our organization?
```

## Why Can One Resource Have Several Identifiers?
<!-- section-summary: Friendly names, service IDs, ARNs, IaC addresses, and tags identify or describe a resource for different audiences and must not be treated as interchangeable. -->

Imagine one EC2 instance used by a production payments API. A human, the EC2 API, IAM, Terraform, and the finance team may refer to it in different ways:

```text
Human label
payments-api-prod-a

EC2 instance ID
i-0f123456789abcde0

ARN
arn:aws:ec2:eu-west-2:123456789012:instance/i-0f123456789abcde0

Infrastructure as Code address
aws_instance.payments_api

Tags
Application = payments
Environment = production
Owner       = payments-platform
```

These values are not interchangeable names. Each one answers a different question.

| Identity or metadata | Main audience | Question it answers |
|---|---|---|
| Friendly name | Humans | What should we call it? |
| Service ID | AWS service and API | Which object inside this service? |
| ARN | AWS authorization and cross-service references | Exactly which AWS resource? |
| IaC address | Terraform, CloudFormation, CDK, or another deployment tool | Which declaration manages it? |
| Tags | Humans, automation, billing, and IAM | What does it belong to? |

### Friendly names depend on the service

Humans prefer `production-payments-api` to `i-05bc7c89d3c09a183`, so AWS services usually expose some human-readable label. The meaning of “name” is not consistent across every service.

An IAM user has a friendly name that is part of the IAM user identity. An EC2 instance works differently: the value displayed by the console in the **Name** column is generally a tag with key `Name`. An S3 bucket name is more fundamental to the bucket's service identity.

There is no universal AWS rule that every resource has one identically behaving name. Every service defines its own identity model. Some rely strongly on customer-chosen names, some generate IDs, and some use both.

### Service IDs give APIs an exact target

Many services generate machine-oriented identifiers:

```text
EC2 instance    i-0abc...
VPC             vpc-0123...
subnet          subnet-0456...
security group  sg-0789...
snapshot        snap-0123...
```

Two teams might both call an instance `web-server`. EC2 still needs to distinguish the exact objects, so it uses instance IDs. The friendly name says, “This is our web server.” The instance ID says, “This exact EC2 object.”

During an incident, the team can gradually replace ambiguity with scope:

```text
production API server
        ↓
Account: 123456789012
Region:  eu-west-2
EC2 ID:  i-0123456789abcdef0
```

The service ID is precise within the expected service and scope. AWS still needs a way to express the service, partition, Region, account, resource type, and resource together. That is the job of the ARN.

## How Does an ARN Identify One AWS Resource?
<!-- section-summary: An Amazon Resource Name is a fully qualified AWS address whose partition, service, Region, account, and resource fields remove ambiguity. -->

**ARN** stands for **Amazon Resource Name**. The general form is:

```text
arn:partition:service:region:account-id:resource
```

An EC2 instance ARN can be read field by field:

```text
arn:aws:ec2:eu-west-2:123456789012:instance/i-0123456789abcdef0
    │   │       │          │              │
    │   │       │          │              └─ resource-specific portion
    │   │       │          └──────────────── account
    │   │       └─────────────────────────── Region
    │   └─────────────────────────────────── service
    └─────────────────────────────────────── partition
```

The service ID `i-0123456789abcdef0` identifies the EC2 object in its service context. The ARN qualifies that identity with the AWS partition, EC2 service, `eu-west-2` Region, `123456789012` account, and EC2 resource type.

A useful analogy is the difference between `database` and `database.prod.example.com`. The short name is meaningful in a local conversation. The qualified name supplies the context needed to distinguish it from other databases. An ARN performs a similar qualification job for AWS resources.

### Resource portions vary by service

ARNs do not share one universal suffix grammar. Compare these examples:

```text
arn:aws:iam::123456789012:role/payments-api

arn:aws:lambda:eu-west-2:123456789012:function:payments-api

arn:aws:s3:::my-company-bucket

arn:aws:ec2:eu-west-2:123456789012:vpc/vpc-1234
```

The IAM role uses `role/name`; the Lambda function uses `function:name`; the VPC uses `vpc/id`; and the S3 bucket ARN leaves the Region and account fields empty in this form. AWS supports broad resource patterns such as `resource-id`, `resource-type/resource-id`, and `resource-type:resource-id`, while each service defines its exact syntax.

For that reason, learn to read the stable fields—partition, service, Region, account, and resource-specific part—but consult the service's authorization reference when exact ARN construction matters. Guessing from another service's format can produce a policy that names the wrong resource or never matches the intended request.

![The ARN anatomy view separates partition, service, Region, account, and resource-specific identity](/content-assets/articles/article-cloud-providers-aws-foundations-resources-arns-tags/arn-anatomy.png)

*The stable ARN fields provide context, while the final resource syntax belongs to the individual AWS service.*

## How Do ARNs Define Permission Scope and Connect Evidence?
<!-- section-summary: IAM uses ARN patterns to identify resource scope, while logs, audit events, findings, and deployment systems use ARNs to correlate the same object. -->

Authorization requires more precision than a sentence such as “Allow Alice to delete backups.” AWS must know which identity, action, service, account, Region, and backup resources the statement describes.

IAM policies turn the human intention into a machine-evaluable statement. A simple S3 statement can allow one action on a defined resource set:

```json
{
  "Effect": "Allow",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::company-reports/*"
}
```

The `Action` names the S3 operation. The `Resource` names the objects to which the statement applies. This creates a direct chain:

```text
resource exists
      ↓
resource needs an identity
      ↓
ARN identifies it
      ↓
policy can authorize an action on it
```

Some AWS actions do not support resource-level permission and therefore require a wildcard resource. When a service does support resource-level permissions, the ARN allows the policy to narrow the statement to the intended object or resource set.

### A wildcard describes a set

The resource pattern `arn:aws:s3:::company-data/*` does not identify one S3 object. It can match every object under that bucket:

```text
company-data/a.txt
company-data/reports/july.csv
company-data/images/logo.png
...
```

Similarly, `arn:aws:iam::123456789012:role/*` can match roles in that account. IAM commonly compares the requested resource ARN with the policy's ARN pattern. A `*` can expand the set dramatically, which is why apparently small wildcard changes can create much broader permissions.

### ARNs connect evidence across systems

“Lambda is failing” provides almost no scope. `payments-authorizer` is better, but several environments may reuse that name. The ARN removes the ambiguity:

```text
arn:aws:lambda:eu-west-2:123456789012:function:payments-authorizer
```

It identifies the service, Region, account, and function together. The same ARN may appear in:

- IAM policies;
- CloudTrail events;
- AWS Config records;
- deployment output;
- AWS Resource Explorer;
- monitoring systems;
- security findings;
- automation scripts; and
- incident tickets.

That makes the ARN a useful correlation key. CloudTrail records can include resource ARNs, owning account IDs, and resource types. Some events record a resource name or service ID instead, so an investigation should not assume that every CloudTrail event contains a perfect ARN. When it is present, however, the ARN helps join the policy, change event, configuration record, finding, and deployed resource.

The exact identity now has a technical purpose. The next problem is organizational meaning: AWS can identify the object without knowing why the company created it.

## What Meaning Do Tags Add to a Resource?
<!-- section-summary: Tags attach organization-specific ownership, environment, cost, purpose, and classification to a resource without changing its identity. -->

Suppose AWS knows the exact EC2 instance ARN. It can identify the object, but it does not automatically know why the instance exists, who owns it, whether it is production, which team pays for it, whether automation may stop it, or which data classification applies.

Those are organizational facts. **Tags** attach that meaning as key-value metadata:

```text
Environment = production
Application = payments
Owner       = payments-platform
CostCenter  = FIN-042
ManagedBy   = terraform
```

AWS stores the strings but does not assign custom business meaning to them. `Environment=production` does not automatically mean “never stop this resource.” A policy, cost report, inventory system, or automation rule must interpret the value.

### Identity and classification remain separate

The most useful distinction is:

```text
ARN → identity
tag → classification
```

An EC2 instance may begin with `Environment=staging` and later be reclassified as `Environment=production`. The tag changes while the resource remains the same instance with the same identity. This is desirable because identity should not change every time purpose, owner, or environment metadata changes.

```text
identity ≠ purpose
identity ≠ ownership
identity ≠ environment
```

### Tags overlay the business model

AWS sees resources grouped by service: EC2 instances, Lambda functions, RDS databases, S3 buckets, queues, topics, and load balancers. The organization sees applications and business capabilities such as Payments, Checkout, Search, Analytics, and Internal Tools.

Tags overlay the second model on the first:

```text
AWS service view

EC2      Lambda      RDS      S3
 │          │         │        │
 └──────────┴─────────┴────────┘
                    │
                  tags
                    │
                    ▼
organization view

Application = Payments
Environment = production
Owner       = payments-platform
```

At scale, this turns a pile of service resources into a queryable organizational inventory.

### Ownership tags route questions

An `Owner=payments-platform` tag can answer “Who owns this bucket?” during an incident. Stable organizational values are better than personal values such as `Team=Bob`, because people change roles and leave the organization.

Useful ownership dimensions can be separated:

```text
Application      = payments
Owner            = payments-platform
TechnicalContact = payments-oncall
CostCenter       = CC-1042
```

Each value has a consumer: application grouping, responsible team, incident routing, or financial allocation.

### Cost tags translate the bill

AWS may report spend under EC2, RDS, S3, and Lambda. Finance may need to see the cost of Payments, Search, Data Platform, or a particular customer. Applying `Application=Payments` across those services allows supported cost-allocation tools to group costs around the application rather than around the AWS service boundary.

```text
ARN asks: Which thing incurred the cost?
Tag asks: Whose cost should this be?
```

### Tags can control access

AWS IAM supports attribute-based access control, or **ABAC**. A principal may carry `Project=Apollo`, and resources may carry the same project tag. Policies can compare the principal attribute with the resource attribute:

```text
principal.Project == resource.Project
```

This differs from maintaining a long list of individual ARNs for every role. A role-based policy might say that members of role X may use 437 named resources. An attribute-based policy can say that people may operate resources whose Project tag matches their own Project attribute.

Once tags participate in authorization, tagging quality becomes a security concern as well as an inventory and cost concern.

### Tags are visible metadata, not secret storage

Do not place database passwords, customer identifiers, secret tokens, or other sensitive values in tags. Tags are available through many resource and inventory APIs. Treat them as broadly visible operational metadata.

## How Should a Team Design Its Tagging Rules?
<!-- section-summary: A tag schema needs consistent keys and values, clear consumers, stable ownership terms, and governance that prevents free-form drift. -->

Names and tags should complement one another. Trying to encode every fact in one resource name produces values such as:

```text
prod-eu-west-2-payments-team7-costcenter487-pci-primary-api-v3
```

The name is difficult to read, and changes to its owner, version, or role make several embedded facts stale. A cleaner design uses a readable name and structured tags:

```text
Name = payments-api

Environment = production
Application = payments
Owner       = payments-platform
CostCenter  = 487
Compliance  = pci
ManagedBy   = terraform
```

The name supports human recognition. The ARN supplies exact identity. Tags carry structured, changeable dimensions.

### Add information AWS cannot infer

A `Region=eu-west-2` tag may help a specific external reporting system, but AWS already knows the Region from the resource scope and many ARNs. Before making a tag mandatory, ask whether it adds organizational information or only duplicates a fact AWS already stores.

High-value tags often describe facts AWS cannot infer:

```text
Application
Environment
Owner
CostCenter
Criticality
DataClassification
ManagedBy
Repository
```

Tags such as `AWSService=EC2` or `Region=eu-west-2` may be unnecessary unless an identified consumer requires them.

### Give every required tag a consumer

A practical baseline can include:

```text
Application
Environment
Owner
CostCenter
ManagedBy
Criticality
DataClassification
```

Additional keys such as `Repository`, `BusinessUnit`, `Customer`, `Project`, `ExpiresAt`, `BackupPolicy`, `PatchGroup`, and `Compliance` should be added when something actually uses them.

Each mandatory tag needs a reason:

```text
Owner             → incident routing
CostCenter        → financial allocation
Environment       → automation and safety
DataClassification→ security controls
ManagedBy         → prevents unmanaged manual changes
```

If nobody queries, validates, bills against, authorizes with, or automates from a tag, reconsider whether it needs to be required.

### Treat tags like a schema

Tags are technically flexible strings, but operations should treat them more like database columns. These values fragment one environment into several spellings:

```text
Environment = prod
Environment = production
environment = Prod
Env         = live
stage       = PROD
```

A consistent schema uses one key and one allowed value, such as `Environment=production`. Tag keys and values are case-sensitive, so capitalization changes can break inventory queries, cost grouping, or access rules.

Governance should define allowed keys, allowed values, capitalization, ownership, which resource types require a tag, and how exceptions work. Without that structure, tags eventually become free-form comments and lose their value as a queryable schema.

## How Does Infrastructure as Code Add Another Identity?
<!-- section-summary: Infrastructure as Code uses a logical address that manages an AWS resource but remains separate from its service ID, ARN, and deployed tags. -->

Infrastructure as Code, or **IaC**, adds another namespace. Terraform might declare:

```hcl
resource "aws_instance" "payments_api" {
  # configuration omitted
}
```

Terraform knows this logical object as `aws_instance.payments_api`. AWS may know the deployed instance as `i-0123456789abcdef0` and by its full ARN.

```text
IaC logical identity
       │
       │ creates and manages
       ▼
AWS physical resource
       ├── service ID
       ├── ARN
       └── tags
```

These identities can change independently. Renaming the logical Terraform declaration does not necessarily rename the AWS object. Deleting and recreating the instance produces a new `i-...` service ID even if the logical idea remains `payments_api` in the infrastructure code.

This explains a common IaC surprise: the code can preserve the same conceptual component while AWS replaces the physical resource underneath it. Conversely, the physical resource can remain unchanged while its code address or module structure is reorganized.

### Code metadata is not automatically deployed metadata

The Terraform repository may already contain useful context:

```text
resource name: payments_api
folder: /services/payments
repository: payments-infrastructure
module: compute
```

Those facts help a developer reading the source. AWS does not automatically know them. If an operator looking only at the deployed instance needs to know which repository manages it, copy that relationship into visible resource metadata:

```text
ManagedBy  = terraform
Repository = payments-infrastructure
```

Metadata that stays only in IaC helps people navigating the code. Metadata applied as resource tags helps people navigating the deployed system. Both layers are useful, and neither automatically replaces the other.

### Tags support cross-service inventory

During an incident, a responder may need every production resource for Checkout. A query for `Application=Checkout` and `Environment=production` can locate supported resources across service boundaries: load balancers, ECS services, Lambda functions, databases, queues, topics, and buckets.

AWS Resource Explorer can search indexed resources using metadata such as names, tags, and IDs across Regions. With disciplined metadata, the cloud becomes a queryable inventory. Without it, the responder faces a collection of unrelated service objects and must reconstruct ownership manually.

## How Do You Find and Verify the Exact Resource?
<!-- section-summary: Incident response moves from a business symptom to a tagged resource population, then to one exact service ID or ARN and its management, audit, relationship, and recovery context. -->

A useful incident investigation increases the resolution of the problem step by step:

```text
business symptom
      ↓
application
      ↓
resource group
      ↓
exact resource
      ↓
ARN or service ID
      ↓
CloudTrail, metrics, logs, and configuration
```

For a payments failure, the path might be:

```text
"payments is failing"
        ↓
Application=Payments
Environment=production
        ↓
Lambda function named payments-authorizer
        ↓
arn:aws:lambda:eu-west-2:123456789012:function:payments-authorizer
        ↓
CloudTrail / CloudWatch / AWS Config
```

Tags are effective for finding the population: “Which resources belong to Payments?” The ARN is effective for pinning down the individual: “Which exact function received this policy change?” CloudTrail can then help answer who performed the change, through which API, and when.

The progression removes ambiguity:

```text
payments
   ↓
production payments
   ↓
payments Lambda function
   ↓
specific function
   ↓
exact ARN
```

![The evidence chain shows how an alert becomes a verified resource by connecting tags, ARN, audit evidence, and IaC owner](/content-assets/articles/article-cloud-providers-aws-foundations-resources-arns-tags/resource-evidence-chain.png)

*Tags find the relevant set, while the ARN identifies the exact object across operational systems.*

### Verify the target before changing it

A strong pre-change check follows directly from the identity model:

1. **Identity:** Have you identified the exact resource by an authoritative service ID or ARN rather than only a display name?
2. **Scope:** Are you in the correct AWS account, Region, service, and environment?
3. **Purpose:** What do the `Application`, `Environment`, `Owner`, and `Criticality` tags say?
4. **Ownership:** Which stable team is responsible for the resource, and where is that ownership recorded?
5. **Management:** Does Terraform, CloudFormation, CDK, another deployment system, or a manual process own the desired state? Would a manual change be reverted?
6. **Relationships:** Which resources depend on this object, and which objects does it depend on?
7. **Authorization:** Does the policy name the intended ARN or resource set? Does any wildcard expand further than necessary?
8. **Auditability:** Will CloudTrail or relevant service telemetry identify the change afterward?
9. **Recovery:** Can the prior configuration or data be restored if the change fails?
10. **Metadata:** If the resource is replaced, will the replacement preserve required tags, monitoring, ownership, and cost attribution?

The checklist reduces to one question: **Do I know what this resource is, what it belongs to, how it is managed, and what will happen if I change it?**

A company-employee analogy captures the separation:

```text
Person
  → actual resource

Employee ID
  → service-generated resource ID

Full corporate directory identity
  → ARN

Preferred display name
  → friendly name

Department, cost center, and manager
  → tags

HR system record
  → IaC and state relationship
```

Moving a person from Sales to Engineering changes the department classification without creating a new human. In the same way, changing `Owner=payments` to `Owner=platform` changes organizational metadata without changing the resource identity.

The complete model is:

```text
                    your organization
                           │
                         tags
           Owner=Payments, Env=production
                           │
                           ▼
                    AWS resource
                    EC2 instance
                           │
             ┌─────────────┼─────────────┐
             ▼             ▼             ▼
       friendly name   service ID       ARN
       payments-api    i-01234...      arn:aws:...
             │             │             │
             ▼             ▼             ▼
          humans       service API   IAM, logs, APIs,
                                      and tooling
                           ▲
                           │ managed through
                           │
                    IaC logical address
                 aws_instance.payments_api
```

![The summary gives the exact identity, ownership, management, policy, relationship, audit, and recovery facts to verify before a resource change](/content-assets/articles/article-cloud-providers-aws-foundations-resources-arns-tags/resource-identity-summary.png)

*Safe change starts by connecting the human name, exact AWS identity, organizational tags, and owning deployment system.*

The four durable sentences are:

- A resource is the actual AWS object.
- A friendly name or service ID identifies it in a human or service-specific context.
- An ARN gives AWS a precise, fully qualified reference for authorization and correlation.
- Tags add ownership, environment, cost, purpose, and security classification without becoming the resource identity.

Once those boundaries are clear, AWS inventory, IAM, cost allocation, Infrastructure as Code, and incident response fit into one resource model.

## Check Your Answers

:::expand[What Is an AWS Resource?]{kind="recap"}
A resource is the actual AWS object, with its own identity, configuration, state, lifecycle, permissions, and relationships.

A resource is the actual AWS object created and managed through a service API. It has identity, configuration, state, lifecycle, permissions, and relationships.
:::

:::expand[Why Can One Resource Have Several Identifiers?]{kind="recap"}
Friendly names, service IDs, ARNs, IaC addresses, and tags identify or describe a resource for different audiences and must not be treated as interchangeable.

Friendly names help humans, service IDs target objects inside one service, ARNs provide qualified AWS identity, IaC addresses name declarations in code, and tags describe organizational meaning.
:::

:::expand[How Does an ARN Identify One AWS Resource?]{kind="recap"}
An Amazon Resource Name is a fully qualified AWS address whose partition, service, Region, account, and resource fields remove ambiguity.

An ARN combines partition, service, Region, account, and a service-specific resource portion. Its exact suffix varies by service, so read the common fields and use the service reference for precise syntax.
:::

:::expand[How Do ARNs Define Permission Scope and Connect Evidence?]{kind="recap"}
IAM uses ARN patterns to identify resource scope, while logs, audit events, findings, and deployment systems use ARNs to correlate the same object.

IAM compares requested resources with ARN expressions to determine which objects a statement covers. The same ARN can correlate policies, CloudTrail, Config, deployments, findings, monitoring, and tickets.
:::

:::expand[What Meaning Do Tags Add to a Resource?]{kind="recap"}
Tags attach organization-specific ownership, environment, cost, purpose, and classification to a resource without changing its identity.

Tags attach your organization's environment, application, owner, cost, management, and classification metadata. They can support inventory, cost allocation, automation, and attribute-based access control without replacing identity.
:::

:::expand[How Should a Team Design Its Tagging Rules?]{kind="recap"}
A tag schema needs consistent keys and values, clear consumers, stable ownership terms, and governance that prevents free-form drift.

Use consistent case-sensitive keys and allowed values, prefer stable organizational concepts, avoid secrets, and require only tags with an identified operational, financial, automation, or security consumer.
:::

:::expand[How Does Infrastructure as Code Add Another Identity?]{kind="recap"}
Infrastructure as Code uses a logical address that manages an AWS resource but remains separate from its service ID, ARN, and deployed tags.

IaC gives a resource a logical code address that creates or manages a physical AWS object. That address remains separate from the object's service ID, ARN, and deployed tags.
:::

:::expand[How Do You Find and Verify the Exact Resource?]{kind="recap"}
Incident response moves from a business symptom to a tagged resource population, then to one exact service ID or ARN and its management, audit, relationship, and recovery context.

Move from the business symptom to tagged resources, then to one exact ARN or service ID. Before changing it, confirm scope, purpose, owner, management system, relationships, policy scope, audit evidence, and recovery path.
:::

## References

- [Resource Explorer terms and concepts](https://docs.aws.amazon.com/resource-explorer/latest/userguide/getting-started-terms-and-concepts.html)
- [IAM users and friendly names](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_users.html)
- [Identify AWS resources with ARNs](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference-arns.html)
- [IAM JSON policy element: Resource](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_resource.html)
- [CloudTrail Resource type](https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_Resource.html)
- [Tagging AWS resources](https://docs.aws.amazon.com/tag-editor/latest/userguide/tagging.html)
- [Tagging best practices and strategies](https://docs.aws.amazon.com/tag-editor/latest/userguide/best-practices-and-strats.html)
- [IAM policy variables and tags](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_variables.html)
- [Tag Amazon EC2 resources](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html)
- [What is AWS Resource Explorer?](https://docs.aws.amazon.com/resource-explorer/latest/userguide/welcome.html)
- [CloudTrail record contents](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html)
