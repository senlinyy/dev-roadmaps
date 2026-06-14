---
title: "What Is Storage"
description: "Choose the right Google Cloud home for checkout data by matching receipts, orders, drafts, events, disks, file shares, and recovery copies to the service that fits the job."
overview: "A checkout system creates several kinds of state: files, rows, documents, events, disks, shared media, and previous copies. This article follows one Orders product and maps each kind of state to the Google Cloud storage service that matches how the team uses it."
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

1. [The Checkout Scenario](#the-checkout-scenario)
2. [What Storage Means In Google Cloud](#what-storage-means-in-google-cloud)
3. [Receipt PDFs: Cloud Storage](#receipt-pdfs-cloud-storage)
4. [Orders And Payments: Cloud SQL](#orders-and-payments-cloud-sql)
5. [Checkout Drafts: Firestore](#checkout-drafts-firestore)
6. [Checkout Events: BigQuery](#checkout-events-bigquery)
7. [VM Scratch And Shared Media: Persistent Disk And Filestore](#vm-scratch-and-shared-media-persistent-disk-and-filestore)
8. [Recovery Copies](#recovery-copies)
9. [The Orders Data Map](#the-orders-data-map)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Checkout Scenario
<!-- section-summary: One checkout product creates several data shapes, so the team should name the job before choosing a Google Cloud service. -->

Let's follow a small product called **Orders**. Customers add items to a cart, submit checkout, pay, receive a PDF receipt, and sometimes upload a proof-of-address image for manual review. The team runs the API on Cloud Run, but the compute choice only answers where the code runs. The next question asks where the state lives after each request ends.

That one checkout flow creates several different storage jobs. The receipt PDF acts like a whole file. The order, payment, refund, and line-item records need relationships and transactions. The unfinished checkout draft looks like app state that the frontend reads by user and checkout ID. The product team wants event history for reports. A VM-based image processor needs temporary working space. A legacy review tool expects a shared mounted directory. The release team needs recovery copies for the day a bad migration or bad upload does damage.

Those jobs should not all land in one service just because they came from one feature. A senior engineer would slow the conversation down and ask what each piece of data needs to do after the write succeeds. That answer usually points to the right Google Cloud service before the service names start arguing with each other.

## What Storage Means In Google Cloud
<!-- section-summary: Storage means durable state, and each service makes different promises about reads, writes, queries, access, and recovery. -->

**Storage** is the place a system keeps state after code stops running. In Google Cloud, that can mean objects in Cloud Storage, rows in Cloud SQL, documents in Firestore, analytics tables in BigQuery, block disks on Compute Engine, shared file systems in Filestore, or backups and snapshots held for recovery. The word sounds simple, but the real design work starts when you describe how the data behaves.

A good storage discussion starts with four plain questions. What is the smallest unit the app reads or writes? How does the app find it again? How does it change over time? What previous copy can the team restore after a bad write or deletion? These questions keep the conversation concrete, especially when a team has several Google Cloud products available.

| Data from the Orders product | What the data acts like | First Google Cloud service to consider | Why that service fits |
| --- | --- | --- | --- |
| Receipt PDFs and customer uploads | Whole files addressed by name | **Cloud Storage** | Buckets hold durable objects and serve them through an object API |
| Orders, payments, refunds, line items | Related records with rules | **Cloud SQL** | Managed relational databases provide SQL, schemas, indexes, and transactions |
| Checkout drafts and preferences | Documents read by known paths or indexed queries | **Firestore** | Collections and documents work well for app-shaped records |
| Checkout events and funnel history | Large analytical tables | **BigQuery** | SQL analysis over historical facts fits reporting and dashboards |
| VM worker scratch space | A disk attached to one workload | **Persistent Disk** | Compute Engine workloads can use block storage like a normal disk |
| Shared review media directory | A mounted file share | **Filestore** | Several clients can mount a managed NFS file system |
| Previous good copies | Restore points | **Backups, snapshots, versions, soft delete, and time travel** | Recovery needs a copy outside the active write path |

This table gives a first filter, not a final architecture. Real systems can mix services because one product can produce many data shapes. The important habit is to make each service own a clear job instead of asking one storage product to behave like every other storage product.

## Receipt PDFs: Cloud Storage
<!-- section-summary: Receipt PDFs and uploads belong in Cloud Storage when the app stores and retrieves whole byte payloads by object name. -->

**Cloud Storage** is Google Cloud's object storage service. An object is a named byte payload plus metadata, and a bucket is the container that holds objects and carries settings such as location, IAM policy, lifecycle rules, and retention controls. In the Orders product, receipt PDFs and user-uploaded images fit this shape because the app usually writes the whole file, reads the whole file, and tracks the object name in the database.

The database still owns the business meaning. It should know that order `ord_20260614_7K2Q` belongs to customer `cus_8842`, reached status `PAID`, and has a receipt at `receipts/2026/06/14/ord_20260614_7K2Q/receipt.pdf`. Cloud Storage owns the bytes behind that object name. This split keeps large files out of transactional tables and lets the API serve files through a storage service designed for large object delivery.

A production bucket for receipts usually starts private, regional, and separated by environment. The team might create it like this:

```bash
gcloud storage buckets create gs://orders-prod-receipts-us \
  --project=orders-prod-123 \
  --location=us-central1 \
  --default-storage-class=STANDARD \
  --uniform-bucket-level-access \
  --public-access-prevention
```

That command creates a regional bucket, turns on **uniform bucket-level access**, and enforces **public access prevention**. Uniform bucket-level access makes IAM the control point for the bucket and its objects. Public access prevention blocks common accidental public exposure paths. The next article goes deep on those controls, but the beginner design choice is already visible: receipt storage starts private, and the app grants narrow temporary access only when a customer needs a specific file.

Object names deserve real design attention. Names such as `receipt.pdf` or `uploads/photo.jpg` collide quickly and tell operators almost nothing. Names such as `receipts/tenant_42/2026/06/14/order_ord_7K2Q/receipt.pdf` group related objects by tenant, date, and order while still leaving the database as the source for search and ownership.

## Orders And Payments: Cloud SQL
<!-- section-summary: Orders and payments need relationships, constraints, and transactions, so Cloud SQL fits the request-time business records. -->

The checkout request also creates data that acts nothing like a PDF. An order has line items. A payment belongs to an order. A refund points back to a payment. The system needs rules such as "every line item belongs to one order" and "payment state changes with the order state inside one transaction." This is **relational data**.

**Cloud SQL** is Google Cloud's managed relational database service for MySQL, PostgreSQL, and SQL Server. Managed means Google handles many server operations around the database, such as provisioning, patching support, backup features, and high availability options. The application team still owns schema design, migrations, indexes, query behavior, connection pooling, credentials, and restore drills.

Here is a small PostgreSQL-shaped version of the Orders data. The exact schema would grow in a real product, but the important part is the relationship between tables and the transaction boundary around checkout:

```sql
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL,
  receipt_object TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0)
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  provider TEXT NOT NULL,
  provider_reference TEXT NOT NULL,
  status TEXT NOT NULL,
  authorized_amount_cents INTEGER NOT NULL
);
```

The app can insert the order, line items, and payment state in one database transaction. If the payment record insert fails, the order insert can roll back with it. That behavior matters during checkout because the customer is waiting for one clear answer, not a half-written business record scattered across several storage systems.

Cloud SQL also changes the operational checklist. The team needs migrations for schema changes, indexes for common queries, connection limits for Cloud Run scale-out, automated backups, point-in-time recovery where supported, and a restore rehearsal before a real incident. Managed databases reduce server work, but they do not remove database engineering.

## Checkout Drafts: Firestore
<!-- section-summary: Checkout drafts can fit Firestore when the app reads and updates document-shaped state through known paths and indexed queries. -->

Some checkout state does not need a relational schema on day one. A customer may open checkout, enter a shipping address, pick a delivery option, and close the browser before paying. The frontend wants to save that draft and load it again by user and checkout ID. That shape often fits **Firestore**, Google Cloud's document database.

Firestore stores **documents** inside **collections**. A document is a record with fields, and the path becomes part of how the app finds it. For Orders, a draft could live at a path such as `checkoutDrafts/cus_8842/drafts/chk_20260614_A9D3`. The app can read that one document quickly, update a few fields, and query a known collection path when it needs a predictable list.

```json
{
  "checkoutId": "chk_20260614_A9D3",
  "customerId": "cus_8842",
  "cartItems": [
    {
      "sku": "sku_starter_pack",
      "quantity": 2
    }
  ],
  "shippingPostcode": "94105",
  "deliveryOption": "standard",
  "updatedAt": "2026-06-14T10:45:00Z"
}
```

This record feels natural to application developers because it resembles the object the frontend already uses. The design still needs discipline. Firestore queries rely on defined access patterns and indexes, and document data should not hide relationships that the checkout ledger needs to enforce. Once a draft turns into a paid order, the durable order record belongs in the relational database.

Firestore works well for drafts, preferences, and app state that the product reads by path or by known indexed queries. The team should reach for Cloud SQL when it needs joins, relational constraints, or multi-row business transactions as the center of the workflow.

## Checkout Events: BigQuery
<!-- section-summary: Checkout events belong in BigQuery when the team asks questions across many historical facts instead of serving one customer's request. -->

After the team stores receipts, orders, payments, and drafts, product managers will ask a different kind of question. Which payment provider failed most often last week? Did the new address form reduce checkout abandonment? Which region has the slowest receipt generation? These questions scan many historical facts, so they fit analytics storage rather than request-time storage.

**BigQuery** is Google Cloud's serverless data warehouse. It stores data in datasets and tables, and teams query it with SQL for analytics, dashboards, exploration, and data engineering. The Orders API should not wait on a warehouse query before it tells one customer whether checkout succeeded. BigQuery shines when the question covers many customers, many events, or long history.

A checkout event table might include one row per important event:

| Column | Example value | Why the analyst wants it |
| --- | --- | --- |
| `event_timestamp` | `2026-06-14T10:45:10Z` | Time windows, release comparisons, and incident timelines |
| `event_name` | `payment_failed` | Funnel and failure analysis |
| `order_id` | `ord_20260614_7K2Q` | Joining event history back to support cases |
| `payment_provider` | `stripe` | Provider-level reliability reporting |
| `region` | `us-central1` | Regional latency and failure analysis |
| `release_sha` | `8c7ab21` | Deployment impact checks |

The team could answer a weekly payment failure question with a query like this:

```sql
SELECT
  payment_provider,
  COUNTIF(event_name = 'payment_failed') AS failed_payments,
  COUNTIF(event_name = 'payment_authorized') AS authorized_payments
FROM `orders_analytics.checkout_events`
WHERE event_timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY payment_provider
ORDER BY failed_payments DESC;
```

That query belongs in analytics, not in the checkout request path. A practical production pattern writes request-time state to Cloud SQL, emits events to a pipeline, and lands those events in BigQuery for analysis. The customer gets a fast checkout response, and the business still gets a durable history for reporting.

## VM Scratch And Shared Media: Persistent Disk And Filestore
<!-- section-summary: Some workloads need operating-system paths, so Google Cloud provides block disks and shared file systems for those specific cases. -->

Most new cloud apps should prefer service APIs for state, but some workloads genuinely need an operating-system path. The Orders team may run an older PDF post-processor on a Compute Engine VM, and that tool writes temporary files to `/var/tmp/orders`. Another review tool may expect several workers to read and write files under `/mnt/review-media`. These shapes call for attached storage.

**Persistent Disk** provides durable block storage for Compute Engine VMs and some VM-backed workloads. A block disk acts like a disk device attached to a machine, so the operating system formats it with a filesystem and the application reads and writes normal paths. This fits one worker that needs local scratch or durable working space across VM restarts.

```bash
gcloud compute disks create orders-worker-cache \
  --project=orders-prod-123 \
  --zone=us-central1-a \
  --size=200GB \
  --type=pd-balanced
```

**Filestore** provides a managed file share that clients mount over NFS. This fits legacy tools, shared import directories, media review workflows, and workloads that require file semantics across more than one machine. The team should choose it because the software needs a mounted file system, not because object storage names contain slashes.

Attached storage creates its own operations checklist. The team needs to plan mount points, filesystem permissions, snapshots, capacity alarms, throughput expectations, and failure behavior. Cloud Storage remains the better default for receipts and uploads because those files do not need POSIX file operations.

## Recovery Copies
<!-- section-summary: Durable active storage still needs previous copies, because a system can preserve bad writes just as reliably as good writes. -->

Storage design does not end when the write succeeds. A bad deploy can overwrite receipt metadata. A migration can corrupt order rows. A cleanup job can delete the wrong objects. A support operator can remove a draft that still matters for an investigation. The team needs **recovery copies** before these events happen.

Recovery mechanisms differ by storage shape. Cloud Storage has object versioning, soft delete, retention policies, lifecycle rules, and managed backup options for some needs. Cloud SQL has automated backups and point-in-time recovery features. Firestore has backup and export patterns. BigQuery has time travel and table snapshots. Persistent Disk and Filestore have snapshots or backup options depending on the service and edition.

| Active data | Recovery mechanism to plan | Practical check |
| --- | --- | --- |
| Receipt PDFs in Cloud Storage | Soft delete, object versioning, lifecycle, retention policy where required | Can the team restore one receipt after an accidental delete without opening public access? |
| Orders in Cloud SQL | Automated backups, point-in-time recovery, exports, restore drills | Can the team restore to a new instance and verify one order by ID? |
| Checkout drafts in Firestore | Scheduled backups or exports, security rule review, restore procedure | Can support recover a draft collection without replacing unrelated data blindly? |
| Checkout events in BigQuery | Time travel, table snapshots, partitioned exports where needed | Can analysts recover a table version from before a bad load job? |
| VM worker disks | Snapshots and image rebuild procedures | Can a worker VM rebuild without losing business records? |
| Shared review media in Filestore | Backups or snapshots with mount-level restore steps | Can the team restore a single path or a whole share in a test project? |

A recovery plan needs a test, not only a checkbox. For Cloud SQL, a team might create a monthly restore drill where it restores the latest backup into a temporary instance, runs a few verification queries, and deletes the temporary instance after recording the result. For BigQuery, the team might practice copying a table from a time before a bad load job into a recovery dataset and comparing row counts.

```bash
bq cp \
  orders_analytics.checkout_events@-3600000 \
  orders_recovery.checkout_events_before_bad_load
```

That example uses BigQuery's time travel table decorator syntax to copy the table as it existed one hour ago into a recovery dataset. The exact recovery window depends on the table and project settings, so production teams write the limit into their runbook and test the command before they need it.

## The Orders Data Map
<!-- section-summary: The full Orders system maps each state type to the service that owns the matching access pattern. -->

Now the Orders team can explain its storage design without waving at a giant product list. Each storage service owns a clear part of the checkout system, and the connection between services has a reason.

| Orders work | Data shape | Google Cloud home | What the app stores as the pointer |
| --- | --- | --- | --- |
| Generate a customer receipt | Whole PDF file | Cloud Storage | `orders.receipt_object` contains the object name |
| Save the order and payment | Related request-time records | Cloud SQL | Primary keys and foreign keys connect the checkout transaction |
| Save an unfinished checkout | Document-shaped app state | Firestore | Document path uses customer and checkout IDs |
| Analyze checkout failures | Historical events | BigQuery | Event rows include order ID, provider, region, and release SHA |
| Process PDFs on a VM | Worker scratch disk | Persistent Disk | VM mount path contains temporary files only |
| Share review media with a legacy tool | Mounted shared directory | Filestore | Tool path maps to a managed NFS share |
| Recover after mistakes | Previous copies | Service-specific backups, versions, snapshots, and time travel | Runbook records restore target and verification queries |

The key design habit is the pointer. Cloud SQL can keep the receipt object name, but Cloud SQL should not store the PDF bytes. Cloud Storage can keep the PDF bytes, but Cloud Storage should not act as the order search database. BigQuery can answer trend questions, but the checkout API should not depend on a warehouse query for one customer's order state.

This split also improves incident response. If receipt upload breaks, the team can inspect Cloud Storage permissions and object names without touching payment rows. If a migration damages payment data, the team can restore Cloud SQL without rewriting every receipt. If product analytics lag, customer checkout can continue because BigQuery sits behind the request path.

## Putting It All Together
<!-- section-summary: Google Cloud storage choices work best when each service owns one clear job in the product flow. -->

The Orders product creates many kinds of state during one checkout flow. Receipt PDFs and user uploads fit Cloud Storage because they act like named object bytes. Orders, payments, refunds, and line items fit Cloud SQL because they need relational rules and transactions. Checkout drafts can fit Firestore when the app reads document-shaped state by path or by known indexed queries.

Checkout events fit BigQuery because the team asks questions across many historical facts. VM scratch and shared review media fit Persistent Disk or Filestore when the workload needs operating-system paths. Recovery copies sit beside every one of those choices because durable storage can preserve mistakes unless the team keeps previous good copies and practices restore.

The beginner mistake is looking for one storage product that can hold everything. The production habit is mapping each piece of state to the access pattern, update pattern, and recovery story it needs. Once the team can say those things out loud, the Google Cloud service choice has a solid reason behind it.

## What's Next

The first concrete storage service in this module is Cloud Storage. The next article follows receipt PDFs and user uploads through bucket design, object naming, IAM, uniform bucket-level access, signed URLs, lifecycle rules, versioning, soft delete, retention, and practical `gcloud` and infrastructure-as-code examples.

---

**References**

- [Cloud Storage overview](https://cloud.google.com/storage/docs/introduction) - Explains buckets, objects, storage classes, locations, and the object storage model.
- [Cloud Storage buckets](https://cloud.google.com/storage/docs/buckets) - Documents bucket naming, bucket metadata, locations, and bucket-level settings.
- [About Cloud Storage objects](https://cloud.google.com/storage/docs/objects) - Defines objects, object names, metadata, generations, and object operations.
- [Cloud SQL overview](https://cloud.google.com/sql/docs/introduction) - Describes Cloud SQL for managed MySQL, PostgreSQL, and SQL Server workloads.
- [Firestore overview](https://cloud.google.com/firestore/docs/overview) - Introduces Firestore documents, collections, indexes, transactions, and serverless scaling.
- [BigQuery introduction](https://cloud.google.com/bigquery/docs/introduction) - Describes BigQuery as a managed analytics data warehouse.
- [Persistent Disk overview](https://cloud.google.com/compute/docs/disks) - Documents block storage options for Compute Engine workloads.
- [Filestore overview](https://cloud.google.com/filestore/docs/overview) - Explains managed file shares for applications that need NFS file semantics.
- [Cloud SQL backups and recovery](https://cloud.google.com/sql/docs/postgres/backup-recovery/backups) - Documents automated backups, on-demand backups, and recovery planning for Cloud SQL for PostgreSQL.
- [BigQuery time travel](https://cloud.google.com/bigquery/docs/time-travel) - Documents querying and restoring historical table data within the configured time travel window.
