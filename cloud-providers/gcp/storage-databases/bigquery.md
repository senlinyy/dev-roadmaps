---
title: "BigQuery"
description: "Use BigQuery for analytical questions over many events with datasets, tables, rows, schemas, partitions, clustering, cost controls, slots, views, IAM, and recovery."
overview: "BigQuery is Google Cloud's serverless analytics warehouse for historical questions over many rows. The guide follows shop orders and events through datasets, columnar tables, partitions, clustering, query cost, slots, views, IAM, recovery, and monitoring."
tags: ["gcp", "bigquery", "analytics", "warehouse"]
order: 5
id: article-cloud-providers-gcp-storage-databases-bigquery-analytics-data-warehousing
aliases:
  - bigquery-for-analytics-and-data-warehousing
  - bigquery-analytics-data-warehousing
  - cloud-providers/gcp/storage-databases/bigquery-for-analytics-and-data-warehousing.md
---

## Table of Contents

1. [Why Does Analytics Need a System Outside the Live Database?](#why-does-analytics-need-a-system-outside-the-live-database)
2. [How Do Parallel Compute, Datasets, and Columnar Tables Fit Together?](#how-do-parallel-compute-datasets-and-columnar-tables-fit-together)
3. [Why Does Query Cost Depend on Bytes and Compute?](#why-does-query-cost-depend-on-bytes-and-compute)
4. [How Do Partitioning and Clustering Reduce Work?](#how-do-partitioning-and-clustering-reduce-work)
5. [What Are Slots, Reservations, and Distributed Stages?](#what-are-slots-reservations-and-distributed-stages)
6. [How Do Views and IAM Control Reuse and Access?](#how-do-views-and-iam-control-reuse-and-access)
7. [How Should Operational Data Become Analytical Data?](#how-should-operational-data-become-analytical-data)
8. [How Do Recovery and Monitoring Keep BigQuery Useful?](#how-do-recovery-and-monitoring-keep-bigquery-useful)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

An online shop's live database contains customers, orders, products, payments, and inventory. When Alice buys a book, the application finds one customer and cart, updates one inventory record, creates payment state, and changes one order. These operations are small, frequent, and latency-sensitive. This workload is commonly called **online transaction processing**, or OLTP.

Analytics asks almost the opposite question: what was average order value for every country, month, marketing channel, and product category over three years? That answer may require hundreds of millions of orders and line items plus customer, campaign, and product data. This is **online analytical processing**, or OLAP.

The contrast is:

```text
OLTP
many small operations
→ a few current records each

OLAP
one analytical query
→ an enormous historical data range
```

It is technically possible to run a large grouping query against production PostgreSQL. The query then consumes the same CPU, disk I/O, and memory needed for login, checkout, payment, and inventory. Analytical work competes with the application that generates revenue.

Keep these questions in view as you work through the lesson:

1. **Why Does Analytics Need a System Outside the Live Database?**
2. **How Do Parallel Compute, Datasets, and Columnar Tables Fit Together?**
3. **Why Does Query Cost Depend on Bytes and Compute?**
4. **How Do Partitioning and Clustering Reduce Work?**
5. **What Are Slots, Reservations, and Distributed Stages?**
6. **How Do Views and IAM Control Reuse and Access?**
7. **How Should Operational Data Become Analytical Data?**
8. **How Do Recovery and Monitoring Keep BigQuery Useful?**

## Why Does Analytics Need a System Outside the Live Database?
<!-- section-summary: Operational databases serve many small current-state requests, while BigQuery scans and summarizes enormous historical datasets. -->

A common architecture separates the workloads:

```text
users → application → Cloud SQL or Firestore
                         │
                         │ copies or events
                         ▼
                      BigQuery
                         │
                         ▼
                  analytics, BI, ML
```

The operational database answers what is happening now. BigQuery helps explain everything that happened. BigQuery is Google Cloud's fully managed serverless analytical platform and data warehouse, designed for large-scale processing with storage and compute that scale independently.

This distinction is not simply SQL versus NoSQL. Cloud SQL and BigQuery both support tables and SQL. Their centre of gravity differs: Cloud SQL reads or changes a few related operational records, while BigQuery scans and aggregates millions or billions of rows.

## How Do Parallel Compute, Datasets, and Columnar Tables Fit Together?
<!-- section-summary: BigQuery stores analytical tables separately from a distributed query engine that can divide large work among many parallel workers. -->

BigQuery's fundamental trick is parallelism. If a query must inspect one terabyte, one machine could process the whole amount sequentially, or many workers could process independent chunks and combine partial results:

```text
worker 1 ─┐
worker 2 ─┤
worker 3 ─┼──→ aggregate → final result
...       │
worker N ─┘
```

Instead of relying on one dramatically faster computer, the system divides an enormous query across distributed stages and workers. BigQuery separates the persistent storage layer from the compute that reads, filters, joins, groups, sorts, and aggregates it.

A conventional database server is often pictured as CPU, RAM, and storage inside one instance. BigQuery is better pictured as a large storage layer connected through high-bandwidth infrastructure to a pool of query workers. Users do not ordinarily choose sixteen CPUs, sixty-four gigabytes of RAM, and a two-terabyte disk for one BigQuery database server. They reason about data, tables, bytes scanned, queries, and compute capacity.

The logical hierarchy remains familiar:

```text
Google Cloud project
└── dataset
    ├── table
    ├── table
    └── view
```

A fully qualified table such as `company_analytics.sales.orders` names a project, dataset, and table. A **dataset** organizes related tables and views and forms an important boundary for location, access, and configuration. A project can contain datasets such as `raw`, `analytics`, `finance`, and `marketing`.

Tables logically contain rows and typed columns. An orders schema may include order ID, customer ID, country, order date, and revenue. GoogleSQL queries those logical rows much like familiar relational SQL.

Physically, BigQuery's native table storage is **column-oriented**. If a table contains customer name, shipping address, product, channel, timestamp, currency, revenue, discount, and tax, a query computing only `SUM(revenue)` does not need every other column. Organizing values by column lets analytical queries read a few fields across vast numbers of records, and similar adjacent values often compress efficiently.

That physical model leads directly to one practical rule: select only the columns the question needs. The logical row is still useful to users, while the storage engine can avoid unrelated column data.

### Follow one aggregate through distributed work

Suppose one query asks for revenue by country across a terabyte. BigQuery can split the scan into many work units. Each worker reads the relevant country and revenue columns for its portion, filters rows, and creates partial sums. Later stages redistribute or combine those partial values until one result remains for each country.

Parallelism works because many parts of the scan are independent. It does not mean every operation can run simultaneously without limits. A final global ordering may wait for earlier aggregation, and a join may need intermediate data moved between workers. The query plan and timeline expose those stages and their dependencies.

Storage-compute separation also means stored data does not need a permanently running query server. Different queries can bring different amounts of distributed work to the same persistent tables. This is why BigQuery capacity is discussed through slots and jobs instead of one fixed machine's CPU meter.

Dataset boundaries matter before any query runs. Tables and views in one dataset share a chosen location, and dataset-level access can grant or deny a related collection of analytical resources. Splitting `raw`, `finance`, and `marketing` is therefore both organizational and operational, not merely a naming preference.

## Why Does Query Cost Depend on Bytes and Compute?
<!-- section-summary: BigQuery work has a storage-scanning dimension and a compute-capacity dimension, so query structure can affect performance and price. -->

Suppose a table contains ten terabytes. Selecting only `revenue` may scan much less data than `SELECT *`. A `LIMIT 10` on `SELECT *` does not necessarily reduce the underlying amount read for billing. Developers accustomed to a row-oriented application database can be surprised because “return ten rows” and “scan only ten rows' storage” are not the same promise in an analytical engine.

The important question is how many bytes the engine must process to answer the query. BigQuery supports two broad compute-pricing models:

- **On-demand** processing charges mainly according to data processed.
- **Capacity-based** processing pays for compute capacity represented by slots and reservations.

A ten-terabyte scan and a twenty-gigabyte scan can return the same business answer with radically different work. Improving the SQL is not about making the text shorter; it is about avoiding unnecessary storage and computation.

Projection is the first control: name the needed columns rather than selecting everything. Table organization provides two more powerful controls: partitioning and clustering. They let the engine eliminate irrelevant data before or during the scan.

Storage work and compute work remain separate dimensions. A query can scan little data but still perform an expensive join, grouping, or sort. Another query can have simple arithmetic but scan an unnecessarily huge table. Capacity and query design need to address both.

Cost awareness is therefore part of table and query design, not only a billing concern after deployment. Teams should know which dashboards run frequently, which columns they project, which date ranges they filter, and how recurring scans interact with the chosen pricing model.

### Separate returned rows from processed data

A result containing ten rows can still require scanning billions of source rows and shuffling large intermediate datasets. Conversely, a large result can come from a narrowly pruned partition. Result size alone does not explain the work performed.

For on-demand workloads, repeated broad scans can create an economic issue despite each query completing quickly. For capacity workloads, the same scans can occupy slots and delay other jobs. The pricing model changes how cost is accounted for, while unnecessary work remains unnecessary in both.

Projection, partition filters, and clustering filters should therefore be visible in shared query patterns and views. If every dashboard author writes a different unrestricted query over raw tables, the warehouse loses both semantic consistency and resource control.

## How Do Partitioning and Clustering Reduce Work?
<!-- section-summary: Partitioning eliminates coarse table sections, while clustering lets BigQuery skip finer blocks within the remaining data. -->

An events table containing ten years of history is often queried for one day. **Partitioning** divides the table into coarse sections, commonly by a date or timestamp:

```text
events
├── partition 2026-08-20
├── partition 2026-08-21
├── partition 2026-08-22
└── partition 2026-08-23
```

A qualifying filter on the partition column lets BigQuery apply **partition pruning** and skip unrelated dates. A daily question no longer considers all ten years.

Partitioning is a first cut. Date and timestamp columns are common choices for events, logs, purchases, transactions, and measurements because most questions specify a time range. The principle is broader than “always use date”: choose a partition dimension that lets common queries eliminate large sections.

A single daily partition can still contain hundreds of millions of events. **Clustering** organizes data blocks around selected column values, such as customer ID. After partition pruning selects August 23, a customer filter can let BigQuery apply **block pruning** and skip blocks unlikely to contain that customer.

Think of a library. Partitioning chooses the room. Clustering narrows the shelves inside the room. An events table can be partitioned by `event_date` and clustered by `customer_id`. A query filtering both can reduce work in two stages:

```text
all events
   ↓ partition pruning
one date
   ↓ cluster block pruning
blocks relevant to one customer
```

Partitioning and clustering are not arbitrary indexes that accelerate every predicate. Filters unrelated to the table organization may still inspect much more data. Simple predicates on clustering columns are especially useful; wrapping a clustering column in complex expressions can prevent block pruning.

Data design and query design must therefore cooperate:

```text
common analytical questions
        ↓
partition key for coarse elimination
        ↓
clustering columns for frequent filters
        ↓
query predicates that enable pruning
```

This resembles Firestore's instruction to design from access patterns, though the mechanisms and workloads are entirely different.

## What Are Slots, Reservations, and Distributed Stages?
<!-- section-summary: Slots represent parallel BigQuery compute, while the scheduler allocates available capacity across distributed query stages and workloads. -->

After BigQuery identifies the necessary bytes, compute must read, filter, join, group, sort, and aggregate them. A **slot** is a virtual compute unit used to execute BigQuery query and job work. It is a share of distributed parallel capacity, not one permanent VM assigned to a user.

More available slots can allow more pieces of parallelizable work to execute together and can support more concurrent queries. Queries still contain dependencies. A simplified plan may scan, filter, join, aggregate, and sort. Later stages wait for the outputs they need from earlier stages, and intermediate data moves through BigQuery's distributed shuffle system.

Users do not usually assign a precise slot count to each SQL statement. The scheduler decides how many available slots each stage can use. If a stage could use two thousand slots and only one thousand are available, part of its work waits until capacity becomes free.

This explains why scanned bytes and available compute are distinct. A carefully partitioned query can still perform substantial joins and aggregation. An inefficient scan can waste huge storage work even when abundant capacity executes it quickly.

With the on-demand model, users submit queries and BigQuery supplies infrastructure while charges primarily follow data processed. With capacity-based pricing, organizations manage baseline and autoscaled slot capacity through **reservations**.

Reservations can separate workloads conceptually:

```text
production BI reservation
data science reservation
development reservation
```

This isolation can prevent experimental work from consuming all capacity needed for production reporting. Capacity management concerns throughput and concurrency across workloads, while table design concerns the data each query must inspect. Both influence a healthy warehouse.

### Read waiting time and processing time differently

A job can wait because no slot capacity is available, then execute efficiently once scheduled. Another job can start immediately and run slowly because its stages scan, shuffle, or aggregate much more data than needed. Both feel slow to a user but require different action.

More slots can reduce waiting or increase parallelism for eligible stages. They cannot repair a missing partition filter or make a logically huge join small. Likewise, a perfectly pruned table cannot prevent queuing if every reservation slot is busy. Job timelines help distinguish queue pressure from inefficient work.

Reservations also create policy boundaries. Production dashboards can receive predictable capacity while exploratory workloads use another reservation with its own baseline and autoscaling behavior. The scheduler still allocates work dynamically within those available resources rather than allowing users to pin exactly thirty-seven slots to one query.

## How Do Views and IAM Control Reuse and Access?
<!-- section-summary: Views package reusable analytical SQL and can expose selected data, while IAM and finer-grained controls decide which identities may use each resource. -->

Correct revenue may require a complex query joining orders, refunds, and currencies. Requiring every analyst to recreate that logic invites drift. A **logical view** saves SQL and behaves like a table-like resource:

```text
raw tables
    ↓ complex approved SQL
finance.monthly_revenue view
    ↓
analysts and dashboards
```

Users can query the view without rewriting the underlying business calculation. Views therefore create an abstraction layer between raw physical tables and stable business-facing concepts.

They can also support security. A raw customer table may contain email, phone, country, revenue, and product. Marketing may need only country, revenue, and product. An **authorized view** can share selected query results without granting direct access to every underlying field. BigQuery also supports row-level and column-level controls for finer restrictions.

IAM answers another question: which identities may perform which operations? A data engineering service account might write tables, finance analysts might query the finance dataset, marketing might query approved views, and a dashboard service account might read reporting tables. An intern might receive no production access.

Permissions can be assigned at levels in the Google Cloud resource hierarchy, on datasets, and on individual tables or views, with additional controls inside tables. Keep these concepts separate:

```text
schema and analytical model
→ what data means

view
→ which reusable representation is exposed

IAM
→ which identities may act on resources

row and column controls
→ which portions of table data are visible
```

Neither a view nor IAM replaces careful data modeling. The view should express trusted business logic; access controls should grant least privilege to the consumers that need it.

### Make the analytical interface narrower than the raw source

A raw dataset may preserve fields needed for engineering investigation while an approved view exposes only stable business concepts. The view can hide implementation columns, standardize joins and calculations, and keep a dashboard from depending on every raw schema detail.

An authorized view is especially useful when consumers should query a derived result without receiving direct access to base tables. Row-level controls can limit which records an identity sees; column-level controls can protect sensitive fields. These controls solve different portions of the access problem and can be combined with IAM's resource permissions.

The data engineering service account that writes a table does not need to be the identity used by a dashboard. Separating those callers makes permissions easier to reason about and limits the consequences of one credential being misused.

## How Should Operational Data Become Analytical Data?
<!-- section-summary: Analytical data is copied from operational sources, reshaped for scanning, and presented through raw, transformed, and business-facing layers. -->

BigQuery is not usually the checkout database even though it has tables, SQL, joins, and transaction capabilities. Checkout needs a quick lookup of one cart, validation of one inventory record, a few coordinated writes, and an immediate response. BigQuery is designed around distributed analytical scans.

The useful service comparison is:

| Service | Natural question |
|---|---|
| Cloud SQL | How do related operational records remain correct? |
| Firestore | How do application-shaped documents get stored and retrieved at scale? |
| BigQuery | How do we analyze enormous quantities of history efficiently? |

Operational records are commonly normalized to reduce update duplication and protect transactions. Analytical models may intentionally duplicate attributes in a wider table. A `sales_fact` table can repeat customer country, segment, product category, and campaign alongside quantities, revenue, cost, and margin. The goal is efficient scanning and aggregation over history, not minimizing duplicated customer attributes during checkout.

A typical data journey is:

```text
operational systems and events
        ↓
raw dataset
        ↓ cleanup and standardization
staging
        ↓ business transformations
analytics datasets and tables
        ↓
curated views
        ↓
dashboards and analysts
```

The exact ingestion and transformation technology can vary. The important separation is among source truth, clean analytical models, and business-facing interfaces. Raw data preserves what arrived; transformed tables make analysis consistent; views provide stable questions and access boundaries.

This separation also affects recovery. A derived analytical table that can be rebuilt from retained source events differs from an irreplaceable source. Teams should know which BigQuery data is authoritative and which can be recomputed.

### Let analytical shape follow analytical questions

Normalized operational tables protect frequent updates and relationships. An analytical fact table can repeat country, segment, category, and campaign because a large query benefits from reading those values directly. The repeated values are part of the warehouse model rather than accidental duplication.

That reshaping creates lineage responsibilities. A dashboard should have a traceable path from curated view, through transformed tables, to raw inputs and ultimately operational sources. If a transformation bug corrupts one layer, the team needs to know which preceding layer can rebuild it and which history window preserves the correct input.

The source of truth question also informs backup priority. A raw dataset containing the only retained event history needs different protection from a daily summary that can be recomputed. Cost, recovery order, and acceptable downtime should reflect that distinction.

## How Do Recovery and Monitoring Keep BigQuery Useful?
<!-- section-summary: Time travel and fail-safe preserve short-term history, while job and storage metadata reveal correctness, efficiency, and capacity pressure. -->

Analytical tables can still be destroyed by a mistaken delete or a buggy `CREATE OR REPLACE TABLE`. BigQuery **time travel** retains historical table data for a configurable two-to-seven-day window, with seven days as the default. Within that window, historical table versions can be queried or used for recovery.

After time travel expires, BigQuery holds deleted data for an additional seven-day **fail-safe** period for emergency recovery. This period is fixed and its data is not a normal queryable archive. Longer historical requirements need another mechanism, such as table snapshots.

Recovery does not make warehouse operations healthy by itself. A dashboard can scan six terabytes every five minutes; analysts can repeatedly use `SELECT *`; queries can queue because capacity is saturated. A technically available warehouse can still be slow or unnecessarily expensive.

`INFORMATION_SCHEMA` exposes metadata about BigQuery jobs, tables, storage, reservations, and capacity as queryable views. Teams can ask which queries consumed the most slots, which jobs failed, which users processed the most data, which queries are running, how much storage tables use, and whether work is waiting for compute. Cloud Monitoring and audit or logging data provide additional operational evidence.

### Treat recent history and durable archives differently

Time travel is convenient because historical versions remain accessible through the service's table semantics. Its short configurable window makes it well suited to recently discovered replacements and deletes. The additional fail-safe window is an emergency provider recovery layer, not a normal self-service archive.

If the business needs monthly states for years, relying on a seven-day window cannot satisfy the requirement. Table snapshots or another longer-lived design must preserve those points deliberately. Retention should follow how long corruption may remain unnoticed and how far audit or business history must reach.

Recovery practice should identify an incident time, inspect or restore the historical table, validate counts and representative results, and reconnect downstream views or jobs. A retained version proves little if the team cannot select and use it correctly.

Monitoring should connect resource signals to business consumers. A failed transformation can leave a technically queryable but stale dashboard. High bytes processed can reveal missing filters. Slot contention can reveal an overloaded reservation. Storage growth can expose tables or snapshots retained longer than intended. Healthy analytics includes correct, current, efficient, and accessible results.

Follow one real query. Suppose `analytics.events` contains twenty terabytes, partitioned by `event_date` and clustered by `customer_id`:

```sql
SELECT
  event_type,
  COUNT(*) AS events
FROM `company.analytics.events`
WHERE event_date = '2026-08-22'
  AND customer_id = 'customer-182'
GROUP BY event_type;
```

BigQuery parses the SQL and creates a distributed plan. The date filter prunes unrelated partitions. Clustering metadata skips blocks unlikely to contain `customer-182`. Columnar storage supplies only the needed columns. Slots execute scan and aggregation stages in parallel, intermediate partial counts combine, and the final grouped result returns.

That one path exposes the architecture:

```text
schema
  ↓
partition pruning
  ↓
cluster block pruning
  ↓
column scanning
  ↓
slots and distributed stages
  ↓
aggregation
  ↓
result
```

A practical baseline keeps heavy analytics outside the live application database; places incoming history in a raw dataset; cleans and reshapes it into analytical tables; partitions large event tables by a useful dimension; clusters around common filters; projects only needed columns; exposes trusted views; applies least-privilege IAM; watches jobs, data processed, slots, errors, and storage; and deliberately chooses the required time-travel or snapshot history.

The complete first-principles chain starts with operational data, recognizes that historical questions scan vastly more state, moves analytics away from the live database, stores tables in columnar form, prunes partitions and blocks, executes the remaining work with distributed slots, exposes reusable views, controls access, and preserves short-term history while monitoring both correctness and resource use.

### Review one warehouse from source to business answer

Begin with the live shop. Cloud SQL or Firestore remains responsible for the customer-facing order path. Orders, payments, inventory changes, and events are copied or emitted toward analytics without making a dashboard query part of checkout. Record which operational source remains authoritative when a BigQuery copy disagrees.

Inside BigQuery, place received facts in a raw dataset before reshaping them. A cleaned analytical table can standardize names and timestamps, join useful dimensions, and repeat attributes such as country or product category when that makes large scans simpler. A curated revenue view can then hide complex joins and expose the approved business calculation.

For every large table, list common time ranges and filters. An event date may divide coarse partitions; customer ID may organize blocks within each partition. Verify that real queries filter the partition column directly and use clustering columns in forms that enable pruning. The table design only saves work when queries cooperate with it.

Review projection separately. A dashboard needing date, country, and revenue should not read every address, description, and raw payload column. A limit on returned rows does not automatically limit bytes scanned, so inspect processed data rather than judging work by result size.

Then review compute. Under on-demand pricing, unnecessary scans increase processed-data charges. Under capacity pricing, jobs consume reservation slots and can queue or compete. Use job plans and timelines to distinguish time waiting for capacity from time spent in expensive scan, shuffle, join, aggregation, or sort stages. More slots may improve eligible parallel work but do not replace a missing partition filter.

Access review starts with the consumer. Data engineering identities may write raw and transformed tables. Finance analysts may query a finance dataset. Marketing may receive an authorized view that excludes email and phone. A dashboard service account may read only reporting views. IAM, views, row controls, and column controls each enforce a different portion of that boundary.

Finally, review history and evidence. Time travel can undo a recently replaced table inside its two-to-seven-day window. Fail-safe adds an emergency period but is not the normal long-term interface. Table snapshots can preserve selected states longer. `INFORMATION_SCHEMA`, Cloud Monitoring, and logs should reveal failed or waiting jobs, data processed, slot use, storage growth, and the identities running work.

This review produces one traceable answer: operational facts entered a known raw layer, transformations produced a documented analytical model, table organization reduced unnecessary work, distributed compute executed the remaining stages, a controlled view exposed the result, and recovery plus monitoring kept the answer trustworthy and affordable.

### Keep the three database centres distinct

Cloud SQL centres related operational rows and database-enforced rules. Firestore centres application documents and indexed document queries. BigQuery centres large analytical datasets and distributed scans. All three can contain structured data, use indexes or related storage organization, and expose transaction or SQL capabilities in some form. Selection should still follow the dominant operation.

An order lookup during checkout should not scan historical billions. A cohort analysis should not compete with the database serving current payments. A mobile document listener should not be redesigned as a warehouse query merely because the data may later reach analytics. One application can use all three when each receives the work its architecture was built to perform.

When the same order eventually appears in BigQuery, it has changed roles: it is one fact inside an analytical history. Partition and clustering choices, projected columns, slots, views, IAM, and time travel now matter because analysts ask aggregate questions across many such facts. The operational source still owns the live order unless the architecture explicitly declares otherwise.

## Check Your Answers

:::expand[Why Does Analytics Need a System Outside the Live Database?]{kind="recap"}
Operational databases serve many small current requests. BigQuery handles large historical scans without making analytics compete with checkout, login, payment, and inventory work.
:::

:::expand[How Do Parallel Compute, Datasets, and Columnar Tables Fit Together?]{kind="recap"}
Datasets organize tables and views; columnar storage avoids unrelated fields; the separate query engine divides large work among parallel distributed workers.
:::

:::expand[Why Does Query Cost Depend on Bytes and Compute?]{kind="recap"}
On-demand work largely follows data processed, while capacity pricing follows slots. Queries should avoid unnecessary columns and data regions while also controlling compute-heavy operations.
:::

:::expand[How Do Partitioning and Clustering Reduce Work?]{kind="recap"}
Partitioning prunes coarse table sections. Clustering lets BigQuery skip finer blocks inside the selected data when filters align with clustering columns.
:::

:::expand[What Are Slots, Reservations, and Distributed Stages?]{kind="recap"}
Slots are units of parallel BigQuery compute. The scheduler allocates available slots across dependent stages, and reservations isolate or size capacity for groups of workloads.
:::

:::expand[How Do Views and IAM Control Reuse and Access?]{kind="recap"}
Views package approved analytical SQL and can expose selected representations. IAM and row or column controls decide which identities and data portions are available.
:::

:::expand[How Should Operational Data Become Analytical Data?]{kind="recap"}
Copy operational facts into raw analytical storage, transform them into scan-friendly models, and expose curated business interfaces while keeping source truth explicit.
:::

:::expand[How Do Recovery and Monitoring Keep BigQuery Useful?]{kind="recap"}
Time travel and fail-safe protect recent history; snapshots can extend recovery; INFORMATION_SCHEMA, monitoring, and logs reveal job failures, bytes, slots, capacity, and storage use.
:::

## References

- [BigQuery overview](https://docs.cloud.google.com/bigquery/docs/introduction)
- [Query plan and timeline](https://docs.cloud.google.com/bigquery/docs/query-plan-explanation)
- [BigQuery datasets](https://docs.cloud.google.com/bigquery/docs/datasets)
- [Storage optimization](https://docs.cloud.google.com/bigquery/docs/best-practices-storage)
- [Compute optimization](https://docs.cloud.google.com/bigquery/docs/best-practices-performance-compute)
- [Cost controls](https://docs.cloud.google.com/bigquery/docs/best-practices-costs)
- [Partition pruning](https://docs.cloud.google.com/bigquery/docs/querying-partitioned-tables)
- [Clustered tables](https://docs.cloud.google.com/bigquery/docs/querying-clustered-tables)
- [BigQuery slots](https://docs.cloud.google.com/bigquery/docs/slots)
- [Reservations and workload management](https://docs.cloud.google.com/bigquery/docs/reservations-workload-management)
- [Logical views](https://docs.cloud.google.com/bigquery/docs/views)
- [Row-level security](https://docs.cloud.google.com/bigquery/docs/row-level-security-intro)
- [Time travel and fail-safe](https://docs.cloud.google.com/bigquery/docs/time-travel)
- [BigQuery monitoring](https://docs.cloud.google.com/bigquery/docs/monitoring)
