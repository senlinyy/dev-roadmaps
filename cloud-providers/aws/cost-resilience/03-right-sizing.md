---
title: "Right-Sizing"
description: "Use utilization, latency, error, storage, log, queue, and recovery evidence to reduce AWS waste without cutting away capacity the service still needs."
overview: "Right-sizing is not making everything smaller. This article explains how to tune compute, databases, storage, logs, queues, workers, and autoscaling from evidence while keeping rollback and resilience intact."
tags: ["rightsizing", "compute-optimizer", "autoscaling", "cost"]
order: 3
id: article-cloud-providers-aws-compute-right-sizing
aliases:
  - right-sizing
  - article-cloud-providers-aws-cost-resilience-right-sizing
---

## Table of Contents

1. [The Outage of the Small Database](#the-outage-of-the-small-database)
2. [What Is Right-Sizing](#what-is-right-sizing)
3. [ECS Fargate Compute Tuning](#ecs-fargate-compute-tuning)
4. [Tuning Relational Databases Beyond CPU Graphs](#tuning-relational-databases-beyond-cpu-graphs)
5. [Storage Optimization: Aligning Prefix Lifecycles](#storage-optimization-aligning-prefix-lifecycles)
6. [Eliminating Log Ingestion Noise](#eliminating-log-ingestion-noise)
7. [Analyzing Background Queue Worker Efficiency](#analyzing-background-queue-worker-efficiency)
8. [AWS Compute Optimizer: Machine-Learning Evidence](#aws-compute-optimizer-machine-learning-evidence)
9. [Executing Safe, Reversible Resource Adjustments](#executing-safe-reversible-resource-adjustments)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Outage of the Small Database

A cost review reveals that your relational database is the most expensive line item on the AWS invoice. Eager to reduce spending immediately, a developer decides to downsize the production RDS instance class by half (from a `db.m6g.xlarge` down to a `db.m6g.large`).

Two hours later, the nightly catalog data-export script starts running automatically. The database CPU immediately spikes to 100%, query latency jumps to 15 seconds, and active checkout transactions begin backing up. The orders API container processes, waiting for blocked database sockets, exhaust their own connection pools and crash. 

The immediate cost savings created a massive production outage.

Right-sizing is not the act of making every cloud resource smaller. It is the operational discipline of matching resource shapes and sizes to measured workloads from empirical evidence. 

The goal of right-sizing is to provision the smallest resource footprint that still fully protects your application's transaction latency, recovery speed, logging evidence, and expected traffic surges.

## What Is Right-Sizing

Right-sizing is the practice of matching provisioned AWS resources to actual, measured work and verified risk profiles. It can mean reducing capacity, increasing capacity, changing resource families, tuning autoscaling boundaries, applying lifecycle data rules, or deleting idle resources.

At its core, right-sizing is evidence-based resource fit. It compares provisioned AWS capacity, storage, retention, and scaling limits against observed workload behavior and verified resilience requirements.

To right-size successfully, you must replace high-level assumptions with a specific, evidence-backed question:

> What resource shape does this workload actually require, and what telemetry evidence proves it?

This work requires combining both cost data and deep runtime metrics. A low average utilization graph is not proof of waste. Mathematical averages smooth out and hide the critical latency spikes that occur during software deployments, flash sales, and nightly batch windows. You must analyze the tail performance percentiles (p95 and p99) across full operational cycles before adjusting resource limits.

## ECS Fargate Compute Tuning

Compute right-sizing starts with the active Fargate task size. When you configure an ECS task definition, you select the exact CPU shares (such as 0.5 vCPU) and RAM limits (such as 1 GB) allocated to the container process. 

Fargate compute tuning is task-level capacity adjustment. You change CPU, memory, desired count, or scaling bounds in the service's runtime contract, then verify latency, restart, and saturation signals.

A service can be over-sized because the individual tasks are too large, because too many task replicas run permanently, or because autoscaling limits keep too much idle capacity.

To right-size tasks safely, you must map your compute metrics directly to operational outcomes:

Fargate Compute Optimization Matrix:

| Compute Telemetry | Metric Indication | Safe Operational Move |
| :--- | :--- | :--- |
| **p95 CPU < 10%** | The container process is heavily over-provisioned on compute cycles. | Downsize the task's `cpu` parameter gradually by one tier. |
| **p95 Memory < 15%** | The process requires very little RAM compared to allocation. | Reduce the task's `memory` parameter, keeping a 30% safety buffer. |
| **Task restarts rising** | The container is crashing, often due to Out-Of-Memory (OOM) kills. | Increase task memory parameters immediately; investigate memory leaks. |
| **CPU spikes during deploys** | The rolling update requires significant capacity to boot fresh tasks. | Keep baseline task desired counts high; verify CPU grace periods. |

Never change task configurations during high-traffic windows. Every task size adjustment requires registering a new task definition revision, rolling it out gradually, and verifying that tail latency and container restart metrics remain healthy under load.

A practical Fargate review starts by collecting the service shape and the pressure signals in the same change note:

```bash
aws ecs describe-services \
  --cluster orders-prod \
  --services orders-api \
  --query 'services[].{Desired:desiredCount,Running:runningCount,TaskDefinition:taskDefinition,Deployments:deployments[].{Status:status,Rollout:rolloutState}}'

aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ClusterName,Value=orders-prod Name=ServiceName,Value=orders-api \
  --start-time 2026-06-01T00:00:00Z \
  --end-time 2026-06-08T00:00:00Z \
  --period 300 \
  --extended-statistics p95

aws cloudwatch get-metric-statistics \
  --namespace AWS/ApplicationELB \
  --metric-name TargetResponseTime \
  --dimensions Name=LoadBalancer,Value=app/orders-prod/abc123 \
  --start-time 2026-06-01T00:00:00Z \
  --end-time 2026-06-08T00:00:00Z \
  --period 300 \
  --extended-statistics p95
```

The service command shows which task definition and deployment state the team is changing. The CloudWatch commands show whether CPU and customer-facing latency have room to move. If the API already has p95 latency near the target, reducing CPU creates a latency risk instead of a clean saving.

## Tuning Relational Databases Beyond CPU Graphs

Database right-sizing is a high-risk operational change because databases hold shared state. If a compute task crashes, the orchestrator replaces it. If a database locks up or runs out of storage, the entire application path halts.

Database tuning is stateful capacity management. It must account for CPU, memory, connections, storage I/O, query plans, batch windows, and recovery objectives before changing instance class.

When reviewing Amazon RDS spending, you must look beyond simple CPU utilization graphs. The database capacity may be constrained by write latency, connection limits, storage I/O bottlenecks, or single query designs:

* **Active Connections**: Relational databases dedicate memory handles to active connection sockets. If your compute tasks scale out, connection limits can be exhausted even while CPU utilization remains low.
* **Storage I/O (IOPS)**: High read-write latency is often driven by storage disk bottlenecks rather than CPU limits. Upgrading storage from gp2 to gp3 can resolve latency issues without requiring a larger instance class.
* **Workload Spikes**: Analyze the exact hours when nightly export scripts or cleanup runs execute, verifying that the instance can absorb these batch loads.

If database query performance is poor, look for missing query indexes or redundant connection pools first. Downsizing a database with poorly optimized queries will simply accelerate system failure.

## Storage Optimization: Aligning Prefix Lifecycles

Storage right-sizing means applying automated retention rules rather than executing manual deletions. In Amazon S3, you configure Lifecycle Rules to transition files to cheaper S3 Glacier storage classes or expire them permanently.

Storage optimization is lifecycle alignment. You match object prefixes and data classes to the retention, retrieval-speed, and compliance rules that apply to that data.

To configure lifecycle rules safely, you must align your S3 key prefixes with the data class and business lifecycle:

* `receipts/`: Customer-facing invoices that must be retrieved instantly. Retain on S3 Standard for 90 days, transition to S3 Glacier Instant Retrieval for 7 years to satisfy audit rules, and expire.
* `exports/monthly/`: Financial reports compiled once per month. Retain on S3 Standard for 30 days, transition to S3 Glacier Flexible Retrieval, and expire after 1 year.
* `exports/tmp/`: Temporary processing chunks created during multipart uploads. Set an automated lifecycle rule to delete incomplete multipart uploads after 7 days, eliminating hidden storage fees.

The gotcha is bucket-level rules. If you apply a single, overriding lifecycle rule to an entire bucket without matching key prefixes, you can accidentally delete critical compliance files or customer documents, creating legal and operational liability. Structure S3 keys by explicit prefixes first.

The lifecycle configuration should be reviewed like application code. This example keeps temporary export chunks short-lived while leaving customer receipt prefixes untouched:

```json
{
  "Rules": [
    {
      "ID": "ExpireTemporaryExports",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "exports/tmp/"
      },
      "AbortIncompleteMultipartUpload": {
        "DaysAfterInitiation": 7
      },
      "Expiration": {
        "Days": 14
      }
    },
    {
      "ID": "ArchiveMonthlyExports",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "exports/monthly/"
      },
      "Transitions": [
        {
          "Days": 30,
          "StorageClass": "GLACIER_IR"
        }
      ],
      "Expiration": {
        "Days": 365
      }
    }
  ]
}
```

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket orders-prod-exports \
  --lifecycle-configuration file://orders-export-lifecycle.json

aws s3api get-bucket-lifecycle-configuration \
  --bucket orders-prod-exports
```

The review signal is prefix coverage. Temporary files should match `exports/tmp/`, monthly reports should match `exports/monthly/`, and receipts should stay outside both rules. That prefix review prevents a storage saving from turning into deleted customer evidence.

## Eliminating Log Ingestion Noise

Log cost is driven by ingestion volume, storage retention, and subscription queries. The safe operating answer to high log costs is not "turn off logs." Doing so removes the critical evidence needed to diagnose outages.

Log right-sizing is signal-quality management. You reduce noisy ingestion, tune log levels, and set retention by environment while preserving the diagnostic records needed for incidents.

Instead, you right-size logs by improving signal quality:

* **Eradicate Error Loops**: A single application bug that writes a traceback string 1,000 times per second under load will generate gigabytes of log noise. Fix the underlying error loop to reduce log volume instantly.
* **Manage Ingress Log Levels**: Standardize your logging frameworks to run on `INFO` or `WARN` levels in production, restricting verbose `DEBUG` logging strictly to isolated staging environments.
* **Set Tiered Retention**: By default, CloudWatch Logs retains all files permanently. Enforce a strict 7-day retention policy for development groups, 30 days for production APIs, and stream long-term compliance trails to S3 through Amazon Data Firehose.

## Analyzing Background Queue Worker Efficiency

Background queues and workers compile costs through request counts, Lambda invocations, running container hours, and downstream API calls.

Queue worker efficiency is the relationship between queue input, worker capacity, successful deletes, retries, and downstream cost. A larger worker fleet is efficient only when it converts backlog into completed work.

When an SQS queue backlog grows (visible messages and oldest message age are rising), a naive responder will immediately scale the worker task count. However, you must first verify whether the backlog represents useful work or failing work:

* **Useful Backlog**: Workers are healthy and deleting processed messages, but incoming customer traffic has spiked. Scaling worker task desired counts will safely drain the backlog.
* **Failing Backlog**: Workers are picking up messages, encountering runtime errors, failing to delete the payload, and letting the messages return to the queue. The same bad messages are processed repeatedly.

If the queue is backed up due to failing work, scaling your worker fleet will multiply your AWS costs while producing zero completed jobs. Responders must check Dead Letter Queue (DLQ) volumes first. If the DLQ is accumulating messages, isolate the poison payloads before changing capacity.

## AWS Compute Optimizer: Machine-Learning Evidence

AWS provides native tools to identify optimization opportunities:

AWS Compute Optimizer acts as a recommendation engine over utilization history. It can identify over-allocated or under-allocated resources, but its output must be validated against application behavior and recovery requirements.

* **AWS Compute Optimizer**: Consolidates and analyzes historical utilization metrics to provide recommendations for supported resources such as EC2 instances, Auto Scaling groups, EBS volumes, Lambda functions, ECS services on Fargate, RDS databases, and certain commercial software licenses.
* **Cost Optimization Hub**: A consolidated dashboard that aggregates cost recommendations across accounts and Regions, prioritizing actions by estimated savings.

Compute Optimizer is highly valuable because it identifies utilization patterns that operators may miss, such as a Fargate task that is permanently over-allocated on RAM. However, automated recommendations lack critical business context:

Compute Optimizer Recommendations vs. Operational Context:

| Machine-Learning Recommendation | Required Operational Validation |
| :--- | :--- |
| **Downsize Fargate Task from 1 vCPU to 0.25 vCPU** | Will the application still satisfy its target startup grace period during high-velocity deployments? |
| **Reduce Lambda memory from 2048 MB to 512 MB** | Does the function process large PDF exports that will trigger Out-Of-Memory crashes if memory is reduced? |
| **Delete an apparently "idle" RDS instance** | Is this database a dedicated, cold disaster recovery pilot-light replication standby? |
| **Downsize EC2 instance from m6g to t4g class** | Can the burstable t-series handle sustained transaction load without exhausting CPU credit balances? |

Treat machine-learning recommendations as empirical evidence, but always require manual validation and peer reviews before executing changes in production.

## Executing Safe, Reversible Resource Adjustments

Right-sizing changes must be rolled out with the exact same discipline as a software release. To optimize safely, execute changes step-by-step:

A safe right-sizing adjustment is a reversible infrastructure change. It has a bounded blast radius, target telemetry, versioned implementation, rollback setting, and post-change observation window.

1. Isolate the blast radius. Select one specific layer to change, such as Fargate task size, while databases and logs stay stable.
2. Define the target telemetry bounds. A useful success target might say Fargate CPU can rise to 40%, while p95 latency stays below 200 ms and 5xx errors stay at zero.
3. Deploy through versioned infrastructure code. Register a new task definition revision and let the service controller roll it out gradually.
4. Keep the rollback target ready. Record the previous task definition revision or capacity setting before the change starts.
5. Review after a full operational cycle. Watch peak hours, nightly batch windows, and deployment events before declaring the saving safe.

For ECS, the rollback path is concrete. The team records the stable task definition revision, updates to the new revision during the planned window, and keeps the old revision ready:

```bash
aws ecs describe-services \
  --cluster orders-prod \
  --services orders-api \
  --query 'services[].taskDefinition'

aws ecs update-service \
  --cluster orders-prod \
  --service orders-api \
  --task-definition arn:aws:ecs:eu-west-2:111122223333:task-definition/orders-api:42

aws ecs update-service \
  --cluster orders-prod \
  --service orders-api \
  --task-definition arn:aws:ecs:eu-west-2:111122223333:task-definition/orders-api:41
```

The second command represents the optimized revision. The third command is the rollback to the previous known-good revision. The change is not ready for production review until both commands are known, the monitoring window is agreed, and the on-call engineer knows which metrics decide rollback.

By enforcing this operational sequence, you ensure that you can safely optimize your cloud environments without risking customer-facing regressions.

## Putting It All Together

Right-sizing is the practice of matching provisioned resources to measured workloads and verified risks:

* **Downsize from Tail Metrics**: Analyze p95 and p99 utilization metrics over complete operational cycles; never base decisions on quiet averages.
* **Tune Database I/O First**: Upgrade RDS storage performance and optimize SQL query indexes before attempting to shrink database instance classes.
* **Prefix Storage Keys**: Align S3 key prefixes with explicit lifecycle rules to transition and expire data automatically.
* **Prune Ingestion Noise**: Set production log levels to `INFO`, eradicate error loops, and enforce short retention periods.
* **Isolate Queue Failure Modes**: Verify Dead Letter Queue volumes and worker logs before scaling background capacity.
* **Validate Automated Recommendations**: Treat Compute Optimizer recommendations as starting points, always requiring human context checks.

## What's Next

We have covered the discipline of right-sizing compute tasks, RDS databases, S3 storage prefixes, and logging streams. In the next article, we will focus on the final layer of cost and resilience: disaster recovery. We will detail RTO and RPO targets, disaster recovery strategies (Backup & Restore, Pilot Light, Warm Standby, Active/Active), continuous backup vaults, and Point-in-Time database restores.

---

**References**

* [AWS Compute Optimizer User Guide](https://docs.aws.amazon.com/compute-optimizer/latest/ug/what-is-compute-optimizer.html) - Documentation on machine-learning resource profiling and idle checks.
* [AWS Compute Optimizer Requirements](https://docs.aws.amazon.com/compute-optimizer/latest/ug/requirements.html) - Technical reference for metric history baselines.
* [Cost Optimization rightsizing recommendations](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-rightsizing.html) - AWS Cost Explorer rightsizing recommendations.
* [AWS Cost Optimization Hub User Guide](https://docs.aws.amazon.com/cost-management/latest/userguide/cost-optimization-hub.html) - Documentation on consolidated cross-account cost findings.
