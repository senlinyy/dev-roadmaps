---
title: "What Is Storage"
description: "Choose the right Google Cloud home for durable app data by matching files, records, drafts, events, VM paths, shared folders, and recovery copies to the shape of the data."
overview: "Storage design follows data that must survive after a request ends. The guide maps common data shapes to Cloud Storage, Cloud SQL, Firestore, BigQuery, Persistent Disk, Filestore, and recovery controls."
tags: ["gcp", "storage", "databases", "cloud-storage", "cloud-sql"]
order: 1
id: article-cloud-providers-gcp-storage-databases-gcp-storage-database-mental-model
aliases:
  - gcp-storage-and-database-mental-model
  - storage-and-database-mental-model
  - choosing-the-right-gcp-data-service
  - what-is-data-storage
  - article-cloud-providers-gcp-storage-databases-choosing-right-gcp-data-service
  - cloud-providers/gcp/storage-databases/gcp-storage-and-database-mental-model.md
  - cloud-providers/gcp/storage-databases/choosing-the-right-gcp-data-service.md
  - cloud-providers/gcp/storage-databases/what-is-data-storage.md
---

## Table of Contents

1. [Why Must Storage Outlive Computation?](#why-must-storage-outlive-computation)
2. [How Does Data Shape Reveal the Access Pattern?](#how-does-data-shape-reveal-the-access-pattern)
3. [When Do Objects and Relational Records Need Different Homes?](#when-do-objects-and-relational-records-need-different-homes)
4. [When Do Documents and Analytics Need Different Systems?](#when-do-documents-and-analytics-need-different-systems)
5. [How Do Block and File Storage Provide Paths?](#how-do-block-and-file-storage-provide-paths)
6. [Why Are Durability, Availability, and Backup Different?](#why-are-durability-availability-and-backup-different)
7. [How Do You Map Sources of Truth to Google Cloud Services?](#how-do-you-map-sources-of-truth-to-google-cloud-services)
8. [How Does One Application Use All These Storage Models?](#how-does-one-application-use-all-these-storage-models)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Imagine an order request arriving at an application:

```text
POST /orders

customer = Alice
item     = Book
price    = £20
```

While the request is running, the program can keep those values in memory. Memory belongs to that running process and ultimately to a machine. If the process crashes, scales down, restarts after a deployment, or is replaced by another instance, its in-memory order disappears with it. That is acceptable for temporary calculation results. It is unacceptable for an order, photograph, account balance, customer, invoice, or audit event.

Storage supplies a state boundary outside the current computation:

```text
computation now
      │ write
      ▼
   storage
      │ read later
      ▼
future computation
```

The future computation does not have to be the same request handler. It may be another process, another VM, or a new application instance created days later. This independent lifetime is storage's first and deepest responsibility.

The word **storage**, however, covers many unlike things. A five-gigabyte video, a customer's address, a shopping cart, fifty billion click events, a Linux filesystem, and a directory shared by five servers all need to survive computation. They do not need the same interface or guarantees. Saying “we need to store data” is therefore only the beginning of the design.

Keep these questions in view as you work through the lesson:

1. **Why Must Storage Outlive Computation?**
2. **How Does Data Shape Reveal the Access Pattern?**
3. **When Do Objects and Relational Records Need Different Homes?**
4. **When Do Documents and Analytics Need Different Systems?**
5. **How Do Block and File Storage Provide Paths?**
6. **Why Are Durability, Availability, and Backup Different?**
7. **How Do You Map Sources of Truth to Google Cloud Services?**
8. **How Does One Application Use All These Storage Models?**

## Why Must Storage Outlive Computation?
<!-- section-summary: Storage gives important information a lifetime separate from the process or machine that created it. -->

![E-commerce checkout state split](/content-assets/articles/article-cloud-providers-gcp-storage-databases-gcp-storage-database-mental-model/ecommerce-state-split.png)
*A request may produce several durable forms of state, each with its own access and recovery requirements.*

The useful direction of reasoning is:

```text
data requirement
      ↓
access pattern
      ↓
storage model
      ↓
Google Cloud service
```

Starting with a catalogue of product names reverses that reasoning. Cloud Storage, Cloud SQL, Firestore, and BigQuery all preserve information, yet each is shaped around a different promise to later computations.

## How Does Data Shape Reveal the Access Pattern?
<!-- section-summary: The way an application addresses, reads, updates, and queries data reveals the storage model it needs. -->

**Data shape** means more than file format. It describes how the application believes the information can be addressed and manipulated. Consider five requests:

```text
“Give me photo.jpg.”

“Find every unpaid order for customer 183,
including its line items.”

“Load document user-42/drafts/7.”

“Across five years of clicks, group purchases
by acquisition source and month.”

“Open /var/lib/app/data/index.db.”
```

The photograph is one named blob of bytes. The order query needs structured records and relationships. The draft is an application-shaped document. The analytical question scans and aggregates enormous history. The legacy program expects a filesystem path. Their encodings might all involve JSON, CSV, SQL rows, or files, but encoding alone does not choose the storage system.

Ask about operations instead:

- How is one item addressed?
- How is it queried?
- How often does it change?
- How many writers may change it?
- Must one operation update several records together?
- How much data does one query inspect?
- What latency does the caller need?
- What previous state must remain recoverable?

These questions also separate **storage systems** from **databases**. A storage system fundamentally preserves and retrieves bytes. A database adds opinions and machinery for some combination of structure, indexes, queries, concurrency, transactions, constraints, relationships, and consistency rules.

For example, object storage can understand:

```text
object named invoices/8392.pdf
        ↓
       bytes
```

A relational database can understand that an order refers to a customer and a payment refers to an order. It can follow those relationships in a query and enforce rules about them. A database is therefore not universally superior storage. It is more opinionated storage, and those opinions are valuable when they match the application.

![GCP data shapes map](/content-assets/articles/article-cloud-providers-gcp-storage-databases-gcp-storage-database-mental-model/data-shapes-map.png)
*The central decision is the application's unit of thought: object, row, document, analytical history, block device, shared path, or recovery state.*

Storage systems also differ along independent axes: latency, throughput, durability, availability, consistency, query expressiveness, transaction semantics, scale, cost, geographic distribution, concurrency, and recovery. “Which database is fastest?” is incomplete because fetching a 4 MB image, atomically updating five related records, scanning 40 TB, and opening `/shared/a.txt` measure different work.

## When Do Objects and Relational Records Need Different Homes?
<!-- section-summary: Cloud Storage addresses whole blobs by name, while Cloud SQL understands related records and coordinated transactions. -->

Suppose users upload photographs, reports, videos, archives, and model files. The usual operations are simple:

```text
put this blob
get this blob
delete this blob
```

That is **object storage**. Cloud Storage keeps objects inside buckets. An object combines data, metadata, and a name. The useful lookup model is:

```text
(bucket, object name)
        ↓
       bytes
```

A bucket might contain names such as `products/100/front.jpg` and `products/202/manual.pdf`. Those slashes can make names easy to organize, but the foundational abstraction remains named objects rather than an ordinary remote hard disk.

A filesystem normally exposes operations including opening a file, seeking to a byte position, changing small regions, renaming directories, and locking files. Object storage naturally exposes object-level create, read, replace, delete, and list operations. Cloud Storage has filesystem-oriented capabilities, including hierarchical namespace folders and Cloud Storage FUSE, but an application that demands low-latency filesystem block updates still has a different access pattern.

The object model also lets application servers remain disposable. If an uploaded file lives only at `/home/app/uploads/photo.jpg` on server 8, other servers must somehow find or copy it. If all servers use Cloud Storage, the file has one independent home and any authorized instance can retrieve it. This is why object storage fits scalable application uploads so naturally.

Now compare an online shop. It has customers, orders, products, order items, and payments. One order refers to a customer; each item refers to an order and product. The data consists of individually addressable structured records plus relationships between them.

A **relational database** represents this shape as tables and rows:

```text
CUSTOMERS

id | name
---+------
42 | Alice

ORDERS

id   | customer_id | total
-----+-------------+------
9001 | 42          | 20
```

The key idea is not the SQL spelling. The database understands the records as structured facts rather than opaque objects. It can answer “all orders for customer 42,” combine related tables, and enforce relationships.

Cloud SQL is Google Cloud's managed service for PostgreSQL, MySQL, and SQL Server. Google manages much of the surrounding infrastructure, including areas such as backups, maintenance, networking, monitoring, and high-availability options. The application team still designs tables, indexes, queries, schemas, and transactions.

Transactions matter because one business operation often requires several writes. Buying the last book may reduce inventory, create an order, create its line items, and record payment state. A crash after only two writes would leave contradictory information. A transaction treats those changes as one logical unit: either they all commit or none does. That protection is part of the data model, not merely a place to put bytes.

This gives the first strong contrast:

| Storage model | Natural request | Google Cloud service |
|---|---|---|
| Object | “Return this named blob.” | Cloud Storage |
| Relational | “Store and coordinate related records.” | Cloud SQL |

## When Do Documents and Analytics Need Different Systems?
<!-- section-summary: Firestore centers application-shaped documents, while BigQuery centers scans and aggregates over large historical datasets. -->

Some application state already has the shape of one self-contained object. A collaborative note might include a title, owner, text, tags, and nested preferences. The common operations may be “read this document,” “change this document,” and “listen for this document to change.” Decomposing every nested value into separate relational tables may add work without helping the dominant access pattern.

This motivates a **document database**. Firestore stores application-shaped documents in collections and supports queries and transactions while Google manages infrastructure, replication options, and automatic serverless scaling. A path can look like:

```text
users
└── user-42
    ├── name: "Alice"
    └── drafts
        └── draft-17
            ├── title: "Holiday"
            ├── text: "..."
            └── updatedAt: ...
```

The design is pulled toward documents that the application reads and changes as units. This does not make relational databases old or document databases automatically modern. Banking accounts, transactions, currencies, customers, and regulatory records may benefit from strong relationships and structured queries. User profiles, game state, drafts, and mobile state may map directly to documents. The right question is how the application naturally reads and updates the information.

Analytical data creates another problem entirely. Imagine that every page view, search, product view, basket addition, and purchase produces an event. After a year, the system has billions of rows. A question such as “what percentage of UK users acquired through paid search returned within 30 days, grouped by device and purchase category?” may examine vast amounts of history.

An application database usually performs many small, frequent operations: fetch one order, update one customer, or insert one payment. This is often called **online transaction processing**, or OLTP. Analytics performs large scans, joins, groupings, and aggregates over millions or billions of records. This is often called **online analytical processing**, or OLAP. Physical designs that make one workload excellent are not automatically ideal for the other.

BigQuery is Google Cloud's serverless analytical platform and data warehouse. Its architecture separates storage from compute and uses column-oriented table storage designed for analytics. Applications and pipelines place historical data in BigQuery; analysts use SQL to turn that history into business answers.

Cloud SQL and BigQuery both expose rows, columns, and SQL, so syntax alone cannot distinguish them. The workload does:

```text
Cloud SQL
“Did customer 42 pay for order 9001?”
→ operate the business

BigQuery
“Across eight billion orders, how did basket size
change by market, campaign, and cohort?”
→ analyse the business
```

Firestore is different again. Its centre of gravity is an application-shaped document addressed by path or a planned document query. Together, the three database models answer different promises: relational correctness, document-shaped application state, and large-scale historical analysis.

## How Do Block and File Storage Provide Paths?
<!-- section-summary: Block storage supplies disk-like devices for one machine, while Filestore supplies a shared filesystem that multiple clients mount. -->

Not every program was written for an object or database API. Some software simply calls `open("/var/lib/myapp/data.db")` or writes to `/srv/uploads`. Its operating system expects a filesystem, and a filesystem usually sits above a block device:

```text
application
    ↓
file path
    ↓
filesystem
    ↓
blocks
    ↓
disk
```

**Block storage** behaves approximately like a disk attached to a computer. It provides addressable blocks, not filenames or directories. The operating system creates a filesystem such as `ext4` on the device and mounts it at a useful path. A database engine might then use `/var/lib/postgresql`, while the filesystem translates its file operations into block reads and writes.

Compute Engine's durable block-storage choices include Hyperdisk and Persistent Disk. Google recommends Hyperdisk where it is supported; both present network-backed block devices that a VM can use much like a physical disk. The important promise is “give this machine something disk-like.” The disk is not itself the database, and it is not yet a filesystem until the operating system formats and mounts it.

The block storage and VM lifetimes can be separate. A disk can remain when one VM is deleted, then attach to a replacement VM. That independence is useful for boot disks, data disks, application state, and software built around ordinary local paths.

Now suppose several machines all need `/shared/render-assets`. An ordinary single-host filesystem does not naturally become safe simply because its block device is visible to multiple writers. Each operating system may believe it owns filesystem metadata, allocation, and caches. Without specialized coordination, simultaneous writers can corrupt it.

A **network filesystem** puts a file server in the middle. Clients send open, read, write, rename, status, and locking requests over the network. NFS, or Network File System, is a common Unix/Linux protocol for that model. Filestore provides managed NFS storage that Compute Engine, GKE, and other clients can mount.

The distinction is concise:

```text
Persistent Disk / Hyperdisk
→ the service supplies blocks
→ your operating system creates and owns the filesystem

Filestore
→ the service supplies a shared filesystem
→ clients mount it over NFS
```

Cloud Storage and Filestore may both contain photographs, documents, models, and datasets, yet their interfaces remain different. Use Cloud Storage when the application naturally gets and puts objects. Use Filestore when several machines require a shared mounted namespace and ordinary filesystem behavior. Do not select NFS simply because the stored thing is colloquially called a file.

## Why Are Durability, Availability, and Backup Different?
<!-- section-summary: Durable and replicated systems preserve current state, while backups retain earlier states that can be recovered after logical damage. -->

Persistent data is not indestructible data. Suppose a database uses durable storage and someone executes `DELETE FROM customers`. The storage system faithfully preserves the deletion. Durability succeeded; the information was still lost. That is why durability and backup are separate properties.

Replication does not necessarily provide historical recovery either. If three current copies receive the same disastrous deletion, all three remain consistent with the wrong present. Replication protects against failures such as losing hardware. It may also replicate valid but harmful writes.

A **backup** preserves an earlier recoverable state:

```text
Monday state ──┐
Tuesday state ─┼── retained recovery points
Wednesday ─────┘

Thursday corruption
        ↓
restore Wednesday
```

Availability and recovery therefore answer different questions. High availability can let a standby continue when a primary fails. A backup can return the system to an older good point after corruption or deletion. Important systems commonly need both.

Google Cloud services expose different historical mechanisms: database backups and point-in-time recovery, disk snapshots, filesystem snapshots, object versioning, soft deletion, BigQuery time travel, and other service-specific controls. Backup and DR Service can centrally manage policies and recovery for supported workloads; backup vaults can enforce immutability and retention so protected backups cannot simply be modified or deleted early.

The mechanism follows the data shape, but the first-principles question remains the same: if the primary state is wrong or gone, how will the team reconstruct it? That question must include actual restore practice. A configured backup that has never been restored does not prove that the application, credentials, networking, and data will work together during an incident.

## How Do You Map Sources of Truth to Google Cloud Services?
<!-- section-summary: Recovery priority depends on which stores are authoritative and which can be rebuilt from retained source data. -->

An application may use Cloud SQL, BigQuery, Cloud Storage, and a cache at the same time. They are not necessarily equally authoritative. Cloud SQL might be the source of truth for orders, Cloud Storage for uploaded invoices, BigQuery an analytical copy of order history, and the cache a disposable acceleration layer.

For each store, ask: if this disappears, where can it be rebuilt from? “Nowhere” means the data is authoritative and deserves protection appropriate to its importance. “Rebuild it from retained source events” means it is derived state.

Derived data changes cost and recovery decisions. A thumbnail regenerated from an original photograph need not receive the same backup priority as the original. A BigQuery table completely rebuilt from retained source events differs from the only copy of an order. This distinction affects retention, recovery order, cost, and acceptable downtime.

A first inventory for an online shop might look like this:

| Data | Natural shape | Role | Initial Google Cloud mapping |
|---|---|---|---|
| Customers, orders, payments | Related structured records | Transactional source of truth | Cloud SQL |
| Product photographs | Whole binary objects | Source objects | Cloud Storage |
| User draft basket or preferences | Application-shaped record | Document or transactional state, depending on design | Firestore or Cloud SQL |
| Click and purchase events | Large historical event set | Analytics | BigQuery |
| VM application filesystem | Disk blocks and files | Machine-owned runtime state | Hyperdisk or Persistent Disk |
| Shared rendering assets | Shared paths | Multi-client file namespace | Filestore |
| Previous valid states | Historical recovery copies | Recovery | Service backups, snapshots, versions, or Backup and DR |

This inventory clarifies the architecture before any resources are created. It also forces the team to describe access patterns rather than treating service popularity as a selection rule.

The mapping is only an initial one. Storage products vary in latency, throughput, consistency, query power, transactions, distribution, concurrency, and recovery. The workload decides which properties matter. There is no single ranking that makes one service the “best storage.”

## How Does One Application Use All These Storage Models?
<!-- section-summary: A complete purchase flow assigns every kind of data to the service whose native interface and guarantees match it. -->

Consider a user buying a book. The product record contains an ID, name, price, and object name such as `products/77/front.jpg`. Structured product and order facts can live in Cloud SQL, while the JPEG bytes live in Cloud Storage. The database refers to the object; it does not need to contain the 4 MB image itself.

When the user places the order, the application starts a relational transaction. It creates the order and lines, adjusts inventory, and records payment state as one coordinated operation. Relationships and business correctness make Cloud SQL a natural home.

The application also emits events such as `ProductViewed`, `AddToBasket`, `CheckoutStarted`, and `OrderPlaced`. Those events eventually enter BigQuery, where analysts can ask which products receive many views but few purchases. BigQuery handles large-scale historical querying rather than acting as another live checkout database.

The user's personal state may include saved filters, recent products, and draft preferences. If the dominant operations address that state as application-shaped documents, Firestore may fit. This is a design choice based on reads, writes, and invariants rather than the fact that the data can be encoded as JSON.

Specialist software on a Compute Engine VM may still need `/var/lib/search-index`. A Hyperdisk or Persistent Disk can provide the durable block device, an operating-system filesystem can turn its blocks into files, and a mount can expose the files at the required path. If a rendering cluster needs one `/assets` directory on every worker, Filestore can provide a shared NFS namespace.

Finally, every authoritative dataset needs a recovery answer. The team asks what happens after deletion, corruption, compromised credentials, or a failed region; how far back recovery must reach; how quickly it must complete; and whether a restore has actually been tested. The answers lead to database backups and point-in-time recovery, object versions or soft deletion, disk and filesystem snapshots, BigQuery historical controls, and protected Backup and DR policies as appropriate.

![Storage choice summary](/content-assets/articles/article-cloud-providers-gcp-storage-databases-gcp-storage-database-mental-model/storage-choice-summary.png)
*One application can use several storage services cleanly because each service owns a different promise to future computation.*

The complete mental model is:

| Model | First-principles question | Google Cloud example |
|---|---|---|
| Object | “Can I retrieve this named blob of bytes?” | Cloud Storage |
| Relational | “Can I query and update related records transactionally?” | Cloud SQL |
| Document | “Can I store this application-shaped record by document?” | Firestore |
| Analytical | “Can I scan and aggregate enormous history?” | BigQuery |
| Block | “Can this machine receive a disk-like device?” | Hyperdisk or Persistent Disk |
| File | “Can several machines share ordinary paths?” | Filestore |
| Backup | “Can I return to an earlier good state?” | Service backups, snapshots, or Backup and DR |

Storage architecture is ultimately about the promises later computations require from preserved bytes: remember the exact file, maintain relationships, update atomically, retrieve a document, analyse billions of events, look like a disk, share one directory, or restore yesterday's valid state. Naming that promise first makes the service choice far easier.

### Recheck the choice from the operation, not the encoding

Before accepting the map, test it against the concrete work. A photograph may be described in a JSON record, yet the image bytes remain one object. An order can be exported as JSON, yet the live system may still require foreign keys and a transaction. Click events can arrive as CSV, yet the important query still scans billions of historical values. A SQLite database is one file, yet the program using it still requires block-backed filesystem behavior rather than object replacement semantics.

For every dataset, write down one representative read and one representative write. Then record whether the operation needs a name lookup, a relationship, a document path, a full historical scan, a mounted path, or an earlier state. Add the number of concurrent writers and the largest amount of data one request examines. Those facts make an initially vague requirement testable.

Also state which promise would hurt most if it failed. A delayed product image may be inconvenient; a partially recorded payment may violate a business invariant. Rebuilding thumbnails may be routine; losing original uploads may be impossible. Reading a daily analytical report in seconds may be acceptable; checkout normally needs a much shorter response. These are independent properties, so the chosen service does not have to win every comparison—only the comparisons that matter for that dataset.

Finally, record the boundary between managed infrastructure and application responsibility. Cloud SQL can operate database infrastructure while the team remains responsible for schema and transactions. Firestore can scale serving infrastructure while the team owns document and query design. Cloud Storage can preserve objects while the application owns their business meaning. Hyperdisk can preserve blocks while the guest owns the filesystem. A managed service narrows operational work; it does not decide what the stored information means.

### Reconstruct the decision without product names

Take the shop inventory and temporarily hide every Google Cloud label. Product photographs need retrieval by stable names and do not need relational queries across pixel content. Orders, customers, line items, and payments need structured relationships and atomic multi-record updates. User preferences may be addressed as one application aggregate. Event history needs large scans and groupings. One specialist server needs a mounted local path, while rendering workers need one shared directory. Each authoritative category needs older recoverable state.

Only after those statements are stable should the names return: Cloud Storage, Cloud SQL, Firestore, BigQuery, Hyperdisk or Persistent Disk, Filestore, and service-native recovery or Backup and DR. This exercise exposes mismatches. If a team selects Filestore but cannot name any required filesystem operation, object storage may be simpler. If it selects Firestore while its core rule spans strongly related records, a relational model deserves another look.

The inventory is also a recovery map. Mark each row as authoritative, derived, or temporary. Authoritative product images and orders need independent protection. Thumbnails and reproducible analytical summaries may be rebuilt. A cache can disappear by design. Then order recovery by business importance instead of treating every stored byte identically.

Finally, revisit geography and concurrency. The same natural data shape can still require different location, availability, consistency, and cost choices. The service category identifies the right interface; detailed configuration supplies the promises this workload needs inside that category.

This method also avoids mistaking persistence for recoverability. A durable relational row, object, document, block, or file share can faithfully preserve a harmful update. For every authoritative row in the inventory, add the earlier state that survives, the identity allowed to restore it, and the maximum acceptable loss and delay. Storage selection and recovery design are one conversation because future computation may need either today's bytes or yesterday's valid bytes.

Repeat the inventory after access patterns change. A small operational report may begin in Cloud SQL and later move to BigQuery after it grows to billions of records. A shared NFS application may move toward Cloud Storage after it learns object operations. The correct initial model is a reasoned starting point, not a permanent product attachment.

## Check Your Answers

:::expand[Why Must Storage Outlive Computation?]{kind="recap"}
Storage gives data a lifecycle independent of the request, process, or machine that created it, so a later computation can retrieve the information.
:::

:::expand[How Does Data Shape Reveal the Access Pattern?]{kind="recap"}
Data shape describes how the application addresses, queries, updates, and coordinates information. Those operations reveal whether it needs objects, relational records, documents, analytical scans, disk blocks, shared paths, or recovery history.
:::

:::expand[When Do Objects and Relational Records Need Different Homes?]{kind="recap"}
Cloud Storage fits named whole blobs. Cloud SQL fits structured records whose relationships, constraints, and multi-step transactions are part of correctness.
:::

:::expand[When Do Documents and Analytics Need Different Systems?]{kind="recap"}
Firestore centres self-contained application documents and their planned queries. BigQuery centres large scans and aggregates over historical datasets.
:::

:::expand[How Do Block and File Storage Provide Paths?]{kind="recap"}
Hyperdisk and Persistent Disk provide blocks that one machine formats and mounts. Filestore provides an already managed filesystem that multiple clients mount through NFS.
:::

:::expand[Why Are Durability, Availability, and Backup Different?]{kind="recap"}
Durability and replication preserve current state, including bad writes. Availability keeps the current service running; backups preserve earlier states for recovery.
:::

:::expand[How Do You Map Sources of Truth to Google Cloud Services?]{kind="recap"}
Identify authoritative data, derived data, access patterns, and recovery needs, then map each shape to the service whose native model matches it.
:::

:::expand[How Does One Application Use All These Storage Models?]{kind="recap"}
One application can use Cloud Storage for objects, Cloud SQL for transactions, Firestore for documents, BigQuery for analytics, block or file storage for paths, and service-specific controls for recovery.
:::

## References

- [Cloud Storage overview](https://docs.cloud.google.com/storage/docs/introduction)
- [Cloud SQL overview](https://docs.cloud.google.com/sql/docs/introduction)
- [Firestore overview](https://docs.cloud.google.com/firestore/native/docs/overview)
- [BigQuery overview](https://docs.cloud.google.com/bigquery/docs/introduction)
- [Hyperdisk overview](https://docs.cloud.google.com/compute/docs/disks/hyperdisks)
- [Filestore documentation](https://docs.cloud.google.com/filestore/docs)
- [Backup and DR overview](https://docs.cloud.google.com/backup-disaster-recovery/docs/concepts/backup-dr)
