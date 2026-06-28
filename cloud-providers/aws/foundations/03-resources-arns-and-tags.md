---
title: "Resources, ARNs, and Tags"
description: "Exact AWS resource identity, ARN variations, naming, and tags for safer production changes."
overview: "AWS work gets safer when every alert, policy, ticket, and change request points to the same exact resource. This article teaches friendly names, service IDs, ARNs, tags, cost allocation, naming standards, IaC ownership metadata, and a practical pre-change checklist."
tags: ["aws", "foundations", "resources", "arns", "tags", "cost-allocation"]
order: 3
id: article-cloud-providers-aws-foundations-resources-arns-tags
aliases:
  - resource-names-tags-and-arns
  - article-cloud-providers-aws-foundations-resource-names-tags-arns
  - cloud-providers/aws/foundations/resource-names-tags-and-arns.md
---

## Table of Contents

1. [Start With the Exact Thing](#start-with-the-exact-thing)
2. [Friendly Names and Service IDs](#friendly-names-and-service-ids)
3. [ARNs in Policies and Logs](#arns-in-policies-and-logs)
4. [Tags for Ownership and Cost](#tags-for-ownership-and-cost)
5. [Naming and IaC Metadata](#naming-and-iac-metadata)
6. [Inventory and Search During Incidents](#inventory-and-search-during-incidents)
7. [A Pre-Change Checklist](#a-pre-change-checklist)
8. [References](#references)

## Start With the Exact Thing
<!-- section-summary: Production work needs exact resource identity so people change the intended object. -->

Picture a CloudWatch alarm firing for high database CPU. The alarm title says `prod-photos-db`, and the on-call engineer knows the `northstar-photos` service is important. That name helps, while the exact AWS object still needs proof.

The team may have a development database, a staging database, a production writer, a production read replica, and an old migration database with similar names. Those resources may live in different accounts, Regions, VPCs, or subnet groups. A production change needs the exact object before anyone changes capacity, parameters, policies, or application configuration.

AWS gives a resource several kinds of identity. A **friendly name** helps humans read dashboards and tickets. A **service ID** gives an API a concrete target inside a scope. An **Amazon Resource Name**, usually called an **ARN**, gives AWS services a structured address for policies, logs, and events. **Tags** add business context such as service, environment, owner, and cost center. **Infrastructure as Code metadata** points people to the system that should manage the desired configuration.

We will focus on safe identification before any production change. Full IAM policy engineering and cost governance belong in later articles. The example follows one production service, `northstar-photos`, and one alert about `prod-photos-db`. The goal is to help a beginner connect an alert, AWS CLI output, IAM policy, CloudTrail event, tags, and IaC owner back to the same resource.

| Identity layer | What it helps with | Example |
|---|---|---|
| **Friendly name** | Human reading and searching | `prod-photos-db` |
| **Service ID** | Exact API target in a service scope | `db-ABCDEFGHIJKLMNOP` or `i-0abc1234def567890` |
| **ARN** | Policy, event, and log resource address | `arn:aws:rds:eu-west-2:123456789012:db:prod-photos-db` |
| **Tags** | Business, owner, cost, and data context | `Service=northstar-photos`, `Environment=prod` |
| **IaC metadata** | Desired configuration owner | `module.photos.aws_db_instance.main` |

Each identity layer has a different job. Names help humans talk. IDs help APIs target one object. ARNs help AWS services describe the object in policies and events. Tags help teams find ownership and cost. IaC metadata helps people make changes in the right place.

The previous article showed how account, Region, AZ, VPC, and subnet scope place a workload. This article zooms into the resources inside that placement map.

## Friendly Names and Service IDs
<!-- section-summary: Friendly names help humans, while service IDs and resource IDs help AWS APIs target concrete resources. -->

A **friendly name** is the name your team chooses, such as `prod-photos-web`, `prod-photos-worker`, or `prod-photos-db`. A good name helps in dashboards, tickets, alarms, console search, and conversations during incidents. Production names should be boring and predictable because people read them under pressure.

A useful resource name usually carries the environment, service, and component. `prod-photos-db` tells a reader that this is the production database for the `northstar-photos` service. A name like `main-db` leaves too much out because every environment can have a main database. A name like `prod-eu-west-2-photos-db-blue-migration-final-2026` tries to carry too many decisions and often turns stale after the next migration.

Many AWS services also create **service IDs** or **resource IDs**. EC2 instances have IDs such as `i-0abc1234def567890`. Security groups have IDs such as `sg-0123456789abcdef0`. VPCs, subnets, route tables, and network interfaces have their own IDs. RDS has DB instance identifiers and deeper resource IDs. These IDs matter because names can change, collide within certain scopes, or get reused after deletion, while an ID usually points to one concrete object in the right account and Region.

For an incident, collect identity before making the change:

```bash
aws rds describe-db-instances \
  --db-instance-identifier prod-photos-db \
  --region eu-west-2 \
  --query 'DBInstances[].{Arn:DBInstanceArn,Identifier:DBInstanceIdentifier,ResourceId:DbiResourceId,Status:DBInstanceStatus,Engine:Engine,Endpoint:Endpoint.Address,MultiAZ:MultiAZ}'
```

Example output:

```json
[
  {
    "Arn": "arn:aws:rds:eu-west-2:123456789012:db:prod-photos-db",
    "Identifier": "prod-photos-db",
    "ResourceId": "db-ABCDEFGHIJKLMNOP",
    "Status": "available",
    "Engine": "postgres",
    "Endpoint": "prod-photos-db.abc123.eu-west-2.rds.amazonaws.com",
    "MultiAZ": true
  }
]
```

The **Identifier** field is the friendly database identifier the team uses in alarms and tickets. The **ResourceId** field is the RDS resource ID that AWS can use internally and in some service outputs. The **Arn** field is the structured resource address that appears in policies, CloudTrail, tagging APIs, and many integrations. The **Status**, **Engine**, **Endpoint**, and **MultiAZ** fields add enough operational context for a beginner to confirm that the alert points at the expected production database.

This output should move into the ticket or incident notes. A note that says "CPU is high on `prod-photos-db`, ARN `arn:aws:rds:eu-west-2:123456789012:db:prod-photos-db`, endpoint `prod-photos-db.abc123.eu-west-2.rds.amazonaws.com`" gives the next responder a real target. The friendly name starts the conversation, and the ARN and endpoint prove the target.

Names also need lifecycle discipline. If the team replaces `prod-photos-db` during a migration, the change notes should say whether the old database remains for rollback, whether the friendly name moved, and which endpoint the app uses now. Stale names create confusion when a dashboard points to the old database and the app talks to the new one.

Once the team has the name and IDs, the next layer is the ARN because policies, logs, events, and cross-service integrations often use that form.

## ARNs in Policies and Logs
<!-- section-summary: ARNs are structured AWS resource addresses used by policies, events, logs, and many cross-service references. -->

An **Amazon Resource Name**, or **ARN**, is a structured address for an AWS resource. AWS uses ARNs when a policy, event, log entry, or API response needs to name a resource precisely. A typical ARN carries the partition, service namespace, Region, account ID, and a service-specific resource part.

The general shape looks like this:

```console
arn:partition:service:region:account-id:resource
```

The **partition** is usually `aws`; AWS GovCloud and AWS China use different partitions. The **service** is the service namespace, such as `rds`, `ecs`, `s3`, `iam`, or `lambda`. The **region** and **account-id** fields appear for many regional resources. The **resource** part belongs to the service, and that is where many beginner policy mistakes happen.

These four ARNs all point to different kinds of AWS objects:

```console
arn:aws:rds:eu-west-2:123456789012:db:prod-photos-db
arn:aws:ecs:eu-west-2:123456789012:service/prod-photos/photos-web
arn:aws:s3:::prod-photos-uploads
arn:aws:iam::123456789012:role/service/prod-photos-task-role
```

The RDS and ECS ARNs include a Region and account ID because they refer to regional resources inside an account. The S3 bucket ARN has an empty Region and account field in this form because S3 bucket ARN syntax is different. The IAM role ARN has an empty Region field because IAM identities are global within an account. This is why beginners should copy the documented ARN pattern for the service they are working with instead of reshaping an ARN by memory.

S3 is a useful first policy example because the bucket ARN and object ARN are different. The bucket itself uses one ARN, and objects under a prefix use another ARN pattern.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListTheBucket",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::prod-photos-uploads"
    },
    {
      "Sid": "ReadAndWriteProfileImageObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::prod-photos-uploads/profiles/*"
    }
  ]
}
```

The first statement allows `s3:ListBucket` on the bucket ARN. That action checks the bucket-level resource. The second statement allows `s3:GetObject` and `s3:PutObject` only for objects under `profiles/`. The `*` means objects below that prefix, such as `profiles/2026/06/avatar-123.jpg`. If the app needs object access and the policy only names the bucket ARN, the request can fail with `AccessDenied`.

ARNs also show up during troubleshooting. CloudTrail events, EventBridge events, AWS Config items, resource tagging results, and many service logs include ARNs. A useful habit is to copy the ARN from the event and compare it with the ARN in the IAM policy, Terraform plan, dashboard, or ticket. A different account ID, Region, path, bucket name, or resource suffix can explain why the team is looking at the wrong thing.

ARNs identify the exact AWS object. The next layer, tags, explains who owns the object and why it exists.

![The ARN anatomy view separates partition, service, Region, account, and resource so policy examples feel less like a single unreadable string](/content-assets/articles/article-cloud-providers-aws-foundations-resources-arns-tags/arn-anatomy.png)

*The ARN anatomy view separates partition, service, Region, account, and resource so policy examples feel less like a single unreadable string.*


## Tags for Ownership and Cost
<!-- section-summary: Tags attach owner, environment, service, cost, and data context to resources. -->

A **tag** is a key-value label on an AWS resource. Common tag keys include `Environment`, `Service`, `Owner`, `CostCenter`, `DataClass`, and `ManagedBy`. Tags help teams answer practical questions such as who owns this load balancer, which application pays for this NAT Gateway, whether this bucket stores customer data, and which system should manage the resource.

For cost reporting, AWS can use activated **cost allocation tags**. After activation in the billing area, costs can be grouped by those tag keys in billing reports and tools such as Cost Explorer. This only helps if the organization keeps tag keys and values consistent. `Service=northstar-photos`, `service=Photos`, and `App=photo-service` can split one workload into several reporting buckets.

A small baseline tag set for the `northstar-photos` service may look like this:

| Tag key | Why it exists | Example value |
|---|---|---|
| `Environment` | Separates prod, staging, dev, and sandbox | `prod` |
| `Service` | Connects resources to an application or platform service | `northstar-photos` |
| `Owner` | Gives the responsible team or group | `commerce-platform` |
| `CostCenter` | Supports finance allocation | `cc-4100` |
| `DataClass` | Signals sensitivity and retention expectations | `customer-data` |
| `ManagedBy` | Warns people which system owns changes | `terraform` |

Tags solve two everyday production problems. The first is ownership. A database, load balancer, NAT Gateway, or queue can outlive the person who created it, so the tag should point to a team or service rather than a single individual. The second is cost. A monthly bill line for NAT Gateway data processing means more when tags connect that spend to `Service=northstar-photos` and `Environment=prod`.

Infrastructure code should make tags part of the resource definition instead of a console afterthought:

```hcl
tags = {
  Environment = "prod"
  Service     = "northstar-photos"
  Owner       = "commerce-platform"
  CostCenter  = "cc-4100"
  DataClass   = "customer-data"
  ManagedBy   = "terraform"
}
```

This block is intentionally small. Each key holds business metadata rather than deep service configuration. `Environment` tells operators whether the resource handles production traffic. `Service` and `Owner` route questions to the right team. `CostCenter` helps finance reports. `DataClass` helps security and retention reviews. `ManagedBy` tells humans to update Terraform instead of hand-editing the live resource.

Tags have practical limits. Some resources support different creation-time tagging paths depending on the service and tool. Some AWS costs remain shared or untagged, such as certain support charges or data transfer views. Tag values can drift if people edit resources manually. A good cost review includes an "untagged" or "missing required tag" view so the team can fix metadata instead of pretending the report is complete.

To search for tagged resources across supported services, use the Resource Groups Tagging API:

```bash
aws resourcegroupstaggingapi get-resources \
  --region eu-west-2 \
  --tag-filters Key=Service,Values=northstar-photos Key=Environment,Values=prod \
  --query 'ResourceTagMappingList[].{ARN:ResourceARN,Tags:Tags}'
```

Example output:

```json
[
  {
    "ARN": "arn:aws:rds:eu-west-2:123456789012:db:prod-photos-db",
    "Tags": [
      { "Key": "Environment", "Value": "prod" },
      { "Key": "Service", "Value": "northstar-photos" },
      { "Key": "Owner", "Value": "commerce-platform" },
      { "Key": "ManagedBy", "Value": "terraform" }
    ]
  },
  {
    "ARN": "arn:aws:elasticloadbalancing:eu-west-2:123456789012:loadbalancer/app/prod-photos-alb/50dc6c495c0c9188",
    "Tags": [
      { "Key": "Environment", "Value": "prod" },
      { "Key": "Service", "Value": "northstar-photos" },
      { "Key": "Owner", "Value": "commerce-platform" }
    ]
  }
]
```

The **tag-filters** ask for resources that belong to the `northstar-photos` service in `prod`. The **ARN** field gives the exact resource address. The **Tags** list shows the business metadata attached to each resource. This is a helpful incident or cost-review inventory. The larger source of truth should still live in IaC, an asset inventory, or a configuration management system.

Tags tell people who owns a resource. Naming and IaC metadata tell people where the desired configuration should live.

## Naming and IaC Metadata
<!-- section-summary: Names and IaC metadata make resources readable while pointing production changes to the owning system. -->

A naming standard should be simple enough that people can guess it. For many resources, `{environment}-{service}-{component}` works well: `prod-photos-web`, `prod-photos-worker`, `prod-photos-db`, and `prod-photos-alb`. Short, consistent names help humans search and talk during incidents.

Some services need extra naming care because scope differs. S3 bucket names are globally unique, so a company may include an organization prefix and Region, such as `acme-prod-photos-uploads-eu-west-2`. Regional resources, such as many ECS services or RDS instances, often use shorter names because the account and Region already provide scope.

Names should complement the source of truth. **Infrastructure as Code**, often shortened to **IaC**, stores the desired configuration for resources through tools such as Terraform, CloudFormation, or AWS CDK. The `ManagedBy` tag, stack name, Terraform resource address, and deployment pipeline should help people find the code that owns the resource.

A practical Terraform pattern is to define common tags once and pass them into resources or modules:

```hcl
locals {
  common_tags = {
    Environment = var.environment
    Service     = "northstar-photos"
    Owner       = "commerce-platform"
    CostCenter  = "cc-4100"
    ManagedBy   = "terraform"
  }
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/aws/ecs/photos/web"
  retention_in_days = 30
  tags              = local.common_tags
}
```

The **locals** block gives the module one shared tag map. The log group then reuses `local.common_tags` instead of repeating each tag by hand. This keeps reviews simple because a missing or inconsistent tag appears in a normal code diff.

The **name** field also carries useful identity. `/aws/ecs/photos/web` tells a reader that this log group belongs to the ECS web component for the `northstar-photos` service. The **retention_in_days** field shows that logs have a defined retention period instead of growing forever. The example stays focused on ownership and metadata, while a later Terraform article can handle complete module design.

When a console user sees `ManagedBy=terraform`, the normal path is to update Terraform and run the pipeline. An emergency manual change may still happen during an incident, but the follow-up should bring IaC back into sync. Otherwise the next deployment may undo the emergency fix or preserve an undocumented drift.

Now the identity pieces are in place. The incident workflow can connect alert, command output, tags, CloudTrail, and IaC state to the same production object.

## Inventory and Search During Incidents
<!-- section-summary: Resource identity lets responders connect alerts, tags, CloudTrail events, and IaC state to one production object. -->

Return to the alert for high CPU on `prod-photos-db`. A responder should collect the account, Region, database ARN, endpoint, status, and tags before changing capacity or parameters. This gives the team a shared target and prevents the common wrong-resource mistake.

```bash
aws sts get-caller-identity --profile prod
```

Example output:

```json
{
  "Account": "123456789012",
  "Arn": "arn:aws:sts::123456789012:assumed-role/ProdOperator/senlin"
}
```

The **Account** field confirms the account that receives the next commands. The **Arn** field confirms the active role. If the role or account differs from the incident target, the responder should fix credentials before touching the database.

Next, capture the database identity:

```bash
aws rds describe-db-instances \
  --db-instance-identifier prod-photos-db \
  --profile prod \
  --region eu-west-2 \
  --query 'DBInstances[].{Arn:DBInstanceArn,Identifier:DBInstanceIdentifier,Status:DBInstanceStatus,Endpoint:Endpoint.Address,Class:DBInstanceClass,Storage:AllocatedStorage}'
```

Example output:

```json
[
  {
    "Arn": "arn:aws:rds:eu-west-2:123456789012:db:prod-photos-db",
    "Identifier": "prod-photos-db",
    "Status": "available",
    "Endpoint": "prod-photos-db.abc123.eu-west-2.rds.amazonaws.com",
    "Class": "db.m7g.large",
    "Storage": 200
  }
]
```

The **Arn** connects the live database to policies, tags, CloudTrail, and IaC. The **Status** field shows whether the database is available. The **Class** and **Storage** fields give enough context for a first capacity conversation without turning the article into an RDS tuning guide.

Then read the tags for the same ARN:

```bash
aws rds list-tags-for-resource \
  --resource-name arn:aws:rds:eu-west-2:123456789012:db:prod-photos-db \
  --profile prod \
  --region eu-west-2
```

Example output:

```json
{
  "TagList": [
    { "Key": "Environment", "Value": "prod" },
    { "Key": "Service", "Value": "northstar-photos" },
    { "Key": "Owner", "Value": "commerce-platform" },
    { "Key": "ManagedBy", "Value": "terraform" }
  ]
}
```

The **Environment** and **Service** tags confirm that this resource belongs to the production `northstar-photos` workload. The **Owner** tag points to the responsible team. The **ManagedBy** tag warns responders that a lasting change should go through Terraform.

After identity and ownership are clear, the team can connect runtime symptoms to control-plane changes. CloudTrail can show whether someone modified the database, changed a security group, updated parameters, or ran a deployment around the time CPU rose.

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=prod-photos-db \
  --start-time 2026-06-24T09:30:00Z \
  --end-time 2026-06-24T10:30:00Z \
  --profile prod \
  --region eu-west-2
```

Example output:

```json
{
  "Events": [
    {
      "EventId": "1a2b3c4d-example",
      "EventName": "ModifyDBInstance",
      "EventTime": "2026-06-24T09:58:12Z",
      "Username": "ProdDeployRole",
      "Resources": [
        {
          "ResourceName": "prod-photos-db",
          "ResourceType": "AWS::RDS::DBInstance"
        }
      ]
    }
  ]
}
```

The **EventName** field names the API action. The **EventTime** field lets responders compare the change with the alarm timeline. The **Username** field points to the role or user behind the action. The **Resources** field confirms that the event refers to the same database identifier from the alert.

Finally, connect the live resource to IaC. The exact command depends on Terraform, CloudFormation, CDK, or another tool, but the habit stays the same. Find the state address or stack, compare the live ARN with the expected resource, and make durable changes through the owning pipeline when time allows.

The incident workflow is now connected: account, Region, friendly name, ARN, tags, CloudTrail event, and IaC owner all point to the same object.

![The evidence chain shows how an alert becomes a verified resource by connecting name, ARN, tags, CloudTrail, and IaC owner](/content-assets/articles/article-cloud-providers-aws-foundations-resources-arns-tags/resource-evidence-chain.png)

*The evidence chain shows how an alert becomes a verified resource by connecting name, ARN, tags, CloudTrail, and IaC owner.*


## A Pre-Change Checklist
<!-- section-summary: A short identity check before changing AWS resources prevents wrong-account and wrong-resource incidents. -->

Before changing a production resource, confirm five fields: account, Region, resource type, exact ID or ARN, and owner tag. This check is small enough to fit into an incident note, deployment ticket, or pull request description.

```bash
aws resourcegroupstaggingapi get-resources \
  --tag-filters Key=Service,Values=northstar-photos Key=Environment,Values=prod \
  --region eu-west-2 \
  --profile prod \
  --query 'ResourceTagMappingList[].ResourceARN'
```

Example output:

```json
[
  "arn:aws:rds:eu-west-2:123456789012:db:prod-photos-db",
  "arn:aws:ecs:eu-west-2:123456789012:service/prod-photos/photos-web",
  "arn:aws:elasticloadbalancing:eu-west-2:123456789012:loadbalancer/app/prod-photos-alb/50dc6c495c0c9188"
]
```

The output gives a quick ARN inventory for the `northstar-photos` workload in `prod`. It helps a responder confirm whether the alert, ticket, dashboard, and CLI are talking about the same set of resources. A full asset management program adds ownership workflows, validation, history, and reporting around this kind of lookup.

For production changes, put a short checklist in the ticket:

| Field | Example |
|---|---|
| Account | `prod`, account `123456789012` |
| Region | `eu-west-2` |
| Resource type | RDS DB instance |
| Exact identifier | `prod-photos-db` |
| ARN | `arn:aws:rds:eu-west-2:123456789012:db:prod-photos-db` |
| Owner tags | `Service=northstar-photos`, `Owner=commerce-platform` |
| IaC owner | `module.photos.aws_db_instance.main` |
| Rollback target | Previous parameter group, previous task definition revision, snapshot ID, or prior config value |

The rollback target belongs beside the identity fields because rollback also needs an exact object. If the team changes a task definition, record the previous revision ARN. If the team changes a Lambda alias, record the previous version. If the team changes an RDS parameter group, record the previous parameter group and whether the database needs a reboot. A vague rollback note gives the on-call person too little to use during pressure.

Resource identity is ordinary production discipline. The team can move faster when names, IDs, ARNs, tags, and IaC metadata all agree because the target stays clear across alerts, tickets, policies, logs, dashboards, and code review.

![The summary gives the production facts a reviewer should see before approving a resource change](/content-assets/articles/article-cloud-providers-aws-foundations-resources-arns-tags/resource-identity-summary.png)

*The summary gives the production facts a reviewer should see before approving a resource change.*


## References

- [Identify AWS resources with ARNs](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference-arns.html)
- [IAM identifiers](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html)
- [Organizing costs with cost allocation tags](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/cost-alloc-tags.html)
- [Tag your Amazon EC2 resources](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html)
- [Tagging AWS resources](https://docs.aws.amazon.com/tag-editor/latest/userguide/tagging.html)
- [Using the Resource Groups Tagging API](https://docs.aws.amazon.com/resourcegroupstagging/latest/APIReference/overview.html)
- [AWS CloudTrail event reference](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference.html)
