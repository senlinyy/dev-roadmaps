---
title: "CloudTrail and Config for \"What Changed?\""
description: "Investigate AWS changes by combining CloudTrail API activity with AWS Config resource history, rules, aggregators, conformance packs, and remediation."
overview: "CloudWatch explains workload symptoms. CloudTrail and AWS Config explain AWS changes. This article shows how CloudTrail answers who called which API, how AWS Config shows what a resource looked like, and how the two services work together during production investigations."
tags: ["cloudtrail", "aws-config", "audit", "change-history", "compliance", "aws"]
order: 8
id: article-cloud-providers-aws-observability-cloudtrail-config-what-changed
---

## Table of Contents

1. [The Question After the Alarm](#the-question-after-the-alarm)
2. [CloudTrail: Who Called Which API](#cloudtrail-who-called-which-api)
3. [Event History, Trails, Lake, and Insights](#event-history-trails-lake-and-insights)
4. [Data Events and Network Activity Events](#data-events-and-network-activity-events)
5. [CloudTrail Security Baseline](#cloudtrail-security-baseline)
6. [AWS Config: What the Resource Looked Like](#aws-config-what-the-resource-looked-like)
7. [Rules, Aggregators, Conformance Packs, and Remediation](#rules-aggregators-conformance-packs-and-remediation)
8. [Investigation Walkthrough: The Open Security Group](#investigation-walkthrough-the-open-security-group)
9. [Putting It All Together](#putting-it-all-together)

## The Question After the Alarm
<!-- section-summary: CloudWatch shows symptoms, while CloudTrail and AWS Config explain the AWS change behind those symptoms. -->

Go back to the checkout system from the previous article. CloudWatch alarms fire because `orders-api` is returning HTTP 500 errors, the `inventory-worker` pods in EKS are logging database connection failures, and the `receipt-renderer` Lambda function still looks healthy. The first incident question is operational: which workload is failing?

After ten minutes, the team finds the symptom. The EKS worker cannot reach the database. The next question is a change question: **what changed?** Someone may have edited a security group, replaced a route table, changed a secret, rotated a role, updated an ECS task definition, modified a Lambda environment variable, or deployed a Kubernetes change that points to the wrong endpoint.

CloudWatch gives the workload evidence. **AWS CloudTrail** and **AWS Config** give the change evidence:

| Service | Simple definition | Main question it answers |
|---|---|---|
| **CloudTrail** | The AWS activity record for API calls and account activity | Who or what called the API, from where, and when? |
| **AWS Config** | The AWS resource inventory and configuration history recorder | What did the resource look like before and after the change? |

These two services work best together. CloudTrail might show that an assumed role called `AuthorizeSecurityGroupIngress` at 15:24 UTC. AWS Config can show the security group rules captured around that time. CloudTrail names the caller and API action; Config shows the resource state and compliance result.

We will start with CloudTrail because every change investigation needs the API activity record first. Then we will add AWS Config so the team can compare the resource before and after the change.

## CloudTrail: Who Called Which API
<!-- section-summary: CloudTrail events record AWS API activity, including the caller, action, time, source, request details, and affected resources. -->

A **CloudTrail event** is a record of activity in an AWS account. The activity can come from the AWS Console, AWS CLI, AWS SDKs, AWS service-to-service calls, or other API paths that CloudTrail monitors. In plain terms, CloudTrail records the control-plane question: who asked AWS to do something?

A CloudTrail event commonly includes fields such as `eventTime`, `eventSource`, `eventName`, `awsRegion`, `sourceIPAddress`, `userAgent`, `userIdentity`, `requestParameters`, `responseElements`, and `resources`. During an incident, responders usually care about four of those fields first:

| Field | What it tells you | Example |
|---|---|---|
| `userIdentity` | The IAM user, role session, federated user, AWS service, or root identity involved | `arn:aws:sts::123456789012:assumed-role/prod-admin/alice` |
| `eventName` | The API action | `AuthorizeSecurityGroupIngress` |
| `eventSource` | The AWS service API endpoint | `ec2.amazonaws.com` |
| `requestParameters` | The requested change or lookup parameters | Security group ID and ingress rule details |

Here is a simplified event shape for the checkout incident:

```json
{
  "eventTime": "2026-06-11T15:24:33Z",
  "eventSource": "ec2.amazonaws.com",
  "eventName": "AuthorizeSecurityGroupIngress",
  "awsRegion": "us-east-1",
  "sourceIPAddress": "203.0.113.10",
  "userIdentity": {
    "type": "AssumedRole",
    "arn": "arn:aws:sts::123456789012:assumed-role/prod-network-admin/alice"
  },
  "requestParameters": {
    "groupId": "sg-0abc123def456",
    "ipPermissions": [
      {
        "ipProtocol": "tcp",
        "fromPort": 5432,
        "toPort": 5432,
        "ipRanges": [
          {
            "cidrIp": "0.0.0.0/0"
          }
        ]
      }
    ]
  }
}
```

That one event already gives the team a lead. The caller used an assumed role. The API came from EC2. The change touched security group `sg-0abc123def456`. The request opened PostgreSQL port `5432` to the world. The team still needs to confirm the actual resource state, but CloudTrail has answered who called the API and what API they called.

CloudTrail separates events into several types:

| Event type | Beginner definition | Production example |
|---|---|---|
| **Management events** | Control-plane activity that creates, changes, deletes, or describes AWS resources | `UpdateFunctionConfiguration`, `CreateTrail`, `AuthorizeSecurityGroupIngress`, `PutBucketPolicy` |
| **Data events** | High-volume data-plane activity performed on or inside resources | S3 `GetObject`, S3 `PutObject`, Lambda `Invoke`, DynamoDB item operations |
| **Network activity events** | API calls made through VPC endpoints from a private VPC to an AWS service | A VPC endpoint owner records calls that passed through an endpoint |
| **Insights events** | CloudTrail-generated events for unusual API call rates or error rates | A sudden spike in failed `AccessDenied` responses after a deployment |

Management events usually answer the first "what changed?" question because resource configuration changes are control-plane actions. Data events matter when the question moves closer to data access, such as "who downloaded this object?" or "who invoked this function?" Network activity events matter when a team owns private VPC endpoints and needs visibility into API activity through those endpoints.

The event type decides which CloudTrail feature you need. Event history is quick, trails are durable, Lake gives SQL for existing Lake customers, and Insights highlights unusual patterns.

## Event History, Trails, Lake, and Insights
<!-- section-summary: CloudTrail has several access patterns, and each one fits a different retention, query, and investigation need. -->

**Event history** is the fastest starting point. AWS enables CloudTrail by default for accounts, and Event history gives a searchable, downloadable, immutable record of the past 90 days of management events in one AWS Region. It is useful when the incident is fresh and the question is simple.

A responder can search recent management events with the CLI:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=AuthorizeSecurityGroupIngress \
  --start-time 2026-06-11T15:00:00Z \
  --end-time 2026-06-11T16:00:00Z \
  --query 'Events[].{Time:EventTime,User:Username,Event:EventName,Resources:Resources}' \
  --output table
```

Event history has clear limits. It covers management events only, it looks back 90 days, it searches within one account and one Region, and `lookup-events` supports one lookup attribute per request. When the team needs durable evidence, multi-account coverage, data events, network activity events, or longer retention, they need a trail or an event data store.

A **trail** delivers selected CloudTrail events to an S3 bucket. A production trail is usually multi-Region, often organization-wide, and stored in a dedicated log archive account. Trails can include management events, data events, and network activity events based on the selector configuration. They can also send events to CloudWatch Logs for monitoring and alarms.

A **CloudTrail Lake event data store** stores events for SQL queries. Lake queries can filter across multiple fields instead of a single lookup attribute. AWS documentation now includes an important availability caveat: CloudTrail Lake closed to new customers starting May 31, 2026, while existing customers can continue to use the service as normal. If your organization already uses Lake, it can be a powerful investigation layer. New customers need to follow current AWS availability guidance and use trails, S3, Athena, SIEM tooling, or other approved paths when Lake enrollment is unavailable.

A CloudTrail Lake query for existing Lake customers might look like this:

```sql
SELECT
  eventTime,
  eventSource,
  eventName,
  userIdentity.arn,
  sourceIPAddress,
  requestParameters
FROM $EDS_ID
WHERE eventSource = 'ec2.amazonaws.com'
  AND eventName = 'AuthorizeSecurityGroupIngress'
  AND eventTime BETWEEN '2026-06-11 15:00:00' AND '2026-06-11 16:00:00'
ORDER BY eventTime DESC
```

**CloudTrail Insights** watches for unusual API call rates and API error rates after CloudTrail learns a baseline. Management Insights can analyze write-only management API call rates and management API error rates. Data Insights can analyze data API call rates and data API error rates on trails. AWS documents data-event Insights for trails only, so teams should check that caveat before expecting the same data-event behavior from event data stores.

These options create a practical decision tree. Event history is good for a fresh control-plane question. Trails are the durable audit baseline. Lake helps existing customers run deeper SQL-style investigations. Insights helps call out unusual API activity that responders might miss during noisy incidents.

The next decision is data events, because teams often assume CloudTrail records every object read or function invoke automatically. That assumption causes painful gaps.

## Data Events and Network Activity Events
<!-- section-summary: Data events and network activity events add deeper visibility, but teams should select them carefully because they can be high volume and cost sensitive. -->

**Data events** record operations performed on or inside resources. S3 object-level API calls are the classic example. A bucket policy change is a management event, while `GetObject`, `PutObject`, and `DeleteObject` on objects are data events. Lambda function `Invoke` activity and DynamoDB table data-plane activity are also common examples.

Data events are often high volume, so production teams choose them deliberately. The checkout platform might enable S3 write data events for `prod-checkout-receipts` because receipt PDFs contain customer records. The same team might avoid all-object read events across every bucket because that could produce huge volume and cost without a clear investigation goal.

Advanced event selectors let the team narrow the data event stream:

```json
[
  {
    "Name": "Critical receipt bucket writes",
    "FieldSelectors": [
      {
        "Field": "eventCategory",
        "Equals": ["Data"]
      },
      {
        "Field": "resources.type",
        "Equals": ["AWS::S3::Object"]
      },
      {
        "Field": "resources.ARN",
        "StartsWith": ["arn:aws:s3:::prod-checkout-receipts/"]
      },
      {
        "Field": "readOnly",
        "Equals": ["false"]
      }
    ]
  }
]
```

Then the selector is attached to the trail:

```bash
aws cloudtrail put-event-selectors \
  --trail-name org-security-trail \
  --advanced-event-selectors file://s3-write-selectors.json
```

That selector records write data events for objects under one critical bucket prefix. The team can answer "who wrote or deleted receipt objects?" without logging every read from every bucket.

**Network activity events** answer a newer kind of question. They let VPC endpoint owners record AWS API calls made through their VPC endpoints from a private VPC to an AWS service. For example, a platform team that owns a private S3 endpoint can use network activity events to investigate API calls that crossed that endpoint path.

The design rule is the same for both event types: match the event stream to the investigation question. CloudTrail can record very detailed activity, and detailed activity can create very large event volume. Useful audit logging has a purpose, a retention plan, and a review process.

Before AWS Config enters the story, the CloudTrail baseline itself needs protection. Audit logs lose value when attackers or overly broad administrators can quietly turn them off or delete them.

## CloudTrail Security Baseline
<!-- section-summary: CloudTrail evidence needs centralization, multi-Region coverage, log validation, encryption, alerting, and tightly controlled access. -->

CloudTrail logs are security evidence. They should live in a place where ordinary application administrators cannot edit or delete them. In a multi-account AWS organization, that usually means a dedicated log archive account and an organization trail that records activity for all member accounts.

A baseline trail often starts like this:

```bash
aws cloudtrail create-trail \
  --name org-security-trail \
  --s3-bucket-name org-log-archive-cloudtrail \
  --is-multi-region-trail \
  --is-organization-trail \
  --enable-log-file-validation
```

Real production setup adds the surrounding pieces: an S3 bucket policy that allows CloudTrail delivery and limits human access, server-side encryption with AWS KMS when required, retention and lifecycle rules, log file validation, and monitoring for sensitive API activity. AWS recommends multi-Region trails for a complete record across enabled Regions, and the CloudTrail console creates multi-Region trails by default.

Log file validation deserves special attention. It lets the team validate whether delivered log files changed, disappeared, or stayed intact after CloudTrail delivered them. For forensic work, that integrity check matters because the evidence needs to survive scrutiny.

Many teams also send selected CloudTrail events to CloudWatch Logs so they can create metric filters and alarms. Examples include root account use, failed console sign-ins, CloudTrail changes, KMS key policy changes, security group changes, and IAM policy changes. GuardDuty and Security Hub can add higher-level detection and posture checks, but the raw trail still provides the audit record.

CloudTrail now answers who called the API. The resource-state side still needs AWS Config, because the team has to see what the security group looked like after AWS applied the change.

## AWS Config: What the Resource Looked Like
<!-- section-summary: AWS Config records resource inventory and configuration history so teams can compare resource state before and after a change. -->

**AWS Config** gives a detailed view of AWS resource configuration. It records supported resources, their relationships, and how their configuration changed over time. A resource can be an EC2 instance, security group, EBS volume, VPC, IAM role, S3 bucket, or another supported AWS resource type.

The core record in AWS Config is a **configuration item**, often shortened to **CI**. A configuration item is a snapshot of a resource's configuration at a point in time. When AWS Config detects that a supported resource was created, changed, or deleted, it records a new configuration item. AWS Config also tracks relationships, so a security group change can show related EC2 instances.

In the checkout incident, CloudTrail showed the API call that opened a security group. AWS Config can show the captured security group configuration around that time:

```bash
aws configservice get-resource-config-history \
  --resource-type AWS::EC2::SecurityGroup \
  --resource-id sg-0abc123def456 \
  --earlier-time 2026-06-11T15:00:00Z \
  --later-time 2026-06-11T16:00:00Z \
  --query 'configurationItems[].{Time:configurationItemCaptureTime,Status:configurationItemStatus,Config:configuration}'
```

This gives responders the resource state as AWS Config recorded it. They can compare the captured ingress rules before and after the CloudTrail event, confirm that port `5432` opened to `0.0.0.0/0`, and see related resources that used the security group.

AWS Config also provides a resource inventory. A team can list discovered resources:

```bash
aws configservice list-discovered-resources \
  --resource-type AWS::EC2::SecurityGroup \
  --query 'resourceIdentifiers[].{Id:resourceId,Name:resourceName}'
```

For broader questions, **advanced queries** let teams query current resource configuration with SQL-like syntax:

```bash
aws configservice select-resource-config \
  --expression "SELECT resourceId, resourceName, configuration.ipPermissions WHERE resourceType = 'AWS::EC2::SecurityGroup'"
```

This helps with inventory and exposure review. For example, the security team can find security groups with broad ingress, buckets without required settings, or resources missing expected tags. The query shows current configuration. The history API shows how one resource changed over time.

AWS Config recording has scope and Region considerations. AWS Config supports many resource types, but support can vary by Region and feature. Teams should check AWS's supported resource type coverage before assuming a specific resource type records everywhere they operate. Once recording is turned on, the configuration recorder and delivery channel become part of the audit foundation.

History is useful during incidents. Rules, aggregators, conformance packs, and remediation make AWS Config useful before the incident.

## Rules, Aggregators, Conformance Packs, and Remediation
<!-- section-summary: AWS Config can evaluate resources, centralize compliance views, package rule sets, and trigger controlled remediation workflows. -->

An **AWS Config rule** evaluates whether resources match a desired configuration. AWS provides managed rules for common checks, and teams can create custom rules with AWS Lambda or CloudFormation Guard. A rule can run when a matching resource changes, on a periodic schedule, or in a hybrid mode that uses both triggers.

A beginner-friendly example is the managed rule `restricted-ssh`. Its rule identifier is `INCOMING_SSH_DISABLED`, and it checks whether security groups allow unrestricted incoming SSH traffic from `0.0.0.0/0` or `::/0`. A team could create a managed rule like this:

```json
{
  "ConfigRuleName": "restricted-ssh",
  "Description": "Flag security groups that allow unrestricted SSH ingress.",
  "Scope": {
    "ComplianceResourceTypes": ["AWS::EC2::SecurityGroup"]
  },
  "Source": {
    "Owner": "AWS",
    "SourceIdentifier": "INCOMING_SSH_DISABLED"
  }
}
```

```bash
aws configservice put-config-rule \
  --config-rule file://restricted-ssh-config-rule.json
```

Rules turn change history into posture. Instead of discovering a public SSH rule during an incident, the team can receive a noncompliant result when the rule appears. For database security groups, the team might use a managed rule with parameters or a custom Guard rule that matches company network policy.

An **aggregator** collects AWS Config configuration and compliance data from multiple accounts and Regions into one account and Region. It gives central teams a read-only view across source accounts without giving that aggregator mutating access back into the source accounts. That fits the separation between compliance visibility and account administration.

A **conformance pack** is a collection of AWS Config rules and remediation actions that can be deployed as one unit. Security teams use conformance packs to package a baseline such as "production network guardrails" or "S3 data protection guardrails" and apply it across accounts or an organization. The pack creates consistent checks instead of relying on every account team to remember the same list.

**Remediation** connects a noncompliant rule result to an AWS Systems Manager Automation document. A remediation can be manual or automatic. For sensitive resources, teams usually start manual: a Config rule flags a risky security group, the responder reviews the finding, and an approved automation removes the bad rule. After the team trusts the detection and remediation path, low-risk fixes can move to automatic remediation.

This is the healthy governance loop:

1. AWS Config records the resource.
2. A rule evaluates the resource.
3. A noncompliant result appears when the resource violates policy.
4. An aggregator centralizes the result across accounts and Regions.
5. A conformance pack keeps the rule set consistent.
6. A remediation action provides a tested way to fix the issue.

Now we can put CloudTrail and AWS Config together in a real investigation.

## Investigation Walkthrough: The Open Security Group
<!-- section-summary: CloudTrail identifies the caller and API action, while AWS Config confirms the exact resource state before and after the change. -->

The checkout alarm fired at 15:32 UTC. `inventory-worker` started logging database connection failures. The database stayed healthy, and no recent application deployment touched the worker. That points the team toward infrastructure.

First, the responder searches CloudTrail for recent security group changes:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventSource,AttributeValue=ec2.amazonaws.com \
  --start-time 2026-06-11T15:00:00Z \
  --end-time 2026-06-11T15:40:00Z \
  --query 'Events[?EventName==`AuthorizeSecurityGroupIngress` || EventName==`RevokeSecurityGroupIngress`].{Time:EventTime,Event:EventName,User:Username,Resources:Resources}' \
  --output table
```

The event list shows `AuthorizeSecurityGroupIngress` at 15:24 UTC. The full event shows the assumed role session, source IP address, request parameters, security group ID, port, and CIDR block. That answers the caller side of the question.

Second, the responder asks AWS Config for the security group history:

```bash
aws configservice get-resource-config-history \
  --resource-type AWS::EC2::SecurityGroup \
  --resource-id sg-0abc123def456 \
  --earlier-time 2026-06-11T15:00:00Z \
  --later-time 2026-06-11T15:40:00Z \
  --output json
```

The configuration items show the before-and-after state. Before 15:24 UTC, port `5432` only allowed traffic from the application subnets. After 15:24 UTC, port `5432` allowed `0.0.0.0/0`. CloudTrail and Config now agree: a role session opened the database security group broadly.

Third, the team rolls back the change using the exact bad permission block from the event and confirms the resource state again through AWS Config. They also add or adjust a Config rule so the same broad ingress appears as noncompliant in the future. If this change came from a deployment pipeline, they fix the pipeline policy and add review around the infrastructure code that produced the change.

The important workflow is the pairing:

| Investigation step | CloudTrail contribution | AWS Config contribution |
|---|---|---|
| Find candidate change | API event, timestamp, service, action | Resource timeline around the same window |
| Identify actor | `userIdentity`, role session, source IP, user agent | Compliance owner and resource relationships |
| Understand requested change | `requestParameters` and affected resources | Captured resource configuration after AWS applied it |
| Prove previous state | Earlier events if available | Earlier configuration items |
| Prevent repeat | Trail monitoring for risky APIs | Rules, conformance packs, and remediation |

CloudTrail gives the activity trail. AWS Config gives the resource state trail. Together they turn a vague "what changed?" into an evidence-backed timeline.

## Putting It All Together
<!-- section-summary: CloudWatch, CloudTrail, and AWS Config form the operational loop for symptoms, actions, and resource state. -->

The full observability and audit loop has three layers. **CloudWatch** answers how the workload behaved: errors, latency, throttles, restarts, logs, traces, and alarms. **CloudTrail** answers who or what called AWS APIs: identity, event name, source IP, request parameters, and time. **AWS Config** answers what AWS resources looked like: current inventory, historical configuration items, relationships, compliance state, and remediation hooks.

In real incidents, the order often looks like this:

1. CloudWatch alarm shows a symptom.
2. Logs and traces identify the affected service and request path.
3. CloudTrail finds AWS API activity near the start of the symptom.
4. AWS Config confirms the resource state before and after the change.
5. The team rolls back the unsafe change, fixes the change path, and adds rules or alerts.

For a small account, Event history and a few Config lookups may solve the investigation. For a production organization, teams usually centralize CloudTrail through organization trails, protect logs in a log archive account, enable targeted data events, record important AWS Config resource types in every active Region, aggregate Config data, and package baseline rules as conformance packs.

The last piece is discipline. CloudTrail and Config help most when teams turn them on deliberately, protect the records, and practice using them before a serious incident. A normal deployment review gives the team a much calmer place to learn these queries than a security incident with executives asking for a timeline.

---

**References**

- [What Is AWS CloudTrail?](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html) - Defines CloudTrail, Event history, trails, Lake, and account activity logging.
- [CloudTrail concepts](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-concepts.html) - Explains CloudTrail events, event records, trails, and delivery concepts.
- [Understanding CloudTrail events](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-events.html) - Documents management events, data events, network activity events, and Insights events.
- [Working with CloudTrail event history](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/view-cloudtrail-events.html) - Documents default 90-day management event history, scope, and limitations.
- [Viewing recent management events with the AWS CLI](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/view-cloudtrail-events-cli.html) - Documents `lookup-events`, supported lookup attributes, time filters, and rate considerations.
- [Working with CloudTrail trails](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-trails.html) - Documents trails, multi-Region trails, and durable delivery to S3.
- [Security best practices in AWS CloudTrail](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/best-practices-security.html) - Covers multi-Region trails, log file validation, CloudWatch Logs integration, centralized S3 buckets, KMS encryption, least privilege, and access limits.
- [Logging data events](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/logging-data-events-with-cloudtrail.html) - Documents data event setup, supported resource types, cost considerations, and selector behavior.
- [Filtering data events by using advanced event selectors](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/filtering-data-events.html) - Documents advanced selector fields such as `eventCategory`, `resources.type`, `resources.ARN`, `eventName`, `readOnly`, and `userIdentity.arn`.
- [Logging network activity events](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/logging-network-events-with-cloudtrail.html) - Explains VPC endpoint network activity event logging.
- [Working with CloudTrail Insights](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/logging-insights-events-with-cloudtrail.html) - Documents Insights baselines, API call rate Insights, API error rate Insights, and data event Insights caveats.
- [CloudTrail Lake event data stores](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/query-event-data-store.html) - Documents event data store categories, SQL query support, and the May 31, 2026 new-customer availability caveat.
- [What Is AWS Config?](https://docs.aws.amazon.com/config/latest/developerguide/WhatIsConfig.html) - Defines AWS Config resource configuration visibility, history, rules, remediation, aggregators, and advanced queries.
- [How AWS Config Works](https://docs.aws.amazon.com/config/latest/developerguide/how-does-config-work.html) - Explains resource discovery, configuration items, resource tracking, relationships, delivery channels, and rule evaluation.
- [Recording AWS Resources with AWS Config](https://docs.aws.amazon.com/config/latest/developerguide/select-resources.html) - Documents how Config records supported resource creation, changes, and deletion as configuration items.
- [Looking Up Resources That Are Discovered by AWS Config](https://docs.aws.amazon.com/config/latest/developerguide/looking-up-discovered-resources.html) - Documents Config resource inventory lookup.
- [GetResourceConfigHistory](https://docs.aws.amazon.com/config/latest/APIReference/API_GetResourceConfigHistory.html) - Documents the API for retrieving configuration items for a resource over a time interval.
- [Querying the Current Configuration State of AWS Resources](https://docs.aws.amazon.com/config/latest/developerguide/querying-AWS-resources.html) - Documents AWS Config advanced queries for inventory, security, operational intelligence, and cost optimization.
- [Evaluating Resources with AWS Config Rules](https://docs.aws.amazon.com/config/latest/developerguide/evaluate-config.html) - Explains Config rules, managed rules, custom rules, and rule considerations.
- [AWS Config Managed Rules](https://docs.aws.amazon.com/config/latest/developerguide/evaluate-config_use-managed-rules.html) - Documents managed rules and customization.
- [restricted-ssh](https://docs.aws.amazon.com/config/latest/developerguide/restricted-ssh.html) - Documents the `INCOMING_SSH_DISABLED` managed rule for unrestricted SSH ingress checks.
- [Multi-Account Multi-Region Data Aggregation for AWS Config](https://docs.aws.amazon.com/config/latest/developerguide/aggregate-data.html) - Documents aggregators, source accounts, source Regions, read-only behavior, and organization aggregation.
- [Conformance Packs for AWS Config](https://docs.aws.amazon.com/config/latest/developerguide/conformance-packs.html) - Defines conformance packs as deployable collections of rules and remediation actions.
- [Remediating Noncompliant Resources with AWS Config](https://docs.aws.amazon.com/config/latest/developerguide/remediation.html) - Documents remediation with AWS Systems Manager Automation documents and managed or custom remediation actions.
