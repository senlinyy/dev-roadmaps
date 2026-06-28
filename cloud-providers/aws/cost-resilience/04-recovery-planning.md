---
title: "Recovery Planning"
description: "Plan RTO, RPO, recovery strategies, backups, restore targets, failover, and drills so an AWS service can return to use after data loss or major failure."
overview: "A backup is useful only when the team knows what it restores, how long restore takes, what data may be lost, and which recovery strategy the business can afford. This article turns backup settings into a full recovery plan for one orders service."
tags: ["backups", "rto", "rpo", "restore", "dr"]
order: 4
id: article-cloud-iac-finops-resilience-recovery-planning
aliases:
  - recovery-planning-and-backups
  - cloud-iac/finops-resilience/recovery-planning.md
  - child-finops-resilience-recovery-planning
  - cloud-providers/aws/cost-resilience/recovery-planning.md
---

## Table of Contents

1. [The Database Is Gone](#the-database-is-gone)
2. [RTO and RPO](#rto-and-rpo)
3. [Backups and Restore Targets](#backups-and-restore-targets)
4. [Failover Strategies](#failover-strategies)
5. [Recovery Runbooks and Drills](#recovery-runbooks-and-drills)
6. [Cost of Recovery Choices](#cost-of-recovery-choices)
7. [Official References](#official-references)

## The Database Is Gone
<!-- section-summary: Recovery planning starts with the uncomfortable question of how the service returns after real loss. -->

The right-sizing review protected recovery settings instead of trimming them blindly. Now the team has to prove those settings actually help. Someone deletes the wrong table, a migration corrupts important rows, or a Region-level problem makes the service unreachable. The team has backups enabled, which is good. The harder question arrives after that: what exactly can we restore, how long will it take, and how much data can the business lose?

**Recovery planning** turns backup settings into an operating plan. It names the failure scenarios, the restore targets, the people involved, the commands or console steps, and the verification checks after recovery.

For this article, follow `orders`, a service with an ECS API, RDS PostgreSQL, S3 receipt files, SQS jobs, and CloudWatch logs. The team wants to be ready for three realistic failures: accidental data deletion, database corruption after a bad migration, and a serious regional outage. Each failure needs a different recovery path.

A backup setting is only the raw material. Recovery also needs application steps. If RDS restores to a new endpoint, the app must point to it. If S3 versioning restores an object, the database row must still reference the correct key. If a queue has old messages, workers may replay actions. If DNS moves to another Region, certificates, secrets, and dependencies must be ready there.

The first recovery decision table can be small:

| Failure scenario | Main recovery path | Key decision | Evidence the team needs |
|---|---|---|---|
| Accidental table deletion | RDS point-in-time restore to a new DB instance | Which restore time avoids the delete? | CloudTrail, migration logs, database audit logs |
| Bad migration corrupts rows | Restore before migration, replay or reconcile later writes | Which writes after the restore point need recovery? | App logs, order events, payment records |
| One Availability Zone has issues | RDS Multi-AZ failover and ECS tasks in healthy AZs | Is local failover enough? | Health checks, RDS event, ALB target health |
| Serious regional outage | Backup and restore, pilot light, warm standby, or active-active | Which Region and strategy match the RTO? | Cross-Region backups, IaC, DNS, dependency readiness |

## RTO and RPO
<!-- section-summary: RTO defines the acceptable outage time, while RPO defines the acceptable amount of data loss. -->

**Recovery Time Objective**, or RTO, is the maximum acceptable time to restore service after an interruption. If the checkout system has a 30-minute RTO, the recovery plan must be able to make checkout usable inside that time.

**Recovery Point Objective**, or RPO, is the maximum acceptable amount of data loss measured in time. If the orders database has a 5-minute RPO, losing an hour of committed orders would break the objective.

These numbers should come from business impact. A marketing preview site and a payment system deserve different recovery targets.

RTO and RPO should be written per workload and sometimes per data type. Checkout availability may need a 30-minute RTO. Admin reporting may accept four hours. Paid order records may need a five-minute RPO. Cached product recommendations may accept a day of loss because they can be rebuilt.

The numbers must be testable. If RDS point-in-time restore takes 42 minutes in a drill, that recovery path supports a longer RTO than 30 minutes. If backups run every hour, a five-minute RPO needs another mechanism such as transaction logs, continuous backup, replication, or a different data architecture.

Write the target in a small table:

| Component | Failure | RTO | RPO |
|---|---|---|---|
| Orders API | One AZ issue | 10 minutes | 0 committed orders lost |
| Orders DB | Bad migration | 45 minutes | 5 minutes |
| Receipt files | Accidental object deletion | 2 hours | 15 minutes |
| Reporting UI | Regional outage | 8 hours | 24 hours |

This gives engineering and business people the same promise to review.

The table also changes design decisions. A five-minute RPO for paid orders may need continuous backups, transaction logs, event replay, or another durable record of order activity. A 24-hour RPO for reporting may work with daily exports. Different targets belong on different components because copying the strongest target everywhere wastes money and creates unnecessary complexity.

![The timeline makes RPO and RTO visible by separating the data-loss window from the restore-time window](/content-assets/articles/article-cloud-iac-finops-resilience-recovery-planning/rto-rpo-timeline.png)

*The timeline makes RPO and RTO visible by separating the data-loss window from the restore-time window.*


## Backups and Restore Targets
<!-- section-summary: A backup only helps after the team proves where it restores and how the app will use it. -->

Backups can include RDS automated backups, database snapshots, DynamoDB point-in-time recovery, S3 versioning, EBS snapshots, AMIs, and AWS Backup plans. Each backup type has different restore behavior.

The restore target should be specific. Restoring an RDS snapshot creates a new database instance. The app must then point to the restored endpoint, secrets may need updates, and traffic may need to pause while data consistency is checked.

```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier prod-orders \
  --target-db-instance-identifier restore-orders-20260624 \
  --restore-time 2026-06-24T10:15:00Z \
  --region eu-west-2
```

That command starts a point-in-time restore for RDS. `--source-db-instance-identifier` names the damaged or source database. `--target-db-instance-identifier` names the new restored database that AWS will create. `--restore-time` is the UTC time the team wants to recover to. RDS creates a new DB instance alongside the damaged one.

Shortened output can look like this:

```json
{
  "DBInstance": {
    "DBInstanceIdentifier": "restore-orders-20260624",
    "DBInstanceStatus": "creating",
    "Engine": "postgres",
    "DBInstanceClass": "db.m6i.large",
    "MultiAZ": false,
    "BackupRetentionPeriod": 7
  }
}
```

`DBInstanceStatus` starts as `creating`, so the runbook waits until the restored database reaches `available`. After that, the team validates the data, updates the application connection settings, restarts services, and verifies user flows. `MultiAZ` in the restored target deserves attention because a restored instance may need additional configuration before it matches the production resilience shape.

A restore target is usually a new resource. RDS point-in-time restore creates a new DB instance. A snapshot restore can create a new database or volume. S3 version restore may copy or promote an older object version. DynamoDB point-in-time recovery restores to a new table. Recovery plans should include the naming pattern, network placement, security groups, parameter groups, secrets, and app config changes for the restored target.

For the orders database, the runbook might say:

1. Stop write traffic or put checkout into maintenance mode.
2. Choose restore time before the bad migration.
3. Restore RDS to `restore-orders-YYYYMMDD-HHMM`.
4. Attach the correct subnet group, security group, parameter group, and tags.
5. Run validation queries against the restored database.
6. Update a new Secrets Manager secret or Parameter Store value with the restored endpoint.
7. Deploy the app against the restored endpoint.
8. Run smoke tests and reconcile any orders created after the restore point.

The reconcile step is where RPO gets real. If the restore point is 10:15 and the incident started at 10:20, what happens to orders placed between those times? A business requirement for preserving those orders needs a replay source, audit log, or manual reconciliation path.

Check backup availability before trusting a plan:

```bash
aws rds describe-db-instances \
  --db-instance-identifier prod-orders \
  --region eu-west-2 \
  --query 'DBInstances[].{BackupRetention:BackupRetentionPeriod,LatestRestorableTime:LatestRestorableTime,MultiAZ:MultiAZ}'
```

This RDS command shows whether the live database has automated backup retention, the newest point AWS currently says it can restore to, and whether Multi-AZ is enabled. `LatestRestorableTime` should be recent enough to satisfy the workload RPO.

Example output:

```json
[
  {
    "BackupRetention": 7,
    "LatestRestorableTime": "2026-06-24T10:42:00+00:00",
    "MultiAZ": true
  }
]
```

This output supports a short RPO only if the application and business can handle the gap between the latest restorable time and the incident time. It also tells the team that the database has local standby protection through Multi-AZ, which helps with AZ failure while backups handle corruption or accidental deletion.

```bash
aws backup list-recovery-points-by-backup-vault \
  --backup-vault-name prod-primary \
  --region eu-west-2 \
  --query 'RecoveryPoints[0:5].{Status:Status,Created:CreationDate,Resource:ResourceArn}'
```

The AWS Backup command lists recent recovery points in the `prod-primary` vault. `Status` should be `COMPLETED`, `Created` shows when the point was made, and `Resource` confirms which database or resource the point protects.

Example output:

```json
[
  {
    "Status": "COMPLETED",
    "Created": "2026-06-24T01:00:14+00:00",
    "Resource": "arn:aws:rds:eu-west-2:123456789012:db:prod-orders"
  },
  {
    "Status": "COMPLETED",
    "Created": "2026-06-23T01:00:11+00:00",
    "Resource": "arn:aws:rds:eu-west-2:123456789012:db:prod-orders"
  }
]
```

These commands show what AWS says is restorable. Drills prove the app can run on the restored data.

![The restore path shows why backups matter only when the team can restore them into a target environment and prove the app works](/content-assets/articles/article-cloud-iac-finops-resilience-recovery-planning/backup-restore-target-path.png)

*The restore path shows why backups matter only when the team can restore them into a target environment and prove the app works.*


## Failover Strategies
<!-- section-summary: Failover choices range from local standby resources to multi-Region recovery, with cost rising as recovery speed improves. -->

Some failures are handled inside one Region. RDS Multi-AZ can fail over to a standby in another Availability Zone. ECS services can keep tasks running across multiple AZs. Load balancers can stop sending traffic to unhealthy targets.

Larger failures may need a second Region. Common strategies include backup and restore, pilot light, warm standby, and active-active. Backup and restore usually has lower steady cost and longer restore time. Warm standby costs more because core resources already run in the recovery Region.

The right choice depends on RTO, RPO, engineering capacity, data replication, and budget. A strategy nobody has practiced is mostly a hope with a service name attached.

AWS disaster recovery strategies often fall into four broad shapes:

| Strategy | Basic idea | Cost and speed |
|---|---|---|
| Backup and restore | Keep backups, create resources during recovery | Lower steady cost, longer RTO |
| Pilot light | Keep core data and minimal infrastructure ready | Moderate cost, faster than full rebuild |
| Warm standby | Keep a scaled-down working environment ready | Higher cost, faster recovery |
| Active-active | Serve traffic from multiple locations | Highest complexity and cost, fastest failover when designed well |

For `orders`, backup and restore may be acceptable for reporting. Checkout may need Multi-AZ inside one Region plus a pilot light or warm standby if the business requires regional recovery. The app also needs data replication choices: RDS cross-Region read replica or snapshot copy, S3 replication, container images in ECR in the recovery Region, secrets copied or recreated, and DNS failover planning.

Failover includes infrastructure and dependencies. The team must know which dependencies exist in the recovery Region: payment provider allowlists, email sending identities, domain certificates, WAF rules, IAM roles, KMS keys, Parameter Store values, and deployment pipelines. Missing one of these can turn a beautiful standby diagram into a long outage.

The strategy decision should name what happens during each failure:

| Scenario | Design choice for `orders` | Reason |
|---|---|---|
| ECS task failure | Run more than one task and use load balancer health checks | Bad tasks stop receiving traffic |
| One AZ issue | Spread ECS tasks across subnets and keep RDS Multi-AZ | The Region still serves checkout from healthy AZs |
| Bad migration | Restore RDS to a new instance before the migration time | Corruption needs a clean data copy and reconciliation |
| Regional outage | Keep cross-Region backups and a pilot-light plan for checkout | The business accepts a longer recovery than active-active |

This table prevents one recovery feature from being used for every problem. Multi-AZ helps with local infrastructure failure. Backups help with corruption and deletion. The plan needs both kinds of thinking because each feature covers a different failure shape.

## Recovery Runbooks and Drills
<!-- section-summary: Recovery plans need written steps and practice runs before an emergency. -->

A recovery runbook should name the trigger, owner, communication channel, restore source, restore target, validation checks, traffic switch, and rollback from the recovery attempt. It should also name forbidden shortcuts, such as skipping data validation to reopen checkout faster.

Drills prove the plan. A quarterly non-production restore can measure how long RDS restore takes, whether secrets update cleanly, whether the app can connect, and whether smoke tests catch missing data. The result should update the RTO estimate with real evidence.

```bash
aws rds describe-db-snapshots \
  --db-instance-identifier prod-orders \
  --region eu-west-2 \
  --query 'DBSnapshots[0:5].{Snapshot:DBSnapshotIdentifier,Created:SnapshotCreateTime,Status:Status,Encrypted:Encrypted}'
```

This command helps confirm which snapshots are available before a restore decision. In the output, check `DBSnapshotIdentifier`, `SnapshotCreateTime`, `Status`, and `Encrypted`. A snapshot with `Status` set to `available` is ready to use. A missing recent snapshot means the team should stop and investigate backup scheduling before promising a restore time.

Example output:

```json
[
  {
    "Snapshot": "rds:prod-orders-2026-06-24-01-00",
    "Created": "2026-06-24T01:00:12+00:00",
    "Status": "available",
    "Encrypted": true
  },
  {
    "Snapshot": "rds:prod-orders-2026-06-23-01-00",
    "Created": "2026-06-23T01:00:10+00:00",
    "Status": "available",
    "Encrypted": true
  }
]
```

The snapshot names and timestamps tell the team which restore points exist. `Status` confirms whether AWS can use the snapshot now. `Encrypted` matters because the recovery account, Region, and KMS key plan must support encrypted restore.

A good runbook is written for a stressed human. It should include exact account, Region, resource names, roles, commands, dashboards, and decision points. It should also say when to call database, security, finance, support, and leadership contacts. Recovery is a technical workflow and a communication workflow.

Validation checks should be application-level. For `orders`, validation might include:

| Check | Why it matters |
|---|---|
| Count recent orders around restore time | Detect missing or duplicated rows |
| Open one known customer order | Prove key relational data joins correctly |
| Create a test order | Prove writes work against restored database |
| Read receipt object from S3 | Prove database and object storage still line up |
| Run payment sandbox smoke test | Prove critical integration config works |
| Check queue depth and dead-letter queues | Detect replay or backlog issues |

Drills should produce measurements. How long did the restore take? Which step was unclear? Which permission was missing? Which smoke test failed? The runbook should receive updates after every honest practice run.

A drill record can stay small:

```yaml
drill: prod-orders-rds-restore
date: 2026-06-24
restoreSource: automated backup
restoreTarget: restore-orders-20260624
measuredRestoreTime: 38 minutes
validation:
  orderCountAroundRestoreTime: passed
  knownCustomerOrder: passed
  testOrderWrite: passed
  receiptObjectRead: failed
followUp:
  - add S3 receipt bucket permission to restored app role
  - update runbook step for restored secret name
nextDrill: 2026-09-24
```

This YAML record explains the drill result without hiding the failure. `measuredRestoreTime` gives the team real RTO evidence. The failed receipt check shows that database restore alone left the full user workflow unproven. `followUp` turns the drill into an improvement plan.

![The recovery comparison shows how backup restore, warm standby, and active multi-region designs trade cost for speed and complexity](/content-assets/articles/article-cloud-iac-finops-resilience-recovery-planning/recovery-drill-cost-tradeoffs.png)

*The recovery comparison shows how backup restore, warm standby, and active multi-region designs trade cost for speed and complexity.*


## Cost of Recovery Choices
<!-- section-summary: Faster recovery usually costs more, so the recovery target should match business impact. -->

Recovery plans spend money in different ways. More frequent backups increase storage. Cross-Region replication adds transfer and storage cost. Warm standby keeps compute and databases running before a failure. Active-active adds the most complexity and steady-state cost.

Cost review should protect recovery capability deliberately. Compare the monthly spend with the RTO and RPO it supports. If the business can accept four hours of recovery for an internal tool, a cheaper strategy may be fine. If checkout needs minutes, the budget needs to support that promise.

Recovery cost should be visible in the same language as the recovery promise. "Cross-Region backup copy costs $X per month and supports regional restore for paid orders" is a better conversation than "backup is expensive." If the business lowers the RTO, the cost may rise. If the business accepts a slower RTO, the team may simplify the design.

Cost can also come from drills. Restoring a large database for a test costs temporary compute and storage. That cost is usually worth paying because it reveals whether the plan works. A team that avoids restore tests to save money may learn during a real incident that the backup was incomplete or the runbook missed a dependency.

The final recovery plan should name the accepted tradeoff:

```yaml
workload: orders checkout
rto: 45 minutes for database restore from accidental corruption
rpo: 5 minutes
strategy: RDS automated backups with point-in-time restore, Multi-AZ for local AZ failure, quarterly restore drill
knownCost:
  - RDS backup storage
  - drill restore instance for testing
acceptedRisk:
  - manual reconciliation for writes after restore point
nextReview: 2026-09-30
```

That note helps cost reviews protect the recovery capability that users and the business actually need.

## Official References

- [Plan for Disaster Recovery](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/plan-for-disaster-recovery-dr.html)
- [Disaster recovery options in the cloud](https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html)
- [Recovery objectives](https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-of-on-premises-applications-to-aws/recovery-objectives.html)
- [Backup and recovery approaches on AWS](https://docs.aws.amazon.com/prescriptive-guidance/latest/backup-recovery/welcome.html)
- [Introduction to Amazon RDS backups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html)
- [What is AWS Backup?](https://docs.aws.amazon.com/aws-backup/latest/devguide/whatisbackup.html)
