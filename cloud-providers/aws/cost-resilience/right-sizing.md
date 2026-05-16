---
title: "Right-Sizing"
description: "Use utilization, latency, error, storage, log, queue, and recovery evidence to reduce AWS waste without cutting away capacity the service still needs."
overview: "Right-sizing is not making everything smaller. This article explains how to tune compute, databases, storage, logs, queues, workers, and autoscaling from evidence while keeping rollback and resilience intact."
tags: ["rightsizing", "compute-optimizer", "autoscaling", "cost"]
order: 3
id: article-cloud-providers-aws-cost-resilience-right-sizing
aliases:
  - right-sizing
---

## Table of Contents

1. [The Problem](#the-problem)
2. [What Is Right-Sizing](#what-is-right-sizing)
3. [Compute](#compute)
4. [Databases](#databases)
5. [Storage](#storage)
6. [Logs](#logs)
7. [Queues And Workers](#queues-and-workers)
8. [Autoscaling](#autoscaling)
9. [Recommendations](#recommendations)
10. [Safe Changes](#safe-changes)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## The Problem

Cost visibility showed that the orders service has a clear owner and cost map. Now the team wants to reduce waste.

That can go wrong quickly:

- ECS CPU looks low, but fewer tasks may make deployments fragile.
- RDS is expensive, but the database is the shared bottleneck during export windows.
- S3 temporary files are growing, but receipts and exports have different retention needs.
- Logs are costly, but cutting them may remove the evidence needed for incidents.
- Worker cost rises, but the queue is growing because jobs are failing and retrying.

Right-sizing is the discipline of changing resource shape from evidence. The goal is not "smaller." The goal is the smallest shape that still protects the workload's latency, recovery, observability, and expected traffic.

## What Is Right-Sizing

Right-sizing means matching provisioned resources to measured work and known risk. It can mean reducing capacity, increasing capacity, changing resource type, tuning autoscaling, deleting idle resources, changing lifecycle policy, or moving work to a better service shape.

The useful question is:

```text
What shape does this workload actually need, and what evidence proves it?
```

Right-sizing requires both cost and runtime signals:

| Signal | Why it matters |
| --- | --- |
| Cost trend | Shows where money moved |
| Utilization | Shows whether capacity is used |
| Latency and errors | Shows user impact |
| Queue age | Shows delayed background work |
| Deployment behavior | Shows headroom needs |
| Recovery targets | Shows retention and backup needs |

The gotcha is averages. Average CPU, average latency, or average queue depth can hide bursts and tail pain. Review representative periods, including deploys, traffic spikes, batch windows, and known incidents.

## Compute

Compute right-sizing starts with the running shape.

For ECS on Fargate, the team chooses task CPU, memory, and desired count. A service can be over-sized because each task is too large, because too many tasks run, or because autoscaling keeps too much idle capacity.

Evidence should include:

| Compute evidence | What it tells you |
| --- | --- |
| CPU and memory over time | Whether task size matches work |
| p95 latency and 5xx | Whether users are protected |
| Target health during deploys | Whether overlap is enough |
| Task restarts | Whether memory or startup behavior is unstable |
| Request count per target | Whether work is evenly distributed |

If CPU and memory stay low for weeks, latency is stable, and deploys tolerate fewer tasks, a smaller task size or desired count may be worth testing. If memory spikes during exports or deploys, the quiet average is not enough.

The safe move is a scoped test with rollback. Change one dimension, watch user impact, and keep the previous task definition or desired count ready.

## Databases

Database right-sizing is slower and riskier because databases hold shared state.

For RDS, the review should look beyond CPU. Read connections, storage, I/O, read/write latency, locks, maintenance windows, backup behavior, and known workload spikes. A low CPU graph does not prove the database can shrink. The bottleneck may be storage, connections, or one query pattern.

| Database signal | Why it matters |
| --- | --- |
| CPU | General compute pressure |
| Connections | App concurrency and pool behavior |
| Read/write latency | User and job impact |
| Storage and IOPS | Data and workload growth |
| Backup window behavior | Recovery and maintenance pressure |
| Export or batch timing | Spikes hidden by averages |

The gotcha is coupling. One database often serves API requests, admin jobs, exports, and background workers. Reducing database capacity without understanding all callers can move cost savings into customer latency.

Right-size databases after the workload shape is understood. If export jobs are creating the pressure, fix the export path before downsizing the database.

## Storage

Storage right-sizing usually means retention and lifecycle, not simply deletion.

The orders service stores receipts, exports, temporary chunks, logs, snapshots, and backups. Each has a different purpose.

| Storage path | Review question |
| --- | --- |
| `receipts/` | How long must customers or support retrieve them? |
| `exports/monthly/` | What reporting or audit window needs them? |
| `exports/tmp/` | When are temporary chunks safe to expire? |
| snapshots | Which restore points are still useful? |
| backups | Which RTO/RPO promise do they support? |

S3 lifecycle rules can transition or expire objects by prefix and age. That is useful when the prefix design matches the data purpose. It is dangerous when one bucket-level rule treats receipts, temporary exports, and audit files as the same kind of data.

The habit is to right-size by data class, not by bucket name.

## Logs

Log cost can grow through ingestion, storage, queries, and subscriptions. The answer is not always "keep fewer logs."

Useful logs protect operations. Excess logs can hide evidence, leak private data, and create avoidable cost.

Review logs through signal quality:

| Log question | Better habit |
| --- | --- |
| Are repeated errors creating volume? | Fix the error loop |
| Are debug logs enabled in prod? | Reduce log level deliberately |
| Are logs structured? | Keep searchable fields, remove noise |
| Is retention tied to incident needs? | Set log-group retention by purpose |
| Are secrets or private data present? | Remove and rotate if needed |

The gotcha is cutting retention to hide an ingestion problem. If a bad deploy creates millions of error logs, shorter retention lowers storage later but does not stop ingestion now. Read the cost shape before changing retention.

## Queues And Workers

Queues and workers create cost through requests, invocations, running worker capacity, retries, and downstream calls.

A growing queue can mean healthy demand, under-provisioned workers, downstream rate limits, poison messages, or a broken job shape. Scaling workers is not automatically right-sizing.

| Queue evidence | Possible meaning |
| --- | --- |
| Visible messages rising | More work is waiting |
| Oldest message age rising | Work is delayed |
| Receives high, deletes low | Workers may be failing |
| DLQ growing | Poison work needs review |
| Worker errors repeated | Retrying bad work may be the cost driver |

If workers are behind because useful work increased, more workers may be right. If workers are behind because every job fails and retries, more workers make the failure more expensive.

The safe habit is to identify whether backlog is useful work or failing work before changing capacity.

## Autoscaling

Autoscaling can reduce idle capacity while keeping protection for spikes. It can also hide design problems if the scaling signal is weak.

For ECS, target tracking can adjust desired count based on metrics. For workers, scaling can follow queue signals. For Lambda, concurrency controls can limit or reserve parallelism.

Autoscaling needs boundaries:

| Scaling setting | Why it matters |
| --- | --- |
| Minimum capacity | Protects baseline availability |
| Maximum capacity | Protects downstream systems and cost |
| Target metric | Defines what pressure is being managed |
| Cooldown or warmup | Prevents thrashing |
| Alarms | Shows when automation is not enough |

The gotcha is scaling on the wrong metric. CPU scaling will not fix database saturation. Queue-depth scaling can amplify poison messages. Request-count scaling can miss expensive requests if all requests are not equal.

## Recommendations

AWS has tools that can help identify opportunities. Treat them as evidence, not automatic changes.

Compute Optimizer analyzes resource configuration and utilization metrics to provide recommendations and identify idle resources. It supports resources such as EC2, EBS, Lambda, ECS services on Fargate, and RDS/Aurora databases when requirements are met. Cost Optimization Hub consolidates and prioritizes cost optimization recommendations across accounts and Regions.

These tools are useful because they see patterns humans may miss. They still need workload context:

| Recommendation | Human check |
| --- | --- |
| Downsize compute | Does deploy/failure headroom still hold? |
| Reduce database size | Do batch windows and latency stay safe? |
| Delete idle resource | Is it truly unused or a recovery target? |
| Change commitment | Is usage stable enough for the pricing model? |

The tool can suggest. The service owner decides with evidence.

## Safe Changes

Right-sizing should be rolled out like any production change.

Use a small change, define success, monitor, and keep rollback ready:

| Step | Example |
| --- | --- |
| Pick one layer | ECS task size, not ECS plus RDS plus logs |
| Define expected signal | CPU rises but p95 and 5xx stay stable |
| Change gradually | One service or environment first |
| Watch user impact | Latency, errors, target health, queue age |
| Keep rollback target | Previous task definition, size, or policy |
| Review after a full cycle | Include peak, batch, and deploy windows |

This prevents the worst cost mistake: changing several layers at once, saving money briefly, and losing the ability to explain the regression.

## Putting It All Together

The opening team wanted to reduce spend without cutting away protection. Right-sizing gave them a disciplined way to do it.

Right-sizing matches resource shape to measured work and known risk. Compute reviews task size, desired count, latency, errors, and deploy behavior. Database reviews look beyond CPU into connections, storage, I/O, and workload timing. Storage changes follow data class and lifecycle. Log changes protect evidence while removing noise. Queue and worker changes separate useful backlog from failing work. Autoscaling reduces idle capacity only when the metric matches the pressure. Recommendations from AWS tools help, but owners still verify context. Safe changes are scoped, observable, and reversible.

The system is right-sized when it is no larger than the evidence justifies and no smaller than the workload and recovery promises require.

## What's Next

The final article focuses on recovery. Cost and right-sizing decide today's shape, but the team also needs to know how the service comes back after data loss, bad writes, failed dependencies, or regional trouble.

---

**References**

- [What is AWS Compute Optimizer?](https://docs.aws.amazon.com/compute-optimizer/latest/ug/what-is-compute-optimizer.html). Supports the explanation of Compute Optimizer recommendations, supported resources, utilization analysis, and idle-resource findings.
- [Resource requirements](https://docs.aws.amazon.com/compute-optimizer/latest/ug/requirements.html). Supports the caution that recommendations depend on resource-specific metric and usage requirements.
- [Optimizing your cost with rightsizing recommendations](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-rightsizing.html). Supports the Cost Explorer rightsizing recommendation discussion and the recommendation to use Cost Optimization Hub.
- [Identifying opportunities with Cost Optimization Hub](https://docs.aws.amazon.com/cost-management/latest/userguide/cost-optimization-hub.html). Supports the consolidated cost optimization recommendation, estimated-savings, and supported-resource discussion.
- [Amazon ECS service auto scaling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html). Supports the autoscaling and desired-count discussion for ECS services.
