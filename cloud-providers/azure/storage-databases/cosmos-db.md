---
title: "Cosmos DB"
description: "Use Cosmos DB when data is item-shaped, reads are known early, partition keys are deliberate, and expiry or global scale matter."
overview: "Cosmos DB is Azure's managed NoSQL database family. This article explains items, containers, partition keys, request units, TTL, and the design pressure that comes from starting with access patterns."
tags: ["azure", "cosmos-db", "nosql", "partition-key", "ttl"]
order: 4
id: article-cloud-providers-azure-storage-databases-cosmos-db-nosql-data-models
aliases:
  - cosmos-db-and-nosql-data-models
  - cloud-providers/azure/storage-databases/cosmos-db-and-nosql-data-models.md
---

## Table of Contents

1. [The Problem](#the-problem)
2. [What Is Cosmos DB](#what-is-cosmos-db)
3. [Items](#items)
4. [Containers](#containers)
5. [Partition Keys](#partition-keys)
6. [Request Units](#request-units)
7. [TTL](#ttl)
8. [Access Patterns](#access-patterns)
9. [When SQL Is Simpler](#when-sql-is-simpler)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Problem

Azure SQL Database is a good home for order records and payment state. But the orders system also has small pieces of data that do not always need relational modeling.

Two examples appear during checkout:

- An idempotency record says request `req_83b` already created order `417`.
- An export job-status record says job `job_712` is still running and should expire after a few days.

The app reads each of these by a known key. It does not need to join them to line items or run flexible support reports across many relationships. That shape can fit Cosmos DB. The key word is can. Cosmos DB is powerful, but it asks for design decisions early.

## What Is Cosmos DB

Azure Cosmos DB is a managed NoSQL database service. It supports multiple APIs, but this article uses the common beginner model: JSON-like items stored in containers and read through known access paths.

If you know DynamoDB, the transferable habit is access-pattern thinking. You do not start by saying "NoSQL is flexible." You start by writing down how the application will read and write the data. Cosmos DB can be excellent when those paths are clear. It can be frustrating when the team chooses it before knowing the reads.

The first nouns are:

| Cosmos DB noun | Beginner meaning |
| --- | --- |
| Account | The Azure resource boundary for Cosmos DB configuration and APIs. |
| Database | A namespace for containers. |
| Container | The scale and partitioning boundary for items. |
| Item | A JSON-like document or record stored in a container. |
| Partition key | The value used to distribute and route items. |
| Request unit | The measured cost of database operations. |
| TTL | Time to live, used to expire items automatically. |

The story is not "Cosmos DB has no schema, so design is easy." The story is "Cosmos DB rewards knowing the shape of reads, writes, partitions, and expiry."

## Items

An item is a stored document. It often looks friendly to application developers because it resembles the object the code already uses.

An idempotency item might look like this:

```json
{
  "id": "req_83b",
  "customerId": "cust_91",
  "orderId": "order_417",
  "status": "completed",
  "createdAt": "2026-05-16T14:07:00Z",
  "expiresAt": "2026-05-23T14:07:00Z"
}
```

This item is useful because the app knows the key before reading it. The checkout code receives a request ID, checks whether that ID already completed, and either returns the existing result or creates a new order safely.

The item shape should match the read path. Do not store a large nested order document here just because JSON makes it possible. If the business record belongs in SQL, keep it there and store only the idempotency fact in Cosmos DB.

## Containers

A container stores items and defines important behavior such as partitioning and throughput. In Cosmos DB, the container is not just a folder. It is the place where scale and partition-key design become real.

For the orders system, idempotency records and export job statuses might be separate containers if they have different access patterns, retention needs, and throughput behavior. They might share a container if the data model and operational boundary truly fit together. The point is to choose the container around workload behavior, not around vague nouns.

Container design affects cost and performance. A container with a poor partition key can create hot partitions or expensive queries. A container that mixes unrelated item types can become hard to reason about later.

## Partition Keys

The partition key is one of the most important design choices in Cosmos DB. It is the value Cosmos DB uses to group and distribute items. The partition key affects how requests are routed, how data is spread, and how efficiently queries run.

For an idempotency container, a request ID might look tempting because the app reads by request ID. For a job-status container, job ID might be the obvious key. For customer-scoped data, customer ID might be useful if the app often reads all items for one customer.

The gotcha is that a partition key is hard to change after the design is live. If the team chooses a key that does not match the real access pattern, the fix may involve creating a new container and moving data. This is why Cosmos DB planning starts earlier than some teams expect.

Ask these questions before choosing:

| Question | Why it matters |
| --- | --- |
| What value does the app know before reading? | Efficient point reads depend on known keys. |
| Will one value receive most traffic? | A hot partition can throttle or distort cost. |
| Does the app need queries across many partitions? | Cross-partition queries can be more expensive. |
| Will the partition key still make sense next year? | Repartitioning later is usually a migration, not a quick toggle. |

## Request Units

Cosmos DB measures database work in request units, often called RUs. Reads, writes, queries, and stored item size all affect RU consumption. This is how Cosmos DB turns operations into capacity and cost signals.

For beginners, the main lesson is that not all reads cost the same. A point read of one item by ID and partition key is usually the clean path. A broad query that scans many partitions is a different shape. If the application will often ask broad, relational questions, the data model may be wrong for Cosmos DB.

Request units make access patterns visible in cost. If a simple feature becomes surprisingly expensive, inspect whether the app is doing broad queries, writing large items, or hitting one partition too hard.

## TTL

TTL means time to live. It lets Cosmos DB automatically delete items after a configured lifetime. This is useful for data that is real but temporary: idempotency records, job statuses, short-lived session records, or processing checkpoints.

TTL is not a trash can for important business history. If support needs a record for seven years, automatic expiry after seven days is wrong. If the app only needs to remember idempotency for a week, TTL can keep the container from growing forever.

The design question is product-shaped: how long should this fact matter? Once that answer is clear, TTL can make the cleanup rule part of the data model.

## Access Patterns

Cosmos DB design starts with access patterns because the service is strongest when the app's reads and writes are known. Write the access paths in plain English before choosing the container and partition key.

For the orders system:

| Data | Access pattern | Possible fit |
| --- | --- | --- |
| Idempotency record | Read by request ID before creating an order | Cosmos DB can fit. |
| Export job status | Read by job ID until the job finishes, then expire | Cosmos DB can fit. |
| Order and line items | Query by customer, status, date, payment state, support workflows | Azure SQL likely fits better. |
| Receipt PDF | Download by blob name after authorization | Blob Storage fits better. |

This table is more useful than a service comparison chart because it starts from the application behavior.

## When SQL Is Simpler

Cosmos DB should not become the place where uncertain relational data goes. If the team keeps asking for joins, ad hoc reports, relational constraints, transaction-heavy updates across multiple entities, and flexible support queries, SQL may be simpler.

The wrong reason to choose Cosmos DB is "we do not know the schema yet." Unknown schema is not freedom. It is missing design. NoSQL systems often need the read path and partition strategy sooner, not later.

Use Cosmos DB when the item model makes the system clearer. Use Azure SQL when relationships and queries are the core of the data.

## Putting It All Together

The opener had an idempotency record and an export job-status record. Both can be item-shaped. Cosmos DB gives them a managed NoSQL home if the app knows how it will read and expire them.

Items hold the data. Containers define scale and partitioning boundaries. Partition keys route and distribute work. Request units reveal the cost of reads, writes, and queries. TTL can expire short-lived facts. Access patterns decide whether Cosmos DB is a good fit. SQL remains simpler when the data is relational.

That is the Cosmos DB habit: start with the read path, not with the word NoSQL.

## What's Next

Next we will look at Disks and File Shares, the storage shapes that exist because some workloads still need an operating-system disk or mounted folder.

---

**References**

- [Azure Cosmos DB documentation](https://learn.microsoft.com/en-us/azure/cosmos-db/)
- [Partitioning and horizontal scaling in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/partitioning-overview)
- [Request units in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/request-units)
- [Time to live in Azure Cosmos DB](https://learn.microsoft.com/en-us/azure/cosmos-db/time-to-live)
