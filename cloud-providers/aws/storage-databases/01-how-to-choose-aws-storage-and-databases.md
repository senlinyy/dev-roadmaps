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

1. [The Data Choice Starts With the Job](#the-data-choice-starts-with-the-job)
2. [Objects, Records, Items, Disks, and Shared Files](#objects-records-items-disks-and-shared-files)
3. [Ownership, Access, and Boundaries](#ownership-access-and-boundaries)
4. [Change Patterns and Consistency](#change-patterns-and-consistency)
5. [Backup, Movement, and Analytics Plans](#backup-movement-and-analytics-plans)
6. [A Practical Selection Checklist](#a-practical-selection-checklist)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## The Data Choice Starts With the Job
<!-- section-summary: AWS storage choices start with what the application needs the data to do during normal work. -->

AWS gives you many places to put data because the word **data** covers a lot of different jobs. A receipt PDF, a checkout order, a login session, a database disk, a shared design file, and a nightly export all need different behavior. They may all matter to the same application, but they do not behave the same way when code reads them, updates them, shares them, protects them, or moves them.

Let's use one running example for the whole module. Maple Market is a small online shop. Customers upload product photos, place orders, download invoices, and return later to see their order history. The warehouse team uses a shared operations file. Finance exports sales reports each night. The company also has an old on-premises database that needs to move into AWS over time.

If Maple Market puts every piece of state into one database, the database receives work it should never own, such as storing large image files. If the team puts every file into S3, the checkout system loses the transaction rules it needs for orders and payments. If the team writes uploads to a container's local disk, those files disappear during a deploy or scale-in event. The right choice comes from the job the data performs.

The first question is simple: **what does the application need to do with this data every day?** After that, the service choice starts to make sense. Whole files usually point to S3. Structured business records usually point to RDS or Aurora. High-volume key lookups often point to DynamoDB. Host-mounted storage points to EBS, EFS, or FSx. Moving large sets of existing data points to tools like DataSync, DMS, Transfer Family, S3 Batch Operations, and sometimes physical transfer options.

## Objects, Records, Items, Disks, and Shared Files
<!-- section-summary: Each AWS data service maps to a data shape, so naming the shape helps narrow the service choice. -->

The cleanest way to choose a service is to name the **data shape**. A data shape means the basic way the data is addressed and changed. The shape tells you whether the application wants a whole file, a row in a transaction, a key-based item, a block device, or a shared folder.

**Object data** is a complete blob stored and fetched by name. In Maple Market, product photos, invoice PDFs, video clips, and nightly CSV exports are object data. The app usually writes the whole object, then reads the whole object later. Amazon S3 is the default AWS home for this shape because it gives you buckets, object keys, versioning, lifecycle rules, events, and access policies around whole files.

**Relational data** is structured business state with rules between records. Orders connect to order lines, payments, customers, refunds, and inventory reservations. A checkout flow needs transactions, constraints, indexes, and SQL queries. Amazon RDS and Amazon Aurora are the usual AWS homes for this shape because they run managed relational database engines while AWS handles much of the infrastructure work around backups, patching, and failover.

**Key-value or document data** is state that the application reads through known keys and access patterns. A shopping cart by `cartId`, an idempotency record by `requestId`, and a session by `sessionId` all fit this style. Amazon DynamoDB is the AWS home for very high-volume key-based access where the table design starts from known reads and writes instead of flexible ad hoc SQL.

**Block storage** is a virtual disk attached to compute. An EC2 instance boot volume, a self-managed database disk, or a build server workspace may need a disk that the operating system formats and mounts. Amazon EBS handles this shape. The important boundary is that an EBS volume lives in one Availability Zone and attaches to compute in that zone.

**Shared file storage** is a mounted filesystem that many clients can read and write through normal file paths. Linux workloads often use Amazon EFS for shared NFS file storage. Windows, high-performance computing, NetApp ONTAP, and OpenZFS workloads often use Amazon FSx because FSx provides managed filesystems with familiar enterprise protocols and performance profiles.

Here is the practical service map Maple Market would start with. The table is a first design conversation, and the later sections add ownership, recovery, and movement details.

| Data need | AWS service family | Example in production |
|---|---|---|
| Whole files and exports | S3 | Product photos, invoice PDFs, nightly reports |
| SQL records and transactions | RDS or Aurora | Orders, payments, inventory, customers |
| Key lookups at high scale | DynamoDB | Carts, sessions, idempotency keys |
| Disk attached to one compute placement | EBS | EC2 boot volume, self-managed search index disk |
| Shared Linux file paths | EFS | Shared uploads folder for legacy Linux workers |
| Managed specialist filesystem | FSx | Windows SMB shares, Lustre scratch space, ONTAP volumes |
| Data migration and movement | DataSync, DMS, Transfer Family, S3 tools | Data center file share copy, database migration, partner SFTP feed |

Once the shape is clear, the next question is who owns and reaches the data. That question moves the discussion from product names into real production boundaries.

## Ownership, Access, and Boundaries
<!-- section-summary: The service choice also depends on which application, team, account, and network path owns the data. -->

Storage design includes access design. **Ownership** means which team controls the data contract, which AWS account contains the resource, and which runtime can call it. **Access** means which IAM principal, network path, and service policy allow the read or write. These details matter because a storage service that looks perfect from a data-shape view can still create a messy production system if the boundary is wrong.

For S3, the main boundary is the **bucket**. Maple Market might use one bucket for customer uploads and another bucket for finance exports because those objects have different permissions, lifecycle rules, and audit expectations. The application role can write product images, while the finance analytics role can read only the export prefix. Bucket policies, IAM policies, S3 Block Public Access, and encryption settings all become part of the storage design.

For relational databases, the main boundary is often the **database endpoint inside a VPC**. Maple Market's order database should sit in private subnets, with security groups allowing traffic from the application service and migration tools. Human engineers should not connect with a shared password pasted into local config files. In a real setup, teams usually store database credentials in AWS Secrets Manager, rotate them when possible, and make applications fetch credentials at runtime through their task role.

For DynamoDB, the main boundary is the **table and its key design**. An application role should get permission for only the table and indexes it uses. If one table contains carts, sessions, and idempotency records, the team needs a clear item naming convention and careful IAM conditions if different callers should touch different item families. Single-table designs can work well, but only when the team keeps the access contract written down.

For EBS, EFS, and FSx, the boundary includes **placement and network reachability**. EBS follows Availability Zone placement. EFS and FSx mount through private network interfaces and security groups. A team must decide which subnets have mount targets, which security groups can reach NFS or SMB ports, and how backup policies apply to the filesystem.

This is why a production storage decision should include more than a service name. A useful design note says: "the upload service writes objects under `uploads/raw/` in the customer media bucket through an ECS task role, S3 events trigger image processing, lifecycle rules expire abandoned temporary uploads, and CloudTrail data events are enabled for sensitive prefixes." That level of detail turns a service choice into an operating plan.

## Change Patterns and Consistency
<!-- section-summary: How data changes over time decides whether the system needs transactions, conditional writes, versions, locks, or filesystem semantics. -->

After shape and ownership, look at **change patterns**. A change pattern describes how often data changes, whether several facts must change together, and what readers expect while changes are happening. This part saves teams from choosing a service that stores the data but fights the workflow.

S3 object changes work well for whole-file replacement. Maple Market can upload `invoices/2026/06/order-1004.pdf`, then read that object later. S3 versioning can keep older copies when the same key receives a new object or delete marker. Lifecycle rules can move older versions to cheaper storage or expire temporary uploads. S3 is a great place for objects, but it is a poor place to coordinate a checkout transaction that updates five related business records at once.

Relational databases handle that checkout transaction because they support **ACID transactions**. ACID is the database promise that a group of changes can complete together with clear consistency rules. When Maple Market charges a payment, writes an order, reserves inventory, and records shipment details, RDS PostgreSQL or Aurora PostgreSQL can protect those related records with constraints and transactions. The team still needs good schema migrations and connection management, but the data model matches the job.

DynamoDB handles fast keyed updates through primary keys, conditional writes, and streams. A conditional write lets Maple Market create an idempotency record only if the request ID does not already exist. That protects the payment workflow from double-submit problems. The table can handle high request volume, but the design must start from known access patterns such as "get cart by customer" or "check request by idempotency key."

EBS, EFS, and FSx keep filesystem semantics for software that expects files and directories. A search index may need fast block writes on one instance, so EBS fits. A fleet of Linux workers may need a shared folder, so EFS fits. A Windows application may need SMB and Active Directory integration, so FSx for Windows File Server fits. The service choice follows the filesystem behavior the application already expects.

When a storage decision feels unclear, write three sample operations in plain language. For Maple Market, that might be "customer uploads a product photo," "customer places an order," and "finance exports yesterday's orders." Then name the required write behavior for each operation. Whole-file write points to S3. Multi-record transaction points to RDS or Aurora. Known-key update points to DynamoDB. Mounted file path points to EBS, EFS, or FSx.

## Backup, Movement, and Analytics Plans
<!-- section-summary: Production storage choices need a plan for recovery copies, migration paths, and downstream data use from the start. -->

A storage service also needs an operating plan around **recovery**, **movement**, and **analytics**. Teams often postpone these topics until the first incident or reporting request, and then the storage design suddenly needs changes at the worst possible time.

Recovery starts with the question: **what historical copy exists if a bad write happens?** S3 versioning can keep older object versions. RDS and Aurora automated backups support point-in-time restore inside a retention window. DynamoDB has point-in-time recovery and on-demand backups. EBS has snapshots. EFS and FSx can integrate with AWS Backup depending on the filesystem type and configuration. High availability protects uptime, while historical recovery protects against bad writes, deletes, and application bugs.

Movement starts with the question: **how will this data enter, leave, or move between systems?** Maple Market may import old product records from an on-premises database into Aurora using AWS Database Migration Service. It may copy a file share into EFS with AWS DataSync. It may receive partner files through AWS Transfer Family into S3. It may copy millions of S3 objects to a new prefix with S3 Batch Operations. Each path has its own identity, logging, retry, validation, and rollback story.

Analytics starts with the question: **who needs to read the data after the application writes it?** Finance may query order exports in S3 through Athena after AWS Glue catalogs the files. Operations may stream DynamoDB changes into Lambda or Kinesis. Product teams may copy RDS data into a warehouse. The production pattern is usually to keep the application service stable, then create controlled export or replication paths for downstream readers instead of letting every analytics user connect to the primary production database.

These plans do not need to be huge on day one. A simple checklist helps: enable the right backup control, tag resources with owner and environment, write the restore steps, log data movement jobs, and test a small restore before a real incident. That is the difference between "we store it somewhere" and "we can operate this data safely."

## A Practical Selection Checklist
<!-- section-summary: A short checklist turns a vague service choice into a reviewable production decision. -->

Before Maple Market creates a bucket, table, database, or filesystem, the team can review the choice with a short checklist. The checklist keeps the conversation concrete and helps junior engineers see why one service fits better than another.

| Question | What a good answer names |
|---|---|
| What is the data shape? | Object, SQL record, key-value item, block disk, shared file, migration stream |
| Who writes it? | Application role, human operator, partner system, migration tool |
| Who reads it? | Application, analytics job, customer download path, operations team |
| How does it change? | Whole-file replacement, transaction, conditional update, mounted file write |
| What consistency does it need? | Transaction rules, read-after-write needs, version recovery, file locks |
| Where does it live? | Region, Availability Zone, VPC subnet, account, bucket, table, database |
| How is access controlled? | IAM role, resource policy, security group, endpoint, secret rotation |
| How is it backed up? | Versioning, PITR, snapshots, AWS Backup plan, restore drill |
| How does it move? | DataSync, DMS, Transfer Family, S3 replication, export job |
| How is cost controlled? | Lifecycle rules, capacity mode, storage class, retention window, cleanup job |

Here is how the checklist might read for a real feature. This kind of note gives every reviewer the same concrete object to inspect.

```markdown
Feature: Customer invoice downloads
Shape: Whole PDF files
Service: S3
Writer: invoice-worker ECS task role
Reader: customer portal through short-lived presigned URLs
Access: bucket policy blocks public access; application role can put and get only invoice prefixes
Recovery: versioning enabled; lifecycle expires noncurrent versions after approved retention
Movement: nightly finance export copies metadata into analytics bucket
Cost: lifecycle moves older invoices to a cheaper storage class after normal support window
```

That note gives reviewers something specific to inspect. Security can check access. Operations can check recovery. Finance can check lifecycle. Application engineers can check the upload and download path. A service name alone cannot do that.

## Putting It All Together
<!-- section-summary: The right AWS storage design splits data by behavior and gives each piece a clear owner, access path, and recovery story. -->

Maple Market does not need one giant storage answer. It needs a few focused answers that match how the system works.

Product photos and invoice PDFs go to S3 because they are whole objects with object-level permissions, lifecycle rules, and event hooks. Checkout records go to RDS or Aurora because orders, payments, and inventory need transactions and SQL constraints. Carts, sessions, and idempotency keys go to DynamoDB when the app needs fast known-key access at high traffic. Host disks use EBS. Shared Linux paths use EFS. Windows shares, Lustre scratch storage, ONTAP, or OpenZFS workloads use FSx. Existing files and databases move through DataSync, DMS, Transfer Family, S3 replication, S3 Batch Operations, or a controlled export pipeline.

The useful habit is to describe the data before choosing the product. Name the shape, owner, read path, write path, change pattern, recovery copy, movement path, and cost control. Once those facts are visible, AWS storage choices turn into normal engineering decisions instead of a long menu of service names.

## What's Next
<!-- section-summary: The next article zooms into S3 because object storage is the first AWS storage service many applications need. -->

Now that the module has a selection path, we can zoom into the most common first service: Amazon S3. The next article follows buckets, objects, permissions, lifecycle rules, and production upload flows through one concrete file workflow.

---

**References**

- [Choosing an AWS storage service](https://docs.aws.amazon.com/decision-guides/latest/storage-on-aws-how-to-choose/choosing-aws-storage-service.html) - AWS decision guide for comparing object, file, block, cache, and data transfer storage choices.
- [Choosing an AWS database service](https://docs.aws.amazon.com/databases-on-aws-how-to-choose/) - AWS decision guide for matching database services to access patterns, data models, and operational needs.
- [Use a purpose-built data store](https://docs.aws.amazon.com/wellarchitected/latest/framework/perf_data_use_purpose_built_data_store.html) - Well-Architected guidance for selecting data stores based on workload requirements.
- [What is Amazon S3?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html) - Defines S3 buckets, objects, keys, access policies, and object storage behavior.
- [What is Amazon RDS?](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html) - Describes managed relational database engines, DB instances, Multi-AZ deployments, and backups.
- [What is Amazon Aurora?](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_AuroraOverview.html) - Explains Aurora as a managed MySQL-compatible and PostgreSQL-compatible relational database engine.
- [Core components of Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html) - Defines DynamoDB tables, items, attributes, and primary keys.
- [Amazon EBS volumes](https://docs.aws.amazon.com/ebs/latest/userguide/ebs-volumes.html) - Explains EBS block volumes and how they attach to EC2 instances.
- [What is Amazon EFS?](https://docs.aws.amazon.com/efs/latest/ug/whatisefs.html) - Describes EFS as elastic shared file storage for AWS compute and on-premises servers.
- [Amazon FSx Documentation](https://docs.aws.amazon.com/fsx/) - Provides the official guides for FSx for Windows File Server, Lustre, NetApp ONTAP, and OpenZFS.
- [AWS DataSync Documentation](https://docs.aws.amazon.com/datasync/) - Covers online file and object data movement to, from, and between AWS storage services.
- [AWS Database Migration Service Documentation](https://docs.aws.amazon.com/dms/) - Covers migration and replication for databases, warehouses, NoSQL stores, and other data stores.
