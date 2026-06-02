---
title: "Cosmos DB"
description: "Use Cosmos DB when data is item-shaped, reads are known early, partition keys are deliberate, and expiry or global scale matter."
overview: "Cosmos DB is Azure's managed NoSQL database family. This article explains items, containers, partition keys, request units, TTL, consistency, and the design pressure that comes from starting with access patterns."
tags: ["azure", "cosmos-db", "nosql", "partition-keys", "request-units"]
order: 4
id: article-cloud-providers-azure-storage-databases-cosmos-db-nosql-data-models
aliases:
  - cosmos-db-and-nosql-data-models
  - cloud-providers/azure/storage-databases/cosmos-db-and-nosql-data-models.md
---

## Table of Contents

1. [What Is Cosmos DB](#what-is-cosmos-db)
2. [Access Patterns](#access-patterns)
3. [Containers and Items](#containers-and-items)
4. [Partition Keys](#partition-keys)
5. [Request Units](#request-units)
6. [Consistency](#consistency)
7. [TTL](#ttl)
8. [When Cosmos DB Fits](#when-cosmos-db-fits)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## What Is Cosmos DB

Cosmos DB is Azure's managed database for item-shaped data that an application usually reads and writes through known keys. It is a NoSQL service, which means it does not start from fixed relational tables and joins. In the API for NoSQL model, records are JSON-like items stored in containers.

Example: an orders service may keep durable order records in Azure SQL, receipt PDFs in Blob Storage, and checkout idempotency records in Cosmos DB. An idempotency record can be read by request ID, updated a few times, then expired after a short period. That is a better item-shaped workload than a relationship-heavy reporting workload.

Cosmos DB is strongest when the application can describe its frequent access patterns early. Which field identifies the item? Which field groups related items? Which queries must be fast? Which data can expire? Which users need to read their own writes immediately? These questions matter before the container is created.

## Access Patterns

An access pattern is the normal way application code reads or writes data. In Cosmos DB, access patterns are not a late optimization. They shape the container design.

A point read is the simplest pattern: the app knows the item ID and the partition key value. For example, the app reads idempotency record `req_83b_checkout` for customer `cust_914`. That request can go directly to the partition that owns the item. It is predictable and cheap.

A broad query is different. If the app asks for every idempotency record created this month without a partition filter, Cosmos DB may need to query across many partitions. That uses more request units and has more latency. Cosmos DB can support queries, but the design should not depend on frequent, expensive scans for core request-time behavior.

The beginner mistake is choosing Cosmos DB because JSON feels flexible, then discovering later that the application really needed joins, ad hoc reports, or relational constraints. Flexibility in the item body does not remove the need for data modeling.

## Containers and Items

A Cosmos DB account is the top-level Azure resource. A database is a namespace inside the account. A container is the unit that stores items and owns key design settings such as partition key, throughput, indexing policy, and TTL behavior. An item is one JSON-like document inside the container.

Example item:

```json
{
  "id": "req_83b_checkout",
  "customerId": "cust_914",
  "orderId": "ord_417",
  "status": "completed",
  "ttl": 86400
}
```

This item has an `id`, business fields, and a `ttl` value. If the container uses `/customerId` as the partition key, Cosmos DB groups this item with other items for the same customer partition key value.

Containers are not generic dumping grounds. A container should group items that share an access pattern and partitioning strategy. Shopping carts, device telemetry, and session records may all be JSON-like, but they usually deserve separate containers because they are read, written, expired, and scaled differently.

## Partition Keys

A partition key is the item field Cosmos DB uses to group related items and distribute storage and request load. It is one of the most important choices in a Cosmos DB design.

![Cosmos DB partition map showing incoming items, partition key routing, balanced and hot partitions, and physical partition behavior](/content-assets/articles/article-cloud-providers-azure-storage-databases-cosmos-db-nosql-data-models/cosmos-db-partition-map.png)

*Partition keys decide where items land, so a good key spreads load while still matching the application lookup path.*


Example: for a shopping cart container, `/customerId` may be a good partition key if the app usually reads or updates one customer's cart. For idempotency records, `/requestId` or a synthetic key may work better if each request token is independent and write load needs to spread widely.

The partition key needs two properties. First, it should have high cardinality, which means many possible values. A key such as `/status` is weak because most items may have the same few values, such as `pending` or `completed`. Second, it should match frequent queries. A high-cardinality key that the app never uses in filters can still create expensive cross-partition queries.

| Candidate key | Fit | Why |
| --- | --- | --- |
| `/customerId` | Good for carts and user-scoped state | Many values and common customer lookups |
| `/requestId` | Good for idempotency records | Very high cardinality and point reads |
| `/createdYear` | Poor for active writes | Low cardinality and hot current-year partition risk |
| `/deviceId` | Good for device telemetry | Many devices and natural device lookup path |

Cosmos DB automatically manages physical partitions behind the service boundary as data and throughput grow. The design task for the application team is simpler and more important: choose a logical partition key that spreads data and matches the requests the app actually makes.

## Request Units

A request unit, or RU, is Cosmos DB's measure of database work. Reads, writes, and queries all consume RUs based on the CPU, memory, and I/O work needed to complete the operation.

![Cosmos DB request unit pressure diagram showing balanced partitions, hot partitions, throttling, and better partition keys](/content-assets/articles/article-cloud-providers-azure-storage-databases-cosmos-db-nosql-data-models/ru-pressure.png)

*RU pressure is often a modeling signal: throttling may come from hot partitions or expensive queries, not only from too little capacity.*


Example: reading a small item by ID and partition key may cost about `1` RU. A query that scans many properties across many partitions can cost far more. That difference is why access pattern design affects both performance and bill.

Cosmos DB offers several capacity models. Provisioned throughput reserves RU/s for a container or database. Autoscale provisioned throughput adjusts within configured bounds. Serverless charges for consumed RUs and can be useful for intermittent workloads. The right model depends on traffic shape. A steady checkout path usually needs more predictable capacity planning than a rarely used admin tool.

HTTP `429` responses are the signal that requests are being throttled because the workload is exceeding available RU capacity or concentrating too much work in one partition range. The fix may be capacity, query design, indexing, partition-key choice, or workload smoothing. Simply raising throughput can hide a modeling problem without solving it.

## Consistency

Consistency is the read guarantee Cosmos DB gives after data is written. The choice controls how fresh reads must be, how replicas coordinate, and what latency or throughput tradeoff the application accepts.

![Cosmos DB consistency dial showing stronger freshness on one side and lower latency on the other](/content-assets/articles/article-cloud-providers-azure-storage-databases-cosmos-db-nosql-data-models/consistency-dial.png)

*Consistency is a product decision: stronger freshness can cost latency and throughput, while weaker reads may be acceptable for some flows.*


The five consistency levels form a spectrum:

| Level | Plain meaning | Example fit |
| --- | --- | --- |
| Strong | Reads see the latest committed write | Small-region correctness-sensitive state |
| Bounded staleness | Reads may lag, but only within a configured bound | Data can trail by a known time or version limit |
| Session | A client can read its own writes | Shopping cart or user preference flows |
| Consistent prefix | Reads preserve write order but may lag | Ordered event views where stale is acceptable |
| Eventual | Replicas converge later with the least freshness promise | Counters, non-critical feeds, telemetry dashboards |

Session consistency is the common beginner default to understand. If a shopper adds an item to a cart, that shopper should see the item on the next read. Other readers may catch up later. Cosmos DB tracks this through session tokens used by SDK calls.

Stronger consistency can cost more latency or throughput, especially across regions. Weaker consistency can improve availability and speed when stale reads are acceptable. The product behavior should drive the setting. A payment status and a public like counter should not automatically use the same guarantee.

## TTL

TTL means time to live. It is an expiry rule that lets Cosmos DB delete items automatically after a configured number of seconds.

Example: a checkout idempotency record may need to survive for one day. Setting `ttl` to `86400` means the record can expire after that window instead of growing the container forever.

TTL can be configured at the container level as a default and overridden on individual items. A document-level `ttl` value can shorten, lengthen, or disable expiry for that item depending on the container configuration.

TTL is useful for temporary state, but it is not free in the design sense. Expired items are removed by background work, and that work can consume request-unit capacity. Monitor RU usage and storage trends instead of assuming expiry has no operational footprint.

## When Cosmos DB Fits

Cosmos DB fits when data is item-shaped, access patterns are known, partition keys can be chosen deliberately, and the team values low-latency key-based reads, horizontal scale, TTL, or distributed consistency options.

It is usually a poor fit for relation-heavy business records. If the application needs foreign keys, multi-table transactions, flexible joins, or ad hoc reporting over many relationships, Azure SQL Database is usually the clearer starting point. If the data is a file, Blob Storage is the clearer starting point. If the workload needs an operating system path, Managed Disks or Azure Files may be the right shape.

The practical design question is not "SQL or NoSQL?" in the abstract. The useful question is: can the application name the item or partition it needs for its common requests? If yes, Cosmos DB may fit. If no, slow down and model the access path before creating the container.

## Putting It All Together

Cosmos DB is an Azure database for item-shaped data with predictable access patterns. A good Cosmos design starts with the application's normal reads and writes, then chooses containers, partition keys, throughput, consistency, and TTL rules around those paths.

The non-obvious lesson is that NoSQL does not mean no modeling. Cosmos DB moves the modeling pressure from table relationships to partition keys, item shape, query paths, RU cost, consistency, and expiry. When those decisions line up with the workload, Cosmos DB can be a clean home for fast, scalable item state.

## What's Next

Next we look at Disks and File Shares, where the question changes from database APIs to workloads that need operating system storage paths.

---

**References**

* [Azure Cosmos DB documentation](https://learn.microsoft.com/en-us/azure/cosmos-db/) - Official Cosmos DB documentation hub.
* [Partitioning and horizontal scaling in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/partitioning-overview) - Logical partitions, physical partitions, and partition key guidance.
* [Request units in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/request-units) - RU concepts, operation costs, and throughput behavior.
* [Consistency levels in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels) - Consistency guarantees and throughput tradeoffs.
* [Time to live in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/time-to-live) - TTL configuration and expiry behavior.
* [Continuous backup mode in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/migrate-continuous-backup) - Continuous backup and point-in-time restore capabilities.
