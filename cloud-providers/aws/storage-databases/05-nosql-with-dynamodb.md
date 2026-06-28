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

1. [Start With a Cart Lookup](#start-with-a-cart-lookup)
2. [Tables, Items, and Keys](#tables-items-and-keys)
3. [Design Access Patterns First](#design-access-patterns-first)
4. [Conditional Writes](#conditional-writes)
5. [Indexes, Streams, TTL, and Global Tables](#indexes-streams-ttl-and-global-tables)
6. [Capacity and Hot Keys](#capacity-and-hot-keys)
7. [Production Checklist](#production-checklist)
8. [References](#references)

## Start With a Cart Lookup
<!-- section-summary: DynamoDB fits high-volume data that applications read and write through known keys and predictable access patterns. -->

Maple Market's shopping cart has a simple hot path. A customer opens the site, the app loads the cart by customer ID, updates item quantities, and saves the result. The app knows the main question before table design starts: "give me this customer's active cart."

That is the kind of workload Amazon DynamoDB handles well. **DynamoDB** is a managed NoSQL database for fast key-based reads and writes at large scale. It is strongest when the application knows its access patterns and can design keys around them.

DynamoDB needs intentional table design. Start with reads and writes, then choose table keys and indexes that serve those paths.

This is the main difference from starting with SQL tables. With DynamoDB, you do not begin by normalizing every noun into a table. You begin with exact questions the app asks under load. If the app cannot name those questions, the table design will probably drift into scans, hot keys, and expensive indexes.

## Tables, Items, and Keys
<!-- section-summary: DynamoDB tables store flexible items, and every item is addressed through a primary key. -->

A DynamoDB table stores **items**. An item is a set of attributes, similar to a JSON-like record. Every item has a primary key. The primary key can be a partition key alone, or a partition key plus sort key.

For a cart table, one item might look like this:

```json
{
  "pk": "CUSTOMER#cust_123",
  "sk": "CART#active",
  "items": [
    { "sku": "tea-001", "quantity": 2 },
    { "sku": "mug-009", "quantity": 1 }
  ],
  "updatedAt": "2026-06-24T10:15:00Z"
}
```

The partition key decides how data is distributed and found. The sort key lets you group related items and query ranges or prefixes under the same partition key. Good keys match real application questions.

The item size limit is part of the design. A cart can store a reasonable list of items, but a growing history of every cart change may belong in separate items, S3, or an event stream. Large items cost more to read and write, and they can make a simple lookup carry data the request does not need.

The application reads this item by key, so the hot request can avoid scanning the table. A small SDK-style call uses the same `pk` and `sk` values the design wrote down:

```js
const response = await dynamo.send(new GetCommand({
  TableName: "maple-carts-prod",
  Key: {
    pk: "CUSTOMER#cust_123",
    sk: "CART#active"
  }
}));
```

That call is the reason the key design matters. The app is not asking DynamoDB to search every cart. It gives DynamoDB the exact key, and DynamoDB can route the request to the partition that owns that item.

![The key routing view shows how partition keys and sort keys decide where DynamoDB stores and finds an item](/content-assets/articles/article-cloud-providers-aws-storage-databases-dynamodb-tables-access-patterns/dynamodb-key-routing.png)

*The key routing view shows how partition keys and sort keys decide where DynamoDB stores and finds an item.*


## Design Access Patterns First
<!-- section-summary: DynamoDB table design starts by listing exact reads and writes, then choosing keys and indexes that serve those paths. -->

Start by writing the exact operations. Maple Market might need these:

- Get active cart by customer ID.
- Update one cart after the customer changes quantity.
- Create payment idempotency record by request ID.
- Read recent sessions by customer for support.
- Expire abandoned carts after 30 days.

Then design keys and indexes. The cart can use `pk = CUSTOMER#{id}` and `sk = CART#active`. Payment idempotency can use a separate table with `pk = IDEMPOTENCY#{requestId}`. Support session lookup may need a global secondary index if it uses a different key pattern.

A table creation command for the cart might look like this:

```bash
aws dynamodb create-table \
  --table-name maple-carts-prod \
  --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
  --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST
```

`pk` is the partition key, and `sk` is the sort key. `AttributeType=S` means both values are strings. `KeyType=HASH` marks the partition key, and `KeyType=RANGE` marks the sort key. The `PAY_PER_REQUEST` mode is often useful for spiky or early workloads. Provisioned capacity can make sense when traffic is predictable and the team wants tighter capacity control. After creation, check that the table reaches `ACTIVE` with `describe-table` or `aws dynamodb wait table-exists`.

The inspection command should confirm the table shape before the application starts using it:

```bash
aws dynamodb describe-table \
  --table-name maple-carts-prod \
  --query 'Table.{Status:TableStatus,Billing:BillingModeSummary.BillingMode,Keys:KeySchema,ItemCount:ItemCount}'
```

Example output:

```json
{
  "Status": "ACTIVE",
  "Billing": "PAY_PER_REQUEST",
  "Keys": [
    {
      "AttributeName": "pk",
      "KeyType": "HASH"
    },
    {
      "AttributeName": "sk",
      "KeyType": "RANGE"
    }
  ],
  "ItemCount": 0
}
```

`Status: ACTIVE` means the table is ready for traffic. `Billing` confirms the capacity mode. `Keys` should match the key design the team wrote down. `ItemCount` can lag behind real item count, so use it as a rough signal. Use dedicated reports, exports, or queries for billing and audit counts.

Map the access patterns before choosing indexes:

| Access pattern | Key choice |
| --- | --- |
| Get active cart by customer | `pk = CUSTOMER#{customerId}`, `sk = CART#active` |
| Store idempotency by request | `pk = REQUEST#{requestId}` in a separate table or item family |
| Support lists recent sessions | GSI with `customerId` or normalized email plus time-based sort key |
| Expire abandoned carts | TTL attribute such as `expiresAt` |

This table is the contract between product behavior and database design.

Some DynamoDB tables use a **single-table design**, where several item types share one table and use prefixes in `pk` and `sk`. That can reduce cross-table calls and support related queries, but it needs careful naming. A customer's active cart, past carts, sessions, and support notes might live under `pk = CUSTOMER#cust_123` with different sort key prefixes such as `CART#active`, `CART#2026-06-24`, `SESSION#2026-06-24T10:00:00Z`, and `NOTE#support_456`.

Single-table design is useful when related access patterns are known. It is a poor place for guessing. If support later needs a lookup by email and the table has no key or GSI for email, the team may end up scanning. Write access patterns in a table before writing Terraform or clicking Create table.

## Conditional Writes
<!-- section-summary: Conditional writes let DynamoDB protect workflows from duplicate requests and unsafe overwrites. -->

A **conditional write** tells DynamoDB to write only if a condition is true. This is very useful for duplicate payment requests. If the same request arrives twice, only the first request should create the idempotency record.

An idempotency item can be written with a condition that the key does not already exist:

```bash
aws dynamodb put-item \
  --table-name maple-payment-idempotency-prod \
  --item '{"pk":{"S":"REQUEST#req_123"},"status":{"S":"started"}}' \
  --condition-expression 'attribute_not_exists(pk)'
```

If a duplicate request tries the same write, DynamoDB returns a conditional check failure. The app can then read the existing item and return the already recorded result. This protects the payment workflow from double charging when clients retry.

The failure is a useful application signal:

```bash
An error occurred (ConditionalCheckFailedException) when calling the PutItem operation: The conditional request failed
```

The app should catch that exception, read `REQUEST#req_123`, and return the result already attached to that request. Treating the error as a normal duplicate path keeps retries safe.

Conditional writes also help protect counters, ownership claims, and optimistic locking patterns. They are one of the main tools for correctness in key-value workflows.

For optimistic locking, store a `version` attribute and update only when the current version matches the value the app read. If another request changed the item first, the conditional update fails and the app can retry or show a conflict. That protects carts and profile settings from last-writer-wins surprises.

A cart quantity update can use a condition so the app does not recreate a deleted cart by accident:

```bash
aws dynamodb update-item \
  --table-name maple-carts-prod \
  --key '{"pk":{"S":"CUSTOMER#cust_123"},"sk":{"S":"CART#active"}}' \
  --update-expression 'SET updatedAt = :now, items = :items' \
  --condition-expression 'attribute_exists(pk)' \
  --expression-attribute-values file://cart-update-values.json
```

The update expression sets `updatedAt` and `items` to placeholder values. Those placeholders, `:now` and `:items`, come from `cart-update-values.json`, which contains DynamoDB-typed values such as strings, numbers, lists, and maps. If the cart item no longer exists, DynamoDB returns `ConditionalCheckFailedException`, which the app should treat as a known business outcome.

If the condition fails, the application should treat that as a business result. Maybe the cart expired, another checkout already completed, or the customer session is stale. DynamoDB gives the app a clean signal instead of silently writing unsafe state.

![The idempotency flow shows how conditional writes protect a workflow from duplicate requests and repeated messages](/content-assets/articles/article-cloud-providers-aws-storage-databases-dynamodb-tables-access-patterns/conditional-idempotency-flow.png)

*The idempotency flow shows how conditional writes protect a workflow from duplicate requests and repeated messages.*


## Indexes, Streams, TTL, and Global Tables
<!-- section-summary: Secondary DynamoDB features support alternate lookups, event-driven workflows, expiry, and multi-Region table replicas. -->

A **global secondary index**, or GSI, supports an alternate key lookup. If support needs to find sessions by email, the table may need a GSI keyed by normalized email. Add indexes only for real access patterns because they add write cost and operational complexity.

**DynamoDB Streams** capture item changes in order per partition key. They can trigger Lambda functions or feed downstream processing. Maple Market might publish cart-abandoned events or update a search projection from stream records.

**TTL**, or time to live, marks items for expiry with a timestamp attribute. It is useful for abandoned carts, sessions, and temporary idempotency records. TTL deletion is asynchronous, so the app should tolerate expired items that remain briefly.

**Global tables** replicate DynamoDB data across Regions for multi-Region applications. Use them when the business needs multi-Region reads and writes, and design carefully for conflict behavior and regional failover.

Streams and TTL also have timing details. Stream records are useful for event-driven processing, but downstream consumers need retry and dead-letter handling. TTL deletion is asynchronous, so expired carts may remain visible for a while. The application should check the expiry attribute itself when correctness depends on it.

Indexes deserve their own review. A GSI copies selected table attributes into another access path. That means each write to the base table may also write to the index. If the index key is low-cardinality, such as `status = OPEN` for every active cart, the index can create a hot key. If the index projection includes large attributes the query never uses, it increases cost and write pressure.

Streams turn table changes into records that downstream workers can process. A stream consumer that updates search, sends email, or publishes events needs idempotency just like an SQS worker. Store a processed event ID or make the side effect safe to repeat. The table update succeeded before the stream consumer ran, so downstream failure handling needs its own alarm and retry path.

Global tables add a multi-Region write path. They are useful when the application needs regional reads and writes, but conflict behavior must be part of the design. If two Regions update the same cart at nearly the same time, the application needs a clear rule for which value wins or how to prevent that situation. Global tables are a resilience feature and a data design choice together.

## Capacity and Hot Keys
<!-- section-summary: DynamoDB scale depends on capacity mode, key distribution, request shape, and monitoring signals. -->

DynamoDB performance depends heavily on key distribution. A **hot key** happens when too much traffic hits one partition key. For example, `pk = CART#active` for every customer would be a bad design because all active carts share one key. `pk = CUSTOMER#{id}` spreads carts by customer.

Capacity mode matters too. On-demand capacity handles variable traffic without planning read and write units in advance. Provisioned capacity can be efficient for steady workloads, especially with auto scaling and clear traffic patterns.

Watch throttling, consumed capacity, hot partitions, item size, and latency. Also watch GSI behavior because an overloaded index can throttle table writes. A table can look healthy while one access pattern is creating pressure on one key or index.

A practical debug path starts with metrics and the key value. If throttling appears, identify the operation, table or index, partition key shape, consumed capacity, and item size. A single tenant, promotion, or popular product can create a hot partition if the key design groups too much traffic under one value.

For on-demand tables, throttling can still happen when traffic ramps sharply or when a partition key receives too much concentrated load. For provisioned tables, compare consumed read and write capacity with the provisioned settings and auto scaling history. In both modes, the key question is the same: is the workload spread across many partition key values, or is one value doing too much work?

Useful production checks include:

```bash
aws dynamodb describe-table \
  --table-name maple-carts-prod \
  --query 'Table.{Status:TableStatus,Billing:BillingModeSummary,ItemCount:ItemCount,KeySchema:KeySchema,GSIs:GlobalSecondaryIndexes[].{Name:IndexName,Status:IndexStatus,KeySchema:KeySchema}}'

aws cloudwatch describe-alarms \
  --alarm-name-prefix maple-carts-prod \
  --query 'MetricAlarms[].{Name:AlarmName,State:StateValue,Reason:StateReason}'
```

The table output gives responders the database shape:

```json
{
  "Status": "ACTIVE",
  "Billing": {
    "BillingMode": "PAY_PER_REQUEST",
    "LastUpdateToPayPerRequestDateTime": "2026-06-01T09:00:00+00:00"
  },
  "ItemCount": 125438,
  "KeySchema": [
    {
      "AttributeName": "pk",
      "KeyType": "HASH"
    },
    {
      "AttributeName": "sk",
      "KeyType": "RANGE"
    }
  ],
  "GSIs": [
    {
      "Name": "gsi-support-sessions",
      "Status": "ACTIVE",
      "KeySchema": [
        {
          "AttributeName": "supportLookup",
          "KeyType": "HASH"
        },
        {
          "AttributeName": "createdAt",
          "KeyType": "RANGE"
        }
      ]
    }
  ]
}
```

The alarm output tells the team whether AWS already sees trouble:

```json
[
  {
    "Name": "maple-carts-prod-throttled-writes",
    "State": "OK",
    "Reason": "Threshold Crossed: 1 datapoint was not greater than the threshold."
  },
  {
    "Name": "maple-carts-prod-user-errors",
    "State": "ALARM",
    "Reason": "Validation exceptions increased during the last 5 minutes."
  }
]
```

Those commands supplement application tracing by giving responders table structure, billing mode, index state, and alarm state before changing capacity or code. If the table is active and alarms are quiet, the next place to look is the request key shape, item size, and application retry behavior.

IAM boundaries should match the table and index access the application needs. A checkout service that reads and writes carts can receive access to one table and its indexes:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-1:123456789012:table/maple-carts-prod",
        "arn:aws:dynamodb:us-east-1:123456789012:table/maple-carts-prod/index/*"
      ]
    }
  ]
}
```

That role should not need account-wide DynamoDB permissions. If the same service also writes events to a stream or queue, give that permission separately so a table access problem and an event publishing problem are easier to debug.

## Production Checklist
<!-- section-summary: DynamoDB production reviews should check access patterns, key heat, indexes, recovery, expiry, security, and cost. -->

Review a DynamoDB design with concrete access patterns:

- Every read and write path has a named key or index.
- Partition keys distribute traffic across many values.
- Conditional writes protect duplicate or unsafe workflows.
- GSIs exist only for required alternate lookups.
- TTL is used for temporary data, and the app tolerates delayed deletion.
- Point-in-time recovery is enabled for production tables.
- IAM policies restrict table and index access to the application role.
- Alarms cover throttles, errors, latency, and consumed capacity.

DynamoDB works best when table design starts with the app's questions. If the team cannot name the access patterns, pause before creating the table.

Recovery should be part of that checklist. Enable point-in-time recovery on production tables, test restoring into a new table, and document how the application would switch or copy back selected items. Restoring a DynamoDB table creates a new table, so the app and IAM paths need a plan for using the restored data.

The PITR path is concrete:

```bash
aws dynamodb update-continuous-backups \
  --table-name maple-carts-prod \
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true

aws dynamodb restore-table-to-point-in-time \
  --source-table-name maple-carts-prod \
  --target-table-name maple-carts-restore-20260624 \
  --restore-date-time 2026-06-24T09:30:00Z
```

`update-continuous-backups` turns on PITR for the source table. `restore-table-to-point-in-time` creates a new table from the source table at the requested time. The target table name must be new because DynamoDB restores into a separate table.

Confirm PITR after enabling it:

```bash
aws dynamodb describe-continuous-backups \
  --table-name maple-carts-prod \
  --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription'
```

Example output:

```json
{
  "PointInTimeRecoveryStatus": "ENABLED",
  "EarliestRestorableDateTime": "2026-05-25T09:00:00+00:00",
  "LatestRestorableDateTime": "2026-06-24T10:08:12+00:00"
}
```

`EarliestRestorableDateTime` and `LatestRestorableDateTime` define the restore window the team can choose from. After the restore, validate sample carts, confirm indexes, update temporary IAM access if needed, and decide whether to copy selected items back or point a repair tool at the restored table. The restore command starts the recovery. The application repair plan finishes it.

![The table review summary connects access patterns, keys, indexes, capacity, streams, TTL, PITR, alarms, and hot-key checks](/content-assets/articles/article-cloud-providers-aws-storage-databases-dynamodb-tables-access-patterns/dynamodb-table-review.png)

*The table review summary connects access patterns, keys, indexes, capacity, streams, TTL, PITR, alarms, and hot-key checks.*


## References

- [Amazon DynamoDB documentation: What is DynamoDB?](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html)
- [Amazon DynamoDB documentation: Core components](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.CoreComponents.html)
- [Amazon DynamoDB documentation: Best practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
- [Amazon DynamoDB documentation: Point-in-time recovery](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Point-in-time-recovery.html)
- [Amazon DynamoDB documentation: Secondary index best practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-indexes-general.html)
