---
title: "NoSQL with DynamoDB"
description: "Design DynamoDB from access patterns through primary keys, sort keys, item collections, secondary indexes, hot-key control, conditional writes, transactions, streams, TTL, capacity, and Global Tables."
overview: "DynamoDB turns application questions into distributed key lookups. This article explains how deliberate key and index design moves work from query time to design time for predictable performance at large scale."
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

1. [What Problem Does DynamoDB Solve?](#what-problem-does-dynamodb-solve)
2. [Why Does DynamoDB Design Start with Access Patterns?](#why-does-dynamodb-design-start-with-access-patterns)
3. [Why Does DynamoDB Use Denormalization and Single-Table Design?](#why-does-dynamodb-use-denormalization-and-single-table-design)
4. [How Do Secondary Indexes Add Access Paths?](#how-do-secondary-indexes-add-access-paths)
5. [How Do Conditional Writes and Transactions Protect State?](#how-do-conditional-writes-and-transactions-protect-state)
6. [How Do Streams and TTL Support Workflows?](#how-do-streams-and-ttl-support-workflows)
7. [How Do Capacity, Indexes, and Key Shape Affect Cost?](#how-do-capacity-indexes-and-key-shape-affect-cost)
8. [How Should You Design and Review a DynamoDB Table?](#how-should-you-design-and-review-a-dynamodb-table)
9. [Check Your Understanding](#check-your-understanding)
10. [References](#references)

The sections below answer these questions in order:

1. **What Problem Does DynamoDB Solve?**
2. **Why Does DynamoDB Design Start with Access Patterns?**
3. **Why Does DynamoDB Use Denormalization and Single-Table Design?**
4. **How Do Secondary Indexes Add Access Paths?**
5. **How Do Conditional Writes and Transactions Protect State?**
6. **How Do Streams and TTL Support Workflows?**
7. **How Do Capacity, Indexes, and Key Shape Affect Cost?**
8. **How Should You Design and Review a DynamoDB Table?**

## What Problem Does DynamoDB Solve?
<!-- section-summary: DynamoDB distributes key-addressed data and request load across physical partitions for predictable large-scale retrieval. -->

On one machine, a program can keep users in a map:

```text
users[123] → Alice
users[456] → Bob
```

Looking up `get(123)` is straightforward. One machine eventually reaches limits in CPU, memory, disk, disk throughput, and network bandwidth. A larger dataset or request rate needs multiple machines.

Now the system must decide where key 123 lives:

```text
request for key 123
        ↓
which storage partition owns it?
   ├── server A
   ├── server B
   └── server C
```

One distributed approach hashes a key to a partition. Different values can map to different physical partitions, spreading both data and work horizontally instead of requiring one ever-larger database server.

```text
hash("USER#123") → partition 7
hash("USER#456") → partition 2
hash("USER#789") → partition 19
```

This idea sits underneath **Amazon DynamoDB**, a managed key-value and document database designed for predictable low-latency access at large scale.

The label **NoSQL** does not simply mean “cannot use SQL.” The more useful distinction is where design begins.

A relational approach often models facts and relationships first and lets the database answer many later queries through joins and indexes. DynamoDB starts with the important application queries and organizes keys so those exact paths are cheap and predictable.

```text
relational: entities and relationships → flexible queries
DynamoDB:  access patterns → deliberate key and index layout
```

With DynamoDB, some complexity moves from query time to design time. That trade enables a request to jump to a narrow key range rather than ask a distributed engine to discover arbitrary relationships on demand.

### How Do Tables, Items, and Primary Keys Work?
<!-- section-summary: A DynamoDB table stores flexible items identified by either one partition key or a composite partition-and-sort key. -->

At the application layer:

```text
Table
└── Items
    └── Attributes
```

An item resembles a JSON-like record:

```json
{
  "userId": "123",
  "name": "Alice",
  "email": "alice@example.com",
  "plan": "premium"
}
```

Different items do not need identical non-key attributes. One can have `name`, while another has `company`, `employees`, and a nested `settings` document. Flexibility does not remove the need for an application schema; it changes where that schema is enforced.

Every item needs a unique **primary key**. A simple primary key has one **partition key**, such as `userId=123`. The value both identifies the item and contributes to DynamoDB’s physical distribution decision.

A composite primary key contains a partition key and a **sort key**:

```text
PK          SK
USER#123    PROFILE
USER#123    ORDER#001
USER#123    ORDER#002
```

The pair `(PK, SK)` must be unique. Items sharing a partition key form an ordered collection by sort key.

```text
partition key → ordered collection of related items
```

That makes DynamoDB more expressive than a single flat `key → value` map. It combines direct partition lookup with ordered range retrieval inside that logical group.

![The key routing view shows how partition keys and sort keys decide where DynamoDB stores and finds an item](/content-assets/articles/article-cloud-providers-aws-storage-databases-dynamodb-tables-access-patterns/dynamodb-key-routing.png)

*The partition key routes the request; the optional sort key identifies and orders items within that key’s collection.*

## Why Does DynamoDB Design Start with Access Patterns?
<!-- section-summary: DynamoDB tables are built around exact high-value reads and writes so normal requests use direct key operations rather than scans. -->

Before creating a social-network table, list operations:

```text
get a user by ID
list a user’s posts newest-first
get a post by ID
list comments for a post
find a user by username
list followers of a user
```

These are **access patterns**. They are the contract the key design must serve.

A relational schema might normalize users, orders, order items, and products, then join them when needed. DynamoDB has no arbitrary server-side joins. It arranges item keys according to retrieval:

```text
PK          SK
USER#42     PROFILE
USER#42     POST#2026-08-23T09:00#721
USER#42     POST#2026-08-22T17:30#700

POST#721    METADATA
POST#721    COMMENT#001
POST#721    COMMENT#002
```

A **Query** supplies a partition-key value and can apply supported sort-key conditions. DynamoDB can route to the relevant key space.

A **Scan** reads broadly through table or index data and filters as it goes. It can be useful for some operational or analytical tasks, but routine latency-sensitive application requests that require full scans often indicate a model fighting DynamoDB.

The design instinct should be:

> Do not ask “How can I search the entire table for this?” Ask “Which key or index lets me jump directly to the needed data?”

For “the most recent 20 orders for user 42,” a partition key `USER#42` with time-ordered order sort keys reads a narrow range. Scanning 100 million orders, filtering user 42, sorting, and taking 20 returns the same answer through dramatically more work.

Filters are not substitutes for keys. A Query that retrieves 10,000 user items and then filters `status=OPEN` may still consume work for the candidates. A sort-key pattern such as `OPEN#{time}#{orderId}` or a suitable index can reduce what is retrieved in the first place.

```text
key condition → narrows storage work
filter         → mainly narrows returned candidates afterward
```

### How Do Sort Keys, Item Collections, and Prefixes Model Data?
<!-- section-summary: Sort-key order and typed prefixes let one partition key represent ranges, item types, aggregates, and application hierarchy. -->

Suppose a customer has thousands of orders:

```text
PK       SK
USER#42  ORDER#2026-01-03#100
USER#42  ORDER#2026-02-17#127
USER#42  ORDER#2026-08-23#9001
```

The application can Query `PK=USER#42` with `begins_with(SK, "ORDER#")` or retrieve a date range. This is dictionary lookup plus ordered range lookup, not a table scan.

Everything sharing a partition key is an **item collection**. An order aggregate can be grouped as:

```text
PK          SK
ORDER#123   METADATA
ORDER#123   ITEM#001
ORDER#123   ITEM#002
ORDER#123   PAYMENT#001
ORDER#123   SHIPMENT#001
```

A single Query retrieves the metadata and related records required by that access pattern.

Typed prefixes such as `USER#`, `ORDER#`, `POST#`, and `COMMENT#` communicate item type and hierarchy and enable prefix conditions. The values are not merely IDs; they form part of the application’s query language.

```text
USER#42 + SK begins ORDER#   → orders for user 42
ORDER#123 + SK begins ITEM#  → line items for order 123
```

Time, status, tenant, and identifiers can be composed into sort-key order when that order directly serves a real access pattern. The exact encoding is an application schema and should be documented and validated.

## Why Does DynamoDB Use Denormalization and Single-Table Design?
<!-- section-summary: DynamoDB can duplicate data and colocate several item types so important reads avoid distributed joins and extra round trips. -->

Relational normalization commonly stores a user name once and joins it into orders. DynamoDB has no general-purpose join operator. An order item can duplicate `customerName` and `shippingCountry` so a request obtains the needed view from one direct path.

Duplication trades more storage and update coordination for fewer reads, lower latency, and less distributed retrieval. The right question is not simply whether data is duplicated. Ask whether the duplicate serves a valuable access pattern and whether the application can keep copies sufficiently consistent.

**Single-table design** can place several entity and relationship types in one DynamoDB table:

```text
PK           SK
USER#42      PROFILE
USER#42      ORDER#1001
USER#42      ORDER#1002

ORDER#1001   METADATA
ORDER#1001   ITEM#PRODUCT#17
ORDER#1001   ITEM#PRODUCT#88

PRODUCT#17   METADATA
```

The table is not “one entity type.” It is the application’s indexed access structure. This can serve related operations with fewer calls and transaction boundaries, but it requires careful conventions and knowledge of access patterns.

DynamoDB is therefore not schema-less. The schema lives in partition- and sort-key formats, prefixes, item types, attribute names, index definitions, validation, and application code.

```text
PK = USER#{userId}
SK = ORDER#{createdAt}#{orderId}
```

is a real schema even though DynamoDB does not require every item to have the same attributes.

Single-table design is a technique, not a goal. Use it when item colocation and shared access patterns create clear value, not because every DynamoDB application must fit one table.

### How Do Partition Keys Control Scale?
<!-- section-summary: High-cardinality partition keys spread work, while low-cardinality or extremely popular keys concentrate traffic and create hot spots. -->

Horizontal scaling works when requests can be distributed. If millions of requests all use `PK=CELEBRITY#Taylor`, the data model sends disproportionate traffic to one logical key. This is a **hot key**.

```text
10 requests ─────┐
1,000 requests ──┤
1,000,000 ───────┼──> one partition-key value
```

No distributed database can fully spread work that the application deliberately funnels through one point.

Keys with many possible values have high cardinality and usually offer better distribution. One million device IDs distribute more naturally than `PK=DEVICE_DATA` for every device. A `country` or `status` key has relatively few values and can concentrate traffic.

For telemetry:

```text
bad:    PK = DEVICE_DATA
better: PK = DEVICE#123, DEVICE#124, ...
```

If one device remains too active, **write sharding** can split it:

```text
DEVICE#123#SHARD#0
DEVICE#123#SHARD#1
DEVICE#123#SHARD#2
DEVICE#123#SHARD#3
```

Writes distribute across shards; reads of all device history now query several shards and merge results. The same trade appears when every event today would use `PK=2026-08-23`. Adding numbered shards improves write distribution and makes whole-day reads more expensive.

```text
write distribution ↔ read aggregation
```

Load tests should include realistic skew. Uniform random keys can make a bad design look healthy even though one popular user, merchant, date, or product dominates production.

## How Do Secondary Indexes Add Access Paths?
<!-- section-summary: Secondary indexes rearrange item keys for additional known lookups, and each index adds write, storage, and hot-key consequences. -->

Suppose the primary structure stores an order under its user:

```text
PK = USER#42
SK = ORDER#123
```

This serves “list user 42’s orders.” It does not directly serve “find order 123.” A **Global Secondary Index (GSI)** can provide another key arrangement:

```text
main index: USER#42  → ORDER#123
GSI1:       ORDER#123 → USER#42
```

The item participates in several prebuilt retrieval paths. Another access pattern—open orders for merchant 73 sorted by creation time—can lead to:

```text
GSI PK = MERCHANT#73#STATUS#OPEN
GSI SK = 2026-08-23T12:30:00#ORDER#123
```

The index encodes product behavior. It is not equivalent to permitting any future `WHERE arbitrary_attribute = value` query.

A **Local Secondary Index (LSI)** retains the table’s partition key and uses an alternate sort key. A GSI can define both a different partition key and different sort key, making GSIs more flexible for genuinely different access paths.

A **sparse index** contains only items that define its index key. If open orders include `GSI1PK` and completed orders omit it, the GSI becomes an efficient view of open orders. Sparse indexes can represent active jobs, escalations, outstanding tasks, or current subscriptions.

Indexes are not free. Every relevant base-table write can also maintain one or more GSI entries, and projections store additional data. A low-cardinality index key can create a hot path even when the base table distributes well. Create an index for a named real access pattern and test its write and storage cost.

## How Do Conditional Writes and Transactions Protect State?
<!-- section-summary: Atomic conditions implement compare-and-swap, uniqueness, optimistic concurrency, counters, and idempotency; transactions protect true multi-item invariants. -->

Two buyers can read the last ticket as available and both attempt to reserve it. A **conditional write** lets DynamoDB apply the check and update atomically:

```text
set remainingTickets = 0
only if remainingTickets = 1
```

One writer succeeds; the other receives a conditional failure. The database becomes the coordination point.

This is a **compare-and-swap** pattern:

```text
if current value equals expected value:
    replace with new value
else:
    fail without overwriting
```

Optimistic concurrency can store `version=17` and update only if the version remains 17, writing version 18. A competing update that already produced version 18 makes the stale writer fail rather than erase newer work.

Conditional creation can enforce uniqueness within a key design. Creating `USERNAME#alice` only when it does not exist lets one request claim the username.

The same mechanism supports **idempotency**. A payment request carries stable ID `payment-abc-123`. The first attempt conditionally creates a marker, performs the business workflow, and records the outcome. A retry finds the existing marker and returns the known result instead of charging again.

```text
request sent → database succeeds → response lost → client retries
```

is normal network ambiguity. Conditional writes, request IDs, retry with backoff, and deduplication are consequences of distributed communication, not DynamoDB quirks.

When one invariant truly spans several items—such as subtracting £10 from Alice and adding £10 to Bob—DynamoDB transactions can coordinate all-or-nothing operations. Use them for genuine multi-item business invariants, not merely to recreate a normalized relational design while ignoring DynamoDB’s access model.

![The idempotency flow shows how conditional writes protect a workflow from duplicate requests and repeated messages](/content-assets/articles/article-cloud-providers-aws-storage-databases-dynamodb-tables-access-patterns/conditional-idempotency-flow.png)

*A conditional write converts a race or duplicate request into one successful state transition and a clean failure for competing attempts.*

### How Should You Choose Read Consistency?
<!-- section-summary: Distributed copies create a choice between eventual and supported strong reads, and the business operation decides which guarantee is necessary. -->

Distributed databases replicate data for availability and durability. Immediately after writing version 11, not every read path must expose that version at the same instant.

DynamoDB supports eventually consistent reads by default for many read paths, while some operations and indexes support stronger read choices. The application should ask whether this particular read must observe the latest successful write immediately.

A bank balance displayed after a transfer can have a stricter requirement than a profile-view count. A support dashboard may tolerate a brief delay that a checkout confirmation cannot.

Stronger guarantees have distributed-system costs and compatibility limits. Choose per access pattern rather than setting every read to the strongest available model or accepting eventual behavior everywhere without thought.

Consistency is a business correctness requirement expressed through database operations.

Write the requirement beside each access pattern. “List popular posts” may tolerate an eventually updated count. “Show the order state immediately after checkout” may need to read the authoritative item through a supported strongly consistent path. “Query a GSI” has the consistency behavior of that index and cannot be made strong merely because the caller wants it. The application may instead return the successful write result, read the base table, or redesign the confirmation flow.

Do not confuse consistency with concurrency. A strongly consistent read can show the latest value and still be followed by a race before the client writes. Conditional writes protect the transition itself. Read consistency controls what value is observed; compare-and-swap controls whether a stale observation may overwrite newer state.

## How Do Streams and TTL Support Workflows?
<!-- section-summary: Streams expose item changes for asynchronous reactions, while TTL performs eventual physical cleanup of expired items. -->

When an order changes from `PENDING` to `PAID`, email, fulfillment, analytics, audit, and search updates may follow. Doing all of them inside the request that writes the order tightly couples success to many dependencies.

**DynamoDB Streams** expose item changes so downstream consumers can react asynchronously:

```text
DynamoDB item changes
       ↓
DynamoDB Stream
   ├──> notification consumer
   ├──> fulfillment consumer
   └──> analytics consumer
```

Store authoritative state first, then react to the state transition. Consumers still need retries, dead-letter handling, and idempotency because distributed event processing can deliver or process work again.

Some items have expiration times: sessions, verification data, temporary caches, old telemetry, and short reservations. **Time to Live (TTL)** lets an item carry an expiration timestamp and lets DynamoDB remove expired items automatically.

TTL is lifecycle cleanup, not an exact scheduler. A session can remain physically present after its `expiresAt` time until deletion occurs. If correctness requires exact expiration, the application reads the timestamp and treats the item as expired immediately; TTL eventually removes the stored item.

### How Do Global Tables Change the Design?
<!-- section-summary: Global Tables replicate across Regions for local access and availability, while simultaneous regional writes introduce unavoidable conflict and convergence questions. -->

A single-Region table can make a user in Tokyo traverse the network to Virginia for every request. **DynamoDB Global Tables** replicate table data across Regions so applications can interact with geographically closer replicas and support multi-Region operation.

```text
London ─┐
Virginia├── replicated DynamoDB table
Tokyo ──┤
Sydney ─┘
```

Multi-Region writes create a fundamental physical problem. London can write `name=Alice` while Tokyo nearly simultaneously writes `name=Alicia`, before either change reaches the other Region. Both local requests can appear valid and eventually meet during replication.

No service can make information travel instantaneously. Active-active designs must define conflict behavior, ordering expectations, idempotency, business invariants, and eventual convergence. A global table improves regional latency and resilience; it does not abolish distributed-systems tradeoffs.

Avoid multi-Region writes merely because the feature exists. The application workflow must be able to tolerate or prevent conflicting state transitions.

## How Do Capacity, Indexes, and Key Shape Affect Cost?
<!-- section-summary: Read and write volume, item sizes, indexes, replication, capacity mode, and traffic distribution jointly determine cost and throttling. -->

At a low level, a database spends resources reading, writing, storing, replicating, and maintaining indexes. DynamoDB cost therefore follows a combination of request volume, item size, index count and projection, global replication, and optional features.

One write to the base table plus three GSIs can update four data representations. Faster alternate reads require more write and storage work.

Suppose an order item is 3 KB and appears in a primary index plus indexes by order ID, merchant status, and customer date. Each new order can consume base-table write work and corresponding index work, while projected attributes occupy storage in every representation. Removing a speculative index can therefore reduce both write pressure and cost. Projecting only attributes the index query actually needs can also avoid carrying a large payload through every alternate path.

**On-demand capacity** fits workloads that want usage-based request handling without explicitly planning read and write units. **Provisioned capacity** fits teams that understand traffic and want to configure capacity, often with autoscaling. Workload predictability, economics, ramp pattern, and operational preference determine the choice; the table model stays the same.

Neither mode repairs a hot key. On-demand tables can still throttle concentrated or suddenly changing traffic, and provisioned tables can exceed configured capacity. Inspect whether pressure belongs to the table or a GSI and which partition-key values dominate.

For provisioned mode, compare actual reads and writes with the configured units and autoscaling history. For on-demand mode, compare recent traffic with prior peaks and the concentration of requests. In either case, increasing a table-wide number may not help one overwhelmingly popular key. A capacity incident should record the exact operation, table or index, item size, partition-key pattern, retry rate, and whether traffic is uniform or dominated by one tenant or product.

Throttling also changes client behavior. Clients should use bounded retries with backoff rather than immediately multiplying pressure. A retry storm can turn a short capacity mismatch into sustained overload, particularly when each request performs several indexed writes.

Item size matters. Reading or writing attributes the request does not need consumes more capacity, and giant blobs usually belong in S3 rather than blindly inside DynamoDB. An unbounded item collection can also approach key and size design limits and make Query pagination increasingly important.

Cost and data modeling are inseparable. A broad Query that reads hundreds of items and filters most of them still consumes work for the candidates. A low-cardinality GSI can concentrate write traffic. Global Tables reproduce writes across Regions. Streams retain change records for consumers. These features may be valuable, but their cost follows the physical work implied by the access design.

Avoid accidental read amplification. Direct GetItem and narrow Query paths should serve latency-sensitive traffic. Large Scans and broad Queries followed by filters make the storage engine touch irrelevant data, increasing latency and cost.

### How Do You Model Relationships and Counters?
<!-- section-summary: Deliberate duplicate edges support many-to-many traversal, while atomic and sharded counters balance correctness with write distribution. -->

Suppose users belong to teams. A relational system can use a join table. DynamoDB can write the relationship in both directions:

```text
USER#42  → TEAM#7
USER#42  → TEAM#19

TEAM#7   → USER#42
TEAM#7   → USER#88
TEAM#7   → USER#104
```

One direction answers “Which teams contain user 42?” The other answers “Which users belong to team 7?” Duplicating the edge creates two direct access paths. This is an **adjacency-list** style for known graph-like relationships; DynamoDB is not a general graph database, but it can efficiently represent specific traversals.

Counters also need atomicity. If two clients read `likes=172` and both write 173, one increment disappears. Use an atomic update equivalent to `likes = likes + 1` so the storage system coordinates each increment.

A globally popular item can turn one atomic counter into a hot key. Shard it:

```text
VIDEO#1#COUNT#00 = 7,100
VIDEO#1#COUNT#01 = 6,932
VIDEO#1#COUNT#02 = 7,344
```

Writes distribute among shards; reading the exact total requires summing them. Again, better write scale creates more read work. The correct balance follows how fresh and cheap the displayed total must be.

## How Should You Design and Review a DynamoDB Table?
<!-- section-summary: A disciplined design loop turns business operations into keys and indexes, then validates distribution, consistency, concurrency, cost, recovery, and security. -->

Use this loop:

```text
business operation
    ↓
access pattern
    ↓
required direct lookup or ordered range
    ↓
partition and sort key design
    ↓
alternate lookup needed?
    ↓
GSI or LSI design
    ↓
expected traffic distribution and hot-key analysis
    ↓
consistency requirement
    ↓
concurrency and retry requirement
    ↓
conditional write or true transaction
```

For a small commerce system, patterns might be:

```text
CUSTOMER#42  PROFILE
CUSTOMER#42  ORDER#2026-08-23#9001
CUSTOMER#42  ORDER#2026-08-10#8755

ORDER#9001   METADATA
ORDER#9001   ITEM#PRODUCT#77
ORDER#9001   ITEM#PRODUCT#88
```

GSI1 can map `ORDER#9001 → CUSTOMER#42` for direct order lookup. GSI2 can use `MERCHANT#5#OPEN` with a time-and-order sort key for open merchant orders in time order. The same logical order participates in several indexes because the table is a distributed collection of predesigned retrieval paths.

Walk through the operations to prove the model. “Get customer profile” performs a direct read at `CUSTOMER#42, PROFILE`. “List customer orders newest-first” queries `CUSTOMER#42` across the `ORDER#` sort-key range in reverse order. “Get order 9001 without knowing the customer” queries GSI1. “List line items” queries `ORDER#9001` with `begins_with(SK, "ITEM#")`. “List merchant 5’s open orders” queries GSI2 at `MERCHANT#5#OPEN` and receives time-ordered results.

Each question has a narrow route. If a new product requirement asks “find orders by arbitrary product description,” no existing key automatically supports it. The team must add a deliberate access path, use a search or analytical system, or accept a batch-style scan outside the request path. That constraint is part of DynamoDB’s predictability: the table does not promise arbitrary discovery for free.

Also test failure ambiguity. A client can send a conditional payment update, the database can commit it, and the response can be lost. Retrying the same request with a stable idempotency key should return the recorded outcome rather than repeat the charge. Backoff protects DynamoDB and dependencies during transient errors, while the request identifier lets the system distinguish a retry from a new business operation.

Recovery has its own shape. Point-in-time recovery restores into a new table rather than rewinding the live table in place. A runbook must validate restored items and indexes, grant a repair tool temporary access, and decide whether to copy selected items back or redirect a controlled application path. Enabling PITR begins the recovery design; a tested way to use the restored table completes it.

Before production, confirm:

- every latency-sensitive operation has a GetItem or Query path;
- partition keys have enough cardinality and load tests include skew;
- sort keys intentionally support ordering and ranges;
- every GSI serves a real pattern and its write, storage, projection, and hot-key cost is understood;
- item and item-collection growth is bounded or intentionally paginated;
- blobs that fit object storage are not needlessly stored as large items;
- conditional writes protect uniqueness, optimistic concurrency, and retryable side effects;
- transactions are reserved for real multi-item invariants;
- consistency is selected per business read;
- stream consumers tolerate retries and duplicate processing;
- TTL is treated as eventual cleanup;
- multi-Region conflict behavior is designed;
- alarms cover throttling, errors, latency, and unexpected capacity;
- point-in-time recovery and restore into a new table have been tested;
- IAM permissions grant only the table and index actions the application needs.

DynamoDB differs from SQL by making access paths first-class. A useful mental description is:

> **DynamoDB is a distributed persistent collection of carefully designed indexes.**

```text
business requirements
      ↓
access patterns
      ↓
keys and indexes
      ↓
physical partitions and work distribution
      ↓
predictable lookup and horizontal scale
```

The team deliberately transforms application questions into key lookups that DynamoDB can distribute efficiently across machines.

![The table review summary connects access patterns, keys, indexes, capacity, streams, TTL, PITR, alarms, and hot-key checks](/content-assets/articles/article-cloud-providers-aws-storage-databases-dynamodb-tables-access-patterns/dynamodb-table-review.png)

*The table is the physical access design for known application questions, not a container for entities chosen before queries are known.*

## Check Your Understanding

:::expand[What Problem Does DynamoDB Solve?]{kind="recap"}
DynamoDB distributes key-addressed data and request load across physical partitions for predictable large-scale retrieval.

Key-derived placement lets a large dataset and request load spread across physical partitions and machines instead of depending on one server’s CPU, memory, disk, and network capacity.

It distributes writes across several partition-key values and makes reads that need the complete logical dataset query and combine multiple shards.

A DynamoDB table stores flexible items identified by either one partition key or a composite partition-and-sort key.

A GSI can define new partition and sort keys. An LSI keeps the base partition key and changes the sort key. A sparse index includes only items that contain its index key attributes.
:::

:::expand[Why Does DynamoDB Design Start with Access Patterns?]{kind="recap"}
DynamoDB tables are built around exact high-value reads and writes so normal requests use direct key operations rather than scans.

Sort-key order and typed prefixes let one partition key represent ranges, item types, aggregates, and application hierarchy.

The partition key routes and groups related items. The sort key uniquely identifies items within that group and provides ordered prefix and range access.

Query jumps to a known partition-key value and optional sort-key range. Scan reads broadly through data, touching many irrelevant items and increasing latency and cost.

It is the ordered group of items sharing one partition-key value, such as order metadata, line items, payment, and shipment records under `ORDER#123`.
:::

:::expand[Why Does DynamoDB Use Denormalization and Single-Table Design?]{kind="recap"}
DynamoDB can duplicate data and colocate several item types so important reads avoid distributed joins and extra round trips.

It can trade extra storage and consistency work for fewer round trips, no distributed join, and predictable low-latency reads along important access paths.

Use it when a genuine business invariant requires coordinated all-or-nothing changes across several items, not simply to recreate a normalized relational design without a DynamoDB access model.

High-cardinality partition keys spread work, while low-cardinality or extremely popular keys concentrate traffic and create hot spots.

Disproportionate requests target one partition-key value, preventing the workload from spreading. Low-cardinality keys, global dates, statuses, celebrities, and counters are common risks.
:::

:::expand[How Do Secondary Indexes Add Access Paths?]{kind="recap"}
Secondary indexes rearrange item keys for additional known lookups, and each index adds write, storage, and hot-key consequences.

Relational modeling makes entities and relationships first-class and supports flexible queries. DynamoDB makes required access paths first-class and designs keys and indexes for predictable lookups.
:::

:::expand[How Do Conditional Writes and Transactions Protect State?]{kind="recap"}
Atomic conditions implement compare-and-swap, uniqueness, optimistic concurrency, counters, and idempotency; transactions protect true multi-item invariants.

It atomically checks an expected state and applies the write only if the condition holds, enabling compare-and-swap, optimistic locking, uniqueness, reservations, and idempotency.

Distributed copies create a choice between eventual and supported strong reads, and the business operation decides which guarantee is necessary.
:::

:::expand[How Do Streams and TTL Support Workflows?]{kind="recap"}
Streams expose item changes for asynchronous reactions, while TTL performs eventual physical cleanup of expired items.

TTL marks expired items for asynchronous physical deletion. The application must compare the expiration timestamp itself when correctness requires the item to become invalid at an exact time.

Global Tables replicate across Regions for local access and availability, while simultaneous regional writes introduce unavoidable conflict and convergence questions.

Concurrent writes in different Regions can be valid locally before replication carries either value to the other Region, so conflict behavior, ordering, invariants, and convergence must be designed.
:::

:::expand[How Do Capacity, Indexes, and Key Shape Affect Cost?]{kind="recap"}
Read and write volume, item sizes, indexes, replication, capacity mode, and traffic distribution jointly determine cost and throttling.

Each relevant base-table write can maintain additional index representations and projected attributes. Faster alternate reads require more write processing and storage.

Deliberate duplicate edges support many-to-many traversal, while atomic and sharded counters balance correctness with write distribution.

Write direct edges in both required directions, such as user-to-team and team-to-user items. Each duplicated direction serves one known traversal without a server-side join.
:::

:::expand[How Should You Design and Review a DynamoDB Table?]{kind="recap"}
A disciplined design loop turns business operations into keys and indexes, then validates distribution, consistency, concurrency, cost, recovery, and security.
:::

## References

- [What is Amazon DynamoDB?](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html)
- [DynamoDB core components](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html)
- [DynamoDB primary keys](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html#HowItWorks.CoreComponents.PrimaryKey)
- [DynamoDB Query](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html)
- [DynamoDB Scan](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Scan.html)
- [DynamoDB sort-key best practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-sort-keys.html)
- [DynamoDB secondary indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/SecondaryIndexes.html)
- [DynamoDB conditional operations](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)
- [DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transactions.html)
- [DynamoDB read consistency](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html)
- [DynamoDB Streams](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html)
- [DynamoDB TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)
- [DynamoDB Global Tables](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GlobalTables.html)
- [DynamoDB on-demand capacity](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/on-demand-capacity-mode.html)
- [DynamoDB provisioned capacity](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/provisioned-capacity-mode.html)
- [DynamoDB partition-key best practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html)
- [DynamoDB point-in-time recovery](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Point-in-time-recovery.html)
