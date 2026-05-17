---
title: "Recovery Planning"
description: "Plan Azure backups, redundancy, RTO, RPO, restore targets, and recovery strategies so a service can come back after failure."
overview: "A backup is useful only when the team knows what it restores, how long it takes, and how the app will use the restored target. This article turns backups and redundancy into a practical recovery plan."
tags: ["recovery", "backups", "rto", "rpo", "redundancy"]
order: 3
id: article-cloud-providers-azure-cost-resilience-recovery-planning-redundancy-backups
aliases:
  - recovery-planning-redundancy-and-backups
  - cloud-providers/azure/cost-resilience/recovery-planning-redundancy-and-backups.md
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Backup vs Recovery](#backup-vs-recovery)
3. [RTO](#rto)
4. [RPO](#rpo)
5. [What Must Recover](#what-must-recover)
6. [Azure SQL Restore](#azure-sql-restore)
7. [Blob Protection](#blob-protection)
8. [Redundancy](#redundancy)
9. [Recovery Strategies](#recovery-strategies)
10. [Restore Drills](#restore-drills)
11. [Putting It All Together](#putting-it-all-together)

## The Problem

The previous article helped the team see and tune cost. Now the uncomfortable question is not the bill. It is recovery.

Something bad happens to `devpolaris-orders-api`:

- A bad release writes incorrect order statuses for 20 minutes.
- A storage cleanup job deletes receipt blobs under the wrong prefix.
- A primary region has a serious outage.
- A developer says "we have backups," but nobody knows what users can do while the restore happens.

A backup is not a recovery plan. A redundancy setting is not a recovery plan. A recovery plan explains what must come back, how much data can be lost, how long the service can be down, what target is restored, and how the application will safely use that target.

## Backup vs Recovery

A backup is a protected copy or restore source. Recovery is the process of returning the service to a useful state. Those are different.

Azure SQL automated backups can let you restore a database to a point in time within the configured retention period. Blob soft delete and versioning can help recover deleted or overwritten objects. Storage redundancy can protect against infrastructure failures. None of those features automatically decides how checkout should use the restored data.

For a recovery plan, ask:

| Question | Why it matters |
| --- | --- |
| What happened? | Delete, overwrite, corruption, region outage, or app bug. |
| What data is affected? | Orders, receipts, audit logs, queue messages, or derived exports. |
| What restore target is created? | New database, previous blob version, secondary region, or old revision. |
| How does the app use it? | Switch connection string, replay data, repair records, or fail over traffic. |
| What proves recovery? | Checkout success, data checks, receipt reads, metrics, and user path tests. |

The restore source is only the beginning. The application still needs a path back to work.

## RTO

Recovery Time Objective, or RTO, is the maximum acceptable downtime after a disaster or serious failure. It is measured in time: 15 minutes, 4 hours, 1 day.

RTO should belong to a workflow, not a vague system. Checkout may need a shorter RTO than admin reports. Receipt downloads may tolerate more downtime than order creation. A dev environment may have a much longer RTO than production.

| Workflow | Example RTO |
| --- | --- |
| Checkout | 30 minutes |
| Receipt download | 4 hours |
| Nightly export | Next business day |
| Admin analytics | 2 days |

Shorter RTO usually costs more. It may require warm compute, tested traffic failover, replicated data, automation, and on-call readiness. A long RTO can be cheaper, but the business must be willing to wait.

## RPO

Recovery Point Objective, or RPO, is the maximum acceptable data loss. It is also measured in time: 5 minutes of data, 30 minutes of data, 4 hours of data.

RPO is where many teams get honest for the first time. If checkout order data can lose at most 5 minutes, the data design is different from a report that can be rebuilt tomorrow. If receipt blobs must never disappear without a recovery path, soft delete, versioning, retention, and lifecycle rules matter.

| Workflow | Example RPO |
| --- | --- |
| Order records | 5 minutes |
| Receipt blobs | Last successful upload or restorable version |
| Search index | Can be rebuilt from source data |
| Daily export | Can rerun from orders database |

Microsoft reliability guidance notes that zero downtime and zero data loss are tempting targets but difficult and costly in practice. That is the tradeoff. RTO and RPO turn "be resilient" into an explicit promise.

## What Must Recover

The orders service is not one thing. Recovery has to name the pieces.

| Piece | Recovery question |
| --- | --- |
| API runtime | Can users reach a working app version? |
| Azure SQL orders database | Can order records return to a correct point? |
| Blob receipts | Can deleted or overwritten receipt files be restored? |
| Identity and secrets | Can the app access restored targets safely? |
| DNS and traffic path | Can users reach the recovery target? |
| Observability | Can the team see whether recovery worked? |

Some pieces can be rebuilt. Others must be restored. A search index can often be rebuilt from source records. Order records usually need stronger protection. Receipt blobs may need object-level recovery. Secrets and identity may need to be reconnected to the restored target.

The recovery card should separate source of truth from derived data. Derived data can often wait. Source-of-truth data needs the strongest promise.

## Azure SQL Restore

Azure SQL Database creates automated backups for point-in-time restore. Microsoft documents full, differential, and transaction log backup behavior for most service tiers, with transaction log backups approximately every 10 minutes. Short-term retention allows point-in-time restore within the configured window, and long-term retention can keep full backups for compliance needs.

The important beginner gotcha: restore creates a database target. It does not magically replace application behavior.

If a bad release corrupts order statuses at 10:24, a point-in-time restore might create:

```text
orders-restored-20260517-1020
```

Now the team has decisions:

| Decision | Why it matters |
| --- | --- |
| Which restore time? | Too early loses valid orders; too late keeps bad writes. |
| New database or replace original? | The app needs a safe target and cutover plan. |
| What happened after the restore point? | Valid orders may need replay or manual repair. |
| What config changes? | Connection strings or secrets may need updating. |
| How is recovery verified? | Data checks and checkout tests must pass. |

Azure gives restore capability. The recovery plan tells the app how to use it.

## Blob Protection

Blob Storage has several data protection tools. They solve different problems.

| Tool | Helps with | Important limit |
| --- | --- | --- |
| Container soft delete | Deleted containers | It protects container-level deletion, not individual blob delete by itself. |
| Blob soft delete | Deleted blobs, snapshots, or versions during retention | After retention expires, recovery is gone. |
| Blob versioning | Previous versions after overwrite or delete | Version growth can increase storage cost. |
| Point-in-time restore | A set of block blobs returned to a previous time | Needs design constraints and does not cover every operation type. |
| Vaulted backup | Offsite protected copy for selected containers | Adds another backup and restore workflow. |

The cost and resilience pair is visible here. Blob versioning and soft delete can protect receipts from accidental overwrite and deletion, but they can also grow storage. Microsoft recommends using data protection features together for important blob data and separating data with different retention needs where useful.

For the orders service, receipts might need versioning and soft delete. Temporary exports may need shorter retention. Debug artifacts might need lifecycle deletion. One storage account policy rarely fits every data shape.

## Redundancy

Redundancy controls where Azure keeps copies for availability and durability. For Azure Storage, options include locally redundant storage, zone-redundant storage, geo-redundant storage, and geo-zone-redundant storage.

The names matter less than the promise:

| Redundancy | Plain meaning | Tradeoff |
| --- | --- | --- |
| LRS | Copies inside one physical location in a region | Lowest cost, weakest protection against location-level disaster. |
| ZRS | Copies across availability zones in one region | Better in-region availability, higher cost than LRS. |
| GRS | Copies to a secondary region asynchronously | Regional disaster durability, possible data loss window. |
| GZRS | Zone copies in primary region plus geo copy | Stronger regional and zone story, higher cost and design complexity. |

Redundancy is not the same as backup. If the app writes bad data, redundancy may copy the bad data. If a user deletes the wrong blob and no object-level protection exists, redundant copies do not necessarily give the app an older business state. Use redundancy for infrastructure failure. Use backups, versions, soft delete, and restore plans for data mistakes.

## Recovery Strategies

Recovery strategy is the shape the system takes when something larger fails. The common ladder is a cost and RTO/RPO tradeoff.

| Strategy | What stays ready | Recovery shape | Cost shape |
| --- | --- | --- | --- |
| Backup and restore | Backups and restore instructions | Restore data, start or reconfigure compute, route users later | Lowest steady cost, longer RTO/RPO. |
| Pilot light | Core data and minimal foundation | Scale or start compute around already-prepared basics | Low to medium steady cost, faster than pure restore. |
| Warm standby | Small full stack already running | Scale up standby and move traffic | Medium to high steady cost, shorter RTO. |
| Active-active | Multiple sites serve traffic | Traffic shifts between live sites | Highest cost and complexity, shortest recovery if tested. |

The best strategy depends on the workflow. Checkout may justify warm standby or stronger data replication. A daily export may be fine with backup and restore. Dev environments may scale to zero and rebuild.

The key is naming the promise. "We have backups" is not a strategy. "Restore SQL to a new database, point the app to it, route traffic after smoke tests, expected RTO 4 hours, expected RPO 10 minutes" is the start of one.

## Restore Drills

A restore drill proves the plan works before an incident. It should be small, safe, and repeatable.

For the orders service, a drill might:

1. Restore Azure SQL to a new database from a chosen point in time.
2. Restore or undelete a test receipt blob.
3. Point a non-production app instance at the restored database.
4. Run checkout and receipt-read smoke tests with test data.
5. Record actual restore time, data gap, manual steps, and surprises.

The drill usually reveals missing pieces: wrong permissions, missing firewall rules, a hardcoded database name, an app setting nobody documented, a restore that takes longer than expected, or logs that do not show the restored path.

That is good news. A drill surprise is cheaper than an incident surprise.

## Putting It All Together

Return to the bad release and deleted receipts.

- Backup vs recovery separated a restore source from a working service.
- RTO named how long checkout can be down.
- RPO named how much data loss the business can accept.
- The recovery card separated source-of-truth data from derived data.
- Azure SQL restore created a new usable database target, but the app still needed a cutover plan.
- Blob protection handled deletes and overwrites differently from infrastructure redundancy.
- Redundancy protected against platform failure, not every bad write.
- Recovery strategies connected cost to readiness: backup and restore, pilot light, warm standby, or active-active.
- Restore drills turned the plan into evidence.

This closes the Azure module sequence. A mature Azure service is not only deployed, observable, and secure. It is understandable when it costs money and honest about how it comes back when something fails.

---

**References**

- [Automated backups in Azure SQL Database](https://learn.microsoft.com/en-us/azure/azure-sql/database/automated-backups-overview?view=azuresql-db)
- [Azure Storage data protection overview](https://learn.microsoft.com/en-us/azure/storage/blobs/data-protection-overview)
- [Azure Storage redundancy](https://learn.microsoft.com/en-us/azure/storage/common/storage-redundancy)
- [What are business continuity, high availability, and disaster recovery?](https://learn.microsoft.com/en-us/azure/reliability/concept-business-continuity-high-availability-disaster-recovery)
- [Architecture strategies for availability zones and regions](https://learn.microsoft.com/en-us/azure/well-architected/design-guides/regions-availability-zones)
