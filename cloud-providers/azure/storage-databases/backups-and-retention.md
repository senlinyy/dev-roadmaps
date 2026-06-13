---
title: "Backups and Retention"
description: "Design Azure recovery around restore points, retention windows, object versions, database PITR, snapshots, vaults, and deletion guardrails."
overview: "Backups are useful only when they lead to a working restore. This article walks through Azure recovery design across Blob Storage, Azure SQL Database, Cosmos DB, Managed Disks, Azure Files, and Azure Backup vaults."
tags: ["azure", "backup", "retention", "restore", "soft-delete"]
order: 6
id: article-cloud-providers-azure-storage-databases-backups-retention-safe-deletion
aliases:
  - backups-retention-and-safe-deletion
  - cloud-providers/azure/storage-databases/backups-retention-and-safe-deletion.md
---

## Table of Contents

1. [The Recovery Map](#the-recovery-map)
2. [Retention Windows](#retention-windows)
3. [Blob Storage Recovery](#blob-storage-recovery)
4. [Azure SQL Database Restore](#azure-sql-database-restore)
5. [Cosmos DB Backup Modes](#cosmos-db-backup-modes)
6. [Managed Disks and Azure Files](#managed-disks-and-azure-files)
7. [Vaults, Immutability, and Backup Soft Delete](#vaults-immutability-and-backup-soft-delete)
8. [Safe Deletion and Restore Drills](#safe-deletion-and-restore-drills)
9. [Putting It All Together](#putting-it-all-together)

## The Recovery Map
<!-- section-summary: Azure recovery design starts by naming the data, the restore point, the restore location, and the application path back to service. -->

A **backup** is a saved recovery point from an earlier moment. A **restore** is the work of turning that recovery point back into usable data. That second word matters a lot, because many teams can point at a backup job and still freeze during an incident. They know Azure has copies somewhere, but they cannot name which copy to choose, where to restore it, who can approve it, or how the application will use the recovered data.

Let's use one production example through the article. Imagine a learning platform called `LearnTrail`. It sells course subscriptions, stores invoices as PDF blobs, keeps user enrollment records in Azure SQL Database, stores high-volume activity events in Cosmos DB, runs one old video processing VM with managed disks, and shares export templates through Azure Files. This is a small enough system to picture, but it has the same recovery problems that larger systems have.

For `LearnTrail`, one accident can hit several data shapes at the same time. A release might update the wrong enrollment rows in SQL. A cleanup job might delete invoice PDFs from Blob Storage. A worker might write bad activity events into Cosmos DB. A VM upgrade might damage files on a data disk. Each case needs a different Azure recovery feature, because each service stores data in a different way.

The practical recovery map has four questions:

| Question | What the team needs to know | LearnTrail example |
| --- | --- | --- |
| **What data changed?** | The exact database, container, share, disk, or blob prefix | `invoices/2026/06/` in Blob Storage |
| **Which earlier point is useful?** | The timestamp, version, snapshot, or recovery point | Just before the cleanup job ran at 09:17 UTC |
| **Where will Azure restore it?** | A new database, another account, a recovered blob version, a restored disk, or a file share path | A separate `learntrail-enrollments-restore` database |
| **How will production use it?** | Compare, copy back, switch traffic, rebuild a VM, or recover selected files | Copy only the corrected enrollment rows back into production |

That last question keeps the article grounded. Recovery design includes the platform feature and the human path from panic to verified data.

![Azure recovery map showing a LearnTrail incident moving through data shape, restore point, safe restore place, and return to service](/content-assets/articles/article-cloud-providers-azure-storage-databases-backups-retention-safe-deletion/azure-recovery-map.png)

*The recovery map turns the incident into five concrete choices before anyone starts copying data back into production.*

Once the map exists, retention becomes the next decision. The team needs to know how long each recovery point remains available.

## Retention Windows
<!-- section-summary: Retention is the time limit on recovery, so the setting has to match how long the business may take to notice and respond to data loss. -->

**Retention** means how long Azure keeps a recovery copy before the service, policy, or lifecycle rule removes it. A retention window turns a recovery promise into a clock. If Blob soft delete keeps deleted blobs for 30 days, the team has 30 days to recover a deleted invoice blob. If Azure SQL Database short-term retention keeps point-in-time restore coverage for 7 days, a mistake found after day 8 needs another recovery source, such as long-term retention or an export process.

For a beginner, retention can feel like a storage setting. In production, retention is a business decision written into cloud settings. `LearnTrail` may discover a bad enrollment migration within an hour because support sees customer tickets quickly. It may discover missing tax invoices after a monthly finance review. It may need to keep annual financial records for years. Those three discovery timelines need separate retention choices instead of one generic "keep backups for a while" setting.

Azure services give different retention shapes. Azure SQL Database short-term retention supports point-in-time restore for recent operational mistakes, with 7 days by default and a configurable range that depends on the database tier. Long-term retention keeps selected full database backups for compliance needs and can go up to 10 years. Blob soft delete and container soft delete use day-based retention windows. Cosmos DB continuous backup uses a selected 7-day or 30-day restore tier. Azure Backup policies for files, disks, VMs, and other workloads can express daily, weekly, monthly, and yearly retention patterns.

**Recovery Point Objective**, usually shortened to **RPO**, is the amount of data the business can afford to lose. If `LearnTrail` can lose at most 10 minutes of enrollment changes, the restore design needs a recent enough database restore point. **Recovery Time Objective**, usually shortened to **RTO**, is how long the business can wait before the service works again. If support needs invoice lookup restored within one hour, the restore workflow has to fit inside that hour and produce data the application can use.

Here is how a team might write the first version of a retention plan:

| Data asset | Discovery pattern | Recovery feature | Starting retention choice |
| --- | --- | --- | --- |
| Enrollment database | Bad release usually noticed the same day | Azure SQL Database PITR | 14 to 35 days for production, plus LTR for compliance rows |
| Invoice PDFs | Finance may notice missing files weeks later | Blob versioning, blob soft delete, container soft delete, immutable storage for final invoices | 30 to 90 days for recoverability, longer WORM policy where records require it |
| Activity events | Bad writes may need timeline replay | Cosmos DB continuous backup | 30-day tier for production accounts with customer impact |
| Video worker disk | Upgrade failures show up quickly | Managed disk snapshots or Azure Backup | Short operational snapshot retention around changes |
| Shared export templates | Accidental edits or deletes show up during reporting | Azure Files snapshots and Azure Backup | Daily snapshots with monthly retention where reporting depends on them |

Longer retention costs money because old versions, deleted blobs, snapshots, recovery points, and restored copies consume storage. Shorter retention can make recovery impossible after the team finally notices the problem. Good retention settings come from the middle of those two realities: keep enough history for the real discovery window, and use lifecycle policies or backup policies so old copies age out on purpose.

With the clock defined, the next question is data shape. The first `LearnTrail` data shape is Blob Storage, because files often receive accidental deletes and overwrites from scripts.

## Blob Storage Recovery
<!-- section-summary: Blob recovery usually combines versioning, blob soft delete, container soft delete, lifecycle cleanup, and sometimes immutability for records that must stay fixed. -->

**Azure Blob Storage** stores object data such as PDFs, images, exports, logs, and media files. A blob has a name inside a container, and application code usually reads or writes it through the storage API rather than mounting it like a normal disk. For `LearnTrail`, invoice PDFs live under names like `invoices/2026/06/invoice-10421.pdf`.

Blob accidents usually come in two flavors. A script deletes the wrong blob, or a process overwrites the blob with wrong content. **Blob soft delete** helps with deletes and overwrites by keeping deleted objects recoverable for a configured number of days. Microsoft documents a blob soft delete retention range from 1 to 365 days. During that window, the deleted blob, snapshot, or version can be restored.

**Blob versioning** keeps earlier versions when a blob changes. When the invoice generator overwrites `invoice-10421.pdf`, Azure can keep the previous version and make the new bytes the current version. That means recovery can be more precise than "restore the whole container." The team can inspect previous versions for one invoice, decide which version has the correct amount and customer name, and promote or copy that version back into the current path.

**Container soft delete** covers a wider accident: deleting the whole container. If someone deletes the `invoices` container, the recovery path needs container-level protection because the parent container disappeared. Container soft delete keeps the deleted container and its contents recoverable for the configured retention window. Microsoft recommends using container soft delete, blob soft delete, and blob versioning together for stronger blob protection.

Those features create a useful recovery path, but they also create storage growth. Every rewrite can create another version. Every deleted blob can stay billable until the retention window ends. For busy prefixes like `exports/tmp/`, lifecycle management can delete old versions and expired temporary data. For final invoice records, the team may choose a longer retention design and accept the cost because the business needs the evidence.

Some blobs need a stronger promise than "we can recover a delete." **Immutable storage** for Blob Storage stores data in a WORM state, which means **write once, read many**. A time-based retention policy can prevent modification and deletion for a configured interval, and a legal hold can keep data immutable until someone explicitly clears the hold. This fits final financial documents, audit exports, and other records where normal administrators need a controlled path before history changes.

A small Blob Storage protection setup often appears in infrastructure automation like this:

```bash
az storage account blob-service-properties update \
  --account-name learntrailprodstore \
  --resource-group rg-learntrail-prod \
  --enable-versioning true \
  --enable-delete-retention true \
  --delete-retention-days 30 \
  --enable-container-delete-retention true \
  --container-delete-retention-days 30
```

That command is only the start of the design. The restore runbook still needs to say which prefix is protected, who can restore, how to choose the correct version, how to verify the PDF, and how to handle matching database records. Blob recovery fixes file history. The application story around that file still needs its own recovery step.

The invoices are files, but `LearnTrail` also stores enrollment state in Azure SQL Database. Database recovery uses a different shape because the team often needs one exact second before a bad write.

## Azure SQL Database Restore
<!-- section-summary: Azure SQL Database recovery uses automated backups, transaction logs, PITR, and long-term retention to restore a database state without treating every table as a file. -->

**Azure SQL Database** is a managed relational database service. It stores structured records in tables, enforces transactions, and supports SQL queries. `LearnTrail` uses it for customers, course enrollments, payments, and support-facing account state. A bad database change can hurt many users at once because one query can update thousands of rows.

Azure SQL Database creates automated backups. For service tiers other than Hyperscale, Microsoft documents weekly full backups, differential backups every 12 or 24 hours, and transaction log backups approximately every 10 minutes. Azure uses that backup chain to support **point-in-time restore**, usually called **PITR**, inside the configured short-term retention window. New, restored, and copied databases keep 7 days of PITR coverage by default, and production teams can configure the short-term window within the supported service limits.

Here is the important beginner idea: PITR usually creates a new database rather than magically undoing one table in place. If a deployment corrupts enrollments at 14:05 UTC, the team can restore a new database to 14:04 UTC. Then they can compare the restored database with production, copy back selected rows, or choose a controlled cutover. That separate restore target keeps the team from replacing good customer activity that happened after 14:05.

![Azure restore paths by data shape showing Blob Storage, Azure SQL, and Cosmos DB each restoring beside production before copying data back](/content-assets/articles/article-cloud-providers-azure-storage-databases-backups-retention-safe-deletion/restore-paths-by-data-shape.png)

*The same restore-beside-production habit works across blobs, relational rows, and Cosmos DB containers, even though each service uses a different recovery feature.*

This is why "restore" means more than "roll back." During the incident, customers may keep buying courses and completing lessons. If the team replaces production with the 14:04 database at 16:00, they may erase valid transactions from the last two hours. Many SQL recoveries become compare-and-repair work instead of whole-database replacement.

**Long-term retention**, or **LTR**, solves a different problem. PITR protects recent operational mistakes. LTR keeps selected full backups for long-running business and compliance requirements, up to 10 years for Azure SQL Database and Azure SQL Managed Instance. For `LearnTrail`, finance may need older database evidence for tax or audit questions even though nobody wants to restore the whole app to last year's state.

Azure SQL backup storage redundancy also matters. Geo-redundant backup storage can support geo-restore if the primary region has a major outage. Local or zone-redundant backup choices may cost less or keep data within a geography, but the recovery behavior changes. A team makes that tradeoff deliberately, especially for production databases that support customer payments or legal records.

Azure SQL gives a strong database recovery path, but `LearnTrail` also has activity data in Cosmos DB. Cosmos DB uses backup modes rather than SQL transaction log restore.

## Cosmos DB Backup Modes
<!-- section-summary: Cosmos DB recovery depends on whether the account uses periodic backup or continuous backup, because those modes give different restore windows and restore workflows. -->

**Azure Cosmos DB** is a globally distributed NoSQL database service. It stores data in containers instead of relational tables, and applications often use it for high-volume events, profiles, carts, catalogs, or session-like records. `LearnTrail` uses Cosmos DB for activity events such as lesson starts, quiz attempts, and video watch progress.

Every Cosmos DB account has automatic backups. Microsoft describes **periodic backup mode** as the default backup mode unless the account uses continuous backup. Periodic mode takes platform-managed backups on a schedule. It fits workloads where the team accepts a coarser restore point and a restore workflow based around the periodic backup model.

**Continuous backup mode** is the mode teams usually discuss when they want point-in-time restore for accidental writes or deletes. Cosmos DB continuous backup supports restore to a timestamp within the selected retention tier, currently 7 days or 30 days. Microsoft describes use cases such as recovering from accidental writes, recovering deleted accounts, databases, or containers, and restoring into a region where backups existed at that point in time.

For `LearnTrail`, continuous backup helps when a worker writes duplicate activity events for 40 minutes. The team can restore the affected container state to another account at a known timestamp, inspect the restored data, and rebuild clean event history or reprocess downstream analytics. The restored account matters because recovery belongs beside production first. Production may still receive new events while the team investigates.

Cosmos DB restore planning also includes partition and throughput reality. A restored account still has to support the shape of the source data. The team needs to know whether the restore target can handle the same partition layout, RU/s needs, indexes, regions, and application connection settings. Recovery that lands in an account the app cannot use still leaves the business stuck.

A simple inventory query can help teams audit backup modes across subscriptions:

```kusto
Resources
| where type =~ "microsoft.documentdb/databaseaccounts"
| extend backupMode = tostring(properties.backupPolicy.type)
| extend periodicBackupIntervalMinutes = toint(properties.backupPolicy.periodicModeProperties.backupIntervalInMinutes)
| extend periodicBackupRetentionHours = toint(properties.backupPolicy.periodicModeProperties.backupRetentionIntervalInHours)
| extend continuousBackupTier = tostring(properties.backupPolicy.continuousModeProperties.tier)
| project subscriptionId, resourceGroup, name, backupMode, periodicBackupIntervalMinutes, periodicBackupRetentionHours, continuousBackupTier
| order by subscriptionId asc, resourceGroup asc, name asc
```

That kind of query gives the operations team a list of accounts and backup settings before an incident. During an incident, they need to know which accounts have continuous restore windows and which accounts depend on periodic backup behavior.

The database services now have a recovery story. The remaining `LearnTrail` state sits closer to operating system storage: managed disks and file shares.

## Managed Disks and Azure Files
<!-- section-summary: Disk and file-share recovery protects VM-bound storage and shared folders, but the team still needs to test whether the restored data starts and mounts cleanly. -->

**Azure Managed Disks** are block storage volumes attached to virtual machines. A VM boot disk, a video worker data disk, or a legacy application disk all use this kind of storage. A **snapshot** captures a disk at a point in time. Azure supports full snapshots and incremental snapshots. Incremental snapshots store changes since the previous snapshot, and Azure can use them to create a full managed disk that represents the selected point in time.

For `LearnTrail`, a video processing VM has a data disk with codec configuration, job state, and temporary working files. Before a risky upgrade, the team can take a disk snapshot. If the upgrade breaks the VM, the snapshot gives them a previous disk state to attach to a recovery VM or use to create a replacement disk.

The word **snapshot** can sound stronger than the guarantee it gives. A disk snapshot captures storage state, but an application may have writes sitting in memory or in a database engine cache. A crash-consistent snapshot may be enough for static files and some services. A busy database running inside a VM often needs application-aware backup behavior or the database's own backup process. A restore test includes starting the service, opening the files, and confirming the application can actually use the recovered disk.

**Azure Files** is Azure's managed file share service. It exposes SMB or NFS shares for workloads that need a shared directory. `LearnTrail` uses an Azure Files share for export templates and shared report files. This data behaves more like a mounted folder than object storage, so recovery often focuses on file share snapshots and Azure Backup policies.

Azure Backup can protect Azure Files through snapshot and vaulted backup tiers. The snapshot tier gives fast restore from file share snapshots. Vaulted backup adds offsite protection for stronger recovery scenarios, ransomware defense, cross-region recovery, and longer compliance-style retention where supported. Azure Backup policies can schedule backups and set daily, weekly, monthly, or yearly retention according to the workload.

File share recovery needs the same restore-side test as disk recovery. A template file restored to the wrong path, with the wrong permissions, or into a share the report worker cannot mount gives the team very little during month-end reporting. The runbook records the restored path, access identity, mount path, sample file check, and owner approval.

By this point, `LearnTrail` has service-level recovery options. The next layer is where Azure Backup vaults, immutability, and backup soft delete protect the recovery points themselves.

## Vaults, Immutability, and Backup Soft Delete
<!-- section-summary: Azure Backup vault settings protect recovery points from accidental cleanup and malicious deletion, which matters because attackers often target backups after production. -->

**Azure Backup** is Azure's managed backup service for workloads such as virtual machines, Azure Files, managed disks, databases on VMs, and other supported resources. A **Recovery Services vault** or **Backup vault** gives the team a central resource for backup policies, jobs, recovery points, monitoring, and security controls.

For `LearnTrail`, vault-based backup keeps the video worker VM and Azure Files shares under policy instead of depending on a person to remember snapshots. The policy says how often Azure creates recovery points and how long those points remain. The vault gives operations a place to review failures, inspect protected items, and start restore workflows.

The vault itself becomes important during a security incident. Ransomware and malicious actors often try to delete backups after damaging production data. **Immutable vault** settings help by blocking operations that could lead to loss of recovery points. Microsoft documents that immutability can be enabled and then locked to make the setting irreversible. That is powerful protection, and it needs careful testing before the team locks it.

**Backup soft delete** adds another safety layer for backup data. Microsoft documents Azure Backup soft delete as a way to recover backup data after accidental or malicious deletion. The default retention is 14 days, and the retention can be extended up to 180 days in supported configurations. In regions with secure-by-default enforcement, soft delete can be on by default and harder to disable from the portal.

These controls answer a different question than ordinary restore. Blob soft delete asks, "Can I recover that deleted PDF?" Backup soft delete asks, "Can I recover the backup item someone tried to delete?" Immutable vault settings ask, "Can normal destructive operations remove protected recovery points before their retention expires?" The stronger controls belong around backups for customer-impacting and compliance-impacting workloads.

There is one caution that beginners need to hear clearly. Locked retention is supposed to be hard to reverse. If the team accidentally keeps too much data for too long, a locked policy may preserve that cost and legal footprint. The team uses the unlocked phase to check restore behavior, cost, ownership, and retention policy shape before turning a protection setting into a long-lived commitment.

The last layer is operational habit. Good backup settings help, but safe deletion and restore drills reduce the chance that the team needs emergency recovery in the first place.

## Safe Deletion and Restore Drills
<!-- section-summary: Safe deletion catches mistakes before they destroy data, and restore drills prove that recovery settings work under real operating conditions. -->

**Safe deletion** means the team proves scope, recovery, and approval before a destructive action runs. This applies to scripts, migrations, lifecycle rules, manual portal actions, and cleanup jobs. The habit sits across the whole system instead of inside one Azure product.

For `LearnTrail`, a cleanup job may delete blobs under `exports/tmp/` every night. A safe version of that job prints the storage account, container, prefix, matched object count, sample blob names, retention settings, and expected delete time before it executes. A reviewer can see whether the job points at `exports/tmp/` or accidentally points at `invoices/`. That simple dry-run evidence can prevent a restore incident.

**Azure resource locks** can help protect important resources from accidental control-plane deletion or modification. A Delete lock on a storage account or resource group can block deletion through Azure Resource Manager. Microsoft documents an important boundary: locks apply to control plane operations rather than data plane operations. A lock can help protect the storage account resource, while blob deletes from application code still need blob-level protection.

That boundary is why deletion guardrails need layers:

| Layer | What it protects | What it does for `LearnTrail` |
| --- | --- | --- |
| Resource lock | Control-plane resource deletion | Helps stop accidental deletion of the production storage account |
| Blob versioning and soft delete | Object overwrite and delete mistakes | Recovers invoice blobs during the retention window |
| Container soft delete | Whole-container deletion | Recovers the `invoices` container if it gets deleted |
| Azure SQL PITR | Recent database corruption | Restores a database to a timestamp before a bad migration |
| Vault immutability and backup soft delete | Backup recovery points | Helps stop backup cleanup from becoming permanent too quickly |
| Dry-run and approval | Human and script mistakes | Shows exact targets before destructive jobs run |

![Azure recovery point guardrails showing managed disk snapshots, Azure Files backup, backup vault policies, and safe deletion approvals protected by a central shield](/content-assets/articles/article-cloud-providers-azure-storage-databases-backups-retention-safe-deletion/protect-recovery-points.png)

*Guardrails protect the recovery points themselves, while safe deletion checks reduce the chance that the team needs an emergency restore.*

**Restore drills** prove the other half of the story. A restore drill is a scheduled practice recovery into a safe place. The team restores a SQL database under a temporary name, recovers a blob version, restores a few files from Azure Files, or creates a disk from a snapshot. Then they verify the recovered data and record how long it took.

A healthy drill feels boring by the third time. That is the goal. The first drill often reveals missing permissions, unclear owners, slow restore steps, networking gaps, forgotten connection strings, or a restored database nobody can safely compare. Finding those problems during practice costs much less than finding them during an outage.

Now we can put the design back together across the whole storage module.

## Putting It All Together
<!-- section-summary: Azure backups and retention work best when each data shape has a named restore point, a retention window, a safe restore location, and a tested return path. -->

Backups and retention are part of storage design. Blob Storage needs versioning, blob soft delete, container soft delete, lifecycle cleanup, and sometimes immutable storage for final records. Azure SQL Database needs short-term PITR for recent mistakes and long-term retention for older compliance needs. Cosmos DB needs the right backup mode before the incident. Managed Disks need snapshots or Azure Backup, plus application-aware thinking for busy services. Azure Files needs snapshot or vaulted backup policies that match how shared folders are used.

`LearnTrail` can now make recovery decisions in plain language. Enrollment corruption goes through Azure SQL PITR into a separate database, followed by compare-and-repair. Invoice deletion goes through blob versions or soft delete. Activity-event damage goes through Cosmos DB backup mode and a restored account. VM disk failure goes through a snapshot or backup recovery point. Shared template damage goes through Azure Files snapshots or Azure Backup. Critical recovery points sit behind vault security controls, and destructive jobs use dry-run evidence before they run.

The useful test is simple: the team can name the data, name the restore point, name the retention window, name the restore location, and name the way production will use the recovered data. When those names are missing, the backup design still needs work.

![Azure backup and retention checklist showing name the data, choose the restore point, set retention, restore beside production, verify the result, and copy back safely](/content-assets/articles/article-cloud-providers-azure-storage-databases-backups-retention-safe-deletion/backup-retention-checklist.png)

*The final checklist keeps the restore path practical: name the data, recover it beside production, verify it, and copy back only what belongs there.*

---

**References**

* [Automated backups in Azure SQL Database](https://learn.microsoft.com/en-us/azure/azure-sql/database/automated-backups-overview?view=azuresql) - Backup frequency, PITR behavior, redundancy choices, and short-term retention.
* [Long-term retention backups in Azure SQL Database and Azure SQL Managed Instance](https://learn.microsoft.com/en-us/azure/azure-sql/database/long-term-retention-overview?view=azuresql) - LTR policy concepts, retention windows, and restore behavior.
* [Data protection overview for Azure Blob Storage](https://learn.microsoft.com/en-us/azure/storage/blobs/data-protection-overview) - Recommended combinations of resource locks, container soft delete, blob soft delete, versioning, and immutability.
* [Soft delete for blobs](https://learn.microsoft.com/en-us/azure/storage/blobs/soft-delete-blob-overview) - Blob soft delete retention and restore behavior.
* [Blob versioning](https://learn.microsoft.com/en-us/azure/storage/blobs/versioning-overview) - Version creation, previous versions, and lifecycle considerations.
* [Soft delete for containers](https://learn.microsoft.com/en-us/azure/storage/blobs/soft-delete-container-overview) - Container-level delete recovery and retention behavior.
* [Immutable storage for blob data](https://learn.microsoft.com/en-us/azure/storage/blobs/immutable-storage-overview) - WORM policies, time-based retention, and legal holds.
* [Continuous backup with point-in-time restore in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/continuous-backup-restore-introduction) - Continuous backup restore scenarios and retention tiers.
* [Online backup and on-demand data restore in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/online-backup-and-restore) - Periodic backup defaults, backup protection, and audit query examples.
* [Create an incremental snapshot for managed disks](https://learn.microsoft.com/en-us/azure/virtual-machines/disks-incremental-snapshots) - Managed disk snapshot behavior and restore use.
* [About Azure Files backup](https://learn.microsoft.com/en-us/azure/backup/azure-file-share-backup-overview) - Azure Files snapshot and vaulted backup behavior.
* [Immutable vault for Azure Backup](https://learn.microsoft.com/en-us/azure/backup/backup-azure-immutable-vault-concept) - Vault immutability concepts and considerations.
* [Secure by default with soft delete for Azure Backup](https://learn.microsoft.com/en-us/azure/backup/secure-by-default) - Backup soft delete behavior and retention.
* [Lock Azure resources to protect infrastructure](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/lock-resources) - Resource lock scope and control-plane boundaries.
