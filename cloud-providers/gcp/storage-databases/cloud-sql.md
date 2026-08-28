---
title: "Cloud SQL"
description: "Use Cloud SQL for relational records that need transactions, private connectivity, connection pooling, migrations, backups, high availability, and restore practice."
overview: "Cloud SQL gives Google Cloud applications a managed relational database for records with relationships and coordinated writes. The guide follows book orders through engines, instances, databases, tables, transactions, private access, pooling, migrations, backups, and HA."
tags: ["gcp", "cloud-sql", "databases", "relational", "postgres"]
order: 3
id: article-cloud-providers-gcp-storage-databases-cloud-sql-relational-databases
aliases:
  - cloud-sql-and-relational-databases
  - cloud-sql-relational-databases
  - cloud-providers/gcp/storage-databases/cloud-sql-and-relational-databases.md
---

## Table of Contents

1. [Why Do Related Records Need a Relational Database?](#why-do-related-records-need-a-relational-database)
2. [How Do Instances, Engines, Databases, Tables, and Keys Fit Together?](#how-do-instances-engines-databases-tables-and-keys-fit-together)
3. [How Do Transactions Preserve Business Meaning?](#how-do-transactions-preserve-business-meaning)
4. [How Does an Application Reach Cloud SQL Securely?](#how-does-an-application-reach-cloud-sql-securely)
5. [Why Must Applications Pool Database Connections?](#why-must-applications-pool-database-connections)
6. [How Do Schema and Database Migrations Differ?](#how-do-schema-and-database-migrations-differ)
7. [Why Do Backups, PITR, and High Availability Solve Different Problems?](#why-do-backups-pitr-and-high-availability-solve-different-problems)
8. [How Does a Complete Cloud SQL Request Fit Together?](#how-does-a-complete-cloud-sql-request-fit-together)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

An online bookshop needs to remember customers, books, orders, order items, and payments. Plain files could preserve those bytes initially, but the application soon needs answers that raw files do not naturally provide. Which orders belong to Alice? What prevents an order from naming a customer that does not exist? What happens when two buyers select the final copy? Can a crash halfway through checkout leave inventory reduced without an order? How can hundreds of application instances search and update millions of records efficiently?

The requirement has grown from storing bytes to preserving structured information and its rules. A **relational database** represents kinds of records in tables and connects them with keys.

```text
customers

id | name  | email
---+-------+------------------
1  | Alice | alice@example.com

orders

id  | customer_id | created_at
----+-------------+-----------
101 | 1           | 2026-08-23
```

The value `orders.customer_id = customers.id` records a relationship instead of copying Alice's full details into every order. A foreign-key constraint can make the database reject an order that points to no customer. This is **referential integrity**: the database participates in keeping relationships valid.

Keep these questions in view as you work through the lesson:

1. **Why Do Related Records Need a Relational Database?**
2. **How Do Instances, Engines, Databases, Tables, and Keys Fit Together?**
3. **How Do Transactions Preserve Business Meaning?**
4. **How Does an Application Reach Cloud SQL Securely?**
5. **Why Must Applications Pool Database Connections?**
6. **How Do Schema and Database Migrations Differ?**
7. **Why Do Backups, PITR, and High Availability Solve Different Problems?**
8. **How Does a Complete Cloud SQL Request Fit Together?**

## Why Do Related Records Need a Relational Database?
<!-- section-summary: Relational databases store structured facts and enforce useful rules among records that change concurrently. -->

Relational records do not literally require Cloud SQL; files, document stores, graphs, and application code can all represent connections. The advantage is that relational databases are designed specifically for records whose relationships and consistency rules matter. They can state that every order belongs to an existing customer, every line belongs to an existing order, every product reference exists, and each quantity remains positive.

Storing one giant duplicated record for every order creates another problem. Alice's email could appear in thousands of orders, so changing it would require finding and updating every copy. Relational modeling stores an important fact in an appropriate table, then uses a SQL **JOIN** to follow keys and assemble related information when needed.

Cloud SQL is Google Cloud's managed environment for PostgreSQL, MySQL, and SQL Server. The database model remains that of the selected engine. Cloud SQL manages much of the compute, storage, patching, replication, backup, and failover infrastructure around it. The application team still owns its relational model and business correctness.

## How Do Instances, Engines, Databases, Tables, and Keys Fit Together?
<!-- section-summary: Cloud SQL hosts a chosen relational engine inside a managed instance, with logical databases, tables, rows, columns, and keys inside it. -->

Treat each term as a smaller boundary to clarify the hierarchy:

```text
Cloud SQL instance
├── PostgreSQL engine
├── database: shop
│   ├── customers
│   ├── products
│   ├── orders
│   └── order_items
└── database: internal_tools
```

A **Cloud SQL instance** is approximately the managed database server. The team chooses engine and version, CPU, memory, storage, region, availability, and networking. It is an infrastructure boundary—the production server applications connect to.

The **engine** is PostgreSQL, MySQL, or SQL Server. It determines SQL dialect, data types, indexing behavior, transaction semantics, extensions and features, query planning, and configuration. Cloud SQL does not replace PostgreSQL with a Google-specific relational model; Cloud SQL for PostgreSQL remains PostgreSQL within a managed service.

A **database** logically groups application data inside the server. Exact terminology differs among engines, but an instance can contain logical databases such as `ecommerce` and `internal_tools`.

**Tables** contain rows and columns. Columns describe attributes such as product ID, name, and price; rows are individual products. A **primary key** uniquely identifies one row. A **foreign key** stores a primary-key value from another table and can enforce that the referenced row exists.

```text
customers.id = 1
        ▲
        │ foreign key
orders.customer_id = 1
```

These simple mechanisms support enormous business systems. SQL retrieves, filters, and combines records through their keys. Constraints keep invalid states out. Indexes help the engine find records efficiently. None of those design decisions appears automatically merely because the service is managed.

Google largely manages machines, storage plumbing, patching, service monitoring, replication infrastructure, backup machinery, and failover machinery. The application team still decides which tables exist, what relationships mean, which indexes serve important queries, what deletion should do, and where transaction boundaries belong.

## How Do Transactions Preserve Business Meaning?
<!-- section-summary: Transactions make related reads and writes behave as one unit and control interference among concurrent operations. -->

Concurrent change is often harder than the table design itself. Suppose one book remains and Alice and Bob both read inventory `1`. If each independently subtracts one, both may believe they bought the last copy. This is a lost-update problem.

A **transaction** groups a business operation. Placing an order may create the order, create its items, reduce inventory, and record payment state. Saving only the first two changes before a crash creates contradictory data. A transaction instead provides a boundary:

```sql
BEGIN;

-- create order
-- create line items
-- update inventory
-- record payment

COMMIT;
```

The operation either commits as one logical unit or rolls back. The familiar **ACID** properties describe the intended guarantees:

- **Atomicity** means all changes happen together or none happens. A money transfer should never preserve only the debit.
- **Consistency** means the database moves between valid states, including constraints such as positive quantity and valid customer references.
- **Isolation** controls what concurrent transactions observe and how they interfere. Engines and isolation levels trade performance and concurrency against stronger visibility rules.
- **Durability** means a successfully committed change survives according to the engine's guarantees, commonly using transaction logs for crash recovery.

Transactions do not eliminate application design. The team still decides whether buying a book is one transaction, how failures are reported, how retries behave, and which invariants belong in constraints or code. Cloud SQL provides the managed environment in which PostgreSQL, MySQL, or SQL Server implements these database mechanisms.

### Follow the last-copy race carefully

Suppose inventory begins at one. Alice and Bob both submit a purchase request. The database's transaction and isolation behavior determine whether both can observe the same available copy and how a conflicting update is handled. Correct application logic may lock or conditionally update the inventory row, check whether the update succeeded, and create order records only for the winning transaction.

The important point is that `BEGIN` and `COMMIT` do not replace correct statements or isolation choices. A transaction makes a selected group atomic and applies the engine's concurrency rules; the application must still express the invariant that stock never falls below zero and act correctly when contention causes a retry or failure.

Durability also begins only after the engine reports a successful commit according to its configuration. A response returned before commit can tell a customer that an order exists when the database later rolls it back. A response returned after commit can treat the transaction log and managed storage as the durable boundary.

Managed also does not answer whether addresses belong in a separate table, whether deleting a customer should delete orders, which indexes a slow query needs, or whether an operation should lock a record. It reduces infrastructure operations; it does not remove the need to understand relational databases.

## How Does an Application Reach Cloud SQL Securely?
<!-- section-summary: Secure database access separates network reachability, caller authentication, database authorization, and encryption in transit. -->

An application talks to Cloud SQL over a network connection. It opens a TCP session, authenticates to the database engine, sends SQL, and receives results. This path raises three independent security questions:

1. Can network packets reach the database?
2. Who is trying to connect?
3. Can another party read the traffic in transit?

The first is network connectivity. The second is authentication. The third is transport encryption. Database privileges add a fourth: once authenticated, which schemas, tables, and operations may that identity use?

For applications running in Google Cloud, private connectivity can avoid exposing the database through a public IP path. Private Services Access can connect a VPC to the Google-managed service network that hosts Cloud SQL; Private Service Connect provides another supported configuration. The architectural benefit is that application traffic can reach a private database address through intended network paths.

A private address does not remove authentication. “Reachable from this VPC” and “authorized database user” are different statements. A secure design still answers:

```text
network path    → may packets arrive?
authentication → which identity connected?
DB privileges  → what can it do?
encryption     → is transit protected?
```

Cloud SQL Auth Proxy and Cloud SQL connectors can use IAM credentials and establish encrypted connections. A proxy can use a private IP when its environment already has the required private network path. These tools help with connection authentication and encryption; they do not replace correct database-user privileges or VPC design.

## Why Must Applications Pool Database Connections?
<!-- section-summary: A pool reuses expensive database sessions and limits the total concurrency that horizontally scaled application instances can create. -->

Creating a database connection costs TCP setup, TLS negotiation, authentication, database session allocation, memory, and server resources. An API handling one thousand requests per second should not necessarily create and destroy one thousand fresh sessions every second.

A **connection pool** maintains a cache of reusable database connections:

```text
pool
├── connection A
├── connection B
├── connection C
└── connection D

request → borrow C → run SQL → return C
```

Reuse lowers connection setup work. Equally important, the pool limits simultaneous database sessions. Cloud SQL connections consume finite application and database capacity.

Horizontal scaling makes pool size an architectural calculation. A Cloud Run service with a pool of twenty may seem modest. If the platform scales to fifty instances, the possible total becomes one thousand connections:

```text
maximum possible connections
≈ application instances × pool size per instance
```

A serverless platform can scale application compute quickly enough to create a **connection storm**. A traditional relational server cannot accept unlimited concurrent sessions. Pool size is therefore a capacity-control mechanism, not a value where larger automatically means faster. Teams must calculate instance count, per-instance pool size, database limits, request concurrency, and expected query time together.

For example, one hundred containers with a pool of ten can attempt one thousand database sessions. If the database safely supports only a smaller number after reserving capacity for administration and background work, the application must constrain instances, request concurrency, or pool size. Waiting briefly for a pooled connection can be safer than overwhelming the database with new sessions.

Pool behavior should also be observable. The team needs to distinguish requests waiting for a connection, connections failing to authenticate, sessions timing out over the network, and SQL running slowly after a connection succeeds. Those failure domains lead to different repairs even though a user may see the same delayed request.

Connections also need correct lifecycle handling: borrow only when needed, return them after use, enforce timeouts, and avoid keeping transactions open across unrelated application work. Cloud SQL reduces database-hosting work, but the application remains responsible for efficient connection behavior.

## How Do Schema and Database Migrations Differ?
<!-- section-summary: Schema migrations evolve an application's data model, while database migrations move an existing system to a new managed destination. -->

The word **migration** describes two distinct jobs. A **schema migration** changes the logical design used by the application. Version one of `customers` may contain only ID and name; version two adds email. Teams record ordered changes such as:

```text
001_create_customers
002_create_orders
003_add_customer_email
004_add_order_status
```

The hard part is coordinating old and new application code with old and new schema during deployment. A change may need a compatible phase, backfill, application rollout, and later cleanup. Cloud SQL hosts the engine but cannot infer the deployment strategy or business meaning of a schema change.

A **database migration** moves the whole database platform or dataset, such as self-hosted PostgreSQL to Cloud SQL for PostgreSQL. A simplistic approach stops the application, exports two terabytes, imports it, and restarts. If transfer and import take hours, the application remains unavailable for hours.

Continuous migration reduces downtime by copying the large base while the source stays active, then replicating ongoing changes:

```text
source database
    ├── initial snapshot → Cloud SQL
    └── continuing changes → Cloud SQL
```

When the destination is nearly caught up, the team pauses writes briefly, applies the final change tail, switches the application, and promotes the destination. Database Migration Service can manage an initial snapshot and ongoing replication into Cloud SQL. The first-principles idea is to copy the bulk while the old system serves traffic, then copy only the changing tail before cutover.

The two migrations can interact. Moving engines or versions may require schema or query changes, and a schema rollout may be part of a platform cutover. Keeping the terms separate prevents a deployment plan from hiding two different kinds of risk under one label.

### Treat cutover as a state transition

Continuous replication lowers downtime only when the destination is proven compatible. Before cutover, the team validates schemas, row counts, important queries, users, extensions, and application behavior. It also watches replication lag so “nearly caught up” has measurable meaning.

At cutover, new writes to the source stop, the remaining change tail reaches Cloud SQL, and the application changes its database destination. The destination is then promoted for normal use. A rollback decision must account for writes that occur after promotion; simply pointing back at an old source can discard them. This is why migration runbooks define a point of no return rather than treating the connection-string change as the whole job.

## Why Do Backups, PITR, and High Availability Solve Different Problems?
<!-- section-summary: HA keeps the current database serving through infrastructure failure, while backups and PITR reconstruct earlier state after logical damage. -->

At 14:03, an operator may accidentally execute `DELETE FROM customers`. A high-availability replica can immediately reproduce the deletion. Both copies remain available and equally wrong. Historical recovery is therefore separate from current availability.

A **backup** preserves an earlier database state. **Point-in-time recovery**, or PITR, combines a base backup with transaction-log history to reconstruct the database close to a chosen time. If the database is good at 13:59 and damaged at 14:03, the target might be 14:02 rather than yesterday's backup.

Cloud SQL PITR restores to a new instance rather than overwriting the current one. That is operationally useful because the team can validate the recovered database before deciding whether to repair production or cut over.

**High availability** addresses a different incident: the serving database or zone fails while the data remains logically correct. A regional HA configuration maintains a standby in another zone and can fail over automatically for eligible failures:

```text
Zone A primary ──replication──► Zone B standby
      ✗ failure                    ↓
                              takes over
```

The distinction is direct:

| Failure | Main mechanism |
|---|---|
| Database host fails | High availability |
| Zone fails | High availability |
| Accidental deletion | Backup or PITR |
| Bad schema or application migration | Backup or PITR |
| Need an older state | Backup or PITR |
| Need current service to continue | High availability |

![Cloud SQL recovery flow](/content-assets/articles/article-cloud-providers-gcp-storage-databases-cloud-sql-relational-databases/cloud-sql-recovery-flow.png)
*PITR rebuilds a new instance from backup state and transaction history, leaving room to validate before production repair or cutover.*

A backup job reporting success does not by itself prove application recovery. Restore practice should validate chosen timestamps, database contents, users and privileges, network paths, application connectivity, and cutover procedures.

## How Does a Complete Cloud SQL Request Fit Together?
<!-- section-summary: A request crosses a pool and a secure network path, uses one transaction for related writes, and relies on independent HA and recovery controls underneath. -->

Consider a Cloud Run application using Cloud SQL for PostgreSQL. Alice clicks “Buy now.” The service receives `POST /orders`, borrows a connection from its pool, and starts a transaction.

It reads and updates the product's remaining inventory under the engine's concurrency rules. It creates an order whose `customer_id` references Alice, creates line items whose product and order keys remain valid, and records payment state. If all changes succeed, `COMMIT` makes them one durable logical operation. If a required step fails, rollback avoids a half-created purchase.

The service returns the connection to the pool so another request can reuse it. Private connectivity controls the network path; authentication, encryption, and database privileges control the session. Underneath, HA replication can protect availability, while backups and PITR preserve recovery history. These layers cooperate without being interchangeable.

Cloud SQL remains bounded. It is not primarily an object store for videos, photographs, archives, or ten-gigabyte scientific files. It excels at structured operational records such as users, accounts, orders, payments, subscriptions, inventory, projects, employees, and permissions.

It is also not an infinitely distributed database. A traditional relational instance has finite CPU, memory, storage bandwidth, and connection capacity. Teams can increase resources, use read replicas and caching, and improve schema and queries, but the product is not conceptually unlimited horizontal SQL. Different database systems trade relational semantics, global distribution, scale, latency, operational complexity, and cost differently.

### Keep the engine visible through the managed layer

Engine choice still affects syntax, data types, extensions, transaction isolation, indexing, query planning, and upgrade behavior. An application written for PostgreSQL does not become engine-neutral merely because both PostgreSQL and MySQL are available through Cloud SQL. Schema and query decisions remain tied to the selected database.

Likewise, managed backup and HA controls do not excuse an application from testing its own invariants. Google can operate replication machinery, but it cannot decide whether an order and payment agree. Google can expose a recovery instance, but the team must determine whether its data predates the mistake and whether users and applications can safely reconnect.

The division of responsibility is the final operating model:

| Google largely manages | Application team largely manages |
|---|---|
| Database infrastructure and machines | Schema and tables |
| Storage plumbing and patching | Keys and relationships |
| Backup and replication machinery | Queries and indexes |
| Failover machinery and service monitoring | Transaction boundaries |
| Managed service availability | Pool sizing and application behavior |

The first-principles chain runs from persistent facts, to related records, to tables and keys, to constraints and transactions, to a relational engine, and finally to the compute, memory, storage, and networking that must host it. Cloud SQL manages much of that platform. The team still owns the data model and the correctness of the business built on it.

### Audit the boundaries before production

Start with the engine. Confirm that the application is designed for the selected PostgreSQL, MySQL, or SQL Server version, including SQL dialect, extensions, and transaction behavior. Then inspect tables, primary keys, foreign keys, constraints, and indexes against the book-order relationships they must preserve.

Follow the connection path from the application environment to the private database address. Prove network reachability, caller authentication, encrypted transport, and database privileges separately. Confirm that pool size multiplied by the maximum application instance count remains within the intended connection budget.

Exercise checkout contention by making two requests compete for the final item. The result should preserve inventory and create only valid related records. Exercise failure by forcing one statement to fail before commit and verifying that the other order changes do not remain.

Review both meanings of migration. Schema changes need application compatibility and ordered rollout. Platform migration needs source replication, lag checks, destination validation, a write freeze, final synchronization, cutover, and a decision about rollback after the destination accepts new writes.

Finally, test availability and recovery as different paths. An HA failover should keep correct current state serving after infrastructure failure. A PITR exercise should create a new instance before a harmful transaction, validate orders and relationships, and prove the application can reconnect. Those two tests establish different promises and neither substitutes for the other.

Capacity review completes the picture. CPU, memory, storage bandwidth, and connections are finite for the managed instance. Slow queries may need better indexes or SQL rather than a larger pool, and read replicas or caching address selected read patterns rather than removing the primary's transactional role. Cloud SQL manages established relational engines; it does not convert them into an unlimited globally distributed database.

The final acceptance criterion is business meaning: committed orders remain internally consistent through concurrency, infrastructure failures do not require an improvised failover, and logical damage has a tested historical restore path.

One last responsibility check follows every order from key to recovery. The primary and foreign keys must preserve valid customer, order, item, and product links. The transaction must make inventory and payment state change together. The pool must bound sessions as application instances scale. Private networking must still be paired with authentication and encryption. Schema migrations must remain compatible during rollout, while a platform migration must catch up before cutover. HA must handle serving failure, and backups plus PITR must handle a correct service containing wrong data. Cloud SQL brings those mechanisms into one managed environment without merging their separate jobs.

## Check Your Answers

:::expand[Why Do Related Records Need a Relational Database?]{kind="recap"}
A relational database represents structured facts in tables, connects them with keys, and can enforce constraints when relationships and concurrent changes matter.
:::

:::expand[How Do Instances, Engines, Databases, Tables, and Keys Fit Together?]{kind="recap"}
The Cloud SQL instance hosts PostgreSQL, MySQL, or SQL Server; logical databases contain tables, rows and columns; primary and foreign keys identify and connect records.
:::

:::expand[How Do Transactions Preserve Business Meaning?]{kind="recap"}
Transactions group related reads and writes so they commit or roll back together and follow controlled rules when operations run concurrently.
:::

:::expand[How Does an Application Reach Cloud SQL Securely?]{kind="recap"}
Treat network reachability, authentication, database authorization, and encryption as separate layers. Private connectivity removes the need for a public IP path but does not remove identity checks.
:::

:::expand[Why Must Applications Pool Database Connections?]{kind="recap"}
Pools reuse expensive sessions and cap database concurrency. Total possible connections are approximately instance count multiplied by pool size per instance.
:::

:::expand[How Do Schema and Database Migrations Differ?]{kind="recap"}
Schema migrations evolve tables and application compatibility. Database migrations move the system, often copying a base while replaying ongoing changes before cutover.
:::

:::expand[Why Do Backups, PITR, and High Availability Solve Different Problems?]{kind="recap"}
HA keeps correct current state available through infrastructure failure. Backups and PITR return to earlier state after deletion, corruption, or a bad migration.
:::

:::expand[How Does a Complete Cloud SQL Request Fit Together?]{kind="recap"}
A request borrows a pooled connection, follows a secure path, commits related writes in one transaction, returns the connection, and relies on separate HA and recovery controls.
:::

## References

- [Cloud SQL overview](https://docs.cloud.google.com/sql/docs/introduction)
- [Cloud SQL private IP](https://docs.cloud.google.com/sql/docs/sqlserver/private-ip)
- [Managing database connections](https://docs.cloud.google.com/sql/docs/sqlserver/manage-connections)
- [Cloud SQL connectivity guidance](https://docs.cloud.google.com/sql/docs/debugging-connectivity)
- [Database Migration Service](https://docs.cloud.google.com/database-migration/docs)
- [Cloud SQL backups](https://docs.cloud.google.com/sql/docs/mysql/backup-recovery/backups)
- [Cloud SQL PITR](https://docs.cloud.google.com/sql/docs/sqlserver/backup-recovery/pitr)
- [Cloud SQL availability](https://docs.cloud.google.com/sql/docs/availability)
