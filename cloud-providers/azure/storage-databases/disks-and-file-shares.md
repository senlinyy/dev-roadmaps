---
title: "Disks and File Shares"
description: "Choose Managed Disks, Azure Files, Blob Storage, or temporary runtime storage by looking at the operating-system contract the workload expects."
overview: "This article follows a legacy orders worker through Azure Managed Disks, Azure Files, temporary storage, disk performance, host caching, shared disks, file protocols, snapshots, and migration planning."
tags: ["azure", "managed-disks", "azure-files", "vm", "file-shares"]
order: 5
id: article-cloud-providers-azure-storage-databases-disks-file-shares
aliases:
  - azure-managed-disks-and-file-shares
  - cloud-providers/azure/storage-databases/azure-managed-disks-and-file-shares.md
---

## Table of Contents

1. [What Disks and File Shares Are For](#what-disks-and-file-shares-are-for)
2. [Start With the Storage Contract](#start-with-the-storage-contract)
3. [Managed Disks](#managed-disks)
4. [Temporary Runtime Storage](#temporary-runtime-storage)
5. [Disk Performance](#disk-performance)
6. [Host Caching](#host-caching)
7. [Shared Disks](#shared-disks)
8. [Azure Files](#azure-files)
9. [Protocols, Identity, and Network Paths](#protocols-identity-and-network-paths)
10. [Snapshots and Migration Evidence](#snapshots-and-migration-evidence)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## What Disks and File Shares Are For
<!-- section-summary: Managed Disks and Azure Files solve operating-system storage needs, while Blob Storage and databases solve different data shapes. -->

Azure has several storage services because applications ask for data in different ways. A receipt PDF may only need an object name and a download link. An order ledger may need relational tables and transactions. A retry token may need one NoSQL item with TTL. A legacy worker may need a path like `/var/lib/orders` or `\\legacy\templates` because the software calls normal filesystem functions.

That last group is the world of **Managed Disks** and **Azure Files**. A **Managed Disk** is Azure-managed block storage attached to a virtual machine. The VM operating system sees it as a disk, formats it, mounts it, and reads or writes blocks. **Azure Files** is a managed file share service. It gives clients a mounted folder through file sharing protocols such as SMB or NFS.

Let's keep one concrete production story through the article. The Orders team runs a newer `orders-api` that stores receipt PDFs in Blob Storage, order facts in Azure SQL Database, and idempotency records in Cosmos DB. They also still have a legacy invoice worker named `vm-devpolaris-orders-legacy-01`. That worker has a managed data disk named `disk-orders-legacy-data-01`, and during migration it still reads templates from an Azure Files share named `legacy-orders-share` in storage account `stdevpolarisordersprod`.

This setup sounds messy because real migrations are messy. One part of the system is modern and service-oriented. Another part expects a VM disk and a shared folder. The useful habit is to name the storage contract before choosing a service.

## Start With the Storage Contract
<!-- section-summary: The storage contract is the way code expects to access data, and it usually decides the first Azure service to review. -->

A **storage contract** is the way the workload expects to read and write data. Application code may call a storage API, send SQL queries, look up one document by key, mount a shared folder, or write to a local disk path. The contract matters because a service can be excellent for one access shape and awkward for another.

The new invoice path is simple. The API generates a PDF, uploads it to Blob Storage, stores the blob name in Azure SQL Database, and gives the customer a controlled download path. Blob Storage fits because the PDF is object-shaped data. The app wants durable bytes by name, metadata, lifecycle rules, and secure download access.

The legacy worker has a different contract. It was written years ago and expects a local folder for working data plus a shared folder for templates. Rewriting the app to use Blob Storage may be the long-term goal, but today's release still needs mounted paths. That is where Managed Disks and Azure Files enter the conversation.

Here is the first review table:

| Workload need | First Azure service to review | Reason |
| --- | --- | --- |
| Customer receipt PDF | Blob Storage | The app stores and retrieves durable bytes by object name |
| Order ledger | Azure SQL Database | The data needs tables, constraints, joins, and transactions |
| Checkout retry token | Cosmos DB | The app reads one small item by key and expires it later |
| VM data path at `/var/lib/orders` | Managed Disk | The operating system expects a block device attached to the VM |
| Shared templates at `/mnt/legacy-orders` | Azure Files | More than one worker may need the same mounted folder |
| Build cache or image conversion scratch space | Temporary runtime storage | The data can disappear after the job retries |

![Infographic showing six storage contracts mapped to Azure services: object by name to Blob Storage, tables and joins to Azure SQL, one item by key to Cosmos DB, VM disk path to Managed Disk, shared folder to Azure Files, and retryable scratch to temporary storage](/content-assets/articles/article-cloud-providers-azure-storage-databases-disks-file-shares/storage-contract-chooser.png)

*Use the storage contract first: the way code asks for data usually points to the first Azure service worth reviewing.*

This table is the bridge for the rest of the article. First we will talk about the VM data disk, because the old worker needs one durable disk attached to one VM. Then we will talk about temporary storage, because many incidents come from confusing scratch space with durable storage. After that, performance and caching show up because a disk can be attached and still be too slow or configured unsafely. Finally, Azure Files handles the shared-folder part of the migration.

## Managed Disks
<!-- section-summary: Managed Disks are Azure-managed block volumes for VMs, and they fit workloads that expect an attached disk device. -->

A **Managed Disk** is block-level storage managed by Azure and used with Azure Virtual Machines. Think about a Linux VM with a disk mounted at `/var/lib/orders`. The operating system owns the filesystem. The application opens files, writes logs, syncs data, and expects the path to behave like a normal disk path.

In our migration, `disk-orders-legacy-data-01` is a 128 GiB Premium managed disk attached to `vm-devpolaris-orders-legacy-01`. The old invoice worker writes local state there while the team moves generated invoice files to Blob Storage. The disk exists as an Azure resource, and the VM sees it as an attached data disk.

The important word is **attached**. A normal data disk belongs to a VM at runtime. It is a good fit for a single VM's application state, database files for a self-managed database, vendor software that demands a local data path, or a boot/data volume. It is a poor shortcut for a shared folder across ordinary workers because several machines writing the same block filesystem need special coordination.

Azure manages the storage service behind the disk. The team chooses disk type, size, region, redundancy option where supported, encryption settings, and attachment. Microsoft currently describes five managed disk types: **Ultra Disk**, **Premium SSD v2**, **Premium SSD**, **Standard SSD**, and **Standard HDD**. The names describe performance and cost shape rather than maturity. A small legacy worker may be fine on Premium SSD. A very busy database VM may need Premium SSD v2 or Ultra Disk review.

This is the kind of evidence an engineer might collect during a migration review:

```bash
az disk show \
  --name disk-orders-legacy-data-01 \
  --resource-group rg-devpolaris-data-prod \
  --query "{name:name,size:diskSizeGB,sku:sku.name,attachedTo:managedBy,encryption:encryption.type}" \
  --output table
```

That output answers practical questions. Which disk exists? How large is it? Which SKU pays for its performance envelope? Which VM owns it right now? What encryption setting protects it? These are boring questions in the best way. They turn "there is a disk somewhere" into a resource the team can operate.

## Temporary Runtime Storage
<!-- section-summary: Temporary runtime storage is scratch space for retryable work, so durable application data needs another home. -->

**Temporary storage** is local scratch space that can disappear when a VM, container, app instance, or host changes. On Azure VMs, some sizes include local temporary disks, sometimes called resource disks. Microsoft documents these temporary disks as separate from Managed Disks and outside the persistent storage path. On app platforms and containers, local paths such as `/tmp` or an instance filesystem usually have the same warning sign: useful for scratch work, risky for durable customer data.

Imagine the invoice worker writes generated files to `/tmp/invoices`. It works during a quiet test. Then the worker restarts, another replica serves the next request, or the host gets replaced. Support looks for the invoice and finds an empty folder. Increasing memory or disk size only makes the temporary folder larger. It still has the wrong durability contract.

Scratch space has good uses. Image conversion can write intermediate frames to local temporary storage because the job can retry from the original upload in Blob Storage. A build can unpack dependencies there because the pipeline can run again. A database may use a temp path for temporary query work when the engine supports that design. The key question is the consequence of loss.

For generated invoices, the durable path should usually be Blob Storage plus metadata in the database. The worker can create the PDF, upload it to Blob Storage, write the blob name to Azure SQL Database, and then delete any local temporary copy. That pattern survives restarts because the durable copy lives outside the runtime instance.

Here is the review table I like for temporary storage:

| Data written locally | Loss consequence | Better durable home |
| --- | --- | --- |
| PDF invoice before upload finishes | Job retries from order data | Blob Storage after generation succeeds |
| Customer's only invoice copy | Customer or support loses data | Blob Storage with database metadata |
| Image conversion scratch file | Worker repeats conversion | Temporary runtime storage |
| Legacy app configuration | VM fails to start correctly | Managed Disk, image configuration, or deployment-managed config |
| Shared report template | Several workers need same file | Azure Files during migration, then Blob Storage or packaged config if possible |

Temporary storage is useful because it is close to the runtime and fast for scratch work. Durable storage is useful because it survives beyond one runtime instance. Mixing those two ideas is how teams end up with files that vanish right after the demo.

## Disk Performance
<!-- section-summary: Disk performance comes from both the disk and the VM size, so a faster disk alone may leave the workload capped. -->

**Disk performance** means the amount of read and write work the storage path can complete. The common measurements are **IOPS**, which means input/output operations per second, **throughput**, which means bytes per second, and **latency**, which means how long each operation waits before it completes.

The disk has its own limits, and the VM size has its own limits. That combination matters. If `disk-orders-legacy-data-01` can provide more IOPS than `vm-devpolaris-orders-legacy-01` can submit, the VM remains the cap. If the VM is large but the disk tier is small, the disk remains the cap. Performance troubleshooting needs both sides of the attachment.

The legacy worker gives us a normal production story. Month-end invoice generation starts taking 45 minutes instead of 12. The team sees high disk latency. A quick fix might be "buy a bigger disk," but the useful review asks more precise questions:

| Question | What it tells the team |
| --- | --- |
| Which disk type and size are attached? | The configured disk performance envelope |
| Which VM size runs the workload? | The VM-level IOPS and throughput ceiling |
| What is the read/write mix? | Whether the job is random I/O, sequential export, or metadata-heavy |
| Is queue depth rising? | Whether I/O requests wait faster than storage completes them |
| Did the workload change? | Whether the same disk now handles more files, larger files, or new reports |

Premium SSD v2 and Ultra Disk let teams configure capacity, IOPS, and throughput more independently than older size-tied disk choices. That flexibility helps I/O-heavy workloads, but it also adds a design responsibility. The team should size the disk from measurements instead of guesswork. Azure Monitor metrics, application logs, and job timing give better evidence than a generic "premium" label.

The file share side has its own performance story too. Azure Files performance depends on share type, provisioned size or provisioned performance model, protocol, client behavior, network path, caching, and workload shape. A share that works for a few templates may become a bottleneck if someone turns it into a hot report output folder for hundreds of workers.

## Host Caching
<!-- section-summary: Host caching can improve selected disk reads, but write-sensitive data needs settings that match durability expectations. -->

**Host caching** is a caching setting on Azure VM disks. It places a cache on the VM host in front of the storage path for certain read or write patterns. Caching can reduce latency for repeated reads, but the setting has to match the data type and the application's write-safety needs.

For the old worker, a read-heavy catalog of reference files may benefit from ReadOnly caching. The same few files get read again and again, and the app can tolerate the normal managed disk write path for updates. That is a very different file type from a transaction log or database write-ahead log, where the application needs a strict durability path before it treats a write as committed.

The usual choices look like this:

| Cache setting | Plain meaning | Common fit |
| --- | --- | --- |
| None | Reads and writes go through without host cache | Transaction logs and write-sensitive data |
| ReadOnly | Repeated reads may come from cache while writes stay on the storage path | Reference files, static app data, read-heavy datasets |
| ReadWrite | Reads and writes can use host cache | Scratch workloads or carefully reviewed app patterns |

The risk comes from guessing. A vendor may say "put our data on a disk" and leave out whether that data is a cache, a queue, a database file, or a log. The storage review needs to ask what the file means to the application. If losing or reordering a write corrupts the app state, the cache setting deserves a careful review.

Host caching also connects back to temporary storage. Some data is scratch data and can use local paths or aggressive caching. Some data is business data and needs durable writes, backups, and restore tests. The file path alone hides that difference, so the workload owner has to name what the file means.

## Shared Disks
<!-- section-summary: Shared disks are for cluster-aware applications, while normal shared folders usually belong on Azure Files. -->

A **shared disk** is a managed disk configured so more than one VM can attach to it. That sounds like the answer to every shared-folder request, but the important word is **cluster-aware**. Shared disks are designed for applications that understand shared block storage, such as failover clusters and clustered databases.

Block storage gives several machines access to raw blocks. Cluster software supplies the coordination for normal file writes, failover, ownership, and consistency. If two ordinary VMs mount and write the same filesystem at the same time without that cluster layer, they can damage the filesystem or application data.

The migration team might ask, "Can we attach `disk-orders-legacy-data-01` to every worker so they all see the same folder?" That request is a good moment to pause. If the workers only need shared templates or shared exports, Azure Files is usually the better first service to review. It provides a managed file share with file protocol semantics, access controls, snapshots, and a folder path the clients can mount.

Shared disks still matter. A Windows Server Failover Cluster, a clustered database, or another application with documented support for shared block devices may need them. In those cases, the design includes disk type support, `maxShares`, cluster software, fencing behavior, backup behavior, and a tested failover runbook. That is a specialized design rather than a general replacement for Azure Files.

Now the article can move naturally from "one VM has a disk" and "clustered block storage is special" to "several clients need a mounted folder." That mounted-folder shape is Azure Files.

## Azure Files
<!-- section-summary: Azure Files provides managed SMB or NFS file shares for workloads that need a shared mounted directory. -->

**Azure Files** is Azure's managed file share service. A file share gives clients a folder-like path through standard protocols. Windows workloads often use **SMB**, which means Server Message Block. Linux and Unix-style workloads may use **NFS**, which means Network File System. Microsoft documents Azure Files support for both SMB and NFS, with protocol choice depending on the workload and share type.

The legacy orders migration uses a share named `legacy-orders-share` in storage account `stdevpolarisordersprod`. The share has a quota, an enabled protocol, a performance tier, and snapshots. Those details matter because a shared folder is more than a string in an app config file. It is a storage resource with capacity, access, performance, and recovery behavior.

Here is the kind of evidence an engineer may collect:

```bash
az storage share-rm show \
  --name legacy-orders-share \
  --storage-account stdevpolarisordersprod \
  --resource-group rg-devpolaris-storage-prod \
  --query "{name:name,quota:shareQuota,protocol:enabledProtocols,tier:accessTier,snapshotCount:length(snapshots)}" \
  --output table
```

Azure Files is a good migration tool when old software needs a shared folder while the team moves to a cleaner object-storage design. The worker can keep reading templates from `/mnt/legacy-orders` during the two-month migration, while new generated invoices already go to Blob Storage. That lets the team reduce risk without pretending the legacy app became cloud-native overnight.

![Infographic showing a legacy VM with an attached managed disk, an Azure Files share for shared templates, Blob Storage for new durable PDF invoices, and a reminder that temporary storage is retryable scratch only](/content-assets/articles/article-cloud-providers-azure-storage-databases-disks-file-shares/legacy-storage-migration-map.png)

*A migration can keep the old disk and shared folder alive while the durable file path moves toward Blob Storage.*

Azure Files can also be a long-term fit. Team shares, lift-and-shift app folders, shared configuration, and some application data paths can all belong there. The decision depends on protocol support, performance needs, identity model, network path, backup requirements, and how many clients use the share at once.

The warning sign is using Azure Files as a quiet dumping ground. If the application can ask Blob Storage for `receipts/2026/06/order-74291.pdf`, Blob Storage usually gives a cleaner service contract. If the application needs a mounted folder because the software literally calls filesystem APIs, Azure Files earns its place.

## Protocols, Identity, and Network Paths
<!-- section-summary: A file share design includes the protocol, who can mount it, and which network path clients use. -->

A **file protocol** defines how clients talk to a file share. SMB carries Windows-style file sharing behavior, permissions, locking, and integration with Active Directory style identities. NFS is common for Linux and Unix-style systems and has its own permission and mount behavior. Azure Files supports both protocol families, but one individual Azure file share is created for the protocol shape it uses.

Protocol choice should follow the clients. A Windows service using NTFS-style access controls and domain identities usually points toward SMB. A Linux workload with NFS tooling and private network access may point toward NFS. A mixed estate may need separate shares or a migration plan that names which clients use which protocol.

Identity is the next layer. **Identity** means who or what is allowed to mount the share and read or write files. The fastest test mount often uses a **storage account key**, which is a secret key for the storage account. That key is powerful because it can grant broad access across the account, so it should be treated like a high-value secret rather than pasted into every script.

Production file shares usually need a narrower identity plan. **Data-plane permissions** are permissions for the data itself: listing directories, reading files, writing files, or deleting files. They are different from control-plane permissions such as creating the storage account or changing its network settings. For example, the legacy invoice worker may need permission to read templates from `legacy-orders-share`, while the migration engineer may need a separate role to create snapshots or change the share quota.

SMB shares can integrate with directory-style identity. **Active Directory Domain Services** is the traditional Windows directory many companies use for users, groups, and file permissions. **Microsoft Entra Kerberos** is an Azure identity option that can help SMB clients use Entra-based authentication in supported scenarios. The beginner point is simple: the mount should use an identity model the clients understand, and the permission should match the job. A template reader, a template publisher, and a storage administrator need separate access instead of one shared broad secret.

Network path matters too. A **private endpoint** gives the storage account a private IP address inside a virtual network, so approved clients can reach the share over a private path. **DNS** is the naming system that turns a storage account name into an IP address. If DNS still sends the client to the public endpoint, the private endpoint design will feel broken even when the private endpoint exists. **Routing** is the network path packets follow from the VM or client to that private address. For `vm-devpolaris-orders-legacy-01`, the release review should confirm the VM resolves the storage account name correctly and reaches it through the intended private network path.

The storage account boundary owns important settings such as public access posture, private endpoints, firewall rules, encryption, and share configuration. A file share design therefore needs both sides: the application mount path and the Azure resource boundary that controls access to that path.

Here is a practical release record for `legacy-orders-share`:

| Detail | Example value | Why the reviewer cares |
| --- | --- | --- |
| Storage account | `stdevpolarisordersprod` | Names the account boundary and network settings |
| Share name | `legacy-orders-share` | Names the exact mounted folder resource |
| Protocol | `SMB` | Tells the team which clients and auth patterns apply |
| Quota | `128` GiB | Sets an early capacity guardrail |
| Access tier | `TransactionOptimized` | Gives the cost and workload shape |
| Consumers | `vm-devpolaris-orders-legacy-01` and migration workers | Shows who still depends on the share |
| Exit plan | Stop writes after invoice Blob path rollout | Prevents the temporary migration path from becoming permanent |

This table connects operations to application behavior. A share without consumers, permissions, network path, and exit plan is just another place for unowned files to collect.

## Snapshots and Migration Evidence
<!-- section-summary: Snapshots and backup evidence make a legacy disk or share safer to carry through one more release. -->

A **snapshot** is a point-in-time copy of a storage resource. Managed disks support snapshots. Azure Files supports share snapshots for SMB and NFS file shares. Snapshots help when an app deployment, script, or operator mistake damages files and the team needs an earlier copy.

For `legacy-orders-share`, a snapshot before the migration release gives the team a recovery point for templates and shared files. If the new worker overwrites `invoice-template-v3.docx`, the team can inspect the snapshot and restore the older file. Microsoft documents Azure Files share snapshots as read-only point-in-time copies, and Azure Backup can schedule and retain snapshots for Azure file shares.

For `disk-orders-legacy-data-01`, a disk snapshot before a risky VM change can help create a recovery disk. The team still has to respect application consistency. A disk snapshot of a running app may capture a crash-consistent state. Some workloads need the app to flush writes, stop briefly, or use an application-aware backup path before the snapshot becomes a useful recovery point.

The migration evidence should name both sides:

| Resource | Evidence to collect | Reason |
| --- | --- | --- |
| Managed disk | Disk name, size, SKU, attachment target, encryption, latest snapshot or backup status | Shows the VM data path has an owner and recovery signal |
| Azure Files share | Share name, storage account, quota, protocol, tier, snapshot or backup evidence | Shows the shared folder can survive one more release |
| Blob Storage destination | Container, prefix, lifecycle, access path, metadata owner | Shows the future durable file path is ready |
| Application release | Which workers still write to the share and when they stop | Prevents old and new paths from fighting |

This is where the next article starts to come into view. Disks and file shares answer the operating-system storage contract. Backups and retention answer how old copies survive and how the team restores them. Both questions belong in the same production review, but they are separate concepts.

## Putting It All Together
<!-- section-summary: The right Azure storage choice follows the workload's access path, durability need, sharing need, and recovery signal. -->

The Orders migration now has a clean story. The main application stores durable receipt PDFs in Blob Storage and business facts in Azure SQL Database. Cosmos DB keeps short-lived key-based operational records. The legacy VM still uses `disk-orders-legacy-data-01` because that worker expects a local data disk. The migration keeps `legacy-orders-share` because several workers still need a mounted template folder for a short period.

Managed Disks fit the VM-bound block storage path. Temporary runtime storage fits scratch work that can be recreated. Disk performance review checks both the disk and the VM size. Host caching follows the file type and write-safety need. Shared disks belong to cluster-aware designs. Azure Files fits shared mounted folders through SMB or NFS. Snapshots and backup evidence make the remaining legacy path safer while the team moves files toward better long-term homes.

The useful beginner habit is to ask four plain questions before choosing a service:

| Question | What it decides |
| --- | --- |
| How does the code access the data? | Object API, SQL query, document lookup, disk path, or mounted share |
| What happens if the runtime disappears? | Temporary scratch path or durable external storage |
| How many machines need the same data at once? | One attached disk, a shared file service, or a different app design |
| What recovery evidence exists? | Snapshot, backup policy, Blob protection, database restore, or migration rollback |

When those answers are clear, the team can choose the service by contract instead of guessing. A disk is for a VM disk contract. A file share is for a shared folder contract. Blob Storage is for object-shaped bytes. Databases are for records and queries. Temporary storage is for work the system can safely redo.

![Infographic summary board with four review questions for Azure storage decisions: how code accesses data, what survives a restart, how many machines share it, and what recovery evidence exists, surrounded by Managed Disk, Azure Files, Blob Storage, Database, and Temporary storage outcomes](/content-assets/articles/article-cloud-providers-azure-storage-databases-disks-file-shares/storage-review-board.png)

*The final review is simple: choose by contract, then verify the recovery evidence before the migration depends on it.*

## What's Next

Next we look at Backups and Retention, where the storage question changes from "where should this data live?" to "which previous copy exists, how long does it stay available, and how would the team restore it during a real incident?"

---

**References**

- [Introduction to Azure managed disks](https://learn.microsoft.com/en-us/azure/virtual-machines/managed-disks-overview) - Managed disk concepts, durability, disk types, and VM usage.
- [Azure managed disk types](https://learn.microsoft.com/en-us/azure/virtual-machines/disks-types) - Ultra Disk, Premium SSD v2, Premium SSD, Standard SSD, and Standard HDD choices.
- [Virtual machine and disk performance](https://learn.microsoft.com/en-us/azure/virtual-machines/disks-performance) - VM limits, disk limits, IOPS, throughput, and bottleneck diagnosis.
- [Format and mount temporary disks on Azure Linux VMs](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/disks-format-mount-temp-disks-linux) - Temporary disk behavior and persistence warnings.
- [Share an Azure managed disk across VMs](https://learn.microsoft.com/en-us/azure/virtual-machines/disks-shared) - Shared disk use cases, `maxShares`, and billing behavior.
- [SMB file shares in Azure Files](https://learn.microsoft.com/en-us/azure/storage/files/files-smb-protocol) - SMB scenarios, features, security, and protocol guidance.
- [NFS file shares in Azure Files](https://learn.microsoft.com/en-us/azure/storage/files/files-nfs-protocol) - NFS support and Linux-oriented file share guidance.
- [Plan for an Azure Files deployment](https://learn.microsoft.com/en-us/azure/storage/files/storage-files-planning) - Azure Files planning, soft delete, backup, and share snapshots.
- [Use Azure Files share snapshots](https://learn.microsoft.com/en-us/azure/storage/files/storage-snapshots-files) - SMB and NFS share snapshot behavior and recovery uses.
- [Understand Azure Files performance](https://learn.microsoft.com/en-us/azure/storage/files/understand-performance) - File share performance factors and workload tuning guidance.
