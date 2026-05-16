---
title: "Backups and Retention"
description: "Design Azure data recovery around restore, retention, soft delete, versioning, snapshots, and safe deletion."
overview: "Backups are useful only when the team can restore the right data to a usable place. This article explains recovery thinking across Azure SQL Database, Blob Storage, Cosmos DB, Managed Disks, and Azure Files without turning it into a full disaster recovery strategy."
tags: ["azure", "backups", "retention", "restore", "soft-delete"]
order: 6
id: article-cloud-providers-azure-storage-databases-backups-retention-safe-deletion
aliases:
  - backups-retention-and-safe-deletion
  - cloud-providers/azure/storage-databases/backups-retention-and-safe-deletion.md
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Backup vs Restore](#backup-vs-restore)
3. [Retention](#retention)
4. [Soft Delete](#soft-delete)
5. [Blob Versioning](#blob-versioning)
6. [SQL Restore](#sql-restore)
7. [Cosmos DB Recovery](#cosmos-db-recovery)
8. [Disk Snapshots](#disk-snapshots)
9. [Safe Deletion](#safe-deletion)
10. [Putting It All Together](#putting-it-all-together)

## The Problem

The storage design now has several homes. Orders live in Azure SQL Database. Receipts and exports live in Blob Storage. Job status may live in Cosmos DB. A legacy worker may use a managed disk or Azure Files share.

Then ordinary production mistakes happen:

- A cleanup script deletes the wrong receipt prefix.
- A migration updates the wrong rows in the orders database.
- A Cosmos DB container keeps temporary job items forever.
- A VM worker corrupts files on a data disk.
- A file share loses templates a legacy process still needs.

The question is not only "do we have backups?" That sentence is too vague. The real question is whether the team can restore the right data, to the right place, at the right time, without making the incident worse.

## Backup vs Restore

A backup is a recoverable copy or recovery point. Restore is the act of bringing data back into a usable place. The difference matters because backups can exist while restore is still slow, unclear, or untested.

For example, an Azure SQL point-in-time restore may create a new database at a chosen moment. That is useful, but it does not automatically decide which rows from the restored database should replace current production rows. Blob soft delete may let you recover deleted objects during a retention window, but only if the protection was enabled and the window still includes the deletion. A disk snapshot may preserve a volume state, but the app still needs a plan for mounting or comparing it safely.

The safe review question is: "Show me how we would restore this specific data." If nobody can answer, the backup is still a theory.

## Retention

Retention is how long data or recovery points are kept. It is a product, compliance, cost, and operations decision.

Short retention can save money but reduce recovery options. Long retention can support audits and mistakes discovered late, but it costs money and may keep data longer than policy allows. Automatic deletion can be correct for temporary job status and dangerous for customer receipts.

Retention should be written down near the data promise:

| Data | Retention question |
| --- | --- |
| Order records | How long must business records and recovery points remain available? |
| Receipt PDFs | How long must customers or support retrieve them? |
| Finance exports | How long do reports stay hot, cool, archived, or deleted? |
| Job status items | When should temporary processing facts expire? |
| VM disks and shares | How long are snapshots or backups useful? |

The gotcha is that retention changes can affect future restore points. Do not change retention as a cleanup shortcut without understanding what recovery windows disappear.

## Soft Delete

Soft delete keeps deleted data recoverable for a window instead of removing it immediately. Azure services expose soft-delete behavior in different ways, such as Blob Storage soft delete, Azure Files soft delete, and other service-specific protections.

Soft delete is useful because many incidents are accidental deletes. It gives the team a second step before permanent loss. It is not a replacement for backup, access control, or lifecycle design. If the retention window is too short, the team may discover the mistake after recovery is no longer possible. If deletion was intentional and compliance requires removal, soft delete must be part of the policy conversation.

For Blob Storage, soft delete and versioning can protect against different mistakes. Soft delete helps with deleted objects. Versioning helps when an object is overwritten and the old version still matters.

## Blob Versioning

Blob versioning keeps previous versions of blobs when they change. This matters because not every data-loss event is a delete. An app can overwrite `receipts/order-417.pdf` with the wrong file. A sync job can replace a good export with a broken one.

Versioning gives the team an older copy to restore or compare, subject to configuration and lifecycle policies. It also creates storage growth. If a process overwrites many large blobs, keeping every version forever can become expensive.

The design habit is to pair versioning with lifecycle rules. Keep useful versions long enough to recover from likely mistakes, then age or delete them according to policy.

## SQL Restore

Azure SQL Database provides automated backups and point-in-time restore behavior. Point-in-time restore lets the team restore a database to a previous moment within the available retention window.

The restore target matters. A point-in-time restore commonly creates a new database. That is safer than blindly rolling production backward because it lets the team inspect the restored state, compare rows, and decide what to copy or repair. It also means the team needs permissions, network access, and a clear comparison plan.

For a bad migration, the recovery path might be: restore the database to just before the migration, compare affected rows, write a repair script, review it, and apply it to production. The backup feature provides the source. The team still owns the judgment.

## Cosmos DB Recovery

Cosmos DB recovery depends on account configuration and backup mode. The exact restore options vary by mode and service setup, so the article's beginner lesson is to decide recovery behavior before the container becomes important.

Cosmos DB also has TTL, which is not a backup feature. TTL expires items automatically after a configured lifetime. That is perfect for temporary job status or idempotency records that should not live forever. It is dangerous for data the business later expects to recover.

For item-shaped data, ask two separate questions: should this item expire as part of normal product behavior, and can we recover it after accidental delete or corruption?

## Disk Snapshots

Managed disk snapshots capture a disk state at a point in time. They can help recover VM-shaped workloads, compare a corrupted volume, or preserve a known state before risky maintenance.

Snapshots are tied to disk-shaped recovery. They are not a substitute for database backups or object versioning. If a VM writes important business data only to a disk, a snapshot might help after corruption, but the architecture is still coupling business state to one machine-shaped resource.

Azure Files also has share snapshot and backup options depending on the setup. The lesson is the same: filesystem recovery should match the workload's real access path.

## Safe Deletion

Safe deletion is the practice of making destructive changes deliberate and recoverable when the data policy allows. It combines permissions, naming, tags, lifecycle rules, soft delete, versioning, retention, and human review.

A cleanup job should not delete by a vague prefix if the prefix can match production receipts. A lifecycle rule should not delete exports before finance signs off. A database migration should not update rows without a rollback or repair plan. A disk cleanup should not target the wrong mount because two VMs have similar paths.

The simplest safe deletion checklist is small:

| Before deleting | Question |
| --- | --- |
| Target | Which exact account, container, database, table, disk, or share is affected? |
| Scope | Which names, rows, partitions, folders, or snapshots match? |
| Retention | Can the team recover if the target is wrong? |
| Evidence | What log, export, or dry run shows the planned change? |
| Owner | Who is allowed to approve this deletion? |

Safe deletion is not ceremony. It is how a team avoids turning routine cleanup into a data incident.

## Putting It All Together

The opener had deleted receipts, bad database changes, expiring items, disk corruption, and missing file-share templates. Each storage shape has its own recovery tool, and none of them is useful unless restore is understood.

Backups create recovery points. Restore makes them usable. Retention decides how long options remain. Soft delete and blob versioning protect against deletes and overwrites. SQL point-in-time restore gives a way to inspect an earlier database state. Cosmos DB recovery and TTL answer different questions. Disk snapshots help with VM-shaped volumes. Safe deletion reduces the chance that the team needs recovery in the first place.

That is the storage recovery habit: never stop at "we have backups." Ask how restore works for this data.

---

**References**

- [Automated backups in Azure SQL Database](https://learn.microsoft.com/en-us/azure/azure-sql/database/automated-backups-change-settings?view=azuresql)
- [Point-in-time restore in Azure SQL Database](https://learn.microsoft.com/en-us/azure/azure-sql/database/recovery-using-backups?view=azuresql)
- [Soft delete for blobs](https://learn.microsoft.com/en-us/azure/storage/blobs/soft-delete-blob-overview)
- [Blob versioning](https://learn.microsoft.com/en-us/azure/storage/blobs/versioning-overview)
- [Backup and restore in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/online-backup-and-restore)
- [Create a snapshot of a virtual hard disk](https://learn.microsoft.com/en-us/azure/virtual-machines/snapshot-copy-managed-disk)
