---
title: "Choosing The Right Data Service"
description: "Decide between Azure Blob Storage, Azure SQL Database, Cosmos DB, Managed Disks, and Azure Files by starting from the data behavior."
overview: "Azure data choices are easier when you describe what the data does before naming the service. This article turns storage selection into a practical review conversation."
tags: ["blob-storage", "azure-sql", "cosmos-db", "azure-files"]
order: 6
id: article-cloud-providers-azure-storage-databases-choosing-right-data-service
---

## Table of Contents

1. [The Choice Starts With A Promise](#the-choice-starts-with-a-promise)
2. [If You Know AWS Data Choices](#if-you-know-aws-data-choices)
3. [Ask What The Data Is Doing](#ask-what-the-data-is-doing)
4. [Decision Table For Everyday Azure Data Choices](#decision-table-for-everyday-azure-data-choices)
5. [Feature Review: Order Records](#feature-review-order-records)
6. [Feature Review: Receipt Files And Export Files](#feature-review-receipt-files-and-export-files)
7. [Feature Review: Idempotency And Job Status](#feature-review-idempotency-and-job-status)
8. [Feature Review: VM Disks And Shared Folders](#feature-review-vm-disks-and-shared-folders)
9. [Failure Patterns That Tell You The Choice Is Wrong](#failure-patterns-that-tell-you-the-choice-is-wrong)
10. [A Decision Record You Can Reuse](#a-decision-record-you-can-reuse)

## The Choice Starts With A Promise

Choosing a data service means choosing what kind of
promise the application needs. That promise might be:
keep this checkout record consistent. Store this PDF
receipt so the customer can download it later. Remember
that this payment request already ran. Let this VM boot
and keep its application files. Let several legacy
workers see the same folder. Those are different
promises. They should not all become "put it in the
database." They should not all become "upload it to
Blob Storage."

Azure gives you several data services because
application data does not all behave the same way.
Azure Blob Storage stores file-like objects. Azure SQL
Database stores relational records with SQL queries and
transactions. Azure Cosmos DB stores NoSQL items when
the access pattern is clear. Azure Managed Disks
provide disk-like storage for VMs. Azure Files provides
managed file shares. The confusing part is that many
features can be forced into more than one service. You
can store JSON in Blob Storage. You can store a PDF in
a SQL column. You can put order state in Cosmos DB.

You can write exports to a VM disk. Some of those
choices work for a demo and hurt later. This article
uses `devpolaris-orders-api` as a review exercise. The
service needs order records, receipt files, export
files, idempotency checks, job status, and maybe
VM-backed legacy work. The goal is to build the habit
of asking better questions before choosing.

> Start with what the app must remember, how it will read it, and what failure would hurt most.

## If You Know AWS Data Choices

AWS experience can help you get oriented. It can also
make you too confident if you skip Azure's details. Use
this bridge as a first map.

| AWS starting point | Azure starting point | Shared idea |
|---|---|---|
| S3 | Blob Storage | Durable object storage for file-like data |
| RDS | Azure SQL Database | Managed relational database for SQL records |
| DynamoDB | Cosmos DB | NoSQL item storage for known access patterns |
| EBS | Managed Disks | Disk attached to compute |
| EFS | Azure Files | Managed shared file path |

The most important shared habit is not the product
mapping. It is the review style. For any cloud
provider, ask: is this data a file, record, item, disk,
or shared folder? Who writes it? Who reads it? Does it
change in place? Does it need transactions? Does it
need to expire? Does it need to survive a process,
container, VM, or region failure? These questions
transfer across providers. The service details do not.

## Ask What The Data Is Doing

Before naming a service, describe the data in plain
English. For `devpolaris-orders-api`, a useful review
asks six questions. What is the unit of data? Is it one
order row, one receipt PDF, one idempotency item, one
VM disk, or one shared folder? Who writes it? The
checkout API writes orders. The receipt worker writes
PDFs. The export worker writes CSV files. The UI reads
job status. The legacy importer may write scratch
files. How does the app read it? Does it fetch by order
ID? Does it list all orders for one customer? Does it
download by blob name?

Does it poll by job ID? Does it mount a folder path?
Does the data change in place? Order status changes.
Receipt files usually do not. Job status changes for a
short time. Temporary files may disappear. What rule
must not break? No duplicate paid orders. No customer
reading another customer's receipt. No export marked
ready before the blob exists. No VM scratch directory
treated as durable product storage. How will the team
recover?

That question often decides whether the first design is
serious enough. A service choice without a recovery
story is only half a choice.

## Decision Table For Everyday Azure Data Choices

Use this table as a first sorting tool. It is not a
law. It is a way to make the conversation concrete.

| Data behavior | Good Azure service to inspect first | Why it fits | Question before you commit |
|---|---|---|---|
| Checkout orders with customer, items, payments, and reports | Azure SQL Database | Relationships, transactions, constraints, and flexible queries | Which writes must succeed together? |
| Receipt PDF or CSV export | Blob Storage | Durable file-like object storage | Where is ownership and authorization recorded? |
| Idempotency token read by exact key | Cosmos DB or Azure SQL Database | Known-key lookup can fit an item store | Does this need SQL transactions with the order write? |
| Job status polled by job ID | Cosmos DB or Azure SQL Database | Direct reads can fit a small item model | Will support need flexible reporting later? |
| VM boot disk or data disk | Managed Disk | VM needs disk-like storage | What happens if the VM is replaced? |
| Folder shared by legacy workers | Azure Files | Workload expects a mounted path | Could Blob Storage be simpler? |
| Temporary unzip workspace | Temporary disk or data disk | Data is disposable scratch | Is every important result copied somewhere durable? |
| Product image or public asset | Blob Storage, often with a delivery layer later | File-like data addressed by name | Who can upload and replace it? |

The best column is the last one. It turns a service
guess into a design review. For example, idempotency
can live in Cosmos DB or Azure SQL Database. If the
idempotency write must be in the same SQL transaction
as the order write, SQL may be simpler. If the
idempotency check is a separate high-volume key lookup
with clear expiry, Cosmos DB may be a good fit. The
data behavior decides.

## Feature Review: Order Records

Order records are the core of the checkout system. They
are not just blobs of JSON. They are connected business
facts. An order belongs to a customer. An order has
line items. Payment attempts belong to the order.
Receipt metadata points to a file and a customer. Those
facts need relationships and rules. For this feature,
Azure SQL Database is the normal first candidate. The
important review is not "SQL can store rows."

The important review is which invariants the database
protects. An invariant is a rule that should stay true
even when requests fail, retry, or arrive close
together.

| Invariant | Why it matters |
|---|---|
| An order cannot exist without a customer | Order history needs ownership |
| An order should not be paid without line items | The customer needs a meaningful receipt |
| A payment attempt should point to one order | Support needs an audit trail |
| A receipt pointer should match the order owner | File download must follow authorization |

Those are relational promises. A relational database is
not chosen because it is traditional. It is chosen
because the data has relationships and consistency
rules. If the team instead puts each order in one blob,
the first checkout demo may pass. The trouble appears
later. Support needs all failed payments for a
customer. Finance needs paid order totals by month.
Product needs orders that include two specific SKUs.
The app now has to list and parse files to answer
database questions. That is a sign the storage choice
is wrong.

## Feature Review: Receipt Files And Export Files

Receipt PDFs and export CSVs behave like files. The app
writes them once, stores them durably, and lets an
authorized user download them later. That points toward
Blob Storage. The database still matters. The database
should store the receipt row, order owner, status, and
blob pointer. Blob Storage should store the bytes. Here
is the useful split.

| Piece | Home | Why |
|---|---|---|
| PDF bytes | Blob Storage | Durable file-like object |
| Customer ownership | Azure SQL Database | Business authorization rule |
| Receipt status | Azure SQL Database | App workflow state |
| Blob name | Azure SQL Database row plus Blob Storage object | Pointer from business record to object |

This prevents two common mistakes. The first mistake is
putting large files directly into SQL because "the
receipt belongs to the order." The receipt does belong
to the order in the business sense. The bytes do not
need to live in the order row. The second mistake is
making the blob path the only source of truth. A path
like `receipts/cus_77/ord_1042.pdf` looks informative,
but the app should still check the database before
download. Authorization belongs in the application and
data model, not only in a naming convention.

## Feature Review: Idempotency And Job Status

Idempotency records and job-status records are smaller
and more direct. They may fit Cosmos DB, Azure SQL
Database, or sometimes both depending on the workflow.
The idempotency question is: does this duplicate
request check need to be part of the same SQL
transaction as the order write? If yes, keeping the
idempotency marker in Azure SQL Database may be
simpler. The SQL unique constraint can protect the
checkout path. If the idempotency record is a separate
key-based lookup with a short lifetime, Cosmos DB may
be a good candidate. The job-status question is: who
reads it, and how?

If the UI only asks "what is happening with job
`job_913`?", Cosmos DB can fit nicely. If support needs
rich reporting across jobs, customers, dates, worker
versions, and failure reasons, SQL may be more
comfortable. This is why the same data label can lead
to different choices. "Job status" is not enough. The
access pattern decides. Here is a review table.

| Feature | Key question | Likely first choice |
|---|---|---|
| Checkout duplicate prevention | Must it share a transaction with order creation? | Azure SQL Database if yes, Cosmos DB if separate and key-based |
| Export status polling | Does the UI read by job ID only? | Cosmos DB can fit |
| Export reporting | Does support need filters and reports? | Azure SQL Database can fit |
| Temporary session state | Should it expire naturally? | Cosmos DB with TTL can fit |

There is no prize for forcing all small records into
one service. Choose the service that matches the read
path and failure rule.

## Feature Review: VM Disks And Shared Folders

Managed Disks and Azure Files appear when the workload
expects operating-system storage. This is different
from storing product data. For example, a legacy import
worker may run on an Azure VM. The VM needs an OS disk.
It may need a data disk for scratch work. That points
toward Managed Disks. The same worker may depend on a
mounted folder of templates. If several workers must
see the same folder, Azure Files may be useful. But if
the worker only writes the final CSV export for
download, Blob Storage is usually better. The final
file should not live only on a VM disk.

The useful question is: does the application need
filesystem behavior, or does it need durable file
storage? Filesystem behavior means mounted paths,
directories, file handles, and sometimes shared access.
Durable file storage means "put these bytes somewhere
the app can read later by name." Those are not the same
promise.

## Failure Patterns That Tell You The Choice Is Wrong

Bad data choices often reveal themselves through
repeated pain. The app stores order records as blobs,
then every report becomes a batch job that lists and
parses thousands of files. That points back toward
relational storage. The app stores receipt PDFs in SQL,
then backups grow slowly and query performance suffers
around large binary columns. That points toward Blob
Storage plus SQL metadata. The app stores job status in
SQL, but the UI polls thousands of times per minute and
the query pattern is always by job ID. That might point
toward a key-based store or a different polling design.

The app stores generated exports on a VM disk, then a
deployment replaces the VM and files disappear. That
points toward Blob Storage. The app uses Azure Files
for a new service that only needs to store final files,
then the team spends time debugging mounts and locks.
That points toward object storage. The app uses Cosmos
DB for business records, then product asks for flexible
reports every week and each new query causes redesign.
That points toward SQL or a separate analytics path.
These are not moral failures. They are feedback from
the system.

When the same kind of pain repeats, inspect whether the
storage shape matches the data behavior.

## A Decision Record You Can Reuse

A good decision record is short enough to write before
implementation. It should be specific enough to catch a
weak choice. Use this format:

```text
Feature:
Data shape:
Write path:
Read path:
Changes over time:
Consistency rule:
Retention rule:
Failure we cannot accept:
Chosen Azure service:
Why this service:
What we are not using:
First recovery plan:
```

Here is the receipt example.

```text
Feature: customer receipt download
Data shape: generated PDF plus ownership metadata
Write path: receipt worker uploads PDF after payment succeeds
Read path: signed-in customer requests by order id
Changes over time: PDF should not change after creation
Consistency rule: database row must not say ready until blob exists
Retention rule: keep according to account and legal retention policy
Failure we cannot accept: one customer reads another customer's receipt
Chosen Azure service: Blob Storage for PDF, Azure SQL Database for metadata
Why this service: file bytes belong in object storage, ownership belongs in relational data
What we are not using: VM disk or Azure Files for receipt storage
First recovery plan: restore missing blob if protected, or regenerate from order data if supported
```

That record is not long. It is clear. It tells a
reviewer why the service choice matches the feature.
That is the standard you want for everyday Azure data
decisions.

---

**References**

- [What is Azure Blob Storage?](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blobs-overview) - Microsoft explains Blob Storage and common object storage use cases.
- [What is Azure SQL Database?](https://learn.microsoft.com/en-us/azure/azure-sql/database/sql-database-paas-overview) - Microsoft describes Azure SQL Database as a managed relational database service.
- [Azure Cosmos DB overview](https://learn.microsoft.com/en-us/azure/cosmos-db/overview) - Microsoft introduces Cosmos DB and its database model options.
- [Introduction to Azure managed disks](https://learn.microsoft.com/en-us/azure/virtual-machines/managed-disks-overview) - Microsoft explains managed disks as VM block storage.
- [Introduction to Azure Files](https://learn.microsoft.com/en-us/azure/storage/files/storage-files-introduction) - Microsoft explains managed file shares in Azure.
