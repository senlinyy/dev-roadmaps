---
title: "What Is Data Storage"
description: "Choose an Azure data service by asking whether the app is storing files, relational records, known-key items, disks, file shares, or recoverable state."
overview: "Storage decisions become easier when you describe what the data is before naming a service. This article uses one orders system to separate Blob Storage, Azure SQL Database, Cosmos DB, Managed Disks, Azure Files, and recovery promises."
tags: ["azure", "storage", "databases", "blob-storage", "azure-sql"]
order: 1
id: article-cloud-providers-azure-storage-databases-storage-database-mental-model
aliases:
  - storage-and-database-mental-model
  - choosing-the-right-data-service
  - article-cloud-providers-azure-storage-databases-choosing-right-data-service
  - cloud-providers/azure/storage-databases/storage-and-database-mental-model.md
  - cloud-providers/azure/storage-databases/choosing-the-right-data-service.md
---

## Table of Contents

1. [What Is Data Storage](#what-is-data-storage)
2. [Data Shape](#data-shape)
3. [Files](#files)
4. [Records](#records)
5. [Items](#items)
6. [Disks](#disks)
7. [File Shares](#file-shares)
8. [Recovery](#recovery)
9. [Sample Data Map](#sample-data-map)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## What Is Data Storage

Azure data storage is the virtualized platform layer that preserves application state outside the volatile running processes of your compute infrastructure. A virtual machine can experience hardware degradation, a container can be dynamically recycled, and a serverless function invocation will terminate after its execution window ends. Data storage resources move application facts, files, and database records out of these ephemeral compute host boundaries, guaranteeing that your data remains durable, consistent, and reachable across host migrations and restarts.

:::expand[Under the Hood: Physical Storage Networks and the Fabric Controller]{kind="design"}
Behind Azure's storage PaaS interfaces sits a highly complex physical storage network fabric. Datacenters are partitioned into specialized storage scale units containing dense storage cabinet enclosures. Each enclosure houses arrays of enterprise-grade physical solid-state drives cabled to high-speed storage controller motherboards. 

To bypass CPU interrupts and achieve ultra-low RTT latencies, hypervisor VM blades communicate with storage scale units over a dedicated, software-defined storage network using high-throughput network cards (often leveraging RoCE or InfiniBand backplanes). 

The software-defined storage controller layer translates raw SSD flash sectors into virtualized volumes. When application code writes data, the storage controllers manage local wear leveling, handle bad block reallocations, and distribute block ranges across three physical disk racks inside the datacenter to guarantee durability. The Fabric Controller separates these data plane API requests (which handle high-throughput I/O block transmissions) from the control plane Azure Resource Manager (ARM) API endpoints (which handle metadata alterations, resource provisioning, and configuration changes).
:::

If you host infrastructures on AWS, Azure's storage portfolio maps cleanly to the Amazon Web Services portfolio. Azure Blob Storage serves as the regional object storage equivalent of Amazon S3, Azure SQL Database serves as the managed relational equivalent of Amazon RDS, and Azure Cosmos DB maps directly to the known-key access pattern model of Amazon DynamoDB. For virtual machine block storage, Azure Managed Disks serve the same role as Amazon EBS volumes, and Azure Files maps to the managed shared directory structure of Amazon EFS.

Rather than choosing a storage service based on generic service names, evaluate the structural shape of your data. The shape of the data—whether it is a whole file, a relational table row, a NoSQL key-value document, or a mounted operating system volume—determines the access performance, billing rates, and permission scopes your system will inherit.

| Operational Question | Architectural Role inside Data Design |
| --- | --- |
| What is the primary data shape? | Whole files, database records, partition key documents, or raw OS disks dictate your database modeling and query syntax. |
| How does the application read the data? | Primary key searches, complex relational joins, full-text index lookups, or file-system directory mounts determine the engine capabilities needed. |
| How frequently does the data change? | Read-heavy archives, balanced transaction logs, or ultra-fast in-memory cache updates change your resource sizing. |
| What does Azure manage? | Managed database updates, physical storage cabinet replication, and automatic backup schedules remove infrastructure chores. |
| What must the team still own? | Schema design, indexing strategies, partition key choices, SAS token encryption, and recovery validations remain your responsibility. |

## Data Shape

To select the correct cloud data host, evaluate each application state requirement against its physical data shape. A single large enterprise application (such as an e-commerce platform) rarely relies on a single database. Different components within the system require different consistency guarantees and access patterns.

A file shape represents a bundle of raw bytes that the application reads, writes, and deletes as a single, opaque block. Product images, generated PDF receipts, support attachments, CSV report exports, and log archives are all file-shaped. 

A record shape represents structured business facts that possess clear relationships, consistency rules, and schemas. Order tables cabled to line-item tables, customer profiles cabled to address tables, and transaction payment logs belong to this shape. They require strict ACID (Atomicity, Consistency, Isolation, Durability) transactional integrity to guarantee that an order is never recorded without its matching line items.

An item shape represents semi-structured data cabled to a known lookup key. Idempotency checks, session tokens, user preferences, and real-time job status flags are item-shaped. They do not require complex relational joins or multi-table constraints; they require fast, predictable read/write operations and automated time-to-live (TTL) expiration policies.

A disk shape represents block storage cabled directly to an operating system. Virtual machine boot disks, localized database data paths, and system swap files are disk-shaped. They require raw virtual block controller attachments that hypervisors can map to guest file systems.

A file share shape represents a mounted network folder that must be concurrently read and written by multiple distinct compute instances using standard file system protocols (such as SMB or NFS). Shared template directories, legacy migrations, and common document shares belong to this shape.

```mermaid
flowchart TD
    App["Application State"] --> Shape{"Data Shape?"}
    Shape --> File["File (Opaque Bytes)"]
    Shape --> Record["Record (Relational)"]
    Shape --> Item["Item (Known Key NoSQL)"]
    Shape --> Disk["Disk (OS Block Volume)"]
    Shape --> Share["File Share (SMB/NFS)"]
    Shape --> Restore["Recovery (Durability)"]
    
    File --> Blob["Blob Storage"]
    Record --> SQL["Azure SQL"]
    Item --> Cosmos["Cosmos DB"]
    Disk --> Managed["Managed Disk"]
    Share --> Files["Azure Files"]
    Restore --> Backup["Backup Policy"]
```

This classification separates state by its access protocol and transaction boundary. Start by mapping each data asset to its core shape, and avoid the anti-pattern of forcing all data into a single database.

## Files

A file is a collection of binary data stored as a single object. Receipt PDFs, CSV reports, and software logs do not have database-like relationships inside their bytes; they are generated as units and must be served to users as units.

In Azure, Blob Storage is the standard PaaS resource for hosting files. If your application code attempts to write a generated receipt PDF directly to the local filesystem of an App Service instance, that file is cabled to that specific virtual machine's ephemeral drive. If the App Service scales out, another VM instance will not see the file. If the process recycles, the local directory mounts reset, and the file is permanently lost.

Blob Storage decouples the file from the compute process. Your checkout API writes the receipt PDF directly to a Blob Storage container, receives a stable URL pointer, and writes that pointer to your customer database. When a customer requests a download, your API generates a secure download link, separating the storage from your application's RAM and local disk limits.

## Records

A business record represents a fact that must be stored with high structural integrity and cabled to related facts. In an orders database, an order table must connect to a customer table, a line-items table, and a payment-attempts table.

This relational structure requires a database engine that enforces schema rules, primary key constraints, foreign key referential integrity, and transactions. Azure SQL Database provides a managed relational home equipped with Microsoft's SQL Server engine, bringing mature indexing, SQL query analysis, and transactional safety to your backend services.

The primary role of a relational database is protecting your business domain models. A checkout workflow must guarantee that if a customer's payment succeeds, the order state is updated, the inventory is decremented, and the payment record is written together within an atomic transaction. If any step fails, the entire transaction rolls back. Relational databases are designed to enforce these strict physical constraints.

## Items

An item represents an isolated document or key-value object that does not need a complex schema or multi-table joins. An idempotency check (which maps a request token to an order status) or a session token (which maps a session ID to user profile fields) are item-shaped.

These workloads are a strong fit for Azure Cosmos DB, a globally distributed, multi-model NoSQL database. Cosmos DB stores data as JSON documents and scales horizontally by partitioning data across logical nodes using partition keys. It bypasses relational table locks to guarantee single-digit millisecond latency under high write volumes.

However, Cosmos DB is not a shortcut to avoid schema planning. Operating a NoSQL database requires designing around your primary access patterns. You must select a partition key that distributes writes evenly across physical hardware nodes, monitor Request Unit (RU) costs, and select one of five tunable consistency levels to balance replication speeds with data accuracy.

## Disks

A disk represents block-level storage that is cabled directly to a virtual machine hypervisor. The guest operating system mounts this disk, formats it with a standard filesystem (such as ext4 or NTFS), and treats it as a local drive.

Azure Managed Disks provide persistent block storage for Virtual Machines. While managed disks are highly durable and triple-replicated, they are designed exclusively for machine-bound workloads. You should never use a managed disk as a generic file store for a web application. If your App Service or container needs to store generated PDFs, writing them to a shared managed disk cabled to a single VM creates severe architectural bottlenecks and prevents horizontal scaling.

Always utilize the ephemeral temporary disk provided by your VM size exclusively for swap files, volatile caches, and scratch directories. Any data that must survive VM recycles and host hardware failures must be written to remote managed disks or PaaS storage resources.

## File Shares

A file share represents a managed network folder that multiple clients can mount concurrently using standard network protocols, specifically Server Message Block (SMB) for Windows/Linux and Network File System (NFS) for Linux.

Azure Files provides fully managed cloud file shares that can be mounted directly by virtual machines, container apps, or on-premises servers. This is highly effective when migrating legacy workloads that rely on traditional file system APIs and assume a shared directory path like `/var/shares/templates`.

Avoid using Azure Files as a replacement for Blob Storage. Writing files to a mounted file share introduces network file-locking latency, session tracking overhead, and complex ACL permission controls. If your application code is modern and can connect to storage using REST APIs or SDKs, Blob Storage is the simpler, faster, and more cost-effective object storage choice.

## Recovery

A data architecture is only as reliable as its recovery plan. Mistakes, security breaches, and hardware failures happen after data is successfully committed: a buggy automated cleanup script deletes a container of customer blobs, a bad migration script corrupts a database column, or a rogue administrator deallocates a VM disk.

Relying on a vague "we have backups" statement is an operational risk. You must design a specific recovery strategy for each data resource based on its shape:
* **Azure SQL**: Point-in-time restore (PITR) using automated transaction log backups cabled to active database copies.
* **Blob Storage**: Enabling Soft Delete to isolate deleted blobs in a hidden platform bin, and configuring Object Versioning.
* **Cosmos DB**: Configuring continuous backup windows and setting Time to Live (TTL) parameters to prune temporary items automatically.
* **Managed Disks**: Creating incremental redirect-on-write snapshots to capture VM disk states before executing updates.

These recovery mechanisms must be documented and tested regularly. A recovery plan is only verified when your team has successfully restored data to an active, operational target environment.

## Sample Data Map

To organize data decisions during architecture reviews, construct a data map. This map separates each component by its shape, target service, and operational rationale.

| Data Asset | Physical Shape | Azure Service | Architectural Rationale |
| --- | --- | --- | --- |
| Customer Profile & Orders | Relational Records | Azure SQL Database | Requires relational integrity, foreign key constraints, and transactional ACID guarantees. |
| Customer Invoice PDF | File | Blob Storage | Opaque binary file that must be durable and served securely via SAS links to public browsers. |
| Session Token cache | Known-Key Item | Azure Cosmos DB (Session) | Requires fast, known-key lookups under single-digit millisecond latency with auto-expiring TTLs. |
| VM Operating System | Disk | Managed Disk (Premium SSD) | Raw virtual block volume cabled to a VM hypervisor for guest OS booting. |
| Legacy Invoice Template | File Share | Azure Files (SMB mounted) | Required by a legacy VM-bound daemon that expects a shared network directory mount. |
| Deleted Assets Bin | Recovery | Soft Delete & Snapshots | Provides operational protection against accidental deletions without database restores. |

## Putting It All Together

Choosing Azure storage and database services requires matching your state requirements to the correct data shape.

* **Abstracted Infrastructure**: Ephemeral compute runtimes must decouple application state by writing data to dedicated, network-connected storage scale units isolated by the Fabric Controller.
* **Files as Blobs**: Unstructured binary files (receipts, CSVs, logs) belong in Blob Storage containers, decoupled from local VM drives and secured using dynamic SAS tokens cabled to managed identities.
* **Relational Records**: High-integrity business transactions belong in Azure SQL Database tables, leveraging referential constraints and ACID transaction logs.
* **Known-Key Items**: Semi-structured documents cabled to predictable key searches belong in Cosmos DB, scaling horizontally using hashed partition keys.
* **Durable Disks & Shares**: VM-bound virtual block volumes use Managed Disks, and legacy directory templates mount over Azure Files SMB/NFS protocols.
* **Tested Recovery**: All data resources must configure shape-specific recovery mechanisms (PITR, Soft Delete, snapshots) to protect state from deletion and corruption.

## What's Next

In the next chapter, we will explore Azure Blob Storage. We will configure a Storage Account, compare LRS and ZRS physical replication cabinets, establish Hierarchical Namespaces, generate secure User Delegation SAS tokens, and set up automated lifecycle tier shifts.

---

**References**

- [Introduction to Azure Storage](https://learn.microsoft.com/en-us/azure/storage/common/storage-introduction) - Overview of Azure's storage account capabilities.
- [Azure SQL Database Overview](https://learn.microsoft.com/en-us/azure/azure-sql/database/) - Technical introduction to managed SQL Server engines.
- [Azure Cosmos DB Introduction](https://learn.microsoft.com/en-us/azure/cosmos-db/) - Guide to globally distributed multi-model NoSQL databases.
- [Azure Managed Disks Overview](https://learn.microsoft.com/en-us/azure/virtual-machines/managed-disks-overview) - Physical overview of remote network-attached block LUNs.
- [Azure Files Introduction](https://learn.microsoft.com/en-us/azure/storage/files/storage-files-introduction) - Overview of managed SMB and NFS network file shares.
