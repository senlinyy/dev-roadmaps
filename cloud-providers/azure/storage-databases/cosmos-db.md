---
title: "Cosmos DB"
description: "Use Cosmos DB for item-shaped application state where the lookup path, partition key, request units, TTL, and consistency choice are part of the design."
overview: "This article focuses on Azure Cosmos DB for NoSQL. It follows idempotency keys and background job status records through containers, items, partition keys, request units, indexing, TTL, consistency, and production fit."
tags: ["azure", "cosmos-db", "nosql", "partition-keys", "request-units"]
order: 4
id: article-cloud-providers-azure-storage-databases-cosmos-db-nosql-data-models
aliases:
  - cosmos-db-and-nosql-data-models
  - cloud-providers/azure/storage-databases/cosmos-db-and-nosql-data-models.md
---

## Table of Contents

1. [What Cosmos DB Is For](#what-cosmos-db-is-for)
2. [Access Patterns First](#access-patterns-first)
3. [Accounts, Databases, Containers, and Items](#accounts-databases-containers-and-items)
4. [Partition Keys](#partition-keys)
5. [Request Units and Throughput](#request-units-and-throughput)
6. [Indexing and Queries](#indexing-and-queries)
7. [Consistency and Regions](#consistency-and-regions)
8. [TTL and Temporary State](#ttl-and-temporary-state)
9. [Transactions and Boundaries](#transactions-and-boundaries)
10. [When Cosmos DB Fits](#when-cosmos-db-fits)
11. [Putting It All Together](#putting-it-all-together)
12. [What's Next](#whats-next)

## What Cosmos DB Is For
<!-- section-summary: Cosmos DB is useful for item-shaped data where the app already knows how it will read and write the records. -->

Azure Cosmos DB is Microsoft's managed database platform for distributed app data. Microsoft now describes the broader product as covering NoSQL, relational, and vector database needs, with support for several APIs and engines. In this article, Cosmos DB means the **API for NoSQL** shape because that is where beginners most often meet **items**, **containers**, **partition keys**, **request units**, and **TTL**.

The practical reason to reach for Cosmos DB is simple: the application has data that looks like independent items, and the app can usually name the exact item or the exact group of items it needs. A checkout service may keep the real order ledger in Azure SQL Database, receipt PDFs in Blob Storage, and short-lived retry records in Cosmos DB. The retry record is small, it has one key, the app reads it quickly during checkout, and the record can disappear after the retry window.

That same checkout system also has background export jobs. A support user starts an export, the worker updates a status record, and the support page checks that job by job ID. This status record also looks like an item: one small JSON document, one natural lookup key, a few updates, and a clear expiry window after support no longer needs it.

Those two examples will carry the whole article. We will follow `idempotency-keys` and `job-status` containers inside an `orders-events` database. First we name the access patterns, then we choose item shape, partition key, throughput, indexes, consistency, TTL, and finally the service fit. Cosmos DB rewards that order of thinking because the access path and the partition key sit close to the center of the design.

## Access Patterns First
<!-- section-summary: An access pattern is the normal read or write path, and Cosmos DB design depends on naming those paths early. -->

An **access pattern** is the normal way application code reads or writes data. In a relational database, a team may start with tables and later add several queries across those tables. In Cosmos DB, the team gets a better result by naming the common requests before creating the container.

For idempotency, the common request is specific. A payment request arrives with an idempotency key like `pay_req_8f31`. The checkout API checks whether a record already exists for that key, creates one if this is the first attempt, updates it after payment succeeds, and reads it again if the client retries. Monthly reporting belongs in a separate reporting path rather than the checkout request path.

For job status, the common request also has a clear key. A background worker writes `job_2026_06_11_0042`, moves it from `queued` to `running` to `complete`, and the support UI reads that same job ID while a user waits. Support may list recent jobs later, but the request-time path still revolves around one job record.

Those access patterns point toward Cosmos DB because the app can name the item it needs. A point read uses both the item `id` and the partition key value, so the SDK can route the request directly. A query that searches broadly across customers, months, or statuses has a different shape and can touch many partitions. That kind of query may belong in Azure SQL Database, an analytics store, or a separate read model built for reporting.

Here is the production review question I would ask before a Cosmos DB container exists. The goal is to describe the real requests before anyone argues about service names:

| Question | Idempotency answer | Job status answer |
| --- | --- | --- |
| What does the app read most often? | One retry record by idempotency key | One status record by job ID |
| How long does the data matter? | About a week | About 30 days |
| Does the app join it to order lines? | No, the order ledger lives elsewhere | No, it is operational status |
| What field can route the request? | `idempotencyKey` | `jobId` |
| What mistake would hurt later? | Adding dashboards that query by customer and month | Treating status records as a permanent audit log |

This table matters because Cosmos DB design has fewer surprises when the main reads are known-key reads. The body of each item can stay flexible JSON, but the access path still needs a shape. NoSQL moves the modeling work from foreign keys and joins toward item boundaries, partition keys, query paths, and request cost.

## Accounts, Databases, Containers, and Items
<!-- section-summary: Cosmos DB stores JSON-like items in containers, and containers hold the main scale and behavior settings. -->

A **Cosmos DB account** is the top-level Azure resource. It owns account-level settings such as API kind, regions, default consistency, backup mode, network access, and keys or identities used by clients. In our example, the account could be named `cosmos-devpolaris-orders-prod` and live in the same production data resource group as the order platform.

A **database** is a namespace inside the account. It groups related containers, similar to a folder for data resources rather than a relational schema with table joins. Our example database is `orders-events` because it holds operational records that sit beside the main order ledger instead of replacing it.

A **container** stores items and owns several important behavior settings. The partition key belongs to the container. Throughput can belong to a container or be shared at the database level. The indexing policy, default TTL behavior, unique key policy, and stored procedures also live at the container boundary.

An **item** is one JSON document inside a container. In the API for NoSQL, every item has an `id`, and the combination of `id` plus partition key value identifies the item inside the container. Here is an idempotency record that a checkout API might write:

```json
{
  "id": "pay_req_8f31",
  "idempotencyKey": "pay_req_8f31",
  "orderId": "ord_74291",
  "requestHash": "sha256:4f2c...",
  "status": "completed",
  "paymentProvider": "stripe",
  "createdAt": "2026-06-11T09:24:18Z",
  "completedAt": "2026-06-11T09:24:21Z",
  "ttl": 604800
}
```

This item has one job: help the checkout API answer "have I already processed this exact payment request?" The item includes business fields like `orderId` and `status`. Azure SQL Database still keeps customers, orders, payments, and line items because those records need relational rules and reporting queries.

The `job-status` container would hold a different item shape:

```json
{
  "id": "job_2026_06_11_0042",
  "jobId": "job_2026_06_11_0042",
  "requestedBy": "support_agent_17",
  "type": "monthly_order_export",
  "status": "running",
  "progressPercent": 72,
  "createdAt": "2026-06-11T10:02:03Z",
  "updatedAt": "2026-06-11T10:04:28Z",
  "ttl": 2592000
}
```

This second item has a separate lifecycle. It gets updated while a worker runs, support reads it by `jobId`, and the record expires after about 30 days. Keeping it in a separate container lets the team choose a different partition key, TTL, throughput, and indexing policy from the idempotency records.

## Partition Keys
<!-- section-summary: The partition key decides how Cosmos DB groups items and routes work, so it must match both scale and lookup paths. -->

A **partition key** is the item property Cosmos DB uses to group items into logical partitions. The partition key path is the property name in the container definition, such as `/idempotencyKey` or `/jobId`. The partition key value is the value on one item, such as `pay_req_8f31` or `job_2026_06_11_0042`.

Cosmos DB hashes partition key values and maps logical partitions onto physical partitions that the service manages. Azure owns the physical placement. The application team chooses a key that gives Cosmos DB enough distinct values and routes common requests efficiently.

For `idempotency-keys`, `/idempotencyKey` is a clean beginner example. Every retry token gets its own partition key value, so writes spread across many values and point reads can target one record. For `job-status`, `/jobId` has the same basic shape because support reads and workers update one job at a time.

The partition key choice carries a long life. Changing the partition key path later usually means creating a new container with the desired key and moving data into it. The partition key value on an existing item also stays tied to that item, so the app should choose a value that belongs to the item for its whole life.

Here are a few candidate keys for the checkout scenario. Each key looks simple in isolation, so the useful review is how it behaves under real traffic:

| Candidate key | Fit | Reason |
| --- | --- | --- |
| `/idempotencyKey` | Good for retry records | Many possible values, direct point reads, natural expiry |
| `/jobId` | Good for job status | One job is the common read and update target |
| `/status` | Weak for scale | A few values such as `queued` and `complete` create busy groups |
| `/createdMonth` | Weak for active writes | Current-month records collect together and dashboards still need more filters |
| `/customerId` | Depends on the workload | Good for customer-scoped queries, risky for very large tenants or token-only lookups |

The dashboard problem comes from this table. Suppose someone later adds a support dashboard that asks, "show every retry record for customer `cust_914` in June." The `idempotency-keys` container uses `/idempotencyKey`, so that query misses the partition key. Cosmos DB can run cross-partition queries, but the request costs more RUs and has a different latency profile than a point read.

At that moment, the team has a design conversation rather than a tuning-only conversation. The dashboard could read from Azure SQL Database if the data is relational, from an analytics pipeline if it is reporting, or from a separate Cosmos DB projection with a partition key such as `/customerId` if the product truly needs fast customer-scoped reads. Raising throughput may reduce symptoms, while the lookup path stays the same.

## Request Units and Throughput
<!-- section-summary: Request units measure the work Cosmos DB performs, and throughput settings decide how much work the container can do per second. -->

A **request unit**, usually shortened to **RU**, is Cosmos DB's unit for database work. Reads, writes, queries, and deletes all consume RUs based on the CPU, memory, and I/O the service uses for the operation. A point read by item ID and partition key costs much less than a broad query that loads many records.

Microsoft's examples use a one-kilobyte point read as `1` RU. Larger items cost more. Queries cost more as they scan more data, use more predicates, return more results, or need more index work. Stronger read consistency levels can also increase RU cost for reads.

Throughput is the RU budget available over time. **Provisioned throughput** reserves a configured number of RU/s for a container or database. **Autoscale throughput** changes within configured bounds as traffic changes. **Serverless** charges by consumed RUs and can fit small or spiky workloads where steady reserved capacity would sit idle.

In our example, each container might start with `400` RU/s while the product is small. Treat that as a capacity guess that should be checked against real request rates, item sizes, consistency settings, indexing policy, and traffic bursts.

HTTP `429` responses tell the app that Cosmos DB throttled a request because the workload exceeded the available RU budget or concentrated too much work in one busy partition range. The SDKs usually retry these responses with backoff, so a small number may appear during healthy high utilization. A sustained pattern needs investigation because the fix could be more throughput, a better partition key, a query change, a smaller item, a different index policy, or a separate read model.

Here is the practical review board for RU pressure:

| Signal | What it may mean | First review |
| --- | --- | --- |
| Point reads are cheap and stable | The access path matches the model | Keep item size and key choice under review |
| Queries cost much more than expected | The query scans too much data or misses the partition key | Check query filters and index use |
| One key receives heavy traffic | The workload has a hot partition key value | Review partition key design or sharding strategy |
| Writes cost more after item growth | The item got larger or more indexed properties changed | Review item shape and indexing policy |
| Repeated `429` responses | RU budget or distribution falls behind | Check normalized RU, hot partitions, and latency |

This is why Cosmos DB design starts with access paths. RUs turn modeling choices into performance and cost. A small point read can feel effortless, while the wrong dashboard query can spend the same budget very quickly.

## Indexing and Queries
<!-- section-summary: Cosmos DB indexes item properties for queries, but the best query still follows the partition and data shape. -->

An **index** is a data structure the database uses to find items without scanning everything. Cosmos DB for NoSQL creates an indexing policy for every container. By default, new containers index every property on every item, which gives beginners useful query behavior without designing indexes on day one.

That default is helpful during early development. It also means each write may update more index entries than the application truly needs. In production, a busy write-heavy container should review the indexing policy so the team indexes fields used by real queries and avoids spending RUs on properties nobody searches.

The `idempotency-keys` container may mostly use point reads. The API calls the SDK with `id = "pay_req_8f31"` and partition key `idempotencyKey = "pay_req_8f31"`. That is the most efficient read shape because Cosmos DB can route directly to one item.

A query has a different shape:

```sql
SELECT c.id, c.orderId, c.status
FROM c
WHERE c.status = "completed"
AND c.createdAt >= "2026-06-01T00:00:00Z"
```

This query can be useful for an admin screen, but it leaves out `/idempotencyKey`. Cosmos DB may need to fan out across partitions, check many items, and page through results. The cost grows with the amount of data processed and returned, even if the result list looks small.

Adding the partition key to a query changes the route. This version gives the query engine the value it needs to target a narrower part of the container:

```sql
SELECT c.id, c.orderId, c.status
FROM c
WHERE c.idempotencyKey = "pay_req_8f31"
AND c.status = "completed"
```

This second query has a better routing story, although a real point read by ID and partition key is still the preferred shape for one known item. The useful distinction is point read versus query. Filtering on `id` and partition key in SQL syntax still runs through the query path, while a point read uses the SDK or REST point-read operation.

Indexing also affects writes. A large item with many indexed properties costs more to write than a small item with fewer indexed fields. If the application stores big blobs of text, PDF bytes, or image data inside Cosmos DB, the item becomes expensive and awkward. Blob Storage is usually the better home for large files, with Cosmos DB storing the metadata and blob URL when the app needs a fast item record.

## Consistency and Regions
<!-- section-summary: Consistency controls how fresh reads must be after writes, especially when data lives in more than one region. -->

So far, the checkout records have a home, a partition key, and a cost shape. The next question comes from the user experience. After the app writes a record, how fresh does the next read need to be?

**Consistency** is the read guarantee the database gives after a write. Cosmos DB offers five consistency levels: **Strong**, **Bounded Staleness**, **Session**, **Consistent Prefix**, and **Eventual**. The choice affects freshness, latency, availability behavior, and RU cost.

For many application flows, **Session consistency** is the easiest place to start. It gives a client session read-your-writes behavior, so the same shopper who just submitted a payment can read the updated idempotency record through that session. Cosmos DB SDKs handle session tokens so the client can send the token on later reads.

The levels form a spectrum:

| Level | Plain meaning | Example fit |
| --- | --- | --- |
| Strong | Reads return the latest committed write where supported by the account configuration | A small correctness-sensitive workload with strict freshness needs |
| Bounded Staleness | Reads can lag only within a configured version or time bound | Multi-region reads where a known maximum lag matters |
| Session | A client session reads its own writes | Carts, preferences, checkout retry records, support job status |
| Consistent Prefix | Reads preserve write order while allowing lag | Event-style views where order matters more than latest value |
| Eventual | Replicas converge over time | Counters, feeds, telemetry views, low-risk status displays |

Now bring regions into the conversation. Cosmos DB can replicate data to multiple Azure regions, and it can support single-region writes or multi-region writes depending on account configuration. A global app may place reads near users, but the team still needs to choose how fresh those reads must be and what latency tradeoff the product accepts.

For our idempotency key, the payment path should avoid stale confusion. If a client retries immediately after payment succeeds, the service should recognize the completed request. Session consistency usually fits that flow because the client or service session can read its own write. A public analytics counter on a dashboard could accept weaker freshness because a short delay leaves the checkout result unchanged.

Consistency also has cost. Microsoft documents that Strong and Bounded Staleness reads consume roughly twice the RUs of more relaxed levels. That cost belongs in the product tradeoff, especially on high-volume read paths where freshness rules affect both behavior and capacity.

## TTL and Temporary State
<!-- section-summary: TTL lets Cosmos DB expire short-lived items automatically, which fits retry keys and operational status records. -->

Now the read behavior is clear, and the next production problem is cleanup. Idempotency keys and job status records have value for a while, then they turn into clutter. A database that keeps every temporary record forever creates storage growth, noisy dashboards, and awkward support questions later.

**TTL** means **time to live**. It is an expiry setting in seconds. Cosmos DB counts that number from the item's last modified time, so an update refreshes the countdown. A container must have TTL enabled before item-level `ttl` values matter, and then each item can use the container default or override it with its own value.

The `idempotency-keys` container may use a default TTL of `604800` seconds, which is seven days. That matches a retry policy where payment clients may repeat requests for a limited period. After the retry window, the key has served its purpose and should stop taking storage.

The `job-status` container may use `2592000` seconds, which is 30 days. Support can still inspect recent exports, but the platform avoids keeping temporary operational records forever. If the business needs permanent audit history, that history belongs in an audit store designed for retention and review rather than in a status container with automatic expiry.

TTL deletion runs as background work. After an item expires, it stops appearing in query results, even if the service still waits to physically remove it from the container. If the container has heavy workload pressure, physical deletion can wait until enough RU capacity is available for the cleanup.

This gives TTL a real operational shape. It helps control storage growth, but it is still part of the data contract. The team should choose the expiry window with product, support, compliance, and recovery needs in mind. A retry key, a job status record, and a legal audit record usually need different retention choices.

## Transactions and Boundaries
<!-- section-summary: Cosmos DB supports transactional work inside one logical partition, so item grouping affects correctness as well as scale. -->

A **transaction** is a group of data operations that succeeds together or fails together. Cosmos DB supports ACID transactions with snapshot isolation inside a single logical partition. In practice, that means the partition key can also define the boundary for multi-item transactional work.

For the idempotency example, the simplest design keeps one item per key. The API can create or update that one item safely with optimistic concurrency controls such as ETags. An **ETag** is a version value the service changes when the item changes, so an update can say, "apply this only if nobody changed the item since I read it."

If a workflow needs to update several Cosmos DB items atomically, those items need to live in the same logical partition for stored procedures or transactional batch-style work. That pushes the team back to the partition key decision. A partition key that spreads everything perfectly may separate records that the app wants to update together, while a key that groups related records may create a busy partition for a large customer.

That tradeoff shows up in real systems. A shopping cart container may partition by `cartId` or `customerId` because cart lines and cart summary need to move together. An idempotency container may partition by `idempotencyKey` because each token is independent. A job-status container may partition by `jobId` because one job record is the unit of work.

Cosmos DB can serve many workloads with single-item write patterns. The key is naming the boundary honestly. If the product requires foreign keys, multi-table joins, broad reporting, and transactions across many unrelated records, Azure SQL Database probably belongs in the first design review.

## When Cosmos DB Fits
<!-- section-summary: Cosmos DB fits item-shaped, key-oriented workloads and asks for another design when the workload is relational, analytical, or file-shaped. -->

Cosmos DB fits well when the data has item-shaped boundaries, the frequent reads are known early, the partition key can spread load, and the team values low-latency reads, elastic scale, TTL, or multi-region options. Idempotency records, shopping carts, user preferences, device state, session documents, job status, and event snapshots can all fit this pattern.

Cosmos DB also fits when JSON flexibility helps the application evolve. A job-status record may gain `queuedBy`, `retryCount`, or `downloadUrl` without a schema migration. The team still reviews item shape because every extra field has storage, indexing, and RU effects, but the document format gives application teams room to evolve operational state.

Azure SQL Database fits a different job. Orders, customers, payments, refunds, and line items often need constraints, joins, transactions, migrations, reports, and point-in-time restore around relational records. Blob Storage fits generated files and large bytes. Azure Files and Managed Disks fit operating-system storage paths. The best Azure design usually combines these services instead of forcing every data shape into one database.

Here is a quick service-fit review. The point is to match the data shape to the service instead of letting one familiar database absorb every workload:

| Workload | First service to review | Reason |
| --- | --- | --- |
| Checkout idempotency keys | Cosmos DB | Key-based reads, small JSON items, short TTL |
| Background job status | Cosmos DB | One job ID lookup, small updates, automatic expiry |
| Order ledger and payment records | Azure SQL Database | Relational rules, constraints, transactions, reporting |
| Receipt PDF files | Blob Storage | Durable object bytes and signed access patterns |
| Monthly customer totals | Azure SQL or analytics service | Aggregates, joins, date ranges, historical reporting |
| Shared templates for a legacy VM app | Azure Files | Mounted filesystem path shared by machines |

The common beginner trap is choosing Cosmos DB because a record can be written as JSON. JSON is only the item format. The stronger question is whether the app can name the item, route through a good partition key, control RU cost, and choose a retention and consistency policy that matches the product.

## Putting It All Together
<!-- section-summary: A good Cosmos DB design connects the access pattern to the item, partition key, RU budget, consistency level, and TTL rule. -->

Let's put the checkout platform together. The main order system keeps durable relational records in Azure SQL Database. Receipt files go to Blob Storage. Cosmos DB holds two operational containers in the `orders-events` database: `idempotency-keys` for checkout retries and `job-status` for background export progress.

The `idempotency-keys` container uses `/idempotencyKey` as the partition key because the checkout API reads one retry token at a time. The default TTL is seven days because the token only needs to protect the retry window. The API uses point reads and conditional writes, watches RU charge and `429` responses, and avoids turning the container into a customer reporting source.

The `job-status` container uses `/jobId` because support screens and workers care about one job at a time. The default TTL is 30 days because old status records should leave the system without a cleanup script. If support later needs long-term audit history, the team can design a separate retention path rather than stretching a temporary status container into an archive.

Cosmos DB works best here because the records are small, independent, key-oriented, and time-bound. The service design stays understandable because every major setting connects back to a concrete product behavior: point reads for retries, job ID lookups for support, TTL for expiry, Session consistency for read-your-writes flows, and RU monitoring for capacity signals.

That is the bigger lesson. Cosmos DB moves modeling work from table relationships to **item shape**, **partition key**, **query path**, **RU cost**, **consistency**, **transaction boundary**, and **expiry**. When those answers line up with the workload, Cosmos DB can be a very clean home for fast application state.

## What's Next

Next we look at Disks and File Shares, where the storage question changes from database records to operating-system paths. That is the world of VM-attached block devices, shared folders, host caching, file protocols, and workloads that expect to call normal filesystem operations.

---

**References**

- [Azure Cosmos DB documentation](https://learn.microsoft.com/en-us/azure/cosmos-db/) - Official Cosmos DB documentation hub and product overview.
- [Databases, containers, and items in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/resource-model) - Account, database, container, item, indexing, and TTL resource model.
- [Partitioning and horizontal scaling in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/partitioning) - Logical partitions, physical partitions, hot partitions, partition key guidance, and partition limits.
- [Request Units in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/request-units) - RU concepts and operation cost factors.
- [Optimize request cost in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/optimize-cost-reads-writes) - Point reads, query cost, write cost, and request charge guidance.
- [Provision throughput for containers and databases](https://learn.microsoft.com/en-us/azure/cosmos-db/set-throughput) - Container throughput, database throughput, RU/s, and rate limiting guidance.
- [Indexing policies in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/index-policy) - Default indexing behavior and indexing policy choices for API for NoSQL containers.
- [Consistency levels in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels) - Strong, bounded staleness, session, consistent prefix, and eventual consistency.
- [Time to live in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/time-to-live) - TTL expiry behavior, background deletion, and item visibility after expiry.
- [Transactions and optimistic concurrency control](https://learn.microsoft.com/en-us/azure/cosmos-db/database-transactions-optimistic-concurrency) - ACID transactions within logical partitions and optimistic concurrency behavior.
