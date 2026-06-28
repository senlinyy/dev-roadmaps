---
title: "Right-Sizing"
description: "Use utilization, latency, error, storage, log, queue, and recovery evidence to reduce AWS waste without cutting away capacity the service still needs."
overview: "Right-sizing tunes resources from evidence instead of instinct. This article explains how to adjust compute, databases, storage, logs, queues, workers, and autoscaling while keeping rollback and resilience intact."
tags: ["rightsizing", "compute-optimizer", "autoscaling", "cost"]
order: 3
id: article-cloud-providers-aws-compute-right-sizing
aliases:
  - right-sizing
  - article-cloud-providers-aws-cost-resilience-right-sizing
---

## Table of Contents

1. [The Expensive Idle Resource](#the-expensive-idle-resource)
2. [Compute Sizing](#compute-sizing)
3. [Database and Storage Sizing](#database-and-storage-sizing)
4. [Logs, Queues, and Background Work](#logs-queues-and-background-work)
5. [Autoscaling Guardrails](#autoscaling-guardrails)
6. [A Safe Change Plan](#a-safe-change-plan)
7. [Official References](#official-references)

## The Expensive Idle Resource
<!-- section-summary: Right-sizing changes resource size or count after checking how the workload actually behaves. -->

Cost visibility has done its first job. The `orders` team now knows the worker service spends too much overnight. Four large ECS tasks run all night, and the SQS queue stays empty most of that time. The bill says the service is expensive, and a dashboard says CPU averages 8 percent.

**Right-sizing** means matching resource size and count to real demand. The target can be a smaller task size, better autoscaling, or more memory that stops retries wasting money elsewhere.

Right-sizing is evidence-based tuning. Sometimes the answer is smaller. Sometimes it is fewer copies during quiet hours. Sometimes it is more memory because the current setting causes slow retries. Sometimes the better cost change is a lifecycle rule, a database index, a log-level fix, or a scaling policy. The goal is lower waste with user experience and recovery promises still intact.

For `orders`, look at four workload shapes:

| Workload | Possible waste | Evidence to inspect | Risk if cut blindly |
|---|---|---|---|
| ECS API | Oversized tasks or high minimum count | CPU, memory, request rate, p95 latency, 5xx, deployments | Latency during peak traffic or deploy overlap |
| ECS worker | Idle capacity overnight | Queue depth, oldest message age, retry count, worker errors | Queue backlog during morning batch |
| RDS database | Large instance or storage growth | CPU, memory, IOPS, connections, slow queries, backups | Slow queries, connection pressure, harder recovery |
| Logs and backups | Long retention or noisy logs | Ingestion bytes, retention, restore target, support needs | Lost debugging or recovery evidence |

The same service can need different right-sizing moves in different layers. The API may need steady minimum capacity for user traffic. The worker may need scheduled scaling. The database may need query tuning before instance changes. Logs may need cleaner fields and retention rules. A good review avoids one giant "make it cheaper" change and turns the system into smaller decisions.

## Compute Sizing
<!-- section-summary: Compute changes should compare utilization with latency, errors, startup time, and deploy overlap. -->

For EC2 and ECS, check CPU, memory, network, disk, request rate, latency, and error rate. A low CPU average can still hide high memory use, spiky traffic, or deploy overlap needs.

For Lambda, memory size affects CPU share and duration. Increasing memory can sometimes reduce duration enough to lower total cost while improving latency. Test several memory sizes with realistic payloads instead of guessing from one metric.

AWS Compute Optimizer can suggest rightsizing for supported resources. Recommendations should be reviewed with application context. A tool can see utilization. The service team knows launch events, batch windows, and rollback needs.

For ECS services, right-sizing has two dimensions: task size and task count. Task size controls CPU and memory per copy. Task count controls how many copies run. If CPU is low but memory is near the limit, reducing CPU alone may help only if the platform allows that combination. If tasks are killed for memory, increasing memory can reduce restarts and user impact.

For web APIs, include deployment overlap. If desired count is `4`, a rolling deployment may briefly run five or more tasks depending on deployment settings. If the database connection pool allows 20 connections per task, new overlap can increase database pressure. Right-sizing compute without checking downstream capacity can move the bottleneck.

For Lambda, real payload tests matter. Memory size affects CPU share, and more memory can shorten duration enough to reduce total cost for CPU-heavy work. For IO-heavy functions, more memory may have little benefit because the function waits on a network call or database response.

```bash
aws compute-optimizer get-ecs-service-recommendations \
  --service-arns arn:aws:ecs:eu-west-2:123456789012:service/prod/orders-worker \
  --region eu-west-2
```

This command asks Compute Optimizer for recommendations about one ECS service. The `--service-arns` value names the service under review. The output should feed a human review before any change approval.

Shortened output might look like this:

```json
{
  "ecsServiceRecommendations": [
    {
      "serviceArn": "arn:aws:ecs:eu-west-2:123456789012:service/prod/orders-worker",
      "finding": "Overprovisioned",
      "currentServiceConfiguration": {
        "cpu": 1024,
        "memory": 2048
      },
      "utilizationMetrics": [
        { "name": "Cpu", "statistic": "Maximum", "value": 18.4 },
        { "name": "Memory", "statistic": "Maximum", "value": 42.7 }
      ],
      "serviceRecommendationOptions": [
        {
          "cpu": 512,
          "memory": 1024,
          "projectedUtilizationMetrics": [
            { "name": "Cpu", "statistic": "Maximum", "value": 36.8 },
            { "name": "Memory", "statistic": "Maximum", "value": 85.4 }
          ]
        }
      ]
    }
  ]
}
```

`finding` says the tool sees overprovisioning from recent utilization history. `currentServiceConfiguration` shows the current task CPU and memory. `utilizationMetrics` shows observed peak utilization rather than business context. `serviceRecommendationOptions` shows a possible smaller task shape and projected utilization. The memory projection near 85 percent deserves caution because a small traffic spike or memory leak could create restarts.

For ECS APIs, check application-level saturation too. CPU at 30 percent may look roomy, while p95 latency is high because database connections are exhausted. Memory at 70 percent may be healthy for a cached app. Right-sizing should include runtime behavior alongside infrastructure graphs.

A practical compute review can read like this:

| Signal | Healthy right-sizing clue | Warning sign |
|---|---|---|
| CPU and memory | Low peaks across normal busy windows | Average is low but peak is high during imports |
| p95 latency and 5xx | Stable before and after a test | Latency rises after reducing task size |
| Deployment overlap | New tasks start before old tasks drain | Minimum count leaves no room for rolling deploys |
| Downstream pressure | Database connections stay below limit | Smaller tasks increase retries or connection churn |
| Startup time | Scale-out starts fast enough for demand | Queue waits for cold capacity every morning |

![The compute evidence view shows why CPU, memory, latency, errors, and queue age should be read together before changing capacity](/content-assets/articles/article-cloud-providers-aws-compute-right-sizing/compute-right-sizing-evidence.png)

*The compute evidence view shows why CPU, memory, latency, errors, and queue age should be read together before changing capacity.*


## Database and Storage Sizing
<!-- section-summary: Database and storage tuning needs performance, growth, retention, and recovery evidence. -->

Databases need careful treatment because they hold state. Check CPU, memory, IOPS, connections, storage growth, slow queries, backup retention, and replication needs before changing instance class or storage settings.

Storage tuning often starts with lifecycle rules. S3 objects can move to cheaper storage classes or expire after a retention period. EBS snapshots and RDS backups should match the recovery plan instead of living forever by accident.

```json
{
  "Rules": [
    {
      "ID": "archive-old-exports",
      "Status": "Enabled",
      "Filter": { "Prefix": "exports/" },
      "Transitions": [{ "Days": 30, "StorageClass": "STANDARD_IA" }]
    }
  ]
}
```

This S3 lifecycle configuration applies only to objects whose keys start with `exports/`. After 30 days, matching objects move to `STANDARD_IA`, which is designed for data that the team accesses less often. The rule can save storage cost, but retrieval has different cost and access patterns, so the team should confirm old exports have low read frequency and no instant user-facing download requirement.

Database cost can be caused by compute class, storage, I/O, backup retention, replicas, and Multi-AZ choices. A database that looks idle by CPU may still need memory for cache or I/O capacity for bursts. Before downsizing, review slow queries, connection counts, read/write latency, storage growth, maintenance windows, and restore objectives.

For RDS, a safe review might run:

```bash
aws rds describe-db-instances \
  --db-instance-identifier prod-orders \
  --region eu-west-2 \
  --query 'DBInstances[].{Class:DBInstanceClass,Storage:AllocatedStorage,Engine:Engine,MultiAZ:MultiAZ,BackupRetention:BackupRetentionPeriod,LatestRestorableTime:LatestRestorableTime,Status:DBInstanceStatus}'
```

This query prints the sizing and resilience settings in one row. `Class` is the database compute size, `Storage` is allocated storage in GiB, `Engine` confirms the database engine, `MultiAZ` shows whether AWS maintains a standby in another Availability Zone, `BackupRetention` shows how many days automated backups are kept, and `Status` should be `available` before sizing decisions are made.

Example output:

```json
[
  {
    "Class": "db.m6i.large",
    "Storage": 500,
    "Engine": "postgres",
    "MultiAZ": true,
    "BackupRetention": 7,
    "LatestRestorableTime": "2026-06-24T10:42:00+00:00",
    "Status": "available"
  }
]
```

This row tells the team that cost and resilience share the same object. `Class` and `Storage` affect the bill. `MultiAZ`, `BackupRetention`, and `LatestRestorableTime` affect recovery. A database right-sizing review should check the recovery target before changing the instance class or retention period.

Then compare with CloudWatch metrics and database-level query evidence. If cost comes from inefficient queries, downsizing makes the problem worse. If storage grows because old audit data stays in the transactional database, a retention or archive design may be better than changing instance class.

Database right-sizing usually starts with query and schema evidence. Review slow query logs, missing indexes, connection pool settings, table growth, vacuum or maintenance behavior for PostgreSQL, and read/write patterns. If the app runs a full table scan every checkout, a larger instance only hides the design issue for a while. If storage grows because receipts or exports live in the database, moving binary objects to S3 may reduce database pressure and improve recovery options.

For S3, lifecycle rules should reflect access and restore needs. Moving old exports to `STANDARD_IA` or Glacier classes can save money, but retrieval has cost and latency differences. Expiring logs or objects should match compliance and support needs. Storage is cheaper than production confusion, so write down the retention reason before deleting.

## Logs, Queues, and Background Work
<!-- section-summary: Operational evidence costs money, so teams should retain enough to debug and audit without storing noise forever. -->

CloudWatch Logs cost can rise quickly when debug logs stay enabled or payloads are logged repeatedly. Keep useful fields such as request ID, version, user-safe identifiers, and error type. Avoid logging full secrets, full tokens, or huge request bodies.

Queues and background workers need balance. Too few workers create backlog and slow users down. Too many workers sit idle or overload downstream systems. Queue depth, age of oldest message, retry count, and downstream throttles show whether worker count matches the job.

Right-sizing background work often means scaling on queue depth rather than keeping peak capacity running all day.

Logs are operational evidence. Reducing log cost should preserve the fields responders need: timestamp, service, version, request ID, operation, error code, and safe customer or order identifiers. The first fix for noisy logs is often code or log-level control before retention cuts.

CloudWatch Logs retention should be explicit by log group. A production API might keep 30 or 90 days depending on support and audit needs. A sandbox service might keep 7 days. Infinite retention by accident is a common cost leak.

Queue workers need two metrics together: queue age and processing errors. Low queue depth can hide old stuck messages. High worker count can hide inefficient processing by throwing capacity at it. A good worker scaling rule may use queue depth per task or age of oldest message, with a maximum that protects the database or downstream API.

```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/SQS \
  --metric-name ApproximateAgeOfOldestMessage \
  --dimensions Name=QueueName,Value=orders-work \
  --start-time 2026-06-24T08:00:00Z \
  --end-time 2026-06-24T12:00:00Z \
  --period 300 \
  --statistics Maximum \
  --region eu-west-2
```

This asks CloudWatch for the maximum age of the oldest visible message in five-minute buckets. The unit is seconds. A low maximum means workers are keeping up during that bucket. A rising maximum during business hours means messages are waiting longer, even if queue depth briefly drops between samples.

Example output:

```json
{
  "Label": "ApproximateAgeOfOldestMessage",
  "Datapoints": [
    {
      "Timestamp": "2026-06-24T08:00:00+00:00",
      "Maximum": 12.0,
      "Unit": "Seconds"
    },
    {
      "Timestamp": "2026-06-24T08:05:00+00:00",
      "Maximum": 18.0,
      "Unit": "Seconds"
    },
    {
      "Timestamp": "2026-06-24T08:10:00+00:00",
      "Maximum": 240.0,
      "Unit": "Seconds"
    }
  ]
}
```

The first two buckets show workers keeping up. The third bucket shows the oldest message waiting four minutes. If that pattern appears after reducing worker count, the service may need a higher scheduled minimum, faster processing, or a less aggressive scale-down.

If queue age stays low with fewer workers, the change may be safe. If age rises during business hours, the team needs a higher minimum, faster processing, or better scheduled scaling.

Retries deserve special attention because they can turn a small problem into cost growth. A worker that fails one downstream call and retries aggressively may consume compute, queue requests, logs, and downstream API quota while making little progress. The cost fix may be exponential backoff, a dead-letter queue, or a circuit breaker around the dependency rather than a worker-count change.

![The storage and async view shows how database growth, log retention, queue backlog, and worker count can all create sizing decisions](/content-assets/articles/article-cloud-providers-aws-compute-right-sizing/storage-logs-queue-sizing.png)

*The storage and async view shows how database growth, log retention, queue backlog, and worker count can all create sizing decisions.*


## Autoscaling Guardrails
<!-- section-summary: Autoscaling needs minimums, maximums, and cooldowns that protect users and control cost. -->

Autoscaling helps resources follow demand, and it needs guardrails. A minimum protects baseline availability and deploy overlap. A maximum protects budgets and downstream dependencies. Cooldowns and target metrics prevent constant scaling churn.

For ECS, target tracking on CPU or request count can work for web services. Queue workers may scale from SQS queue depth or age. EC2 Auto Scaling groups need health checks and launch templates that can actually create healthy replacements.

```bash
aws application-autoscaling describe-scalable-targets \
  --service-namespace ecs \
  --region eu-west-2 \
  --query 'ScalableTargets[].{ResourceId:ResourceId,Dimension:ScalableDimension,Min:MinCapacity,Max:MaxCapacity}'
```

This gives the team a quick inventory of scalable ECS targets before changing limits. `ResourceId` names the ECS service, `ScalableDimension` tells whether the target controls desired task count, and `MinCapacity` and `MaxCapacity` show the floor and ceiling the scaling policy can use. Those numbers protect availability and budget, so they deserve review before changing task count.

Example output:

```json
[
  {
    "ResourceId": "service/prod/orders-api",
    "Dimension": "ecs:service:DesiredCount",
    "Min": 4,
    "Max": 12
  },
  {
    "ResourceId": "service/prod/orders-worker",
    "Dimension": "ecs:service:DesiredCount",
    "Min": 1,
    "Max": 8
  }
]
```

The API keeps a higher minimum because it serves user traffic and needs deploy overlap. The worker keeps a lower minimum because queue work can scale with demand. The maximum values protect the database and downstream APIs from an uncontrolled scale-out.

Autoscaling should match the workload signal. CPU works for CPU-bound web services. Request count per target can work for ALB-backed services. Queue depth or queue age fits background workers. Custom metrics may fit domain-specific work, such as orders waiting for fulfillment.

A minimum of zero can work for some workers and scheduled jobs. It may be a poor choice for user-facing APIs that need warm capacity. A maximum should be high enough for normal peaks and low enough to protect budgets and dependencies. Cooldowns should avoid scaling up and down every few minutes because churn itself can cause instability.

Scheduled scaling is useful when demand has a predictable rhythm. If marketplace order imports always start at 08:00, the worker service can scale up before the queue fills and scale down after the batch. That can save overnight cost without making the morning queue wait for cold capacity.

## A Safe Change Plan
<!-- section-summary: Right-sizing should move in small steps with a rollback path and a watch window. -->

Change one main dimension at a time when possible. Reduce task memory, lower desired count, or adjust autoscaling target values separately so the team can understand the result. Bundle changes only when they must move together.

Write the rollback path before applying the change. For ECS, record the previous task definition and service scaling values. For EC2, record the previous launch template and Auto Scaling settings. For RDS, check whether the change requires downtime or has a maintenance window.

After the change, watch cost signals and user signals together. A smaller bill that creates retries, latency, or failed checkouts has only moved the cost into user pain.

A safe right-sizing plan can look like this:

```yaml
workload: orders-worker
currentState:
  taskCpu: 1024
  taskMemory: 2048
  desiredCount: 4
  overnightQueueAge: under 30 seconds
proposedChange:
  scheduledScaling:
    22:00-07:30: 1 task
    07:30-22:00: 4 tasks
rollback:
  restoreDesiredCount: 4
  restoreMinCapacity: 4
watchWindow: 7 days
watchSignals:
  - ApproximateAgeOfOldestMessage
  - worker error count
  - retry count
  - downstream throttles
successCondition: cost decreases and oldest message age stays below 120 seconds during business hours
```

The plan records the current state, the proposed change, the rollback, the watch window, and the signals that decide success. The success condition includes cost and user-impact signals. This prevents the team from calling a change successful only because the bill went down.

For RDS or storage changes, include maintenance windows and restore checks. For log retention changes, confirm support and compliance owners agree. For backup changes, confirm RTO and RPO still match the recovery plan. Right-sizing should keep recovery impact visible.

After the watch window, close the loop. Compare the expected savings with actual cost trend, and compare user signals with the baseline. If the service saved money and stayed healthy, keep the change and update the runbook. If latency rose or queues backed up, roll back and write down which assumption was wrong. That feedback is how teams get better at cost work without making users pay for experiments.

![The change plan shows the safe path from baseline evidence through one small change, a watch window, and a keep-or-rollback decision](/content-assets/articles/article-cloud-providers-aws-compute-right-sizing/safe-right-sizing-change-plan.png)

*The change plan shows the safe path from baseline evidence through one small change, a watch window, and a keep-or-rollback decision.*


## Official References

- [Cost Explorer overview](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-what-is.html)
- [Amazon EC2 Auto Scaling health checks](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-health-checks.html)
- [AWS Budgets best practices](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-best-practices.html)
- [AWS Compute Optimizer](https://docs.aws.amazon.com/compute-optimizer/latest/ug/what-is-compute-optimizer.html)
- [Identifying opportunities with Cost Optimization Hub](https://docs.aws.amazon.com/cost-management/latest/userguide/cost-optimization-hub.html)
- [Managing Amazon S3 storage lifecycle](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html)
- [Amazon ECS service auto scaling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html)
