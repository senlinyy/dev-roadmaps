---
title: "Backups and Retention"
description: "Plan recovery on Google Cloud with backups, restores, RPO, RTO, retention, PITR, object versioning, soft delete, snapshots, BigQuery time travel, and restore drills."
overview: "Recovery planning covers deletion, corruption, bad deploys, and audit retention. The guide defines backup, restore, RPO, RTO, retention, PITR, versioning, soft delete, snapshots, time travel, and practical restore checks."
tags: ["gcp", "backups", "retention", "recovery"]
order: 7
id: article-cloud-providers-gcp-storage-databases-backups-retention
aliases:
  - backups-and-retention
  - backups-retention
  - safe-deletion
---

## Table of Contents

1. [What Recovery Planning Protects You From](#what-recovery-planning-protects-you-from)
2. [Backup and Restore](#backup-and-restore)
3. [RPO and RTO](#rpo-and-rto)
4. [Retention](#retention)
5. [Point-in-Time Recovery](#point-in-time-recovery)
6. [Versions, Soft Delete, Snapshots, and Time Travel](#versions-soft-delete-snapshots-and-time-travel)
7. [Restore Sandboxes](#restore-sandboxes)
8. [Deletion Guardrails and Audit Needs](#deletion-guardrails-and-audit-needs)
9. [Restore Drills](#restore-drills)
10. [Putting It Together](#putting-it-together)
11. [References](#references)

## What Recovery Planning Protects You From
<!-- section-summary: Recovery planning answers what happens after deletion, corruption, bad deploys, ransomware-like mistakes, or audit retention needs. -->

Durable storage keeps data after a request ends. It also keeps bad writes after a bad release. A clinic import script can overwrite appointment notes. A cleanup job can delete inspection photos. A profile editor bug can replace drafts with stale data. A BigQuery transform can overwrite a revenue table with an incomplete result. A VM worker can corrupt a local render directory.

Backups and retention answer the uncomfortable question: what happens after the mistake? The answer needs more than "the data is durable." Durability protects against hardware loss. Recovery planning protects against deletion, corruption, bad deploys, operator mistakes, and audit requirements.

This is the beginner leap: durable does not mean recoverable to the exact state you need. If bad data is written at 13:41, the storage system may keep that bad data perfectly. Recovery planning gives you an earlier state, a safe place to restore it, and a tested path to repair production without creating more damage.

The shape changes by service. Cloud SQL may use backups and point-in-time recovery. Cloud Storage may use object versioning, soft delete, lifecycle rules, and retention policies. BigQuery may use time travel and snapshots. VM disks may use snapshots. A useful recovery plan names the tool and proves the team can actually use it.

![Recovery map by data shape](/content-assets/articles/article-cloud-providers-gcp-storage-databases-backups-retention/recovery-map-by-data-shape.png)
*Each data shape has a different recovery tool, so the incident plan should route the data to the right previous copy.*

For AWS readers, the anchors are familiar after the GCP recovery jobs are clear. AWS Backup, S3 Versioning and Object Lock, S3 lifecycle rules, RDS PITR, DynamoDB PITR, EBS snapshots, and Redshift snapshot or restore patterns all map to similar recovery conversations. Google Cloud uses its own service-specific controls.

## Backup and Restore
<!-- section-summary: A backup is a previous copy, and a restore turns that copy into usable data again. -->

A **backup** is a previous copy of data. It may be a database backup, object version, Firestore backup, BigQuery table snapshot, disk snapshot, or Filestore backup. The backup exists so the team can return to or inspect an earlier state.

A **restore** is the process of turning a backup into usable data. A restore may create a new Cloud SQL instance, copy an older Cloud Storage object generation back to the live name, restore Firestore data, create a disk from a snapshot, or copy a BigQuery table from an earlier state.

The restore target matters. In many incidents, the first restore should land in a separate project, instance, dataset, bucket, or disk. That gives the team a safe place to inspect recovered data before changing production again.

Imagine a clinic import job loads `appointments_import_20260704.csv` and overwrites appointment notes for the wrong clinic. The useful recovery path is backup artifact, separate restore target, then validation. For Cloud SQL, the artifact may be an automated backup plus transaction logs inside the PITR window. The separate target could be `clinic-restore-20260704`.

```bash
gcloud sql instances clone clinic-prod clinic-restore-20260704 \
  --project=clinic-prod \
  --point-in-time="2026-07-04T13:41:00Z"
```

Important details in this command:

- The timestamp should sit just before the import job started damaging rows.
- The restore target is a new instance, so validation can happen away from production.
- The clone gives the team a source for comparison or selective repair.

Validation should answer the business question and confirm the database starts. A few SQL checks might compare damaged rows in production with the restored target:

```sql
SELECT COUNT(*) AS missing_notes
FROM appointments
WHERE clinic_id = 'clinic_42'
  AND appointment_date = DATE '2026-07-05'
  AND appointment_notes IS NULL;

SELECT appointment_id, patient_id, appointment_notes, updated_at
FROM appointments
WHERE appointment_id IN ('appt_88421', 'appt_88422', 'appt_88423')
ORDER BY appointment_id;
```

Example validation output from the restore target:

```console
missing_notes
-------------
0

appointment_id | patient_id | appointment_notes        | updated_at
---------------+------------+--------------------------+------------------------
appt_88421     | pat_1021   | Bring referral documents | 2026-07-04 12:58:11 UTC
appt_88422     | pat_1104   | Follow-up blood pressure | 2026-07-04 13:02:44 UTC
```

This evidence proves the restored target contains useful pre-import data. The team can then choose a repair path, such as exporting selected rows from the restore target and applying a reviewed update to production.

## RPO and RTO
<!-- section-summary: RPO names how much data change the business can lose, and RTO names how long recovery may take. -->

**Recovery Point Objective**, or **RPO**, means the maximum amount of data change the business can lose. **Recovery Time Objective**, or **RTO**, means the maximum time the business can spend getting useful service back.

These terms are easier with a clock. If the clinic appointment database has a 5-minute RPO, a bad import at 13:41 should let the team recover to a point very close to 13:36 or later. The business accepts losing at most about five minutes of changes. If the same system has a 1-hour RTO, the team should be able to make useful service available again within that hour.

RPO talks about data loss. RTO talks about time to usable service. A system can have a strong RPO and a weak RTO if backups are frequent but restores are slow. A system can have a strong RTO and a weak RPO if it comes back quickly with stale data. The business needs both numbers because they answer different pain points.

These terms make sense only after you attach them to real data:

| Data | Likely incident | Recovery target |
|---|---|---|
| Clinic appointments in Cloud SQL | Bad import updates appointment notes | RPO 5 minutes, RTO 1 hour |
| Inspection photos in Cloud Storage | Folder deleted during cleanup | Recover deleted files within 30 days |
| Support case drafts in Firestore | Automation overwrites case fields | Recover earlier state from same day |
| Product analytics in BigQuery | Transform replaces table with bad data | Restore dashboard table within 2 hours |
| Render cache on Persistent Disk | VM script corrupts local files | Recreate disk from latest useful snapshot |

RPO and RTO guide feature choices. A short RPO for appointments may require Cloud SQL PITR and tested clones. A longer RPO for derived analytics may rely on raw event replay and table snapshots. A legal retention need for inspection documents may require Cloud Storage retention policies.

## Retention
<!-- section-summary: Retention decides how long previous copies or protected records must survive. -->

**Retention** means how long data or previous copies must remain available. Retention can support recovery, compliance, customer support, finance, legal hold, or audit review. It can also control cost by removing old versions after they stop being useful.

Retention policy should be written in business language first. For example: keep submitted inspection documents for seven years, keep temporary upload staging objects for seven days, keep object versions for 90 days, and keep database PITR logs for the agreed recovery window.

Cloud Storage retention policies can prevent object deletion before the required age. Lifecycle rules can remove temporary objects and old noncurrent versions. Database backup retention and log retention should match the RPO and audit needs of the data set.

A practical retention table should name the owner and cleanup mechanism:

| Data type | Retention rule | Owner | Reason | Cleanup mechanism |
|---|---|---|---|---|
| Temporary upload staging objects | Keep for 7 days | Platform storage owner | Users abandon uploads and retries create leftovers | Cloud Storage lifecycle rule on `upload-staging/` |
| Submitted inspection reports | Keep for 7 years | Compliance owner and product owner | Contract, audit, and customer dispute review | Cloud Storage retention policy, then approved lifecycle cleanup after the retention age |
| Cloud SQL appointment records and PITR logs | Keep backups and logs for the agreed recovery window | Database owner | Recover from bad imports and migrations | Cloud SQL automated backup and PITR retention settings |
| Firestore profile drafts | Keep inactive drafts for 180 days | Product owner | Let users return to unfinished work without storing drafts forever | Firestore TTL on an `expiresAt` timestamp field |
| BigQuery raw product events | Keep raw events for 13 months | Analytics data owner | Trend analysis, finance checks, and pipeline replay | Partition expiration or scheduled deletion after export review |
| Persistent Disk snapshots | Keep daily snapshots for 30 days and selected weekly snapshots longer | Platform owner | VM and legacy workload rollback | Snapshot schedule retention policy |

This table makes retention review concrete. The owner knows why the data survives, engineers know which control performs cleanup, and reviewers can see where a legal or compliance rule outranks a simple storage-cost decision.

## Point-in-Time Recovery
<!-- section-summary: PITR recovers a database or document store to a specific timestamp inside a retained recovery window. -->

**Point-in-Time Recovery**, often shortened to **PITR**, restores data to a specific timestamp inside a supported recovery window. PITR is useful after the team identifies the rough start time of a bad deploy, import, migration, or automation run that wrote wrong data.

Cloud SQL PITR uses backups and retained transaction logs. Firestore also supports point-in-time recovery for supported databases. The team still needs evidence for the timestamp: deploy records, audit logs, application logs, or incident notes.

Example Cloud SQL clone for a clinic appointment database:

```bash
gcloud sql instances clone clinic-prod clinic-restore-20260704 \
  --point-in-time="2026-07-04T13:42:00Z"
```

Important details in this command:

- The clone creates a separate instance for inspection.
- The timestamp should be just before the damaging write began.
- After the clone is ready, SQL validation should check appointment counts, sample records, and missing updates before production repair.

Firestore PITR uses the same idea for document data: choose the timestamp, restore or clone to a separate target, then validate real document paths before repair. For a profile-draft incident, the recovery command might look like this:

```bash
gcloud firestore databases clone \
  --source-database='projects/profile-prod/databases/(default)' \
  --snapshot-time='2026-07-04T14:10:00Z' \
  --destination-database='profile-restore-20260704'
```

Important details in this command:

- `--snapshot-time` should come from deploy records, audit logs, or incident notes.
- The destination database is separate, so validation does not overwrite production drafts.
- The validation should compare a few known document paths and the fields damaged by the incident.

PITR is powerful only inside its retained window. If the bad write happened outside that window, the team needs scheduled backups, exports, raw event replay, or another service-specific recovery copy.

## Versions, Soft Delete, Snapshots, and Time Travel
<!-- section-summary: Google Cloud recovery controls differ by service: objects use versions and soft delete, disks use snapshots, and BigQuery uses time travel and snapshots. -->

Different services store history differently. A good recovery runbook sends each incident to the right tool:

| Service | Recovery control | Good fit |
|---|---|---|
| Cloud Storage | Object Versioning | Recover a previous generation after overwrite |
| Cloud Storage | Soft delete | Recover recently deleted objects or buckets inside the soft delete window |
| Cloud Storage | Retention policy | Prevent early deletion of required records |
| Cloud SQL | Automated backups and PITR | Restore relational data to a timestamp |
| Firestore | Backups, PITR, exports | Recover document data or inspect earlier states |
| BigQuery | Time travel, table snapshots, table copies | Recover or inspect earlier table data |
| Persistent Disk | Snapshots | Create a new disk from an earlier block-device state |
| Filestore | Backups or snapshots where supported | Recover shared filesystem data |

Cloud Storage object recovery might look like this:

```bash
gcloud storage ls --all-versions \
  gs://inspection-prod-docs-us/inspections/site_4471/2026/07/report_771/front-door.jpg

gcloud storage cp \
  gs://inspection-prod-docs-us/inspections/site_4471/2026/07/report_771/front-door.jpg#1719858400123456 \
  gs://inspection-prod-docs-us/inspections/site_4471/2026/07/report_771/front-door.jpg
```

Important details in these commands:

- `--all-versions` lists generations, including noncurrent versions if versioning is enabled.
- The `#1719858400123456` suffix chooses one exact generation.
- The copy restores that generation to the live object name.

![Cloud Storage recovery layers](/content-assets/articles/article-cloud-providers-gcp-storage-databases-backups-retention/cloud-storage-recovery-layers.png)
*Cloud Storage recovery can combine versions, soft delete, retention, and lifecycle rules.*

A disk restore uses a snapshot:

```bash
gcloud compute disks create render-cache-restore \
  --project=studio-prod \
  --zone=us-central1-a \
  --source-snapshot=render-cache-before-upgrade
```

Important details in this command:

- The restored disk is new, so the team can attach it to a test VM first.
- The snapshot name should come from the incident timeline or scheduled policy.
- Application owners should verify files before the disk replaces any production path.

BigQuery recovery often uses time travel or table snapshots. A recovery query might copy an earlier table state into a new validation table:

```sql
CREATE TABLE `ticket-prod.ticket_restore.ticket_sales_events_20260704`
CLONE `ticket-prod.ticket_curated.ticket_sales_events`
FOR SYSTEM_TIME AS OF TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 2 HOUR);
```

Important details in this SQL:

- The restored table lands in a restore dataset.
- `FOR SYSTEM_TIME AS OF` asks for an earlier table state inside the time travel window.
- Analysts should compare row counts and known event samples before replacing reporting data.

## Restore Sandboxes
<!-- section-summary: A restore sandbox lets the team validate recovered data without overwriting production during an incident. -->

A **restore sandbox** is a safe place to land recovered data first. It can be a separate Google Cloud project, Cloud SQL instance, BigQuery dataset, bucket prefix, VM, or disk. The sandbox keeps validation away from production until the team knows exactly what it has.

The sandbox exists because "restore" and "repair production" are different moves. During an incident, the team may need to inspect old data, compare rows, export a few records, or prove a file still exists. Doing that directly in production can create a second accident. A sandbox gives responders a place to look before they touch the live system again.

For the clinic appointment incident, the restore sandbox might include:

| Restored item | Sandbox target | Validation |
|---|---|---|
| Cloud SQL appointments | `clinic-restore-20260704` | Compare appointment counts and sample corrupted records |
| Cloud Storage intake forms | `gs://clinic-restore-docs-us/` | Confirm deleted forms and metadata |
| Firestore case notes | Restore target database or export location | Check affected patient support cases |
| BigQuery reports | `clinic_restore` dataset | Compare dashboard totals before and after incident |

The sandbox should have separate IAM, clear labels, and cleanup rules. It should also block accidental app connections unless the restore plan explicitly needs a test app.

Good sandbox evidence includes the restore source, restore timestamp or backup ID, target name, owner, validation queries, and cleanup date. That evidence helps reviewers understand whether the restored data is safe to use for repair or only useful for investigation.

## Deletion Guardrails and Audit Needs
<!-- section-summary: Guardrails reduce accidental loss, while audit retention keeps required records available for review. -->

Recovery features help after damage. Guardrails reduce the chance of damage. Useful guardrails include delete protection on important databases, retention policies on required object records, IAM separation for destructive roles, approval workflows for retention changes, and alerts for backup failures.

Audit needs should be named clearly. A finance export, signed agreement, inspection report, medical record, or security log may need a retention period that is longer than the engineering restore window. That retention choice should involve legal, security, finance, or compliance owners for regulated or sensitive data.

For Cloud Storage, a locked retention policy needs careful review because shortening or removing it after the lock is restricted. Test the policy on non-production data, confirm application behavior, confirm lifecycle behavior, and document the approval before locking a production bucket.

A destructive-change workflow can use this shape:

| Step | Evidence to keep |
|---|---|
| Request the change | Ticket names the resource, action, reason, owner, expected data impact, and rollback or restore path |
| Review backup state | Current backup schedule, PITR setting, snapshot policy, or object retention output is attached before approval |
| Separate duties | One identity can request the change, a different owner approves it, and a tightly scoped operator or service account applies it |
| Apply in staging first | Staging command, output, and restore test show the same control path works before production |
| Apply in production | Command output, change ticket, and resource description after the change show the final state |
| Verify audit logs | Cloud Audit Logs show who changed the resource, from which principal, and at what time |
| Alert on future drift | Monitoring or log-based alerts notify the team about backup schedule changes, retention policy updates, lifecycle rule changes, PITR changes, and failed backup jobs |

IAM separation should match the danger level. Keep the identity that deploys application code separate from the identity that can shorten retention on required records. Backup administrators can manage schedules. Restore operators can restore into approved targets. Storage administrators can manage lifecycle rules after review. Broad project owner access should be rare enough that audit logs are meaningful.

Alerting closes the loop after approval. A retention policy change, Cloud SQL PITR disablement, failed backup, snapshot schedule deletion, or lifecycle rule update should create a visible signal for the owning team. The alert should link to the runbook and the audit log query so the responder can tell whether the change was approved or unexpected.

## Restore Drills
<!-- section-summary: A restore drill proves that backups, permissions, runbooks, validation queries, and human decisions work before the incident. -->

A backup has limited value until someone proves a restore. A **restore drill** is a scheduled practice run that restores real-enough data into a safe target, validates it, records timing, and updates the runbook.

The drill tests more than the storage feature. It tests whether the right person has permission, whether the command still works, whether the backup is recent enough, whether validation queries exist, whether the restored data can be understood, and whether the team can make a repair decision under time pressure.

For a clinic database, the drill can simulate a bad import. The team picks a timestamp, clones Cloud SQL to a restore instance, runs appointment-count and sample-record checks, measures the clone time, and records the repair options. For Cloud Storage, the drill can replace a harmless test object, restore the previous generation to a sandbox prefix, and compare checksum, content type, and metadata.

A practical drill includes:

| Step | Evidence |
|---|---|
| Pick scenario | "Bad import corrupted clinic appointments at 13:42 UTC" |
| Restore | Clone Cloud SQL to a sandbox timestamp |
| Validate | Run row counts, sample checks, and app-level queries |
| Decide repair | Export selected rows, cut over, or rebuild from source |
| Measure | Compare actual recovery time with RTO |
| Update | Fix missing IAM, unclear commands, or slow approvals |

![Restore drill checklist](/content-assets/articles/article-cloud-providers-gcp-storage-databases-backups-retention/restore-drill-checklist.png)
*A restore drill should test people, permissions, commands, validation, and timing.*

The best drill output is boring and specific. It should say which backup was used, how long the restore took, which validation checks passed, which permissions were missing, and which runbook step changed afterward. That record is what turns a backup setting into an operational recovery path.

## Putting It Together
<!-- section-summary: Recovery design connects each data shape to backup, restore, RPO, RTO, retention, and a tested runbook. -->

Backups and retention turn storage from "durable" into "recoverable." Define backup and restore first. Attach RPO and RTO to real data. Set retention in business language. Use PITR where timestamp recovery matters. Match object versions, soft delete, snapshots, and time travel to the service that stores the data.

The final proof is a restore drill. If the team can restore into a sandbox, validate the data, and explain the repair path calmly, the recovery design is doing real work.

## References

- [Cloud Storage Object Versioning](https://cloud.google.com/storage/docs/object-versioning) - Documents previous object generations for overwrite and delete recovery.
- [Cloud Storage soft delete](https://cloud.google.com/storage/docs/soft-delete) - Documents recoverable deletion windows for Cloud Storage objects and buckets.
- [Cloud Storage retention policies](https://cloud.google.com/storage/docs/bucket-lock) - Documents retention controls that protect required records from early deletion.
- [Cloud SQL backups](https://cloud.google.com/sql/docs/postgres/backup-recovery/backups) - Documents automated backup behavior for Cloud SQL for PostgreSQL.
- [Cloud SQL point-in-time recovery](https://cloud.google.com/sql/docs/postgres/backup-recovery/configure-pitr) - Documents PITR configuration and retained transaction logs.
- [Firestore backup and restore](https://cloud.google.com/firestore/native/docs/backups) - Documents scheduled Firestore backups and restore operations.
- [Firestore point-in-time recovery](https://cloud.google.com/firestore/native/docs/pitr) - Documents Firestore PITR behavior and recovery windows.
- [BigQuery time travel](https://cloud.google.com/bigquery/docs/time-travel) - Documents querying earlier table states inside BigQuery time travel.
- [BigQuery table snapshots](https://cloud.google.com/bigquery/docs/table-snapshots-intro) - Documents table snapshots for named historical recovery points.
- [Persistent Disk snapshots](https://cloud.google.com/compute/docs/disks/snapshots) - Documents creating and restoring snapshots for attached disks.
- [Filestore backups](https://cloud.google.com/filestore/docs/backups) - Documents Filestore backup behavior for supported tiers.
- [Cloud Audit Logs](https://cloud.google.com/logging/docs/audit) - Documents audit evidence for Google Cloud administrative and data access events.
- [Cloud Monitoring alerting](https://cloud.google.com/monitoring/alerts) - Documents alerting policies for operational and recovery signals.
