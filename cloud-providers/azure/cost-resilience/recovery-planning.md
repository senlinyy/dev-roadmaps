---
title: "Recovery Planning"
description: "Turn Azure backups, redundancy, RTO, RPO, failover, and restore drills into a tested recovery plan for a real workload."
overview: "Recovery planning connects Azure backups, redundant copies, failover routing, identity, and validation into one tested path. This article follows a checkout system so the difference between backup source, restored target, RTO, RPO, redundancy, strategy, and restore drills stays concrete."
tags: ["recovery", "backups", "rto", "rpo", "redundancy"]
order: 3
id: article-cloud-providers-azure-cost-resilience-recovery-planning-redundancy-backups
aliases:
  - recovery-planning-redundancy-and-backups
  - cloud-providers/azure/cost-resilience/recovery-planning-redundancy-and-backups.md
---

## Table of Contents

1. [What Recovery Planning Covers](#what-recovery-planning-covers)
2. [Backup vs Recovery](#backup-vs-recovery)
3. [RTO](#rto)
4. [Recovery Points and Data Protection](#recovery-points-and-data-protection)
5. [Redundancy in Azure Storage](#redundancy-in-azure-storage)
6. [Recovery Strategies](#recovery-strategies)
7. [Restore Drills](#restore-drills)
8. [Putting It All Together](#putting-it-all-together)

We will build this article in one connected path. First we separate the backup copy from the full recovery workflow. Then we give that workflow time and data-loss targets with **RTO** and **RPO**. After that we choose Azure recovery points, storage redundancy, a regional strategy, and a restore drill that proves the plan works.

The example stays the same the whole way through. DevPolaris runs a checkout service in Azure. The public traffic reaches the app through Azure Front Door, the app runs on Azure App Service or Azure Container Apps, orders live in Azure SQL Database, receipt PDFs live in Azure Blob Storage, secrets live in Azure Key Vault, and the app uses managed identity for access. That gives us enough real pieces to talk about recovery without drifting into abstract diagrams.

## What Recovery Planning Covers
<!-- section-summary: Recovery planning connects data copies, restored targets, traffic, identity, validation, and ownership into one tested path. -->

**Recovery planning** is the work of describing how a workload returns to a useful state after an outage, a bad deployment, a mistaken deletion, or a data corruption event. A good plan names the restore source, the restore target, the traffic path, the secrets, the identity permissions, the checks that prove the app works, and the people who make the call during an incident.

For the DevPolaris checkout service, the plan has to answer several plain questions. Which Azure SQL backup can recover the order rows? Which Blob version can recover a receipt that a script overwrote? Which region receives traffic if the primary region has a serious problem? Which managed identity can read the restored Key Vault secrets and connect to the restored database? Which smoke test proves that a customer can place an order after the recovery?

This is the part that makes recovery planning feel bigger than backups. Azure can store copies of data for you, and many Azure services create recovery points automatically or through a policy. The team still has to know how those copies become a working system again, because the checkout page needs connection strings, identity, routing, and validation before customers can use it.

The useful structure has five layers. **Recovery sources** are the backups, versions, snapshots, replicas, and logs you can restore from. **Recovery targets** are the databases, storage accounts, virtual machines, app environments, or regions that receive the restored state. **Recovery objectives** define how long the outage may last and how much recent data the business can lose. **Recovery routing** moves traffic and application configuration toward the recovered target. **Recovery evidence** proves that the recovered service can serve the real workflow.

The first mistake usually happens at the boundary between a backup and a recovery. So before we talk about Azure SQL, Blob Storage, Front Door, or regions, we need that boundary to be very clear.

## Backup vs Recovery
<!-- section-summary: A backup gives the team a source to restore from, while recovery describes how the restored source becomes a working service. -->

**A backup** is a saved copy of data. In Azure, that copy might come from Azure SQL automated backups, an Azure Backup vault, a Blob version, Blob soft delete, a VM recovery point, or a replicated storage account. The backup answers one question: "What old state can we retrieve?"

**A restore** is the action of creating a usable target from that saved copy. Azure SQL Database point-in-time restore creates a new database from an earlier point inside the retention window. Blob soft delete can bring back a deleted blob during its retention period. Azure Backup can restore disks or virtual machines from a recovery point.

**Recovery** is the bigger workflow around that restore. The team has to connect the app to the restored database, make sure managed identities and Azure RBAC assignments still work, update Key Vault references if names changed, route traffic through Front Door or another entry point, run smoke tests, and record what happened. Recovery answers the practical question: "Can users complete the workflow again?"

Here is the DevPolaris checkout example. Azure SQL has automatic backups for `sqldb-devpolaris-orders-prod`, so the team can restore yesterday's 10:15 database state into `sqldb-devpolaris-orders-restore`. That gives them data, but the checkout app still points at the production database connection string. The recovery plan says how the app receives the restored endpoint, which environment runs the recovered checkout service, which managed identity has database access, and which tests prove that checkout, receipt creation, and order lookup all work.

The same idea applies to Blob Storage. Blob versioning may preserve the previous copy of `receipts/ord-88421.pdf` after a broken export job overwrites it. That protects the object history, but the support workflow still needs to pick the correct version, restore it, verify the file, and confirm that customers can download the receipt from the app.

This table keeps the words separated. It also gives the team a quick way to notice when someone has named a backup source but skipped the recovered service path.

| Term | Simple meaning | DevPolaris example |
|---|---|---|
| **Backup** | A saved copy or recovery point | Azure SQL automated backups for the orders database |
| **Restore** | A new target created from that saved copy | `sqldb-devpolaris-orders-restore` created from a point in time |
| **Recovery** | The full path back to a useful service | App config, identity, traffic routing, validation, and customer workflow checks |

A real recovery note should name the source and target together. This small YAML shape works well because it forces the team to write the missing pieces before an incident, and it gives reviewers concrete names to question during design review. The example uses the checkout workflow.

```yaml
workflow: checkout
source_of_truth: sqldb-devpolaris-orders-prod
restore_source: Azure SQL point-in-time restore
restore_target: sqldb-devpolaris-orders-restore
application_target: app-devpolaris-checkout-recovery
identity: mi-devpolaris-checkout-recovery
traffic_entry: Azure Front Door recovery origin
validation:
  - create a test order
  - generate a receipt PDF
  - read the order from the restored database
  - confirm production data remains untouched
```

That recovery note naturally leads to the next question. The team now knows what it can restore and what a working target looks like. The business still needs to say how fast that must happen and how much data can disappear during the gap.

## RTO
<!-- section-summary: RTO and RPO turn outage pain into measurable time and data-loss targets for each workflow. -->

**Recovery Time Objective**, usually shortened to **RTO**, means the longest acceptable time the workflow can stay unavailable after an incident. If checkout has an RTO of 30 minutes, the recovery process has to bring checkout back inside 30 minutes. That timer includes detection, decision making, restore work, app configuration, traffic movement, and validation.

**Recovery Point Objective**, usually shortened to **RPO**, means the largest acceptable amount of data loss measured in time. If checkout has an RPO of five minutes, the business accepts losing at most about five minutes of order data during a disaster recovery event. That target influences backup frequency, database replication, storage replication, and the amount of manual reconciliation the support team may need.

RTO and RPO belong to individual workflows instead of whole cloud accounts. The checkout path, receipt downloads, nightly exports, and search index can each have different targets because they hurt the business in different ways. A customer waiting to pay has a different impact from an analytics dashboard that can rebuild overnight.

| Workflow | RTO target | RPO target | Why the target fits |
|---|---:|---:|---|
| **Checkout API** | 30 minutes | 5 minutes | Customers and revenue stop when checkout fails to take orders. |
| **Receipt PDFs** | 2 hours | 15 minutes | Customers need receipts, but support can resend or regenerate some files. |
| **Nightly finance exports** | 24 hours | Rerun from source data | The job can run again after the database recovers. |
| **Product search index** | 8 hours | Rebuild from catalog | The index is derived data, so the catalog database matters more than the index files. |

Short targets cost money and operational attention. A five-minute RPO for orders may require Azure SQL active geo-replication or failover groups, application code that can handle failover, alerting that wakes the right people, and a tested way to point the app at the healthy writer. A 24-hour RTO for finance exports may only need durable source data and a documented rerun process.

The timer also exposes hidden dependencies. Checkout may recover its database in 20 minutes, but the service still misses a 30-minute RTO if Key Vault access fails, the recovery app has no managed identity role assignment, or Front Door still routes to the failed origin. That is why a recovery target must cover the whole user workflow instead of the data store alone.

Now the plan has a source, a target, and measurable objectives. The next step is choosing which Azure recovery features can actually meet those objectives for each kind of data.

## Recovery Points and Data Protection
<!-- section-summary: Azure SQL, Blob Storage, and VM workloads each create recovery points differently, so each data shape needs its own protection choice. -->

**A recovery point** is a specific moment that the team can restore to. For databases, this often means a time inside a backup retention window. For Blob Storage, it might mean a previous blob version, a soft-deleted blob, or a point-in-time restore range for block blobs. For virtual machines, it might mean a VM backup recovery point with a certain consistency level.

The checkout database uses Azure SQL Database, so the most important feature is **point-in-time restore**, often called **PITR**. Azure SQL Database automatically takes full, differential, and transaction log backups so a database can be restored to a point in time inside its configured short-term retention period. New databases commonly start with seven days of PITR retention, and teams can configure retention according to service limits and business needs.

PITR creates a new database. That detail matters during an incident because a restored database has its own name, compute size, firewall rules, permissions, and connection path. If the team wants to recover from a bad data import, it may compare the restored database with production and copy selected rows back. If the team wants to replace the broken database, it has to move the application to the restored database and then validate the whole checkout path.

Blob Storage protects a different shape of data. Receipt PDFs, export files, customer uploads, and generated reports usually need **Blob soft delete**, **container soft delete**, and **Blob versioning**. Soft delete keeps deleted objects recoverable for a retention period. Versioning keeps earlier versions when a blob changes. Container soft delete protects against a deleted container, while blob soft delete and versioning protect individual blobs and versions.

Those features also affect cost and cleanup. Versioning creates extra stored objects when files change, so a team should separate critical receipt containers from temporary scratch containers. The DevPolaris receipt container may need versioning and a 30-day retention period, while a short-lived image-processing scratch container may use a cheaper cleanup policy because the source files can be regenerated.

VM workloads add one more concept: **backup consistency**. Azure Backup can create application-consistent, file-system-consistent, or crash-consistent recovery points depending on the workload and configuration. A line-of-business VM with a database process needs application-aware backup behavior or a database-native backup plan. A stateless web VM can usually recover from a simpler disk restore because its important state lives elsewhere.

Here is how the DevPolaris recovery map looks after the team separates the data shapes. Each row has a different recovery source because each row stores a different kind of state. The validation column keeps the plan connected to a working user or operator action.

| Data shape | Azure protection | Recovery target | Validation |
|---|---|---|---|
| **Orders database** | Azure SQL PITR, plus geo-replication for regional events | New Azure SQL database or failover group primary | Create order, read order, confirm payment record |
| **Receipt PDFs** | Blob versioning, blob soft delete, container soft delete | Restored blob version in the receipts container | Open PDF through the app and compare metadata |
| **Exports** | Rebuild from orders database and retained job config | New export file in Blob Storage | Finance row counts and checksum checks |
| **Legacy VM batch worker** | Azure Backup recovery point with expected consistency | Restored VM or restored disk in an isolated network | Worker starts, reads queue, writes test output |

The data protection choices tell us how old the recovered data may be. They still leave a physical placement question. A copy inside one region helps with many failures, but regional disaster planning needs us to understand where Azure places redundant copies.

## Redundancy in Azure Storage
<!-- section-summary: Redundancy controls where Azure places physical copies, while backup and versioning control which older state the team can recover. -->

**Redundancy** is Azure's replica placement choice for a storage account. It controls how Azure stores multiple physical copies of the current data. Redundancy helps the storage account survive hardware, datacenter, zone, or regional failures depending on the option the team selects.

**Locally redundant storage**, or **LRS**, keeps multiple synchronous copies in a single primary-region location. It gives a low-cost durability baseline for many workloads. The DevPolaris nightly export container might use LRS if the export can be regenerated from the orders database and the business can wait for the next run.

**Zone-redundant storage**, or **ZRS**, keeps synchronous copies across multiple availability zones in one region. This helps when a zone has a problem and the application still operates in the same region. Receipt PDFs may use ZRS if the app needs strong regional availability and the business wants files to survive a zone-level failure without a regional failover process.

**Geo-redundant storage**, or **GRS**, copies data to a secondary region after Azure commits the write in the primary region. The cross-region copy happens asynchronously, so a severe primary-region failure can leave the secondary region behind the latest writes. **Geo-zone-redundant storage**, or **GZRS**, combines ZRS in the primary region with asynchronous replication to a secondary region.

The read-access variants, **RA-GRS** and **RA-GZRS**, allow reads from the secondary endpoint before an account failover. That can help reporting, inspection, or limited degraded-mode workflows. Write access still belongs to the primary endpoint until failover changes the account's primary region.

Redundancy and data protection solve different problems. If a script deletes a receipt PDF, a redundant storage account faithfully replicates the current state of the account, including the deletion. Blob versioning and soft delete give the team an older state to recover. Redundancy protects physical availability and durability. Versioning, soft delete, PITR, and backups protect history.

This distinction matters during design reviews. The team may choose GZRS for the receipt storage account because customers need receipts during a regional event. The same team still enables blob versioning and soft delete because accidental deletion and overwrite need recoverable history. The plan uses both because physical failure and human mistake are different incident shapes.

Once the team chooses recovery points and replica placement, the last design question becomes the readiness level of the secondary environment. That is where recovery strategies come in.

## Recovery Strategies
<!-- section-summary: A recovery strategy defines how much of the secondary environment already exists before an incident starts. -->

**A recovery strategy** describes how ready the backup environment is before something goes wrong. A low-cost strategy keeps data copies and creates compute during recovery. A higher-cost strategy keeps more of the app running in another region so failover takes less time. The right strategy comes from the workflow's RTO, RPO, business value, and operational maturity.

**Backup and restore** has the lowest steady cost. The team stores backups, templates, and runbooks, then creates the recovery environment during an incident. For DevPolaris finance exports, this works well because the job can rerun after the orders database recovers. The RTO may be hours, and that is acceptable for a batch workflow with a clear owner.

**Pilot light** keeps a tiny but important core ready in the recovery region. The data layer may replicate continuously, and the network, Key Vault, managed identities, and deployment templates already exist. App compute stays stopped, scaled to zero, or very small. For the checkout service, pilot light might mean an Azure SQL failover group in a paired region, a recovery App Service plan ready to scale, and Front Door configured with a secondary origin that becomes useful after deployment and validation.

**Warm standby** keeps a smaller working version of the app running in the secondary region. The recovery region already has app instances, configuration, identity assignments, secrets, and database replication. During failover, Front Door can shift traffic toward the healthy origin and the platform can scale the standby up. This costs more than pilot light, but it removes many steps from the incident timeline.

**Active-active** runs full production capacity in more than one region at the same time. Azure Front Door can route users to healthy origins based on priority, latency, or weights, and health probes help decide which origins should receive traffic. The data layer becomes the hardest part because writes from multiple regions need a consistency and conflict plan. Active-active can fit read-heavy global workloads, but checkout systems often need careful database design before they can safely accept writes in multiple regions.

Azure SQL failover groups are useful in the pilot-light and warm-standby parts of that ladder. A failover group can replicate databases to another region and provide stable listener endpoints, so the application connection string can stay pointed at the listener while the primary database role changes. The app team still needs to test login permissions, firewall paths, DNS behavior, retry logic, and the rest of the workflow.

Azure Site Recovery belongs to another common case: VM-based recovery. It can replicate virtual machines and provide test failover workflows so teams can validate recovery without disrupting production. That helps lift-and-shift systems, but the same recovery questions still apply: which network receives the VM, which dependencies come with it, which users can reach it, and which smoke tests prove that the service works?

The DevPolaris team can now make different choices for different workflows. The expensive recovery shape goes to checkout, while the slower and cheaper shapes stay with rebuildable or lower-urgency work. The table keeps those tradeoffs visible.

| Workflow | Strategy | Azure pieces |
|---|---|---|
| **Checkout API** | Warm standby | Azure SQL failover group, secondary app environment, Key Vault, managed identity, Front Door priority routing |
| **Receipt downloads** | Pilot light | GZRS or RA-GZRS storage, versioning, soft delete, recovery app path ready to deploy |
| **Nightly exports** | Backup and restore | LRS storage for outputs, job definition in source control, orders database as source of truth |
| **Product search** | Backup and restore | Rebuild index from catalog database and deployment pipeline |

The team still needs proof after choosing the strategy. A recovery plan becomes trustworthy only when the team runs the steps, measures the time, and checks the recovered app like a user would.

## Restore Drills
<!-- section-summary: Restore drills turn written recovery plans into evidence by measuring the real recovery workflow in a safe target. -->

**A restore drill** is a planned exercise that proves the team can recover a workflow without waiting for a real disaster. The drill uses a safe target such as an isolated resource group, test database name, non-production virtual network, or recovery app slot. The goal is evidence: actual recovery time, actual recovered data age, missing permissions, broken configuration, and validation results.

For the checkout service, a useful drill starts with a clear scenario. The team may simulate a bad data import that corrupts recent order rows. They restore Azure SQL to a new database from a point before the import, deploy the checkout app into an isolated recovery environment, point that app at the restored database through Key Vault configuration, assign the managed identity to the restored target, and run a test order that never touches production.

The drill should measure both targets. The **actual RTO** starts when the team declares the scenario and ends when the recovered checkout workflow passes validation. The **actual RPO** comes from the age of the restored data compared with the incident time. If the target says 30-minute RTO and five-minute RPO, the drill record should show whether the team met those targets and where the time went.

A good drill record includes operational details beyond a success checkbox. It names the restored database, the recovery app, the Key Vault secrets used, the Front Door origin or test host, the identity assignments, the smoke tests, the data gap, the cleanup action, and the follow-up work. Those details turn the next drill into a shorter and calmer exercise.

Here is a compact drill record for the checkout scenario. It shows the kind of evidence that helps the team improve the next drill instead of relying on memory. The gaps matter as much as the pass results.

```yaml
drill: checkout-sql-pitr
scenario: bad order import
declared_at: 10:00Z
restore_point: 09:55Z
restored_database: sqldb-devpolaris-orders-restore
recovery_app: app-devpolaris-checkout-recovery
actual_rpo: 5 minutes
actual_rto: 27 minutes
validation:
  checkout: passed
  receipt_generation: passed
  order_lookup: passed
  production_isolation: passed
gaps_found:
  - recovery managed identity lacked database user mapping
  - receipt container role assignment had to be added manually
```

Those two gaps are exactly why drills matter. The backup existed, and the database restored, but identity and storage access almost delayed the workflow beyond the target. After the drill, the team can add those role assignments to the recovery template and prove the fix in the next exercise.

Site Recovery drills follow the same idea for VM-based systems. Azure Site Recovery test failover creates a copy of replicated VMs for validation without disrupting ongoing replication or production. The team still has to choose a recovery point, place the VM in a safe network, check boot and application health, and clean up the test resources when the drill ends.

Recovery planning now has all the pieces: backup sources, restored targets, RTO, RPO, data protection, redundancy, strategy, and evidence. The final step is putting them into one operating checklist that a team can use during design and incident review.

## Putting It All Together
<!-- section-summary: A complete Azure recovery plan gives each workflow a source, target, objective, strategy, validation path, and owner. -->

A strong Azure recovery plan starts from the user workflow, then works backward through the systems that make that workflow useful. For DevPolaris checkout, the workflow needs the app, Azure SQL, Blob receipts, Key Vault, managed identity, Front Door, monitoring, and a person who can declare failover. Each dependency gets a recovery source, a recovery target, and a validation check.

The plan also avoids one-size-fits-all recovery. Checkout receives a warm standby because customer orders and revenue need a short RTO and RPO. Receipt downloads receive stronger Blob data protection and a lighter regional plan because the workflow can tolerate a little more delay. Finance exports use rerun logic because the database remains the source of truth. Search rebuilds from catalog data because the index is derived state.

Here is the final recovery map. It ties each user-facing workflow to the Azure feature, target, objective, strategy, and evidence that make recovery measurable. This is the kind of table that can live beside the service runbook.

| Workflow | Source | Target | Objective | Strategy | Evidence |
|---|---|---|---|---|---|
| **Checkout** | Azure SQL PITR and failover group replication | Secondary app and database writer | 30-minute RTO, 5-minute RPO | Warm standby | Test order, receipt, order lookup, Front Door route |
| **Receipts** | Blob versioning, soft delete, geo-redundant copies | Restored blob or secondary storage path | 2-hour RTO, 15-minute RPO | Pilot light | Customer download and metadata check |
| **Exports** | Orders database and job definition | New export file | 24-hour RTO, rerunnable RPO | Backup and restore | Row count and checksum |
| **Search** | Product catalog database | Rebuilt index | 8-hour RTO, rebuildable RPO | Backup and restore | Search smoke query and catalog count |

The main lesson is practical. Azure backups and redundancy provide raw materials, and the recovery plan turns those materials into a working service. RTO and RPO tell the team what "working soon enough" means. Restore drills show whether the plan survives real configuration, identity, traffic, and validation details.

When a team can point to the last successful drill and explain the actual RTO, actual RPO, restored target, and gaps fixed afterward, recovery planning stops being a hopeful document. It becomes an operating habit that protects customers, data, and the engineers who have to respond under pressure.

---

**References**

- [Architecture strategies for disaster recovery](https://learn.microsoft.com/en-us/azure/well-architected/reliability/disaster-recovery) - Defines Azure disaster recovery terms, RTO, RPO, drills, failover, failback, and recovery-aware architecture principles.
- [Develop a disaster recovery plan for multi-region deployments](https://learn.microsoft.com/en-us/azure/well-architected/design-guides/disaster-recovery) - Explains how RTO and RPO drive multi-region recovery planning and validation.
- [Azure Storage redundancy](https://learn.microsoft.com/en-us/azure/storage/common/storage-redundancy) - Documents LRS, ZRS, GRS, GZRS, read-access variants, asynchronous geo-replication, and storage account failover behavior.
- [Azure SQL Database automated backups](https://learn.microsoft.com/en-us/azure/azure-sql/database/automated-backups-overview?view=azuresql) - Describes automatic full, differential, and log backups plus short-term and long-term retention.
- [Restore a database from a backup in Azure SQL Database](https://learn.microsoft.com/en-us/azure/azure-sql/database/recovery-using-backups?view=azuresql) - Explains point-in-time restore, restored database behavior, geo-restore, and restore considerations.
- [Data protection overview for Azure Blob Storage](https://learn.microsoft.com/en-us/azure/storage/blobs/data-protection-overview) - Covers blob versioning, blob soft delete, container soft delete, and point-in-time restore for block blobs.
- [Failover groups overview and best practices for Azure SQL Database](https://learn.microsoft.com/en-us/azure/azure-sql/database/failover-group-sql-db?view=azuresql) - Explains failover group replication, listener endpoints, failover policies, and end-to-end application recovery considerations.
- [Azure Front Door traffic routing methods](https://learn.microsoft.com/en-us/azure/frontdoor/routing-methods) - Documents priority-based failover routing, health probes, latency routing, and weighted routing behavior.
- [About Azure VM backup](https://learn.microsoft.com/en-us/azure/backup/backup-azure-vms-introduction) - Describes Azure VM backup flow and application-consistent, file-system-consistent, and crash-consistent recovery points.
- [About failover and failback in Azure Site Recovery](https://learn.microsoft.com/en-us/azure/site-recovery/failover-failback-overview-modernized) - Describes test failover, planned failover, unplanned failover, recovery points, and drill validation for VM recovery.
