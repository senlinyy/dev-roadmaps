---
title: "Backups, Retention, and Safe Deletion"
description: "Design Azure data recovery habits around restore, retention, soft delete, lifecycle rules, and the mistakes real teams make."
overview: "Backups are only useful when the team can restore data to a usable state. This article teaches recovery thinking across Azure SQL Database, Blob Storage, Cosmos DB, Managed Disks, and Azure Files."
tags: ["backups", "retention", "restore", "soft-delete"]
order: 7
id: article-cloud-providers-azure-storage-databases-backups-retention-safe-deletion
---

## Table of Contents

1. [Recovery Is Part Of The Feature](#recovery-is-part-of-the-feature)
2. [If You Know AWS Recovery Features](#if-you-know-aws-recovery-features)
3. [Backups Are Not The Same As Restore](#backups-are-not-the-same-as-restore)
4. [Azure SQL Needs Point-In-Time Thinking](#azure-sql-needs-point-in-time-thinking)
5. [Blob Storage Needs Protection And Lifecycle Rules](#blob-storage-needs-protection-and-lifecycle-rules)
6. [Cosmos DB Needs Retention And Expiry Decisions](#cosmos-db-needs-retention-and-expiry-decisions)
7. [Disks And File Shares Need Workload-Aware Recovery](#disks-and-file-shares-need-workload-aware-recovery)
8. [Safe Deletion Is A Two-Step Habit](#safe-deletion-is-a-two-step-habit)
9. [Failure Scenarios And First Responses](#failure-scenarios-and-first-responses)
10. [A Practical Recovery Review](#a-practical-recovery-review)

## Recovery Is Part Of The Feature

Data features are not finished when the write succeeds.

They are finished when the team knows what happens after a mistake.

A developer may run a bad migration.

A cleanup job may delete the wrong blobs.

A support script may update the wrong customer.

A VM disk may fill during an import.

A job-status container may keep temporary records forever.

These are ordinary production problems.

They do not mean the team is careless.

They mean data needs operating habits.

Backups, retention, and safe deletion are those habits.

A backup is a recoverable copy or recovery point.

Retention is how long the team keeps data or recovery points.

Safe deletion is the practice of making deletion hard to do accidentally and possible to recover from when appropriate.

For `devpolaris-orders-api`, recovery thinking touches several Azure services.

Azure SQL Database stores order and payment records.

Blob Storage stores receipt PDFs and export files.

Cosmos DB may store idempotency or job-status items.

Managed Disks may support a VM worker.

Azure Files may hold shared templates for legacy jobs.

Each service has different recovery tools.

The question is not "which service has backup?"

The question is "can we get the right data back in a usable way?"

## If You Know AWS Recovery Features

AWS concepts can help you recognize the pattern.

You may know RDS point-in-time restore, S3 versioning, S3 lifecycle rules, EBS snapshots, or AWS Backup.

Azure has similar recovery ideas, but the names and service boundaries differ.

| AWS idea you may know | Azure idea to inspect | Shared recovery question |
|---|---|---|
| RDS automated backups and PITR | Azure SQL automated backups and point-in-time restore | Can we restore the database to the right moment? |
| S3 versioning and lifecycle | Blob versioning, soft delete, lifecycle management | Can we recover or age out objects safely? |
| DynamoDB TTL and backups | Cosmos DB TTL and backup modes | Should items expire, and can important data be restored? |
| EBS snapshots | Managed disk snapshots and Azure Backup | Can the VM disk be recovered or recreated? |
| AWS Backup | Azure Backup | Which workloads need central backup policy? |

The transferable habit is testing restore.

The provider feature names are less important than the recovery drill.

If nobody has restored the data, the backup is still a theory.

## Backups Are Not The Same As Restore

It is easy to say "we have backups" and move on.

That sentence is too vague.

A backup only matters if the team can restore the right data to the right place at the right time.

Usable restore has several parts.

The restored data needs a destination.

The destination needs network access.

The right people or applications need permission.

The app needs a configuration plan.

The team needs to know whether it is restoring the whole system or repairing a small part.

For example, imagine a bad migration sets every order status to `cancelled`.

Restoring the whole production database to yesterday may lose valid orders created today.

The safer response might be:

restore yesterday's database to a separate database.

compare affected rows.

repair only the damaged orders.

keep evidence of the repair.

That is a different plan from "replace production with backup."

The word restore hides those details unless you force them into the conversation.

Use this plain review question:

if this data is wrong tomorrow, what exact recovery action would we take?

## Azure SQL Needs Point-In-Time Thinking

Azure SQL Database has automated backup and point-in-time restore capabilities.

Point-in-time restore means recovering a database to an earlier moment within the available retention window.

That is useful for bad migrations, accidental updates, and data corruption.

The hard part is choosing the moment and using the restored data safely.

For `devpolaris-orders-api`, imagine a migration bug runs at 10:13.

It marks paid orders as refunded.

Customers keep placing valid orders after 10:13.

The team cannot blindly roll the whole database back to 10:12 without thinking about the new valid orders.

The first response should be careful.

```text
Incident: bad order status migration
Bad change started: 2026-05-03T10:13:00Z
Known affected table: orders
Suspected affected rows: status changed from paid to refunded
Recovery candidate: restore database to 2026-05-03T10:12:30Z in separate database
Repair plan: compare affected rows and update production with reviewed script
```

The restored database is evidence.

It is not automatically the new production database.

Sometimes full replacement is the right move.

Often selective repair is safer.

That depends on the incident.

The important habit is to document how the team chooses.

Also remember that database restore is not only a storage action.

The restored database needs access rules, identities, connection strings, and careful handling of customer data.

## Blob Storage Needs Protection And Lifecycle Rules

Blob Storage recovery is about objects.

Receipts, exports, images, and archives can be deleted, overwritten, moved to a colder tier, or aged out by lifecycle rules.

That means the team needs two kinds of decisions.

Protection decisions answer:

can we recover from accidental delete or overwrite?

Lifecycle decisions answer:

how long should this data live, and when should it move or disappear?

For `devpolaris-orders-api`, receipt PDFs and admin exports should not share one vague rule.

They have different promises.

| Blob type | Recovery concern | Retention concern |
|---|---|---|
| Customer receipt PDFs | Recover accidental delete or overwrite | Keep according to product and legal promise |
| Admin exports | Recover recent mistakes | Delete after agreed operations window unless marked for audit |
| Failed import files | Keep for debugging | Delete after short troubleshooting window |
| Public images | Recover accidental replacement | Keep while the product is active |

Soft delete and versioning can help protect blobs from accidental delete or overwrite.

Lifecycle management can move or delete old blobs according to rules.

Those features are useful only when they match the product promise.

If receipts must be available for years, a 30-day deletion rule is wrong.

If debug exports only matter for two weeks, keeping them forever is waste.

Recovery and cost are connected.

The right answer is rarely "keep everything forever."

It is also rarely "delete old files because storage is expensive."

The right answer starts with what the user, business, and operations team need.

## Cosmos DB Needs Retention And Expiry Decisions

Cosmos DB often stores item-shaped data.

Some items are durable business data.

Some items are temporary operational state.

Those need different retention decisions.

For idempotency records, expiration may be useful.

The app only needs to remember the key during a retry window.

After that, the record may be safe to remove.

For job-status records, the team may want to keep recent records for debugging.

After a period, old successful jobs may not be useful.

For order records, automatic expiry would be dangerous.

The business probably needs order history.

Do not apply TTL just because a container supports it.

TTL should match the natural lifetime of the item.

Here is a simple review.

| Item type | Should it expire? | Reason |
|---|---|---|
| Checkout idempotency item | Usually yes | It protects a retry window |
| Export job status | Often yes | It supports recent UI and debugging |
| Customer session state | Usually yes | Abandoned sessions should not grow forever |
| Core order record | Usually no | It is durable business history |

Cosmos DB backup and restore choices also matter for important containers.

If the container holds only short-lived job status, the recovery plan may be lighter.

If the container holds business-critical state, the team needs a serious restore plan.

Again, the data promise decides the recovery design.

## Disks And File Shares Need Workload-Aware Recovery

Managed Disks and Azure Files have their own recovery shape.

A managed disk may be backed up, snapshotted, or restored depending on the workload design.

An Azure Files share may need backup if it holds important shared files.

The key is to understand what the disk or share contains.

If the disk is an OS disk for a disposable worker VM, maybe the best recovery is to recreate the VM from code or image.

If the disk contains important local application state, the backup plan matters much more.

If an Azure Files share contains templates that are also stored in Git, recovery may be simple.

If it contains user-generated files that exist nowhere else, recovery is much more serious.

For the legacy import worker, write this down:

```text
Path: /mnt/import-work
Storage: VM data disk
Purpose: scratch data during import
Durability promise: none after job completion
Recovery action: rerun import from original blob input
```

That is a good answer if it is true.

The dangerous answer is silence.

If nobody knows whether the path is scratch or durable, the first incident will decide for you.

## Safe Deletion Is A Two-Step Habit

Deletion should be boring only after the team knows what is being deleted.

For application data, safe deletion usually has two steps.

First, make the data unreachable or inactive.

Second, delete it after a review or retention window.

For example, an export file might be marked expired in the database before the blob is deleted.

A customer account might be marked pending deletion before irreversible cleanup runs.

A file share path might be moved to an archive location before final removal.

This pattern gives the team a chance to catch mistakes.

It also gives users and support a clearer story.

Immediate deletion is sometimes required.

Privacy requests, security incidents, and legal rules can change the flow.

Even then, the team should be explicit about what is being deleted, where copies exist, and what recovery is allowed.

For routine cleanup, avoid scripts that delete broad paths without a dry run.

The dry run should show what would be deleted.

Someone should know whether the list makes sense.

Here is a safe deletion review for old exports.

```text
Cleanup target: admin exports older than 90 days
Source of truth: exports table where status=expired
Blob container: exports
Dry run output: list export ids and blob names
Protection: soft delete enabled for recent recovery
Final check: no exports marked audit_hold=true
```

That is much safer than "delete old blobs under exports."

## Failure Scenarios And First Responses

A cleanup job deletes receipt blobs too early.

First response:

pause the cleanup job.

identify affected blob names and time range.

check soft delete or versioning recovery options.

compare database receipt rows to blob existence.

repair rows only after the blob recovery story is clear.

A bad SQL migration updates too many orders.

First response:

stop further writes if needed.

record the exact time window.

restore to a separate database.

compare affected rows.

prepare a reviewed repair script.

avoid overwriting valid newer data without review.

Cosmos DB job-status records grow forever.

First response:

check whether the data has a natural lifetime.

add TTL only for item types that should expire.

keep durable business records out of the expiry path.

monitor storage and request behavior after the change.

A VM disk fills during imports.

First response:

identify whether the filled path is scratch or durable.

remove only disposable files after confirming the job state.

increase disk or change job cleanup if needed.

copy final outputs to Blob Storage before deleting scratch data.

An Azure Files share loses a template folder.

First response:

check whether templates are source-controlled.

restore from backup or redeploy from source.

verify worker mounts and permissions.

add a safer release path for future template changes.

These responses are not scripts.

They are thinking paths.

They stop the team from making the incident worse.

## A Practical Recovery Review

Before shipping a data feature, ask recovery questions while the design is still small.

What data is durable?

What data is temporary?

What data can be recreated?

What data must never be recreated differently?

Which service stores each piece?

What protection is enabled?

How long is the data kept?

How would a human restore it?

How would the app find the restored data?

Who is allowed to access restored customer data?

What deletion path exists?

What dry run or review protects that deletion?

Use this table as a final pass.

| Data | Protection habit | Retention habit | Restore question |
|---|---|---|---|
| Order records in Azure SQL | Automated backups and tested restore | Match business and legal needs | Can we restore to a separate database and repair safely? |
| Receipt blobs | Soft delete or versioning where appropriate | Match receipt promise | Can we recover a deleted or overwritten receipt? |
| Admin export blobs | Soft delete for recent mistakes | Expire after agreed window | Can we prove old exports were meant to delete? |
| Cosmos DB job status | Backup based on criticality | TTL if naturally temporary | Would losing old status hurt users or only debugging? |
| VM data disk | Snapshot or backup if stateful | Depends on workload | Can the VM be recreated without this disk? |
| Azure Files share | Backup if source of truth | Depends on content | Is the share the only copy? |

The safest teams do not only ask "is backup enabled?"

They ask "what would we do on Tuesday morning if this data was wrong?"

That question turns backup from a checkbox into a useful operating habit.

---

**References**

- [Azure SQL Database automated backups](https://learn.microsoft.com/en-us/azure/azure-sql/database/automated-backups-overview) - Microsoft explains backup behavior and retention for Azure SQL Database.
- [Recover an Azure SQL database using backups](https://learn.microsoft.com/en-us/azure/azure-sql/database/recovery-using-backups) - Microsoft explains point-in-time restore and related database recovery operations.
- [Data protection overview for Azure Blob Storage](https://learn.microsoft.com/en-us/azure/storage/blobs/data-protection-overview) - Microsoft summarizes blob data protection features such as soft delete and versioning.
- [Soft delete for blobs](https://learn.microsoft.com/en-us/azure/storage/blobs/soft-delete-blob-overview) - Microsoft explains how blob soft delete helps recover deleted blob data.
- [Azure Backup overview](https://learn.microsoft.com/en-us/azure/backup/backup-overview) - Microsoft introduces Azure Backup for protecting supported Azure and hybrid workloads.
