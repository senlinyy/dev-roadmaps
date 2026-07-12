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

1. [Why Storage Exists After the Request Ends](#why-storage-exists-after-the-request-ends)
2. [Name the Data Shape Before the Service](#name-the-data-shape-before-the-service)
3. [Whole Files: Cloud Storage](#whole-files-cloud-storage)
4. [Related Records: Cloud SQL](#related-records-cloud-sql)
5. [App-Shaped Drafts: Firestore](#app-shaped-drafts-firestore)
6. [Analytical Events: BigQuery](#analytical-events-bigquery)
7. [Disk Paths and Shared Folders](#disk-paths-and-shared-folders)
8. [Recovery Copies](#recovery-copies)
9. [A First Storage Inventory](#a-first-storage-inventory)
10. [Putting It Together](#putting-it-together)
11. [References](#references)

## Why Storage Exists After the Request Ends
<!-- section-summary: Storage is the durable home for data that must still exist after one request, process, VM, or browser session ends. -->

A request is temporary. A customer uploads an inspection photo, a clinic books an appointment, a traveler saves a draft itinerary, or a media worker renders a file on a VM. The code handles the request and returns a response, yet the useful data must still exist after the process stops thinking about that one request.

**Storage** is the durable home for that data. In Google Cloud, storage can mean object storage, relational databases, document databases, analytics warehouses, VM disks, shared file systems, snapshots, versions, and backups. The service name comes after the simpler question: what shape is the data, and how does the app need to use it?

Picture six ordinary data shapes:

| Data shape | Plain job | Example |
|---|---|---|
| Whole file | Keep bytes under a name | Uploaded profile photos, ticket PDFs, inspection documents |
| Related records | Keep rows with rules | Seat reservations, appointment slots, subscription invoices |
| App-shaped draft | Keep a flexible record by path | A collaborative profile draft or shopping cart draft |
| Analytical event | Keep many facts for later questions | Product clicks, ticket-sale events, failed payment events |
| Disk path | Give software a mounted local path | VM render cache, media workstation scratch files |
| Recovery copy | Keep a previous good version | Database backup, object version, disk snapshot, audit retention copy |

![E-commerce checkout state split](/content-assets/articles/article-cloud-providers-gcp-storage-databases-gcp-storage-database-mental-model/ecommerce-state-split.png)
*One application can create several data shapes. The service choice follows the shape, the read pattern, and the recovery need.*

## Name the Data Shape Before the Service
<!-- section-summary: A useful storage choice uses read, write, query, access, and recovery behavior before any product name enters the conversation. -->

A beginner-friendly storage review asks a few direct questions. What is the smallest unit you write? How do you find it again? Does the app update one item at a time or many related records together? Does a user, service account, analyst, or VM need access? What previous copy must survive deletion, corruption, or audit review?

Those answers point to a short Google Cloud map:

| Shape | Google Cloud service | Why it fits |
|---|---|---|
| Whole files | **Cloud Storage** | Buckets hold named objects with metadata, IAM, signed URLs, lifecycle, and retention controls. |
| Related records | **Cloud SQL** | Managed PostgreSQL, MySQL, or SQL Server stores rows, tables, constraints, indexes, and transactions. |
| App-shaped documents | **Firestore** | Collections and documents work well for known paths and indexed application queries. |
| Analytical facts | **BigQuery** | Datasets and tables support SQL over large event history without sitting in the live request path. |
| VM disks | **Persistent Disk** or **Hyperdisk** | Compute Engine workloads can attach durable block storage, format it, and mount it as a filesystem. |
| Shared folders | **Filestore** | Multiple clients can mount a managed NFS file share for software that needs file semantics. |
| Previous copies | Backup, versioning, snapshots, PITR, time travel | Recovery features keep earlier states available for repair, audit, and restore drills. |

For AWS readers, the first anchors are familiar after the GCP jobs are clear. Cloud Storage maps closely to S3, Cloud SQL to RDS or Aurora for managed relational databases, Firestore to DynamoDB-style document or key-value access patterns, BigQuery to Redshift and Athena-style analytics, Persistent Disk and Filestore to EBS, EFS, or FSx depending on the filesystem need, and Google Cloud recovery controls to AWS Backup, lifecycle, versioning, and point-in-time restore patterns.

![GCP data shapes map](/content-assets/articles/article-cloud-providers-gcp-storage-databases-gcp-storage-database-mental-model/data-shapes-map.png)
*A useful storage map gives each service one clear data shape instead of asking every service to solve every problem.*

## Whole Files: Cloud Storage
<!-- section-summary: Cloud Storage fits whole file-like objects that the app writes, names, protects, and serves outside the application database. -->

**Cloud Storage** stores objects in buckets. An **object** is a byte payload plus metadata, and a **bucket** is the named container that owns location, access, retention, lifecycle, and other policy settings. A profile photo, inspection PDF, support attachment, or generated ticket file fits this shape because the application usually writes the whole payload and stores the object name somewhere else.

The simple picture is a file cabinet for whole files. The app does not ask Cloud Storage to find "all overdue invoices for customer 42." The app asks Cloud Storage to store or return the bytes for one named object. The business search usually lives in a database, and the database stores the object name as the pointer to the file.

Use this split for beginner design. Keep the photo bytes, PDF bytes, or ZIP bytes in Cloud Storage. Keep owner, status, permissions, and workflow state in the application database. Then the app can decide who may view the record and ask Cloud Storage for the exact object bytes only after that decision.

For example, an inspection app may receive photos from field staff. The relational database can store the inspection record, inspector ID, site ID, and review state. Cloud Storage can store the photo bytes at names such as `inspections/site-8842/2026/07/report-193/front-door.jpg`.

That split keeps large files out of tables that should hold searchable business records. The database stores a pointer to the object, while Cloud Storage handles object durability, metadata, access, signed download links, lifecycle cleanup, and retention policies.

## Related Records: Cloud SQL
<!-- section-summary: Cloud SQL fits business records that need tables, relationships, constraints, and transactions. -->

**Cloud SQL** is Google Cloud's managed relational database service for PostgreSQL, MySQL, and SQL Server. A relational database stores data in tables and lets the team define relationships, constraints, indexes, and transactions. It fits data where the rules between records are part of the business.

Think of a relational database as the system that keeps related business records honest. A seat reservation is not just one blob of data. It touches events, seats, customers, reservations, payments, and refunds. The database can enforce that a payment points to a real reservation and that two customers do not hold the same seat for the same event.

That is why Cloud SQL is usually a better first fit for bookings, billing records, appointments, ledgers, and subscription state. The team needs more than storage; it needs coordinated writes and rules that survive retries, concurrent requests, and partial failures.

A seat reservation system is a clean example. A venue has events, sections, seats, reservations, payments, and refunds. During a two-seat reservation, the app needs one coordinated database change: mark the seats held, create the reservation, record the payment attempt, and release the hold if the payment fails.

A **transaction** gives that coordinated boundary. If one write fails, the database can roll the related writes back together. That behavior is the reason finalized reservations, appointment bookings, subscription billing records, and ledgers usually belong in a relational database rather than object storage or an analytics table.

## App-Shaped Drafts: Firestore
<!-- section-summary: Firestore fits application documents that are read by known paths or planned indexed queries. -->

**Firestore** is a document database. It stores **documents** inside **collections**, and a document can look close to the data object your app already passes around. It fits state such as collaborative profile drafts, support case notes, shopping cart drafts, and small workflow records that the app reads by path or by planned queries.

A document database is useful for records that have a natural owner and screen shape. A draft profile, for example, may have optional sections, nested fields, a last editor, and a status. The app often loads the whole draft to render one screen, then updates a few fields as the user edits.

Firestore still needs planning. It is not a free-form box for any JSON the app invents. The collection path, indexed query, document size, security rule, and recovery plan all need names before the collection grows. If the record starts to need strict joins or multi-table financial rules, move that part of the design toward a relational database.

A collaborative profile editor might keep a draft at `profiles/user_391/drafts/current`. That document can hold display name, biography, avatar object name, section completion state, and the last editor. The frontend can save partial progress without needing a relational table for every optional field.

Firestore still needs design discipline. Query patterns and indexes should be planned before the collection grows, and security rules or backend IAM access should match how users and services read data. A draft that turns into a billing record, reservation, or legal record with strict relationships should move to Cloud SQL or another relational choice.

## Analytical Events: BigQuery
<!-- section-summary: BigQuery fits questions over many historical rows, separate from the database that serves one live user request. -->

**BigQuery** is Google Cloud's serverless analytics warehouse. It stores analytical data in datasets and tables, then lets teams run SQL over many rows. The word **analytics** is the key. BigQuery is for questions about history, patterns, totals, funnels, and comparisons across many records.

Those questions are different from a live request. The app database needs to answer one user's request quickly and safely. BigQuery can scan historical events, aggregate many users, compare releases, and feed dashboards without adding warehouse work to the request path.

Imagine a checkout service writing one event each time a customer reserves seats, starts payment, completes payment, or sees an error. The live database keeps the reservation safe. BigQuery keeps the event history so the business can ask larger questions later: did the new checkout release increase failed payments, which venues sold out fastest, or which device type has the highest abandonment rate?

An event table might store `event_timestamp`, `event_name`, `user_id`, `page`, `device`, `release_sha`, and a small set of business fields. Product analytics, finance reports, support investigations, and incident reviews can query that history later.

The practical design habit is to keep raw facts and cleaned tables separate. Raw events preserve what the app emitted. Curated tables clean names, remove duplicates, standardize timestamps, and make common dashboard questions easier. That split protects the live app database and gives analysts a stable place to work.

## Disk Paths and Shared Folders
<!-- section-summary: Persistent Disk, Hyperdisk, and Filestore fit software that needs operating-system storage paths rather than service APIs. -->

Some workloads need a path on a machine. A legacy importer may write temporary files to `/var/lib/importer`. A media processing workstation may need a fast render cache at `/mnt/render-cache`. Several render workers may need to share `/mnt/media-inbox` because the software expects normal file operations.

This is the storage shape closest to a traditional server. The software is not asking for an object named `ticket.pdf` through an API. It is asking the operating system to open a local or shared path. That path may need filesystem permissions, directory scans, temporary files, file locks, and tools that expect POSIX-like behavior.

The key question is one VM or many clients. A single VM that needs its own disk path usually points to Persistent Disk or Hyperdisk. Several clients that need the same shared folder usually point to Filestore. If the application only stores finished files and can use an object API, Cloud Storage is usually simpler.

**Persistent Disk** and **Hyperdisk** are durable block storage options for Compute Engine. A block disk acts like a device the operating system formats and mounts. One VM can use that mounted path for application files, caches, local databases, or legacy software that cannot write to an object API.

**Filestore** is managed file storage that clients mount over NFS. It fits shared directories, handoff folders, and legacy applications that depend on POSIX-like file behavior. Choose Filestore because the software needs a shared filesystem, permissions, and file operations across clients.

For AWS readers, Persistent Disk and Hyperdisk map to the EBS block-storage family. Filestore maps more closely to EFS or FSx, depending on protocol and workload needs.

## Recovery Copies
<!-- section-summary: Durable storage preserves bad writes too, so each data shape needs previous copies and restore practice. -->

Storage design includes the day something goes wrong. A user deletes a document by mistake. A bad deploy corrupts appointment rows. A lifecycle rule removes inspection photos too early. An analyst replaces a BigQuery table with incomplete data. A VM script overwrites a render directory.

Durable storage preserves mistakes too. If a bad import overwrites database rows, the database will faithfully keep the bad rows until you repair them. If a cleanup job deletes objects, a durable object store will not automatically know the deletion was accidental. Recovery design gives the team a previous good copy and a tested path to use it.

The useful beginner question is: what previous state would we need after a mistake? For Cloud SQL, that might be a point-in-time clone. For Cloud Storage, it might be object versioning or soft delete. For BigQuery, it might be time travel or a table snapshot. For a VM disk, it might be a snapshot that can create a replacement disk.

**Recovery copies** are previous states the team can use after deletion, corruption, or audit requests. They include Cloud Storage object versions, soft delete windows, retention policies, Cloud SQL backups, point-in-time recovery, Firestore backups, BigQuery time travel, table snapshots, Persistent Disk snapshots, and Filestore backups or snapshots where the chosen tier supports them.

The first recovery questions are **RPO** and **RTO**. Recovery Point Objective means how much data change the business can afford to lose. Recovery Time Objective means how long the business can spend restoring useful service. A clinic appointment database may need a short RPO, while a product analytics table may tolerate a longer rebuild window from raw events.

## A First Storage Inventory
<!-- section-summary: A storage inventory turns abstract service choice into a practical list of data owners, access paths, and recovery needs. -->

A useful first inventory can fit in one table. The goal is to name each data set, its shape, the service that owns it, and the recovery promise your team must test.

| Data set | Shape | First service | Access pattern | Recovery need |
|---|---|---|---|---|
| Profile photos | Whole files | Cloud Storage | App writes object, browser downloads by signed URL | Versioning, soft delete, lifecycle cleanup |
| Seat reservations | Related records | Cloud SQL | API reads and writes inside transactions | Automated backups, PITR, restore drills |
| Profile drafts | App-shaped documents | Firestore | Frontend or backend reads by document path | Scheduled backups or PITR for bad writes |
| Product events | Analytics rows | BigQuery | Analysts query many rows by date | Time travel, snapshots, raw event replay |
| Render cache | Mounted disk path | Persistent Disk or Hyperdisk | VM reads and writes local path | Snapshots and rebuild process |
| Shared media inbox | Shared folder | Filestore | Multiple workers mount the same NFS share | Backups, snapshots, permissions review |
| Audit copies | Previous versions | Service-specific recovery controls | Compliance and incident responders inspect prior state | Retention policy and restore sandbox |

The inventory also names ownership. The app team may own schema changes, object naming, and draft paths. The platform team may own bucket policy, networking, backups, and service accounts. The data team may own BigQuery datasets, cost controls, views, and retention.

## Putting It Together
<!-- section-summary: A good GCP storage choice follows data shape, access behavior, and recovery needs before service names. -->

Google Cloud storage is the durable layer for many data shapes. Whole files fit Cloud Storage, related records fit Cloud SQL, app-shaped drafts can fit Firestore, analytical events fit BigQuery, VM paths fit Persistent Disk or Hyperdisk, shared folders fit Filestore, and previous copies need backup and retention controls.

The practical habit is simple: describe the data before naming the service. After that, service names stop competing and each one gets a clear job.

![Storage choice summary](/content-assets/articles/article-cloud-providers-gcp-storage-databases-gcp-storage-database-mental-model/storage-choice-summary.png)
*The summary map should help you explain why each data shape lives where it does.*

## References

- [Cloud Storage documentation](https://cloud.google.com/storage/docs) - Official documentation for buckets, objects, access, lifecycle, retention, and recovery controls.
- [Cloud SQL documentation](https://cloud.google.com/sql/docs) - Official documentation for managed relational databases on Google Cloud.
- [Firestore documentation](https://cloud.google.com/firestore/docs) - Official documentation for document databases, queries, indexes, rules, backups, and PITR.
- [BigQuery documentation](https://cloud.google.com/bigquery/docs) - Official documentation for analytics datasets, tables, SQL, access, cost, and recovery features.
- [Persistent Disk documentation](https://cloud.google.com/compute/docs/disks/persistent-disks) - Official documentation for durable block storage attached to Compute Engine VMs.
- [Filestore documentation](https://cloud.google.com/filestore/docs) - Official documentation for managed NFS file shares on Google Cloud.
