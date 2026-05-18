---
title: "Backups and Retention"
description: "Protect GCP data by deciding what previous copy exists, how long it is kept, who can delete it, and how restore is proven."
overview: "Data safety is not only taking backups. This article explains recovery points, object versions, database backups, exports, time travel, snapshots, retention, safe deletion, and restore drills as one operating habit."
tags: ["gcp", "backups", "retention", "recovery"]
order: 7
id: article-cloud-providers-gcp-storage-databases-backups-retention
aliases:
  - backups-and-retention
  - backups-retention
  - safe-deletion
---

## Table of Contents

1. [The Problem](#the-problem)
2. [What Is A Backup](#what-is-a-backup)
3. [Recovery Points](#recovery-points)
4. [Cloud Storage Recovery](#cloud-storage-recovery)
5. [Cloud SQL Recovery](#cloud-sql-recovery)
6. [Firestore Recovery](#firestore-recovery)
7. [BigQuery Recovery](#bigquery-recovery)
8. [Snapshots](#snapshots)
9. [Retention](#retention)
10. [Safe Deletion](#safe-deletion)
11. [Restore Drills](#restore-drills)
12. [Sample Recovery Map](#sample-recovery-map)
13. [Putting It All Together](#putting-it-all-together)

## The Problem

The data choices are now clear. Receipts live in Cloud Storage. Orders live in Cloud SQL. Drafts may live in Firestore. Analytics facts live in BigQuery. A worker may use Persistent Disk or Filestore when it truly needs attached storage.

Then the first real data mistake arrives:

- A release writes bad status values into thousands of order rows.
- A cleanup job deletes export files that finance still needed.
- A script overwrites receipt PDFs under the same object names.
- A Firestore update removes fields that mobile clients still need.
- A BigQuery table is replaced before a dashboard owner notices.

At that moment, "the service is durable" is not enough. The team needs to know which previous copy exists, how far back it goes, who can delete it, and whether restore has been tested.

## What Is A Backup

A backup is a copy that exists so data can be recovered after failure, mistake, corruption, or deletion. Backups are part of an operating promise. They should connect to recovery time objective, recovery point objective, retention policy, and restore procedure.

The most important beginner distinction is between service durability and recovery from bad data. A durable service can preserve the wrong value very reliably. Backup and retention choices decide whether the team can return to a previous good state.

| Term | Plain meaning |
| --- | --- |
| Recovery point | The moment in time the restored data represents |
| Retention | How long previous copies are kept |
| Restore | The procedure that makes a copy usable again |
| Safe deletion | Controls that prevent or delay irreversible removal |

Do not count a backup as real until restore is understood.

## Recovery Points

A recovery point answers "how much data can we afford to lose?" If the last usable backup is 24 hours old, restoring from it may lose a day of writes. If point-in-time recovery is available and enabled, the team may restore closer to the mistake.

Different data needs different recovery points. A temporary export may be recreated. A paid order record may need a much tighter recovery target. A BigQuery modeled table may be rebuilt from raw events if the raw events are protected.

The recovery point should follow the business impact, not the service default.

## Cloud Storage Recovery

Cloud Storage recovery depends on bucket settings and object handling. Object versioning can keep older generations. Soft delete and retention-related features can delay or prevent immediate loss depending on configuration. Lifecycle rules can clean up old objects or old versions.

The main object-storage mistake is overwriting or deleting under the same name without a recovery plan. If receipts use immutable object names, accidental overwrite is less likely. If exports reuse names, versioning or generation-aware writes may matter more.

For protected buckets, review:

```text
bucket: devpolaris-orders-receipts-prod
protected data: receipt PDFs
overwrite policy: immutable object names
delete policy: restricted delete permissions
recovery: versioning or soft delete where required
lifecycle: temporary exports expire separately
```

Lifecycle cleanup should not silently defeat recovery expectations.

## Cloud SQL Recovery

Cloud SQL recovery usually starts with automated backups and, where required, point-in-time recovery. Backups help restore an instance or database state from a previous copy. Point-in-time recovery helps recover closer to a specific moment when supported and enabled.

Cloud SQL also needs migration discipline. A bad migration can be more dangerous than an instance failure because the database stays available while holding wrong data. Restore planning should include how to recover after bad writes, not only how to replace failed infrastructure.

A good Cloud SQL recovery review asks:

| Question | Why |
| --- | --- |
| Are automated backups enabled? | Establishes regular recovery copies |
| Is point-in-time recovery needed and enabled? | Reduces data loss window for critical records |
| Has restore been tested? | Proves the backup is usable |
| Where does restored data land? | Avoids overwriting current production by accident |
| How are migrations rolled forward or back? | Handles release-caused data issues |

The restore target is often a new instance for inspection, not an immediate overwrite of production.

## Firestore Recovery

Firestore recovery should be planned around the value of the documents. For low-risk cache-like state, rebuilding may be enough. For important user state, the team should consider backups, exports, security rules, and restore procedure.

The risk is that document databases can make sweeping writes easy. A script can update many documents with the wrong field. A client bug can remove data from user preference documents. Security rules can accidentally allow writes the team did not intend.

Firestore recovery review should name the collection, business impact, backup or export path, and restore procedure. If nobody can say how to restore a collection after a bad write, the data is not protected enough.

## BigQuery Recovery

BigQuery recovery has a different shape. BigQuery supports time travel for recently changed or deleted table data within a configured window, and table snapshots can preserve a table at a point in time. Pipelines may also be able to rebuild modeled tables from raw events.

The best protection often starts with keeping raw facts safe. If a modeled dashboard table is wrong, the team can rebuild it from raw events. If raw events are missing or overwritten, recovery is harder.

For BigQuery, ask:

| Data | Recovery habit |
| --- | --- |
| Raw event table | Protect and retain source facts |
| Modeled table | Rebuild from raw data or snapshot important versions |
| Dashboard aggregate | Recompute when possible |
| Deleted table | Use time travel or snapshots within limits |

Analytics recovery is as much about pipeline design as table recovery.

## Snapshots

Snapshots protect disk-shaped data. Persistent Disk snapshots can capture disk state for restore, cloning, or migration. Filestore has backup and snapshot-style recovery features depending on tier and configuration.

Snapshots need consistency thinking. If a worker is writing files while the snapshot is taken, the restored disk may need application recovery. For self-managed databases on disks, database-aware backup procedures matter.

Use snapshots for attached storage, but do not confuse them with application-level recovery unless the application can safely use the restored state.

## Retention

Retention decides how long recovery copies stay available. Too short, and the team discovers a mistake after the copy is gone. Too long, and cost, privacy, and compliance problems can appear.

Different data needs different retention:

| Data | Retention question |
| --- | --- |
| Receipts | How long must customer records be available? |
| Temporary exports | When should they disappear? |
| Order records | What legal and support windows apply? |
| Analytics events | How long are historical trends useful? |
| Backups | How long can old copies be kept under policy? |

Retention is a product, legal, security, and operations decision, not only a storage setting.

## Safe Deletion

Safe deletion is the set of controls that make destructive actions deliberate. It can include IAM restrictions, retention policies, soft delete, object holds, lifecycle review, separate production roles, and approval workflows.

The goal is not to make deletion impossible forever. Some data must be deleted for privacy or lifecycle reasons. The goal is to keep one typo, script, or broad role from permanently removing important data before anyone can react.

Ask who can delete, what delay or recovery window exists, and how deletion is logged.

## Restore Drills

A restore drill proves that recovery works. It does not have to be dramatic. Restore a Cloud SQL backup into a non-production instance. Recover a Cloud Storage object version. Rebuild a BigQuery modeled table. Restore a disk snapshot to a test VM.

The drill should produce evidence:

```text
data: orders Cloud SQL backup
restore point: 2026-05-17 09:00 UTC
target: orders-restore-test
verified: order count, sample checkout, app read test
time to usable: 42 minutes
owner: platform data team
```

Without a drill, the team has a belief, not a recovery capability.

## Sample Recovery Map

For the Orders system, the recovery map might be:

| Data | Recovery copy | Restore proof |
| --- | --- | --- |
| Receipt objects | Object versioning or soft delete plus restricted deletion | Restore one receipt object |
| Orders database | Cloud SQL automated backups and PITR | Restore to test instance and run sample reads |
| Checkout drafts | Firestore export or backup strategy if business-critical | Restore sample collection |
| Analytics tables | BigQuery time travel, snapshots, raw event replay | Rebuild modeled table |
| Worker disk | Persistent Disk snapshot | Attach restored disk to test VM |
| Shared files | Filestore backup or snapshot plan | Mount restored share and verify files |

The map ties each data shape to a recovery mechanism and a proof.

## Putting It All Together

Return to the opening mistakes.

Bad order rows need Cloud SQL recovery, often from backups or point-in-time recovery, plus a plan for migration-caused damage.

Deleted exports and overwritten receipts need Cloud Storage recovery choices such as immutable names, versioning, soft delete, lifecycle review, and restricted delete permission.

Firestore document mistakes need collection-level recovery planning when the data matters.

BigQuery table mistakes may be solved by time travel, snapshots, or rebuilding from protected raw events.

Disk and file share problems need snapshots or backups that match application consistency.

The final storage habit is simple: every important data shape should have a previous copy, a retention reason, a safe deletion story, and a tested restore path.

---

**References**

- [Google Cloud: Cloud Storage Object Versioning](https://cloud.google.com/storage/docs/object-versioning)
- [Google Cloud: Cloud SQL backups](https://cloud.google.com/sql/docs/mysql/backup-recovery/backups)
- [Google Cloud: BigQuery time travel](https://cloud.google.com/bigquery/docs/time-travel)
- [Google Cloud: Persistent Disk snapshots](https://cloud.google.com/compute/docs/disks/create-snapshots)
