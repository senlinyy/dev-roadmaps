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

1. [What Does Right-Sizing Actually Optimize?](#what-does-right-sizing-actually-optimize)
2. [How Do You Right-Size Compute?](#how-do-you-right-size-compute)
3. [How Do You Right-Size Databases and Storage?](#how-do-you-right-size-databases-and-storage)
4. [How Do You Right-Size Logs, Queues, and Background Work?](#how-do-you-right-size-logs-queues-and-background-work)
5. [How Do You Set Autoscaling Guardrails?](#how-do-you-set-autoscaling-guardrails)
6. [How Do You Make a Safe Right-Sizing Change?](#how-do-you-make-a-safe-right-sizing-change)
7. [What Should You Remember?](#what-should-you-remember)
8. [References](#references)

Right-sizing means providing enough capacity to meet performance and resilience goals without continuously paying for capacity that contributes neither useful work nor justified protection. It is an optimization problem: minimize total cost subject to acceptable service behavior. Total cost includes the cloud bill, latency, failed work, outages, recovery, engineering effort, and complexity created by overly aggressive tuning.

The sections below answer these questions in order:

1. **What Does Right-Sizing Actually Optimize?**
2. **How Do You Right-Size Compute?**
3. **How Do You Right-Size Databases and Storage?**
4. **How Do You Right-Size Logs, Queues, and Background Work?**
5. **How Do You Set Autoscaling Guardrails?**
6. **How Do You Make a Safe Right-Sizing Change?**

## What Does Right-Sizing Actually Optimize?
<!-- section-summary: Right-sizing changes resource size or count after checking how the workload actually behaves. -->

Cost visibility has done its first job. The `orders` team now knows the worker service spends too much overnight. Four large ECS tasks run all night, and the SQS queue stays empty most of that time. The bill says the service is expensive, and a dashboard says CPU averages 8 percent.

**Right-sizing** means matching resource size and count to real demand. The target can be a smaller task size, better autoscaling, or more memory that stops retries wasting money elsewhere.

Available capacity must cover three different quantities:

```text
expected demand + demand variance + failure reserve
```

Expected demand is ordinary work. Variance covers bursts, cache misses, garbage collection, deployments, batch jobs, and forecasting error. Failure reserve keeps the service within its promise when a task, node, or Availability Zone is lost. Unused capacity can therefore be insurance rather than waste.

Right-sizing is evidence-based tuning. Sometimes the answer is smaller. Sometimes it is fewer copies during quiet hours. Sometimes it is more memory because the current setting causes slow retries. Sometimes the better cost change is a lifecycle rule, a database index, a log-level fix, or a scaling policy. The goal is lower waste with user experience and recovery promises still intact.

For `orders`, look at four workload shapes:

| Workload | Possible waste | Evidence to inspect | Risk if cut blindly |
|---|---|---|---|
| ECS API | Oversized tasks or high minimum count | CPU, memory, request rate, p95 latency, 5xx, deployments | Latency during peak traffic or deploy overlap |
| ECS worker | Idle capacity overnight | Queue depth, oldest message age, retry count, worker errors | Queue backlog during morning batch |
| RDS database | Large instance or storage growth | CPU, memory, IOPS, connections, slow queries, backups | Slow queries, connection pressure, harder recovery |
| Logs and backups | Long retention or noisy logs | Ingestion bytes, retention, restore target, support needs | Lost debugging or recovery evidence |

The same service can need different right-sizing moves in different layers. The API may need steady minimum capacity for user traffic. The worker may need scheduled scaling. The database may need query tuning before instance changes. Logs may need cleaner fields and retention rules. A good review avoids one giant "make it cheaper" change and turns the system into smaller decisions.

Start by finding the **bottleneck**: the constrained resource that limits useful throughput. A service can show 42 percent CPU while its database connection pool is at 100 percent, or show moderate disk capacity while IOPS or throughput is exhausted. Inspect CPU, memory, network, disk IOPS, disk throughput, connections, locks, thread pools, file descriptors, concurrency, queues, and service quotas according to the workload.

**Utilization** describes how much of a resource is in use. **Saturation** means work is waiting because the resource cannot serve it immediately. Two systems can both report 70 percent CPU while one has an empty run queue and stable latency and the other has a growing queue and rising latency. Average utilization alone cannot tell them apart.

Queueing explains why a latency-sensitive service can need significant headroom. If capacity is 100 requests per second and average arrivals are 95, random bursts above 100 accumulate work. As utilization approaches full capacity, tail latency can rise sharply. Operating an interactive API at 40 to 60 percent may be a rational latency decision rather than waste.

## How Do You Right-Size Compute?
<!-- section-summary: Compute changes should compare utilization with latency, errors, startup time, and deploy overlap. -->

For EC2 and ECS, check CPU, memory, network, disk, request rate, latency, and error rate. A low CPU average can still hide high memory use, spiky traffic, or deploy overlap needs.

For Lambda, memory size affects CPU share and duration. Increasing memory can sometimes reduce duration enough to lower total cost while improving latency. Test several memory sizes with realistic payloads instead of guessing from one metric.

AWS Compute Optimizer can suggest rightsizing for supported resources. Recommendations should be reviewed with application context. A tool can see utilization. The service team knows launch events, batch windows, and rollback needs.

For ECS services, right-sizing has two dimensions: task size and task count. Task size controls CPU and memory per copy. Task count controls how many copies run. If CPU is low but memory is near the limit, reducing CPU alone may help only if the platform allows that combination. If tasks are killed for memory, increasing memory can reduce restarts and user impact.

Total compute is roughly instance size multiplied by instance count, but equal totals have different failure shapes. Two 32-core instances and eight 8-core instances both provide 64 cores. Losing one large instance removes half the fleet; losing one smaller instance removes one eighth. Vertical scaling is simpler and may fit workloads that cannot distribute well. Horizontal scaling reduces failure-unit size but adds scheduling, coordination, network, and connection overhead.

CPU and memory also fail differently. CPU pressure often makes work slower. Exhausted memory can crash or OOM-kill a process. Size memory from working set, peak variation, and safety margin, not average alone. Before removing a large cache, check whether the apparent saving moves work and cost into a database or dependency.

For web APIs, include deployment overlap. If desired count is `4`, a rolling deployment may briefly run five or more tasks depending on deployment settings. If the database connection pool allows 20 connections per task, new overlap can increase database pressure. Right-sizing compute without checking downstream capacity can move the bottleneck.

Replica count must follow the promised failure tolerance. If demand needs three instances and the service must survive losing one, provision at least four units of equal capacity. For three Availability Zones with ten workers each, total capacity is 30, but zone-loss-guaranteed capacity is only `30 - 10 = 20`. A workload needing 28 workers is healthy in ordinary conditions and badly underprovisioned for its stated zone-loss goal.

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


## How Do You Right-Size Databases and Storage?
<!-- section-summary: Database and storage tuning needs performance, growth, retention, and recovery evidence. -->

Databases need careful treatment because they hold state. Check CPU, memory, IOPS, connections, storage growth, slow queries, backup retention, and replication needs before changing instance class or storage settings.

They also scale more slowly than stateless compute. Resizing, replica creation, cache warming, rebalancing, failover, shard movement, and connection redistribution can take minutes or hours. Database headroom normally includes ordinary load, bursts, growth, and failure capacity. A database at 30 percent CPU may still be saturated by storage latency, lock contention, connection limits, or replication lag.

Storage tuning often starts with lifecycle rules. S3 objects can move to cheaper storage classes or expire after a retention period. EBS snapshots and RDS backups should match the recovery plan instead of living forever by accident.

Storage has at least three independent limits: capacity in bytes, operations per second, and byte throughput. It also has a latency requirement and a growth runway. If two terabytes remain and consumption grows 100 gigabytes per day, the system has only twenty days to full even if the percentage-used chart does not yet look critical.

Replication adds physical bytes for resilience. Three copies of ten terabytes may consume roughly thirty terabytes, and the extra twenty is not waste if the durability promise requires it. Classify hot transactional, warm historical, cold archive, and disposable cache data so each uses an appropriate performance and durability tier.

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

## How Do You Right-Size Logs, Queues, and Background Work?
<!-- section-summary: Operational evidence costs money, so teams should retain enough to debug and audit without storing noise forever. -->

CloudWatch Logs cost can rise quickly when debug logs stay enabled or payloads are logged repeatedly. Keep useful fields such as request ID, version, user-safe identifiers, and error type. Avoid logging full secrets, full tokens, or huge request bodies.

Log volume grows as request rate multiplied by events per request and bytes per event. At 20,000 requests per second, five 500-byte events per request produce about 50 MB per second, or roughly 4.3 TB per day before compression and indexing effects. Sampling routine success logs, removing duplicates, shortening low-value retention, or emitting a metric instead can beat resizing the logging system because it removes unnecessary work at the source.

Queues and background workers need balance. Too few workers create backlog and slow users down. Too many workers sit idle or overload downstream systems. Queue depth, age of oldest message, retry count, and downstream throttles show whether worker count matches the job.

Queues decouple arrival rate from processing rate. Backlog grows while arrivals exceed processing and shrinks when processing exceeds arrivals. Long-term processing capacity must exceed average arrival rate, but temporary backlog is acceptable if the oldest job and expected drain time remain within the business deadline. One million queued jobs are only ten seconds of work at 100,000 jobs per second.

For a draining queue, estimate `drain time = queue depth / net processing rate`. One hundred thousand jobs shrinking by 5,000 per minute represent about twenty minutes of backlog. Compare that estimate and oldest-message age with the promised completion time rather than alarming on depth alone.

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

Demand reduction often beats capacity optimization. Caching, batching, eliminating duplicate work, fixing inefficient queries, compressing transfer, and stopping retry storms reduce pressure throughout the dependency chain. Shrinking one component while pushing more work into the database or an external API is not a system-level saving.

![The storage and async view shows how database growth, log retention, queue backlog, and worker count can all create sizing decisions](/content-assets/articles/article-cloud-providers-aws-compute-right-sizing/storage-logs-queue-sizing.png)

*The storage and async view shows how database growth, log retention, queue backlog, and worker count can all create sizing decisions.*


## How Do You Set Autoscaling Guardrails?
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

Scale on a signal that causally represents the needed capacity, not merely the easiest available graph. CPU is weak for an I/O-bound API. Raw queue depth is weak when job sizes vary. Request concurrency, work seconds per worker, oldest-message age, or request count per healthy target may describe the load more directly.

A minimum of zero can work for some workers and scheduled jobs. It may be a poor choice for user-facing APIs that need warm capacity. A maximum should be high enough for normal peaks and low enough to protect budgets and dependencies. Cooldowns should avoid scaling up and down every few minutes because churn itself can cause instability.

Four guardrails need explicit reasoning. Minimum capacity covers baseline, startup delay, deploy overlap, and failure reserve. Maximum capacity limits financial damage and protects dependencies. Scale-up speed must catch demand before latency or backlog violates the SLO. Scale-down speed must wait long enough to avoid removing capacity during temporary dips or incomplete work.

Scheduled scaling is useful when demand has a predictable rhythm. If marketplace order imports always start at 08:00, the worker service can scale up before the queue fills and scale down after the batch. That can save overnight cost without making the morning queue wait for cold capacity.

## How Do You Make a Safe Right-Sizing Change?
<!-- section-summary: Right-sizing should move in small steps with a rollback path and a watch window. -->

Start with scenarios rather than averages. A capacity proposal should be tested against at least six conditions:

| Scenario | What the model must include |
|---|---|
| Normal operation | Healthy dependencies and an ordinary weekday load |
| Normal peak | The busiest period the team expects during routine operation |
| Traffic spike | Two or three times normal traffic for a defined duration |
| Infrastructure failure | One host, replica, or Availability Zone unavailable |
| Deployment | Old and new versions overlapping while some capacity is starting, draining, or warming |
| Downstream degradation | Higher database latency, longer active requests, and more retries |

A plan that works only in the first row is inexpensive only while everything is healthy. It is not right-sized for the service's resilience promise.

Headroom should therefore be explicit. Instead of saying that the service keeps "plenty of spare capacity," write what that capacity covers: a 20 percent traffic burst, one-node failure, rolling deployment, and ten minutes of autoscaling delay. Each part of the reserve now has a reason that can be measured and revisited. If startup time later falls from ten minutes to one, the scaling-delay reserve may shrink safely. Improving elasticity can reduce required capacity even when peak demand stays unchanged.

Service-level objectives turn this reasoning into a boundary. Suppose the service promises 99.9 percent availability and p95 latency below 250 milliseconds. The question is not whether CPU can be pushed to 80 percent. It is: what is the smallest configuration that still meets the availability, latency, error-rate, queue-age, and recovery objectives in the scenarios that matter? Cost is minimized only within those constraints.

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

The full change loop is deliberately incremental:

1. Establish a baseline over several representative weeks. Include weekday and weekend demand, p50, p95, and p99 latency, error rate, CPU, memory, IOPS, disk latency, network, connections, queue age, replication lag, and cost.
2. Identify actual waste from workload and failure requirements. If 18 instances cover ordinary demand, 23 cover the peak, one extra covers the required instance failure, and three cover deployment overlap, a justified minimum is about 27 rather than the current 40.
3. Trace dependencies before shrinking anything. Less compute may increase database or cache pressure. Less cache may increase database work. Fewer workers increase queue latency. Reduced logging changes observability. A smaller database may increase application latency and retries.
4. Reduce capacity in steps such as `40 → 36 → 32 → 29 → 27`, observing each step. Systems often have nonlinear boundaries that a single large cut would cross without warning.
5. Test failure conditions as well as healthy steady state. Remove one instance, one zone, one replica, or a percentage of capacity. Test a deployment in which versions overlap and some instances are not yet ready.
6. Define rollback thresholds before the experiment. Examples include p99 latency above 500 milliseconds for ten minutes, error rate above 1 percent, queue age above 15 minutes, database CPU above 85 percent, or replication lag above 60 seconds.
7. Keep the saving only if latency, reliability, and failure recovery remain within the agreed promises.

Predefined thresholds matter because they prevent an incident-time debate about whether deteriorating behavior is "bad enough." The operator knows which signal ends the experiment and which previous configuration to restore.

For RDS or storage changes, include maintenance windows and restore checks. For log retention changes, confirm support and compliance owners agree. For backup changes, confirm RTO and RPO still match the recovery plan. Right-sizing should keep recovery impact visible.

After the watch window, close the loop. Compare the expected savings with actual cost trend, and compare user signals with the baseline. If the service saved money and stayed healthy, keep the change and update the runbook. If latency rose or queues backed up, roll back and write down which assumption was wrong. That feedback is how teams get better at cost work without making users pay for experiments.

One useful accounting model separates provisioned capacity into three categories:

- **Productive capacity** serves the expected workload.
- **Resilience capacity** covers bursts, failures, scaling delay, deployments, and recovery.
- **Waste** has no credible workload or operational purpose.

Imagine a 100-server service. Normal traffic needs 55 servers, the normal peak needs 65, losing one Availability Zone removes 20, and a deployment can temporarily remove another five. Peak plus zone loss plus deployment therefore requires about 90 servers. The first 55 serve the baseline, ten cover the expected peak, twenty cover failure, five cover deployment, and the remaining ten are the clearest removal candidate. Calling all 45 idle servers waste would cut away the system's promised protection.

This leads to a practical order for optimization: eliminate unnecessary work, improve software efficiency, choose appropriate resource types, improve elasticity, remove unnecessary headroom, and only then optimize pricing or commitments. Buying a three-year commitment first can lock the organization into a discounted version of a workload it never needed.

A mature capacity explanation should sound like `18 normal + 4 peak variation + 3 scaling delay + 4 zone reserve + 1 deployment buffer = 30`, not "30 is what we have always used." The same reasoning should explain database size, disk capacity, replicas, queue workers, cache memory, log retention, and autoscaling minimums.

![The change plan shows the safe path from baseline evidence through one small change, a watch window, and a keep-or-rollback decision](/content-assets/articles/article-cloud-providers-aws-compute-right-sizing/safe-right-sizing-change-plan.png)

*The change plan shows the safe path from baseline evidence through one small change, a watch window, and a keep-or-rollback decision.*


## What Should You Remember?

:::expand[What Does Right-Sizing Actually Optimize?]{kind="recap"}
Right-sizing changes resource size or count after checking how the workload actually behaves.

It minimizes total cost while preserving the service's performance and resilience promises. Required capacity covers expected demand, demand variance, and failure reserve. Capacity without a credible workload or protection purpose is the part to remove.
:::

:::expand[How Do You Right-Size Compute?]{kind="recap"}
Compute changes should compare utilization with latency, errors, startup time, and deploy overlap.

Find the real bottleneck, distinguish utilization from saturation, and examine CPU, memory, latency, errors, startup time, deployment overlap, and downstream pressure together. Size the remaining fleet for the failures it promises to survive, not only for healthy average load.
:::

:::expand[How Do You Right-Size Databases and Storage?]{kind="recap"}
Database and storage tuning needs performance, growth, retention, and recovery evidence.

Databases scale more slowly and may be constrained by connections, locks, I/O, or replication rather than CPU. Storage has separate byte-capacity, IOPS, throughput, latency, growth, retention, and durability requirements. Extra copies are resilience capacity when the durability promise requires them.
:::

:::expand[How Do You Right-Size Logs, Queues, and Background Work?]{kind="recap"}
Operational evidence costs money, so teams should retain enough to debug and audit without storing noise forever.

Reduce unnecessary log events and duplicate work at the source. For queues, use arrival rate, processing rate, oldest-message age, retries, and expected drain time—not depth alone. Protect downstream systems when increasing worker capacity.
:::

:::expand[How Do You Set Autoscaling Guardrails?]{kind="recap"}
Autoscaling needs minimums, maximums, and cooldowns that protect users and control cost.

Use a metric that causally represents required capacity. Set a minimum for startup delay, deployment overlap, baseline demand, and failure reserve; a maximum for dependency and budget protection; fast enough scale-up; and patient enough scale-down.
:::

:::expand[How Do You Make a Safe Right-Sizing Change?]{kind="recap"}
Right-sizing should move in small steps with a rollback path and a watch window.

Model normal, peak, spike, failure, deployment, and degraded-dependency scenarios. Establish a representative baseline, make small changes, test failures, define rollback thresholds first, and keep savings only when SLOs and recovery requirements remain intact.
:::


## References

- [Cost Explorer overview](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-what-is.html)
- [Amazon EC2 Auto Scaling health checks](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-health-checks.html)
- [AWS Budgets best practices](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-best-practices.html)
- [AWS Compute Optimizer](https://docs.aws.amazon.com/compute-optimizer/latest/ug/what-is-compute-optimizer.html)
- [Identifying opportunities with Cost Optimization Hub](https://docs.aws.amazon.com/cost-management/latest/userguide/cost-optimization-hub.html)
- [Managing Amazon S3 storage lifecycle](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html)
- [Amazon ECS service auto scaling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html)
