---
title: "NoSQL with DynamoDB"
description: "Model NoSQL data in DynamoDB by designing access patterns, partition keys, sort keys, indexes, conditional writes, capacity mode, streams, TTL, PITR, and global tables."
overview: "DynamoDB is built for fast key-based access at large scale. This article follows carts, sessions, and payment idempotency records through table design, hot-key avoidance, conditional writes, indexes, capacity planning, and production checks."
tags: ["aws", "dynamodb", "nosql", "tables", "keys"]
order: 5
id: article-cloud-providers-aws-storage-databases-dynamodb-tables-access-patterns
aliases:
  - dynamodb-tables-and-access-patterns
  - dynamodb-tables-access-patterns
  - nosql-with-dynamodb
  - cloud-providers/aws/storage-databases/dynamodb-tables-and-access-patterns.md
  - cloud-providers/aws/storage-databases/nosql-with-dynamodb.md
---

## Table of Contents

1. [When Key-Based Data Fits](#when-key-based-data-fits)
2. [Tables, Items, and Primary Keys](#tables-items-and-primary-keys)
3. [Access Patterns Before Attributes](#access-patterns-before-attributes)
4. [Conditional Writes and Idempotency](#conditional-writes-and-idempotency)
5. [Indexes, Streams, TTL, and Global Tables](#indexes-streams-ttl-and-global-tables)
6. [Capacity, Hot Keys, and Observability](#capacity-hot-keys-and-observability)
7. [Production Table Checklist](#production-table-checklist)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## When Key-Based Data Fits
<!-- section-summary: DynamoDB fits high-volume data that applications read and write through known keys and predictable access patterns. -->

Maple Market already has a relational checkout database for orders and payments. That database is the right home for transactions, joins, constraints, and flexible SQL reporting. The application also has data that behaves differently: shopping carts, login sessions, rate-limit counters, feature flags, and payment idempotency records.

Those records usually have one thing in common. The application knows the key before it reads or writes the data. It asks for cart `CART#8842`, session `SESSION#abc`, or payment request `REQUEST#pay_771`. The request path wants a fast answer for a known key at high traffic, while flexible reporting and many-table joins still belong in the relational part of the system.

Amazon DynamoDB is a managed NoSQL database for this kind of access. **NoSQL** is a broad term, but in this article it means DynamoDB stores items in tables and routes reads and writes through primary keys and indexes instead of SQL joins. AWS manages the servers and storage partitions behind the service. Your team designs the keys, item shapes, indexes, capacity mode, and access patterns.

That design shift is the big beginner hurdle. In a relational database, you often start with normalized entities and then write SQL queries. In DynamoDB, teams start with the questions the application must answer quickly. "Get cart by customer." "Add item to cart." "Create idempotency record if request ID is new." "Find open carts by account for support." The table design follows those access patterns.

## Tables, Items, and Primary Keys
<!-- section-summary: DynamoDB tables store flexible items, and every item is addressed through a primary key. -->

A DynamoDB **table** is a collection of **items**. An item is a group of attributes. Attributes can be strings, numbers, booleans, lists, maps, sets, and other supported value types. Items in the same table can have different attributes, which gives DynamoDB flexibility for mixed item shapes.

Every item needs a **primary key**. A simple primary key has only a partition key. A composite primary key has a partition key and a sort key. The partition key decides how DynamoDB routes the item to physical storage partitions. The sort key lets many related items share the same partition key while staying ordered and uniquely addressed inside that partition key.

For Maple Market, a cart item could look like this. The `pk` and `sk` values are part of the application contract, and reviewers should treat them as designed API fields.

```json
{
  "pk": "CUSTOMER#771",
  "sk": "CART#active",
  "cartId": "cart-8842",
  "items": [
    {
      "sku": "BAG-RED-01",
      "quantity": 2
    }
  ],
  "updatedAt": "2026-06-13T11:40:00Z",
  "expiresAt": 1781350800
}
```

The partition key `CUSTOMER#771` groups records related to one customer. The sort key `CART#active` names the active cart. A query can ask DynamoDB for the item with that exact key. Another query could request all items under `CUSTOMER#771` if the table stores more customer-scoped items.

The primary key is more than a label. It affects performance and scale. DynamoDB distributes data by partition key. If many requests hit the same partition key at the same time, that key can get hot. A hot key is a key that receives too much traffic compared with the rest of the table. Good partition key design spreads work across many keys while still matching the reads the application needs.

This is why naming keys deserves review. `CUSTOMER#771` may work for carts if each customer has moderate traffic. A celebrity live event or flash sale counter under one key could overload that key. For high-write counters, teams often shard the key, write to multiple buckets such as `COUNTER#sale-2026#shard-03`, and aggregate results later.

![DynamoDB key routing infographic showing a cart request, partition key hash, storage partitions, selected cart item, and hot key warning](/content-assets/articles/article-cloud-providers-aws-storage-databases-dynamodb-tables-access-patterns/dynamodb-key-routing.png)

*The partition key is both an address and a traffic distribution choice.*

## Access Patterns Before Attributes
<!-- section-summary: DynamoDB table design starts by listing exact reads and writes, then choosing keys and indexes that serve those paths. -->

Before Maple Market creates a table, the team should write the access patterns. This is the DynamoDB design step that replaces "let's make tables for every noun." A useful access pattern names the caller, the key facts known at request time, and the result needed.

Here is a small access-pattern list. Each row names what the caller knows and how the table should answer.

| Access pattern | Known values | DynamoDB path |
|---|---|---|
| Get active cart | `customerId` | `pk=CUSTOMER#771`, `sk=CART#active` |
| Save cart | `customerId`, cart body | Put or update same cart item |
| Create payment idempotency record | `requestId` | `pk=IDEMPOTENCY#pay_771`, `sk=REQUEST` |
| Check session | `sessionId` | `pk=SESSION#abc`, `sk=PROFILE` |
| List open carts for support | `accountId`, status | Global secondary index by account and status |

That table gives the design something concrete. The first four paths are direct key lookups. The support query needs a second access path because support knows account and status, not the exact customer cart key. That is where a **global secondary index**, usually called a GSI, can help.

The item can carry extra attributes for future workflows, but those attributes do not make the table queryable by themselves. DynamoDB does not scan the whole table efficiently for every question. If the application needs to find data by a different key, the table usually needs an index or a separate projected item shape.

This is the production lesson: write the real reads and writes before choosing keys. If the team cannot name the access patterns, DynamoDB design turns into guessing. If the access patterns are clear, DynamoDB can be very predictable.

## Conditional Writes and Idempotency
<!-- section-summary: Conditional writes let DynamoDB protect workflows from duplicate requests and unsafe overwrites. -->

One of DynamoDB's most useful production features is the **conditional write**. A conditional write says "write this item only if this condition is true." DynamoDB evaluates the condition atomically with the write. This lets a single table item act as a concurrency barrier.

Maple Market uses conditional writes for payment idempotency. **Idempotency** means the same client request can arrive more than once and still produce one business result. Payment systems need this because browsers retry, networks time out, and users click buttons twice. The payment service should charge once, even if it receives the same request twice.

The service can create an idempotency item with a condition that the item does not already exist. That single conditional write protects the workflow during retries.

```json
{
  "TableName": "maple-prod-app-state",
  "Item": {
    "pk": { "S": "IDEMPOTENCY#pay_771" },
    "sk": { "S": "REQUEST" },
    "status": { "S": "processing" },
    "createdAt": { "S": "2026-06-13T12:00:00Z" },
    "expiresAt": { "N": "1781352000" }
  },
  "ConditionExpression": "attribute_not_exists(pk)"
}
```

If the item already exists, DynamoDB rejects the write with a conditional check failure. The service can then read the existing item and return the already-created result or wait for the first request to finish. That is much safer than checking first and writing later because a check-then-write sequence can race under concurrent requests.

DynamoDB also supports transactions for cases where multiple items need coordinated changes. Transactions are useful, but they should stay tied to clear access patterns and measured needs. If most of the application needs broad relational transactions and flexible joins, the data may belong in RDS or Aurora instead. For key-based concurrency barriers, DynamoDB conditional writes are often a clean fit.

![DynamoDB conditional write flow showing payment request, PutItem, item-missing condition, first request processing, duplicate returning saved result, and one charge](/content-assets/articles/article-cloud-providers-aws-storage-databases-dynamodb-tables-access-patterns/conditional-idempotency-flow.png)

*A conditional write can turn a retry-prone payment request into one safe business result.*

## Indexes, Streams, TTL, and Global Tables
<!-- section-summary: Secondary DynamoDB features support alternate lookups, event-driven workflows, expiry, and multi-Region table replicas. -->

After primary keys, DynamoDB has several features that show up in real systems. Each feature should attach to a specific access path or operating need.

A **global secondary index** gives the table another key structure. Maple Market support wants to list open carts by account. The base table key is customer-oriented, so the team can add a GSI with `gsi1pk=ACCOUNT#42#CART_STATUS#open` and `gsi1sk=UPDATED#2026-06-13T11:40:00Z#CART#8842`. The support UI can query that index without scanning the whole table.

GSIs have their own capacity and consistency behavior. Updates replicate from the base table into the index asynchronously, so a GSI read can lag behind the base table briefly. DynamoDB supports eventually consistent reads from GSIs. If Maple Market needs immediate read-after-write confirmation for a customer, that path should read the base item by primary key.

**DynamoDB Streams** capture item-level changes in a table. A stream can trigger Lambda or feed other processing. Maple Market can publish cart changes into a recommendation workflow or send idempotency completion events to an audit process. Streams are helpful when the application wants the table write to produce follow-up work without putting that work inside the user request.

**Time to Live**, usually called TTL, lets DynamoDB delete expired items after a timestamp attribute passes. Sessions, abandoned carts, and idempotency records often have a natural expiry. TTL is an eventual background cleanup feature, so the application should still treat expired records carefully during reads. For example, it can check `expiresAt` and ignore a stale session even if DynamoDB has not removed the item yet.

**Point-in-time recovery**, or PITR, helps recover from accidental writes or deletes by allowing restore to a previous point within the configured window. **Global tables** replicate a DynamoDB table across Regions for multi-Region applications. These features are powerful, and they also add operational work around replication, conflict behavior, cost, failover procedures, and testing.

The feature list is tempting, but the design should stay anchored in access patterns. A GSI belongs in the table when one real query needs it. Streams belong in the design when one workflow consumes the change. TTL belongs on item families that expire. Global tables belong in a real multi-Region design that needs regional reads and writes.

## Capacity, Hot Keys, and Observability
<!-- section-summary: DynamoDB scale depends on capacity mode, key distribution, request shape, and monitoring signals. -->

DynamoDB has two main capacity modes. **On-demand** mode charges per request and adjusts capacity automatically for variable traffic. It is a strong default for new workloads, unpredictable workloads, and teams that want less capacity planning. **Provisioned** mode lets teams set read and write capacity and use auto scaling, which can fit steady workloads with known patterns and cost optimization goals.

Capacity mode does not erase data-model problems. If one partition key receives too much traffic, the table can still throttle that hot key even while other keys sit quiet. Maple Market should avoid designs where every live request updates `pk=GLOBAL#cart-count` or `pk=FLASHSALE#current` during a launch event. High-write shared counters usually need sharding, aggregation, or a different service pattern.

Read consistency also matters. DynamoDB can serve eventually consistent reads for lower cost and higher throughput in many paths. Strongly consistent reads are available for base table reads in a single Region, but not for GSI reads. The application should pick consistency based on the user path. A cart page right after a write may read the base item strongly. A support dashboard can usually accept slight delay from an index.

The main observability signals include throttled requests, consumed read and write capacity, successful request latency, system errors, user errors, hot partition symptoms, stream iterator age, conditional check failures, and account-level limits. Conditional check failures can be healthy if they represent duplicate payment requests being blocked, so alarms should separate expected business conflicts from unexpected failures.

A practical DynamoDB launch review includes one load test. Maple Market can generate traffic with realistic key distribution, not only random UUIDs. Random keys can make a bad design look good because they spread perfectly. Production traffic often has popular customers, hot products, repeated sessions, and launch spikes. The test data should include those shapes.

## Production Table Checklist
<!-- section-summary: DynamoDB production reviews should check access patterns, key heat, indexes, recovery, expiry, security, and cost. -->

Before a DynamoDB table goes live, Maple Market can review it with a focused checklist. The checklist helps catch missing access patterns while the table is still easy to change.

| Area | Production check |
|---|---|
| Access patterns | Each read and write path is written down with known keys |
| Primary key | Partition key distributes traffic and sort key supports item grouping |
| Hot keys | Known popular keys have sharding, aggregation, or another mitigation |
| GSIs | Each index maps to a real query and has expected consistency behavior documented |
| Conditions | Duplicate-sensitive writes use conditional expressions |
| Capacity | On-demand or provisioned mode matches traffic and cost goals |
| TTL | Expiring items have a timestamp attribute and application-side stale checks |
| Recovery | PITR or backup strategy matches data importance |
| Streams | Stream consumers are idempotent and monitored for lag |
| IAM | Application role can access only required table and index actions |
| Observability | Throttles, latency, errors, consumed capacity, and stream age have dashboards or alarms |

The checklist makes DynamoDB less mysterious for a beginner. It also keeps the team from discovering missing access patterns after the table is full of production data.

## Putting It All Together
<!-- section-summary: DynamoDB works best when the team designs exact key-based access paths before creating the table. -->

Maple Market uses DynamoDB for carts, sessions, idempotency records, and other key-based state. The team starts from access patterns, then chooses partition keys, sort keys, and indexes. It uses conditional writes to prevent duplicate payment work. It uses TTL for records with a natural expiry. It watches capacity, throttles, hot keys, and stream lag. It turns on recovery features for important tables and keeps IAM scoped to the exact table and indexes.

DynamoDB can serve very large traffic with low operational overhead, but it asks for careful data modeling upfront. Relational design starts from relationships and flexible SQL. DynamoDB design starts from known questions and known keys. When the access paths are clear, that trade is powerful.

![DynamoDB table review checklist covering access patterns, partition key, sort key, GSI, capacity mode, and PITR plus TTL](/content-assets/articles/article-cloud-providers-aws-storage-databases-dynamodb-tables-access-patterns/dynamodb-table-review.png)

*The table review starts with the application questions, then checks key design and operating controls.*

## What's Next
<!-- section-summary: The final article covers the movement paths that get files, databases, and exports into and around AWS. -->

Now Maple Market has places for objects, filesystems, relational records, and key-value items. The last topic is movement: how data gets imported, copied, replicated, transformed, and handed off between systems.

---

**References**

- [What is Amazon DynamoDB?](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html) - Introduces DynamoDB, capacity modes, serverless behavior, and core service concepts.
- [Core components of Amazon DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html) - Defines tables, items, attributes, primary keys, and streams.
- [Partition key design best practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html) - Covers partition key design and high-cardinality distribution.
- [DynamoDB throughput capacity modes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/capacity-mode.html) - Explains on-demand and provisioned capacity modes.
- [Global secondary indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html) - Documents GSI key schemas, projections, and asynchronous index behavior.
- [DynamoDB read consistency](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html) - Explains eventually consistent and strongly consistent reads.
- [Condition expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html) - Shows conditional writes such as `attribute_not_exists`.
- [Time to Live in DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html) - Documents item expiration behavior and TTL attributes.
- [Point-in-time recovery for DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery.html) - Explains continuous backups and restore behavior.
- [DynamoDB global tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GlobalTables.html) - Covers multi-Region table replication.
