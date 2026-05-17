---
title: "Cost Visibility"
description: "Use Azure Cost Management, Cost Analysis, tags, budgets, Advisor, and right-sizing to understand spend before changing resources."
overview: "Cost work starts with visibility. This article follows one bill increase and shows how Azure teams connect spend to services, owners, environments, and safe tuning decisions."
tags: ["cost-management", "cost-analysis", "tags", "budgets", "advisor"]
order: 2
id: article-cloud-providers-azure-cost-resilience-cost-management-budgets-tags
aliases:
  - azure-cost-management-budgets-and-tags
  - cloud-providers/azure/cost-resilience/azure-cost-management-budgets-and-tags.md
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Cost Management](#cost-management)
3. [Cost Analysis](#cost-analysis)
4. [Tags](#tags)
5. [Resource Groups](#resource-groups)
6. [Budgets](#budgets)
7. [Advisor](#advisor)
8. [Right-Sizing](#right-sizing)
9. [Cost Leaks](#cost-leaks)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Problem

The previous article paired cost with resilience promises. Now the team has a more concrete problem: the Azure bill is higher than expected.

Nobody is sure why.

- The API team says traffic was normal.
- The database team says no tier was changed.
- The platform team thinks log volume increased after the last release.
- A staging resource group may still be running.
- Backup and versioned blob storage might be growing quietly.

The wrong first move is to resize random resources until the number drops. Cost visibility comes first. The team needs to see spend by time, service, resource group, tag, environment, and owner before deciding what to change.

## Cost Management

Microsoft Cost Management is the Azure area for understanding and managing cloud spend. It includes tools such as Cost Analysis, budgets, exports, recommendations, and cost alerts. For a beginner, the job is simple: turn one large bill into smaller questions a team can answer.

For `devpolaris-orders-api`, the first useful questions are:

| Question | Why it matters |
| --- | --- |
| Which subscription or resource group grew? | Finds the boundary where spend changed. |
| Which service family grew? | Separates compute, SQL, storage, logs, network, and backup cost. |
| Which environment grew? | Separates production from staging, dev, and test. |
| Which owner owns the spend? | Turns cost review into an engineering conversation. |
| Which change happened near the cost increase? | Connects bill movement to releases, traffic, retention, or scaling. |

Cost Management does not tell you what to delete. It tells you where to look.

## Cost Analysis

Cost Analysis is where the team slices spend by dimensions. Dimensions are fields such as service name, resource group, resource, location, meter, tag, charge type, or subscription. Grouping and filtering are the point.

Imagine the monthly total grew by 32 percent. A useful investigation might move like this:

```text
Scope: production subscription
Time: last 30 days compared with previous 30 days
Group by: service name
Then filter: devpolaris resource groups
Then group by: resource
Then compare: daily cost trend
```

That path turns "Azure is expensive" into a sharper statement:

```text
Application Insights ingestion and Log Analytics retention rose after release 2026-05-16.
```

Or:

```text
Deleted test databases still have backup retention cost aging out.
```

Cost Analysis is not a once-a-month punishment. It is operating evidence. When cost changes, ask what system behavior changed.

## Tags

Tags are key-value metadata on Azure resources. They help teams group, filter, allocate, and review resources. Tags do not make architecture better by themselves. They make ownership visible.

Useful tags for the orders service might be:

| Tag | Example value | Question answered |
| --- | --- | --- |
| `service` | `orders-api` | Which service owns this spend? |
| `env` | `prod` | Is this production, staging, dev, or test? |
| `owner` | `platform-api` | Which team should review it? |
| `cost-center` | `commerce` | Which business area pays? |
| `criticality` | `customer-facing` | How careful should tuning be? |

The gotcha is that tags are not history. If tags are missing or wrong, Cost Analysis can group spend incorrectly. Also, tags do not always appear everywhere in exactly the way people expect, especially around inherited billing data or resources created by managed services. Tags are a cost allocation tool, not a substitute for clear resource design.

Still, a small tag set beats heroic detective work. If a resource cannot be tied to a service, environment, and owner, it is hard to tune safely.

## Resource Groups

Resource groups are lifecycle and organization boundaries. They are also a useful cost review boundary because many teams group resources by service and environment.

For example:

| Resource group | Contents | Cost review meaning |
| --- | --- | --- |
| `rg-devpolaris-orders-prod` | App runtime, SQL, storage, monitoring links | Production orders service. |
| `rg-devpolaris-orders-staging` | Candidate runtime and test dependencies | Release and pre-production cost. |
| `rg-devpolaris-shared-observability` | Shared workspace, alerts, dashboards | Shared telemetry cost needing allocation rules. |

Resource groups and tags work together. Resource groups show lifecycle boundaries. Tags show ownership and allocation. If shared resources exist, do not pretend they have no owner. Decide how shared cost should be reviewed, even if the allocation is approximate.

## Budgets

Budgets help teams plan for and drive accountability. A budget can track actual or forecasted cost at a scope and send notifications when thresholds are reached.

The important beginner gotcha: budgets notify. They do not automatically stop Azure resources from running. Microsoft documents that resources are not affected and consumption is not stopped when budget thresholds are exceeded. That is good for uptime, but it means a budget is an alarm, not a circuit breaker.

Useful budget design starts with the scope:

| Scope | Example | When it helps |
| --- | --- | --- |
| Subscription | `sub-devpolaris-prod` | Overall production guardrail. |
| Resource group | `rg-devpolaris-orders-prod` | Service-level accountability. |
| Tag-filtered cost | `service=orders-api` | Cross-resource ownership when service resources span groups. |

Budget alerts can use actual and forecasted cost. Forecasted alerts are valuable because they warn before the end of the month. But cost data is not instant. Cost and usage data can arrive with delay, and budgets are evaluated periodically. Do not use budgets as the only protection against a runaway loop.

## Advisor

Azure Advisor gives recommendations across areas such as cost, reliability, security, performance, and operational excellence. For cost, it can identify idle or underutilized resources and recommend actions such as resizing, shutdown, reservations, or savings plans.

Advisor is a starting point, not an automatic approval. A recommendation that says a resource looks underused may be correct. It may also miss a monthly batch job, a failover role, a planned launch, or a recovery promise.

Review Advisor recommendations with context:

| Advisor says | Ask before acting |
| --- | --- |
| Resize this resource | What latency, traffic, and recovery promise does it support? |
| Shut down idle resource | Is it a rollback target, staging slot, standby, or disaster recovery component? |
| Buy reservation or savings plan | Is the usage stable after right-sizing and cleanup? |
| Remove unused resource | Who owns it, and what evidence proves it is unused? |

Cost recommendations are useful because they point to likely waste. The team still owns the tradeoff.

## Right-Sizing

Right-sizing means choosing the smallest resource shape that still protects the service promise. It is not the same as shrinking everything.

For the orders API, safe right-sizing connects cost evidence to operating evidence:

| Resource | Cost evidence | Safety evidence before change |
| --- | --- | --- |
| App runtime | Low CPU and memory for weeks | Traffic pattern, scale rules, p95 latency, restart history. |
| Azure SQL | Low compute pressure | Query latency, storage growth, backup needs, peak windows. |
| Log workspace | High ingestion and retention cost | Which logs are used for alerts, incidents, audits, and search. |
| Blob Storage | Version growth | Which containers need versioning, soft delete, and retention. |

The cost leak might be real. The right-sizing action still needs a rollback plan. If reducing a database tier hurts checkout latency, the team should know how to restore the previous tier and what signal proves recovery.

## Cost Leaks

Cost leaks are spend patterns that grow quietly because nobody owns or watches them.

Common Azure cost leaks for a learning production service:

| Leak | Why it happens | Safer fix |
| --- | --- | --- |
| Forgotten staging resources | Release test resources remain always on. | Tag and review staging separately; scale down or delete with owner approval. |
| Log ingestion spike | A release logs too much detail or retries noisily. | Fix logging volume and retention, not only workspace size. |
| Blob versions grow | Versioning protects data but every write can create retained versions. | Apply lifecycle policies and separate containers by retention need. |
| Deleted database backups linger | Azure SQL keeps backups for PITR until retention expires. | Understand retention before deleting/recreating databases repeatedly. |
| Overprovisioned database | Tier sized for a rare peak or old assumption. | Compare peak windows, latency, and recovery promise before downsizing. |

The pattern is the same: find evidence, find owner, understand promise, then tune.

## Putting It All Together

Return to the surprising bill.

- Cost Management gave the team a place to inspect spend.
- Cost Analysis turned the total into service, resource, tag, and time slices.
- Tags and resource groups connected spend to ownership and environment.
- Budgets warned when actual or forecasted spend crossed a threshold, but did not stop resources.
- Advisor pointed at likely waste, but needed workload context.
- Right-sizing connected cost evidence to latency, traffic, retention, and recovery promises.
- Cost leaks became reviewable patterns instead of mystery charges.

Cost visibility is the work before cost optimization. If the team cannot explain the spend, it is not ready to change the architecture.

## What's Next

The next article turns from money to recovery. It explains RTO, RPO, backups, redundancy, restore targets, recovery strategies, and restore drills so the team can say what comes back after data loss or a larger outage.

---

**References**

- [Optimize your cloud investment with Cost Management](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/cost-mgt-best-practices)
- [Group and filter options in Cost Analysis and Budgets](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/group-filter)
- [Create and manage budgets](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets)
- [Azure Advisor cost recommendations](https://learn.microsoft.com/en-us/azure/advisor/advisor-reference-cost-recommendations)
- [Azure Storage data protection overview](https://learn.microsoft.com/en-us/azure/storage/blobs/data-protection-overview)
