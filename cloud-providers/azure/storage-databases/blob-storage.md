---
title: "Blob Storage"
description: "Store generated files, uploads, exports, and logs in Azure Blob Storage by understanding accounts, containers, blob names, access, lifecycle, and recovery."
overview: "Blob Storage is Azure's object store for file-like bytes. This article teaches the account, container, blob, SAS, lifecycle, tiering, and versioning model without treating object storage like a database or a normal filesystem."
tags: ["azure", "blob-storage", "storage-account", "objects", "lifecycle"]
order: 2
id: article-cloud-providers-azure-storage-databases-storage-accounts-blob-storage
aliases:
  - storage-accounts-and-blob-storage
  - cloud-providers/azure/storage-databases/storage-accounts-and-blob-storage.md
---

## Table of Contents

1. [What Is Blob Storage](#what-is-blob-storage)
2. [Storage Account](#storage-account)
3. [Containers and Blobs](#containers-and-blobs)
4. [Names](#names)
5. [Access and SAS Tokens](#access-and-sas-tokens)
6. [Replication](#replication)
7. [Lifecycle](#lifecycle)
8. [Versioning and Soft Delete](#versioning-and-soft-delete)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## What Is Blob Storage

Blob Storage is Azure's managed object store for files that an application reads and writes as whole objects. A receipt PDF, profile photo, CSV export, database export file, support attachment, or log archive is usually object-shaped data. The app cares about the bytes as a named unit, not as rows that need joins or transactions.

The practical job of Blob Storage is to move those bytes out of compute. If an App Service instance writes `receipt-417.pdf` to its own local disk, that file belongs to that one instance. A scale-out instance will not see it. A recycle can remove it. A deployment can replace the filesystem. Blob Storage gives the file a durable service endpoint that survives compute replacement.

In a typical orders system, Azure SQL keeps the order facts and the blob name. Blob Storage keeps the receipt bytes. The browser can later download the receipt through a narrow, temporary access link. This split keeps large files out of the database and keeps the web app from proxying every download through its own memory and network path.

## Storage Account

A storage account is the outer Azure resource that owns the Blob Storage endpoint, region, redundancy choice, network rules, encryption settings, and billing boundary. It is the administrative container for storage services such as blobs, files, queues, and tables.

Example: `stordersreceiptsprod` can expose an endpoint such as `https://stordersreceiptsprod.blob.core.windows.net`. Inside it, a `receipts` container can hold blobs such as `2026/05/order-417.pdf`.

The account name must be globally unique because it becomes part of the public DNS endpoint. The account is also where many important controls live. If public blob access is disabled at the account, a container cannot accidentally make anonymous receipt files public. If the account uses private endpoints and firewall rules, callers need the approved network path before they can reach the data plane.

The beginner habit is to treat the storage account as a security and operations boundary, not just a folder for containers. Mixing unrelated environments or unrelated risk levels into one account makes access, lifecycle, cost, and recovery reviews harder.

## Containers and Blobs

A container is a named grouping of blobs inside a storage account. A blob is the object itself: the bytes plus metadata and properties. Containers are useful for grouping files that share access patterns, lifecycle rules, or ownership.

For example, the same storage account might contain `receipts`, `exports`, and `temporary-imports`. Receipts may need customer download links and long retention. Exports may move to a cooler tier after a month. Temporary imports may be deleted after a week. Those are different lifecycles, so they should be easy to identify.

Containers are not as strong an isolation boundary as separate storage accounts. Network rules, private endpoints, account keys, and some redundancy choices apply at the account. If two data sets need clearly separate network or administrative control, separate accounts may be cleaner than separate containers.

## Names

A blob name is the full string that identifies one object inside a container. Names often contain slashes, such as `receipts/2026/05/order-417.pdf`, but in a standard flat namespace those slashes are part of the name string. They help humans and tools group objects by prefix. They are not normal operating system directories.

That detail matters when designing names. Blob Storage can list by prefix, so date or tenant prefixes can make operations easier. A name such as `receipts/2026/05/order-417.pdf` lets operators list May receipts without scanning unrelated objects. A name such as `order-417.pdf` is simpler, but it gives less operational structure.

The database should still be the search index for business questions. If support needs every paid order for customer `cust_91`, query the order database and read the blob names stored there. Do not try to make blob names or blob metadata replace relational indexing.

Azure also supports hierarchical namespace accounts for Azure Data Lake Storage Gen2. With hierarchical namespace enabled, directory operations and access control behave more like a real filesystem, which helps analytics and big data workloads. For ordinary application objects, a flat namespace with clear prefix naming is often enough.

## Access and SAS Tokens

Blob access is the decision of who may read, write, list, or delete objects. For production applications, anonymous public access should usually be disabled unless the data is deliberately public. The application should use Microsoft Entra ID, managed identity, storage data roles, private networking where needed, and narrow delegated links for user downloads or uploads.

![Azure Blob Storage SAS token boundary showing limited delegated access to a container path](/content-assets/articles/article-cloud-providers-azure-storage-databases-storage-accounts-blob-storage/sas-token-boundary.png)

*A SAS token is a narrow delegated permission, not the storage account key itself.*


A Shared Access Signature, commonly called a SAS, is a signed token that grants limited access to a storage resource for a limited time. It exists so a browser, partner process, or job can access one blob or container operation without receiving broad account credentials.

Example: after a customer signs in, the orders API can issue a 15-minute read-only SAS for `receipts/2026/05/order-417.pdf`. The browser downloads the receipt directly from Blob Storage. The browser does not receive the storage account key and does not gain permission to list every receipt.

There are several SAS patterns. An account SAS can be broad and is signed with an account key. A service SAS is narrower but still depends on account-key signing. A user delegation SAS is usually the safer pattern for modern applications because it is signed with a short-lived user delegation key obtained through Microsoft Entra ID by an authorized identity.

The design rule is simple: users and browsers should receive the smallest temporary permission that completes the task. The storage account key should stay out of frontend code, scripts, tickets, and logs.

## Replication

Replication is the copy policy for stored bytes. It decides where Azure keeps redundant copies and which failures those copies can survive.

Locally redundant storage, or LRS, keeps multiple synchronous copies in one physical location in the primary region. Zone-redundant storage, or ZRS, keeps synchronous copies across availability zones in supported regions. Geo-redundant options add asynchronous copying to a secondary region. Geo-zone-redundant options combine zone redundancy in the primary region with geo replication to a secondary region.

The choice is a tradeoff between cost, availability, durability, latency, and recovery expectations. A temporary export container may not need the same redundancy as customer-visible legal receipts. A compliance archive may care more about geographic survival than immediate read latency.

Replication is not the same as backup. If the application overwrites the wrong blob and that overwrite is replicated, the replica now also has the wrong current value. Versioning, soft delete, retention, and restore procedures answer the logical recovery question.

## Lifecycle

Lifecycle management is Blob Storage's rule engine for moving or deleting objects as they age. It exists because files are often valuable immediately, then cheaper to keep in colder storage later.

![Azure Blob Storage lifecycle timeline moving blobs from hot to cool to archive and delete](/content-assets/articles/article-cloud-providers-azure-storage-databases-storage-accounts-blob-storage/lifecycle-tier-timeline.png)

*Lifecycle rules turn object age into storage-tier movement, which changes cost and restore speed.*


Example: receipt PDFs may stay in Hot tier while customers are likely to download them, move to Cool or Cold after the support window, and remain available for the required retention period. Temporary import files may be deleted after seven days. Compliance exports may move to Archive when hours of retrieval delay are acceptable.

| Tier | Useful starting point | Read behavior |
| --- | --- | --- |
| Hot | Active files read or changed often | Online, fast access, higher storage cost |
| Cool | Infrequently accessed files | Online, fast access, lower storage cost with higher access cost |
| Cold | Rarely accessed files that still need quick retrieval | Online, fast access, lower storage cost with higher access cost |
| Archive | Long-term data with hours of acceptable retrieval delay | Offline until rehydrated |

Archive is the sharpest beginner trap. Archived blobs are not directly readable. A rehydration request must bring the blob back to an online tier before normal reads work. That can take hours, so Archive is a poor home for troubleshooting logs, active backups, or files support may need during an incident.

## Versioning and Soft Delete

Versioning and soft delete are Blob Storage data protection features. They answer a different question from replication: what previous object state can we recover after a bad overwrite or deletion?

Blob versioning keeps previous versions when an object changes. Blob soft delete keeps deleted blobs, snapshots, or versions recoverable for a configured retention period. Container soft delete protects against deleting an entire container. Microsoft recommends combining these features for stronger blob protection when the data matters.

Example: if a bug overwrites `receipts/2026/05/order-417.pdf` with a blank PDF, versioning can preserve the previous good version. If a cleanup job deletes the blob, soft delete can keep the deleted object recoverable during the retention window.

These features add cost because previous versions and soft-deleted data still consume storage until lifecycle or retention rules remove them. That cost is often worth paying for important customer files, but it should be intentional and reviewed.

## Putting It All Together

Blob Storage is the Azure service for object-shaped data: named byte payloads that should live outside compute and outside relational tables.

The storage account owns the endpoint, region, network controls, redundancy, encryption, and billing boundary. Containers group related objects. Blob names form the lookup path and operational prefix structure. SAS tokens delegate narrow temporary access. Replication protects against infrastructure failures. Lifecycle rules control long-term cost. Versioning and soft delete protect against logical mistakes.

When you design Blob Storage, keep the database and the object store in their proper roles. The database knows what the file means. Blob Storage keeps the file bytes durable, reachable, protected, and cost-managed.

## What's Next

Next we move from file-shaped objects to relational records in Azure SQL Database, where the important questions are tables, constraints, transactions, connections, migrations, and restore.


![Azure Blob Storage object path from storage account to container and blob with replication, SAS, lifecycle, and access tier controls](/content-assets/articles/article-cloud-providers-azure-storage-databases-storage-accounts-blob-storage/blob-storage-object-path.png)

*Use this as the Blob Storage path: the account, container, and object name form the address, while replication, SAS, lifecycle, and tiers control durability, access, and cost.*

---

**References**

* [Introduction to Blob Storage](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blobs-introduction) - Containers, blobs, storage accounts, and object access.
* [Azure Storage redundancy](https://learn.microsoft.com/en-us/azure/storage/common/storage-redundancy) - LRS, ZRS, GRS, and GZRS redundancy models.
* [Grant limited access with shared access signatures](https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview) - SAS types and access boundaries.
* [Access tiers for blob data](https://learn.microsoft.com/en-us/azure/storage/blobs/access-tiers-overview) - Hot, Cool, Cold, Archive, and rehydration behavior.
* [Blob lifecycle management overview](https://learn.microsoft.com/azure/storage/blobs/lifecycle-management-overview) - Rule-based tier movement and deletion.
* [Soft delete for blobs](https://learn.microsoft.com/en-us/azure/storage/blobs/soft-delete-blob-overview) - Blob soft delete behavior and retention.
* [Data protection overview for Azure Blob Storage](https://learn.microsoft.com/en-us/azure/storage/blobs/data-protection-overview) - Recommended protection features for blob data.
