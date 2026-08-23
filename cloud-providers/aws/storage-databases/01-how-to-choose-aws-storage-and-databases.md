---
title: "How To Choose AWS Storage and Databases"
description: "Choose among S3, EBS, EFS, FSx, RDS, Aurora, and DynamoDB by starting with the data interface, access patterns, guarantees, movement, and recovery needs."
overview: "AWS has many data services because blocks, shared files, objects, relational records, and key-based items require different interfaces. This article builds a first-principles selection method before the service names."
tags: ["aws", "storage", "databases", "s3", "rds", "aurora", "dynamodb"]
order: 1
id: article-cloud-providers-aws-storage-databases-storage-database-mental-model
aliases:
  - storage-database-mental-model
  - storage-and-database-mental-model
  - choosing-the-right-data-service
  - how-to-choose-aws-storage-and-databases
  - article-cloud-providers-aws-storage-databases-choosing-the-right-data-service
  - cloud-providers/aws/storage-databases/storage-database-mental-model.md
  - cloud-providers/aws/storage-databases/choosing-the-right-data-service.md
  - cloud-providers/aws/storage-databases/how-to-choose-aws-storage-and-databases.md
---

## Table of Contents

1. [What Does the Application Think the Data Is?](#what-does-the-application-think-the-data-is)
2. [What Is the Difference Between Storage and a Database?](#what-is-the-difference-between-storage-and-a-database)
3. [When Should You Choose S3?](#when-should-you-choose-s3)
4. [When Should You Choose EBS or Instance Store?](#when-should-you-choose-ebs-or-instance-store)
5. [When Should You Choose EFS or FSx?](#when-should-you-choose-efs-or-fsx)
6. [When Should You Choose DynamoDB?](#when-should-you-choose-dynamodb)
7. [How Do Movement, Availability, and Recovery Change the Design?](#how-do-movement-availability-and-recovery-change-the-design)
8. [What Decision Process Should You Use?](#what-decision-process-should-you-use)
9. [Check Your Understanding](#check-your-understanding)
10. [References](#references)

The sections below answer these questions in order:

1. **What Does the Application Think the Data Is?**
2. **What Is the Difference Between Storage and a Database?**
3. **When Should You Choose S3?**
4. **When Should You Choose EBS or Instance Store?**
5. **When Should You Choose EFS or FSx?**
6. **When Should You Choose DynamoDB?**
7. **How Do Movement, Availability, and Recovery Change the Design?**
8. **What Decision Process Should You Use?**

## What Does the Application Think the Data Is?
<!-- section-summary: The first storage decision is the data interface the application expects: block, file, object, relational row, or key-based item. -->

AWS storage becomes confusing when service names come first: S3, EBS, EFS, FSx, RDS, Aurora, and DynamoDB sound like a list to memorize. Start instead with a more basic question:

> **Which operations must the application perform on this data?**

Different access interfaces create different engineering systems:

```text
data
├── store bytes
│   ├── block device  → EBS
│   ├── filesystem    → EFS or FSx
│   └── object API    → S3
└── manage structured state
    ├── relational rows and queries → RDS or Aurora
    └── key-addressed items         → DynamoDB
```

Ask what the application believes the data *is*:

| Application interface | Example | Natural AWS family |
|---|---|---|
| Blocks on a disk | `/dev/xvdf` | EBS |
| Files and directories | `/shared/reports/a.pdf` | EFS or FSx |
| Objects identified by keys | `images/cat.jpg` | S3 |
| Rows with relationships | customers, orders, payments | RDS or Aurora |
| Items found mainly through known keys | user ID to user profile | DynamoDB |

The contents do not decide the interface by themselves. A photo-sharing application can put image bytes in S3, photo ownership and caption rows in a database, and temporary image-processing scratch data on an EBS volume or ephemeral disk.

```text
database row
├── photo_id
├── user_id
├── caption
└── s3_key ─────> S3 object containing the image bytes
```

One application normally uses several data technologies. The goal is not to discover one universal store. It is to place each data shape behind the interface and guarantees it needs.

![The data-shape map links rows, objects, disks, shared files, key-value access, and movement jobs to the AWS services that usually fit them](/content-assets/articles/article-cloud-providers-aws-storage-databases-storage-database-mental-model/data-shape-service-map.png)

*Begin with blocks, files, objects, relations, or keys; the AWS service family follows from that interface.*

## What Is the Difference Between Storage and a Database?
<!-- section-summary: Storage preserves bytes, while databases add query, transaction, constraint, indexing, and concurrency abstractions for application state. -->

Suppose Alice has £100, Bob has £50, and an application transfers £20. Alice must become £80 at the same logical moment Bob becomes £70. If the system updates Alice and crashes before updating Bob, money disappears.

Databases exist partly to help applications treat related state changes as one logical transaction. Storage services such as S3 and EBS fundamentally preserve bytes. A database builds higher-level concepts on storage:

- rows or items;
- indexes and query execution;
- transactions;
- constraints;
- concurrency control.

The first branch is therefore:

```text
Do I mainly need a place to put and retrieve bytes?
        └── storage

Do I need the system to understand, query, and safely change structured state?
        └── database
```

This is not a claim that storage lacks durability or that databases do not store bytes internally. It identifies the interface the application receives. An object store does not perform a relational join between an order and payment table, and a block device does not understand that two sectors represent one business transaction.

### When Should You Choose RDS or Aurora?
<!-- section-summary: Relational databases fit entities with relationships, flexible SQL queries, constraints, and multi-row business transactions. -->

Relational thinking is natural when the domain contains customers, orders, order items, products, and payments connected through one-to-many and many-to-one relationships. The application may need joins, uniqueness or foreign-key constraints, reporting queries, and transactions spanning several rows.

```sql
SELECT customers.name,
       SUM(order_items.quantity * products.price)
FROM customers
JOIN orders ...
JOIN order_items ...
JOIN products ...
GROUP BY customers.name;
```

**Amazon RDS** is AWS’s managed relational database service for familiar engines. AWS manages much of the infrastructure and administration around supported engines, while the customer still designs schemas, indexes, queries, connection behavior, credentials, and safe migrations.

**Amazon Aurora** remains relational. It provides MySQL-compatible and PostgreSQL-compatible editions on an AWS-designed distributed storage architecture. Its storage replicates across three Availability Zones and grows automatically.

Think of the choice this way:

```text
Need SQL, joins, relational constraints,
flexible queries, or multi-row transactions?
        ↓
RDS or Aurora
```

Then ask which compatible engine and operating architecture fit. “Aurora is for big databases” is too vague. A better question is whether the application wants a MySQL- or PostgreSQL-compatible relational model and whether Aurora’s AWS-native architecture is preferable to a conventional RDS engine for the workload.

## When Should You Choose S3?
<!-- section-summary: S3 fits whole objects addressed by bucket and key rather than mutable disk blocks or relational queries. -->

Applications usually handle a photograph as a whole object: put `vacation.jpg`, get it, or delete it. They do not normally modify arbitrary byte ranges in place as if the image were a mounted disk.

An S3 object combines:

```text
bucket + key + data + metadata
```

For example, bucket `company-assets` can contain key `users/42/avatar.jpg`, binary image data, and metadata such as `content-type=image/jpeg`.

**Amazon S3** is object storage. It is a natural home for images, videos, PDFs, assets, logs, backups, datasets, archives, and data-lake files. Standard multi-AZ S3 storage classes are designed for extremely high durability, including the familiar eleven-nines durability design target.

Storing a 500 MB video in a relational database is technically possible, but the application may gain little from making database pages, transaction logs, indexes, query machinery, and replication manage a blob it only retrieves whole. A common split stores the business facts and S3 key in the database, while S3 stores the bytes.

S3’s API is not a mounted filesystem or block device. Choose it when bucket-and-key object operations fit the application rather than expecting POSIX file behavior.

## When Should You Choose EBS or Instance Store?
<!-- section-summary: EBS provides persistent block storage for an EC2 placement, while instance store provides disposable local block storage. -->

Some software expects an ordinary disk. Linux sees a device such as `/dev/nvme1n1`, places an `ext4` or XFS filesystem on it, mounts it at `/data`, and performs arbitrary block reads and writes.

**Amazon EBS** provides persistent block volumes for EC2. The operating system understands the files and directories; EBS sees addressed blocks.

```text
EC2
  ↓ block I/O
EBS volume
  ↓
filesystem managed by the OS
  ↓
application files
```

EBS fits EC2 boot volumes, self-managed database disks, application data volumes, and low-latency stateful server workloads. Its volume lifecycle can be independent from the instance depending on deletion settings. EBS snapshots capture point-in-time backups that can produce new volumes.

**EC2 instance store** is local ephemeral block storage. Its selection question is simple:

```text
Can the data be lost with the host and recreated?
├── yes → instance store may fit scratch data, caches, or temporary processing
└── no  → use persistent storage and a tested recovery design
```

Do not confuse low latency with durability. A very fast temporary device is still the wrong only copy of business-critical data.

## When Should You Choose EFS or FSx?
<!-- section-summary: Shared filesystems let several clients see one mounted namespace, with EFS for general elastic NFS use and FSx for specific filesystem ecosystems. -->

Three EC2 instances each attached to an independent EBS disk have three filesystems, not one shared directory. If every application expects `/shared/customer-files/` to show the same contents, the design needs a shared filesystem.

```text
EC2 A ─┐
EC2 B ─┼──> shared filesystem namespace
EC2 C ─┘
```

**Amazon EFS** provides elastic shared file storage with concurrent NFS access for Linux clients. The practical distinction is:

```text
one machine needs a persistent disk → EBS
many machines need the same filesystem → EFS
```

The **Amazon FSx** family fits specialized or familiar filesystem requirements. Its services include FSx for Windows File Server, Lustre, NetApp ONTAP, and OpenZFS.

```text
Need shared files?
├── general elastic NFS-style filesystem → EFS
└── particular filesystem or feature set → FSx
```

Mounted file paths, directory semantics, locks, client identities, and filesystem-specific behavior are reasons to choose file storage instead of pretending S3 is a drop-in filesystem.

## When Should You Choose DynamoDB?
<!-- section-summary: DynamoDB fits known key-based access patterns that need predictable low-latency performance and large or variable scale. -->

Some applications know their hot questions in advance: given a user ID, get the profile; given a shopping-cart ID, get the cart; given a device ID, update device state; given a session token, retrieve the session.

**Amazon DynamoDB** is a managed NoSQL database supporting key-value and document models with single-digit millisecond performance design at scale.

```text
partition or composite key
          ↓
       DynamoDB
          ↓
         item
```

A user item might be identified by `PK = USER#81723` and contain a name, plan, and country. The important point is that the application knows how it will find the data.

Do not use rules such as “structured data means RDS” because DynamoDB items are structured. “Transactions mean RDS” is also incomplete because DynamoDB supports ACID transactions. The stronger distinction is the access model.

Relational thinking says: customers have orders, orders contain products, and the application needs flexible relationships and queries. That points toward RDS or Aurora.

Access-pattern thinking says: given `customerId`, fetch a profile; given `customerId + orderId`, fetch an order; these paths are known ahead of time and must perform at large scale. That points toward DynamoDB.

The schema design is therefore tightly coupled to the planned reads and writes. A system that expects arbitrary future joins without deliberately designed keys and indexes is not using DynamoDB’s natural model.

### How Should You Compare Performance and Cost?
<!-- section-summary: Choose the data abstraction first, then optimize latency, throughput, capacity, availability, durability, and cost within that family. -->

“Which service is fastest?” has no universal answer. A block device, object store, shared filesystem, relational database, and key-value database expose different operations. Comparing them without a workload is like comparing a forklift, motorcycle, and elevator.

EBS can provide excellent block-device latency. DynamoDB can provide excellent key lookup latency. S3 can hold extraordinary amounts of object data. EFS can give many clients one namespace. None replaces the others because their APIs and guarantees differ.

Choose the abstraction first:

```text
block, file, object, relational row, or key-based item?
```

Then optimize the qualities that matter inside that model:

```text
latency, throughput, availability, durability,
capacity, access frequency, and cost
```

Starting from a price or scale headline can select a service whose interface forces the application into awkward or unsafe behavior.

## How Do Movement, Availability, and Recovery Change the Design?
<!-- section-summary: Primary storage selection, migration transport, infrastructure availability, backups, and recovery targets solve different problems. -->

After choosing the primary store, ask how data reaches it and how it returns after failure. These are separate problems.

**AWS DataSync** moves file and object data among on-premises systems, other clouds, and AWS storage such as S3, EFS, and FSx. The target services say where data lives; DataSync is a transport mechanism for large storage datasets.

**AWS Database Migration Service (DMS)** moves database data while preserving database-oriented migration behavior. A common pattern performs an initial copy from an old database and then applies ongoing changes while the source still serves traffic, reducing final cutover downtime.

Movement is not recovery, and replication is not backup. Imagine a primary database and a perfectly current replica. If a user accidentally runs `DELETE FROM customers`, replication quickly repeats the unwanted deletion. Replication protected against one infrastructure copy failing; it did not preserve the prior correct state.

> **Replication protects availability against infrastructure failure. Backups protect recoverability from unwanted state.**

Define two objectives:

- **Recovery Point Objective (RPO):** how much recent data can the business afford to lose—24 hours, one hour, five minutes, or effectively none?
- **Recovery Time Objective (RTO):** how long can the system remain unavailable—eight hours, one hour, five minutes, or seconds?

Those answers determine the required combination of replication, snapshots, continuous backups, cross-Region copies, failover, retention, and restore testing. RDS supports automated backups and point-in-time recovery within configured retention. AWS Backup can centrally automate policies for supported services including EBS, RDS, DynamoDB, EFS, and S3. S3 also offers versioning, Object Lock, and replication mechanisms.

A backup job reporting success is not proof that recovery works. Restore into an isolated location, validate application-readable data, and measure the actual recovery time.

![The access/change/recovery map shows why the right storage choice depends on who reads it, how it changes, and how it must recover](/content-assets/articles/article-cloud-providers-aws-storage-databases-storage-database-mental-model/access-change-recovery-map.png)

*Where data lives, how it moves, how it stays available, and how an earlier correct state is restored are separate design questions.*

## What Decision Process Should You Use?
<!-- section-summary: A repeatable decision tree selects the interface first and then adds operational requirements for protection, scale, migration, and ownership. -->

Use this first pass:

```text
Need SQL, joins, constraints, or flexible relational queries?
└── RDS or Aurora

Need known key-based item lookups at very large or variable scale?
└── DynamoDB

Mainly need to store bytes?
├── object API with bucket and key        → S3
├── one EC2 server expects persistent disk → EBS
└── multiple clients expect shared files
    ├── general NFS-style filesystem      → EFS
    └── specialized filesystem            → FSx
```

Then ask the second-order questions: required availability and durability, response latency and throughput, scaling pattern, access frequency, cost, backup and restore, migration path, and the consequence of losing the data.

| Question | Service or mechanism to consider |
|---|---|
| SQL, joins, constraints, or relational querying? | RDS or Aurora |
| Known item/key lookups at high scale? | DynamoDB |
| Whole images, logs, videos, backups, or datasets? | S3 |
| One EC2 machine expects a persistent disk? | EBS |
| Several clients need one directory tree? | EFS or FSx |
| Disposable local scratch data? | EC2 instance store |
| Move large file or object datasets? | DataSync |
| Migrate database data and ongoing changes? | DMS |
| Centralize supported backup policies? | AWS Backup |

One final question belongs above every row: **What happens when this data disappears?** If the business stops, availability, backup, restore drills, and disaster recovery are part of the primary design, not future enhancements.

The shortest memory aid is:

```text
disk      → EBS
files     → EFS or FSx
objects   → S3
relations → RDS or Aurora
keys      → DynamoDB

DataSync  → move storage datasets
DMS       → move databases
AWS Backup→ coordinate protection
```

Choose the interface and guarantees the application needs, not the service name with the strongest marketing headline.

## Check Your Understanding

:::expand[What Does the Application Think the Data Is?]{kind="recap"}
The first storage decision is the data interface the application expects: block, file, object, relational row, or key-based item.

Blocks, files, objects, relational rows, and key-addressed items require different APIs and guarantees. Naming the interface first narrows the service family before secondary performance and cost choices.

DataSync transports file and object datasets among storage systems. DMS handles database-oriented migration, including supported initial loads and ongoing changes from active sources.
:::

:::expand[What Is the Difference Between Storage and a Database?]{kind="recap"}
Storage preserves bytes, while databases add query, transaction, constraint, indexing, and concurrency abstractions for application state.

It provides application-level abstractions such as rows or items, queries, indexes, constraints, transactions, and concurrency control for structured state.

Relational databases fit entities with relationships, flexible SQL queries, constraints, and multi-row business transactions.

They fit domains with related entities, SQL, joins, constraints, flexible queries, and business changes that need relational transactions. Aurora remains a MySQL- or PostgreSQL-compatible relational database.
:::

:::expand[When Should You Choose S3?]{kind="recap"}
S3 fits whole objects addressed by bucket and key rather than mutable disk blocks or relational queries.

S3 stores the object bytes efficiently by bucket and key. The database stores business relationships and searchable metadata such as owner, caption, and the object key.
:::

:::expand[When Should You Choose EBS or Instance Store?]{kind="recap"}
EBS provides persistent block storage for an EC2 placement, while instance store provides disposable local block storage.

EBS is persistent block storage with configurable lifecycle and snapshots. Instance store is local ephemeral block storage suited only to data that can disappear with the host and be recreated.
:::

:::expand[When Should You Choose EFS or FSx?]{kind="recap"}
Shared filesystems let several clients see one mounted namespace, with EFS for general elastic NFS use and FSx for specific filesystem ecosystems.

EBS gives one compute placement a disk. EFS gives multiple clients concurrent access to one NFS-style filesystem namespace. FSx covers specific filesystem ecosystems and features.
:::

:::expand[When Should You Choose DynamoDB?]{kind="recap"}
DynamoDB fits known key-based access patterns that need predictable low-latency performance and large or variable scale.

RDS or Aurora fit relationships and flexible querying. DynamoDB fits preplanned key-based reads and writes at predictable low latency and high scale. Both can store structured data and support transactions.

Choose the data abstraction first, then optimize latency, throughput, capacity, availability, durability, and cost within that family.

The services perform fundamentally different operations. First choose block, file, object, relation, or key/item semantics; then compare latency, throughput, availability, durability, capacity, and cost within the suitable family.

RPO asks how much recent data loss is tolerable. RTO asks how long the system may remain unavailable. Together they shape backup frequency, replication, failover, retention, and restore testing.
:::

:::expand[How Do Movement, Availability, and Recovery Change the Design?]{kind="recap"}
Primary storage selection, migration transport, infrastructure availability, backups, and recovery targets solve different problems.

Replication copies current state, including accidental deletion or corruption. A backup preserves recoverable earlier state. Replication primarily improves availability; backup and restore protect recoverability.
:::

:::expand[What Decision Process Should You Use?]{kind="recap"}
A repeatable decision tree selects the interface first and then adds operational requirements for protection, scale, migration, and ownership.
:::

## References

- [What is Amazon RDS?](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html)
- [What is Amazon Aurora?](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_AuroraOverview.html)
- [What is Amazon S3?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)
- [Data protection in Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/DataDurability.html)
- [Amazon EBS persistent block storage](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/storage_ebs.html)
- [Creating and managing Amazon EFS](https://docs.aws.amazon.com/efs/latest/ug/creating-using.html)
- [Amazon FSx documentation](https://docs.aws.amazon.com/fsx/)
- [Amazon DynamoDB overview](https://docs.aws.amazon.com/whitepapers/latest/choosing-an-aws-nosql-database/amazon-dynamodb.html)
- [What is AWS DataSync?](https://docs.aws.amazon.com/datasync/latest/userguide/what-is-datasync.html)
- [What is AWS DMS?](https://docs.aws.amazon.com/dms/latest/userguide/Welcome.html)
- [RDS automated backups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html)
- [What is AWS Backup?](https://docs.aws.amazon.com/aws-backup/latest/devguide/whatisbackup.html)
