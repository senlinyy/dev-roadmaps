---
title: "How To Choose AWS Storage and Databases"
description: "Choose between S3, EBS, EFS, FSx, RDS, Aurora, DynamoDB, and data movement tools by looking at how the data is read, changed, shared, protected, and moved."
overview: "AWS has many storage and database services because production data has many shapes. This article builds a practical selection path around files, relational records, key-value items, disks, shared filesystems, and migration flows."
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

1. [Start With the Shape of the Data](#start-with-the-shape-of-the-data)
2. [Rows That Need Transactions](#rows-that-need-transactions)
3. [Files That Need Object Storage](#files-that-need-object-storage)
4. [One Server Disk](#one-server-disk)
5. [Shared Files](#shared-files)
6. [Key Lookups at High Scale](#key-lookups-at-high-scale)
7. [Movement and Recovery](#movement-and-recovery)
8. [A Practical Decision Checklist](#a-practical-decision-checklist)
9. [References](#references)

## Start With the Shape of the Data
<!-- section-summary: AWS storage choices start with what the application needs the data to do during normal work. -->

Imagine a small online store called Maple Market. A customer checks out, uploads a return photo, and later asks support to find the order. The app has several kinds of data before AWS service names enter the conversation.

The order rows need transactions because payment, inventory, and order status must agree. The return photo is a whole file that the app stores and retrieves by name. A search server may need a local disk for an index. A group of web servers may need shared files. A shopping cart may need fast key lookups. A migration needs a safe copy plan.

AWS has many storage and database services because production data behaves in different ways. Start with the behavior, then choose the service.

A useful first pass is to write three operations in plain language. "Customer uploads a return photo." "Customer places an order." "Support opens an order history." Each operation tells you how the data is addressed, changed, shared, and recovered. The AWS service name comes after that behavior is clear.

We will name services only enough to place each job in the right family. The later articles go deeper into bucket policies, database creation choices, DynamoDB keys, and migration runbooks.

| Job the application needs | Data shape | AWS service family that usually fits | Simple Maple Market example |
| --- | --- | --- | --- |
| Save related business records that must agree | Rows and transactions | RDS or Aurora | Checkout writes an order, payment, and inventory reservation together |
| Store and retrieve whole files | Objects | S3 | Customer uploads a return photo and support opens it later |
| Give one server a normal disk | Block storage | EBS | Search node stores a local index directory |
| Let many clients use normal file paths | Shared filesystem | EFS or FSx | Legacy web servers share `/mnt/uploads` during migration |
| Read and update by a known key at high scale | Key-value or document item | DynamoDB | Cart service loads the active cart by customer ID |
| Copy data safely between places | Movement workflow | DataSync, DMS, Transfer Family, or S3 tools | Old product photos and orders move into AWS before cutover |

![The data-shape map links rows, objects, disks, shared files, key-value access, and movement jobs to the AWS services that usually fit them](/content-assets/articles/article-cloud-providers-aws-storage-databases-storage-database-mental-model/data-shape-service-map.png)

*The data-shape map links rows, objects, disks, shared files, key-value access, and movement jobs to the AWS services that usually fit them.*


## Rows That Need Transactions
<!-- section-summary: Each AWS data service maps to a data shape, so naming the shape helps narrow the service choice. -->

Some data is made of related rows that must change together. In Maple Market, an order insert, payment authorization, inventory reservation, and ledger entry may need to succeed or fail as one unit. That is a **transaction**.

Relational databases fit this shape. Amazon RDS runs familiar engines such as PostgreSQL, MySQL, MariaDB, SQL Server, and Oracle. Amazon Aurora is AWS's cloud-designed relational database engine with MySQL-compatible and PostgreSQL-compatible options.

A small checkout query might join tables:

```sql
select o.id, o.status, p.status as payment_status, sum(oi.quantity) as items
from orders o
join payments p on p.order_id = o.id
join order_items oi on oi.order_id = o.id
where o.id = 'ord_123'
group by o.id, o.status, p.status;
```

Choose a relational database when the application needs constraints, joins, flexible SQL queries, transactions, and mature reporting patterns. The team still owns schema design, indexes, query performance, migrations, and credentials.

The boundary around a relational database usually includes a private VPC endpoint, security groups, a credential path, backup retention, and a migration process. In production, "we use RDS" is only the start. A reviewable design says which app role connects, which subnet group hosts the database, how credentials are stored, which restore window the business needs, and how schema changes ship safely.

## Files That Need Object Storage
<!-- section-summary: Object storage fits whole files and blobs that applications store, retrieve, protect, and expire through an API. -->

A return photo has a different shape from an order row. The app usually saves the whole file, stores metadata about it, and retrieves it later by key. The unit of work is the object key and the complete object body. This points to **object storage**.

Amazon S3 stores objects in buckets. An object has bytes, a key, metadata, tags, and permissions. Maple Market might store return photos under keys like `returns/2026/06/ord_123/photo-1.jpg` and keep the order row in a relational database with the S3 key.

S3 is also common for logs, exports, backups, analytics files, data lake tables, static assets, and partner file drops. It has versioning, lifecycle rules, replication, encryption options, event notifications, and access policies. Choose it when the data is file-shaped and API access is natural.

S3 design starts with ownership and prefixes. A customer upload bucket may separate `tmp/`, `returns/`, and `processed/` prefixes because each prefix has different lifecycle and processing rules. The database should keep the business relationship, such as which order owns which object key. S3 holds the bytes and object metadata; the application still owns the workflow state.

## One Server Disk
<!-- section-summary: Block storage fits one compute placement that needs a durable disk with normal operating system behavior. -->

Some workloads expect a disk attached to one machine. A search index, a database engine you manage yourself, or a legacy app might write to a mounted filesystem and use normal operating system paths.

Amazon EBS provides block volumes for EC2 instances. The operating system sees the volume like a disk. You format it, mount it, and put files on it. EBS volumes live in one Availability Zone, so the EC2 instance and volume need compatible placement.

Choose EBS when one compute placement needs durable block storage with configurable size and performance. Plan snapshots, encryption, monitoring, and restore tests because the disk often sits directly on a request path.

EBS decisions include volume type, size, IOPS, throughput, encryption, snapshot policy, and instance placement. A search index disk may be safe to rebuild from S3 exports. A self-managed database disk may need a strict snapshot and restore plan. The service can look the same while the recovery requirement is very different.

## Shared Files
<!-- section-summary: Shared filesystem storage fits workloads where multiple compute resources need normal file paths at the same time. -->

Some apps need shared files because their code expects normal file paths. A content management system may have multiple web servers reading and writing uploaded files. A data science team may run jobs that expect a shared POSIX filesystem. A Windows application may expect SMB shares.

Amazon EFS provides managed NFS file storage for Linux clients and many AWS compute services. Amazon FSx provides managed filesystems for specific ecosystems, including Windows File Server, Lustre, NetApp ONTAP, and OpenZFS.

Choose shared filesystems when multiple clients need normal file operations, locks, directory structures, and mounted paths. Review network access, mount targets, security groups, POSIX or Windows permissions, backups, and performance mode. Shared files solve a real need, but they also create shared operational responsibility.

This is the place where many migrations pause. A legacy app may expect `/mnt/uploads` or `\\fileserver\reports`, and rewriting it to object storage might take months. EFS or FSx can be a practical bridge, as long as the team documents mount paths, identity, backup, and performance limits instead of treating the filesystem as magic shared state.

## Key Lookups at High Scale
<!-- section-summary: Key-value and document-shaped access fits workloads that know their read and write paths before table design starts. -->

A shopping cart or session record may need fast lookup by customer ID. The app knows the access path: get cart by customer, update item quantity, expire old carts. It does not need joins across many tables for the hot path.

Amazon DynamoDB fits known key-based access patterns at high scale. You design the table around partition keys, optional sort keys, and indexes that match exact reads and writes. The design work happens before creating the table because DynamoDB performs best when the app asks questions the table was built to answer.

Choose DynamoDB when the access patterns are predictable, low-latency key lookups matter, and the data does not need relational joins. Plan conditional writes for duplicate requests, TTL for expiry, point-in-time recovery, streams for events, and hot-key monitoring.

DynamoDB is especially strong for data that the app reads by known keys: cart by customer, session by token, idempotency record by request ID, feature state by tenant. It is a poor fit for a team that wants to ask arbitrary joins later without designing indexes. Write the access patterns before creating the table, because key design is the product design for this kind of data.

## Movement and Recovery
<!-- section-summary: Production storage choices need a plan for recovery copies, migration paths, and downstream data use from the start. -->

A storage choice is incomplete without movement and recovery. Maple Market may import old product photos, migrate an old database, receive nightly partner files, export order data to analytics, and restore a deleted object or table after a mistake.

For files, AWS DataSync can move file data between on-premises storage and AWS storage services. AWS Transfer Family can receive SFTP, FTPS, or FTP partner uploads into S3 or EFS. For databases, AWS Database Migration Service can help with full loads and change data capture for supported sources and targets. For large S3 object sets, S3 Batch Operations can apply changes at scale.

Recovery needs concrete tests. RDS backups and point-in-time restore are useful only if the team has practiced restoring to a new instance. S3 versioning helps only if lifecycle rules keep the needed versions. DynamoDB point-in-time recovery helps only if the table restore process is part of the runbook.

Movement also has security work. Temporary migration roles, firewall openings, database users, S3 staging buckets, and transfer agents should have removal dates. A migration that succeeds and leaves powerful temporary access behind has created a new production risk.

![The access/change/recovery map shows why the right storage choice depends on who reads it, how it changes, and how it must recover](/content-assets/articles/article-cloud-providers-aws-storage-databases-storage-database-mental-model/access-change-recovery-map.png)

*The access/change/recovery map shows why the right storage choice depends on who reads it, how it changes, and how it must recover.*


## A Practical Decision Checklist
<!-- section-summary: A short checklist turns a vague service choice into a reviewable production decision. -->

Use this checklist before picking a service:

- What shape is the data: rows, object files, one disk, shared files, key-value items, or migration stream?
- Who reads it, who writes it, and from which network path?
- Does the app update small fields, whole objects, mounted files, or known keys?
- Does it need transactions, joins, locks, versioning, or conditional writes?
- What is the recovery target after delete, corruption, bad deploy, or Region issue?
- How will data move into AWS, around AWS, and out to analytics or partners?
- Which team owns schema, bucket policy, filesystem permissions, backups, and cost review?

The right answer can include more than one service. Maple Market can use RDS for orders, S3 for return photos, EBS for a search node, EFS for shared uploads, DynamoDB for carts, and DataSync or DMS for migration. The key is to split data by behavior and give each piece an owner, access path, and recovery plan.

A short design note can make this concrete:

| Data | Service | Access path | Recovery plan |
| --- | --- | --- | --- |
| Orders and payments | RDS or Aurora | Private app security group to database security group | PITR restore drill and tested migrations |
| Return photos | S3 | App role and presigned uploads to controlled prefixes | Versioning, lifecycle, and object restore check |
| Active carts | DynamoDB | App role keyed by customer ID | PITR enabled and duplicate-write tests |
| Legacy shared reports | FSx or EFS | Approved client security groups and filesystem permissions | Backup restore into a test mount |

![The summary turns the article into a storage selection checklist for production review](/content-assets/articles/article-cloud-providers-aws-storage-databases-storage-database-mental-model/storage-selection-summary.png)

*The summary turns the article into a storage selection checklist for production review.*


## References

- [Amazon S3 documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)
- [Amazon RDS documentation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html)
- [Amazon DynamoDB documentation](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html)
- [AWS Database Migration Service documentation](https://docs.aws.amazon.com/dms/latest/userguide/Welcome.html)
