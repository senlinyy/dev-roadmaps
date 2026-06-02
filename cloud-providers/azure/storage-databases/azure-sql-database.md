---
title: "Azure SQL Database"
description: "Use Azure SQL Database for relational application records that need tables, transactions, constraints, query flexibility, and restore."
overview: "Azure SQL Database is a managed relational database for business records such as orders, payments, and line items. This article explains logical servers, databases, tables, transactions, connections, migrations, and point-in-time restore."
tags: ["azure", "sql", "database", "transactions", "restore"]
order: 3
id: article-cloud-providers-azure-storage-databases-azure-sql-database
---

## Table of Contents

1. [What Is Azure SQL Database](#what-is-azure-sql-database)
2. [Logical Servers and Databases](#logical-servers-and-databases)
3. [Tables and Constraints](#tables-and-constraints)
4. [Transactions](#transactions)
5. [Connections](#connections)
6. [Service Tiers](#service-tiers)
7. [Migrations](#migrations)
8. [Restore](#restore)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## What Is Azure SQL Database

Azure SQL Database is Azure's managed relational database for table-shaped business data. Use it when the application needs SQL queries, relationships between records, constraints, transactions, indexes, and a restore path.

A checkout system is a simple example. Customers, orders, payments, and line items are separate facts, but they are connected. An order should not point to a customer that does not exist. A payment should not be recorded without the matching order update. Support may need a query that joins several tables. Those requirements fit a relational database better than an object store or a key-value item container.

Azure SQL Database removes much of the server operation work. Microsoft manages the database service platform, patching path, availability infrastructure, and automated backup system. Your team still owns the data model, indexes, query behavior, permissions, connection management, schema migrations, and recovery decisions.

## Logical Servers and Databases

An Azure SQL logical server is the administrative wrapper and network name around one or more databases. It is not a VM. You cannot SSH into it, install packages, or manage its operating system. It gives Azure a place to keep server-level settings such as the DNS name, firewall rules, administrator configuration, Microsoft Entra authentication, and private endpoint relationship.

Example: `sql-orders-prod.database.windows.net` can host databases named `orders` and `billing`. The server name is the connection endpoint. The databases hold the tables and data.

This separation helps beginners avoid a common misunderstanding. The logical server is not where the rows live in a traditional machine sense. It is a management and connection boundary. The database is the resource with the schema, tables, indexes, storage size, compute model, backup retention, and service tier.

## Tables and Constraints

A table stores records in rows and columns. A constraint is a database rule that protects the shape or relationship of those records. Constraints matter because application code is not the only place where correctness should live.

In an orders database, the schema might start like this:

| Table | Important field | Constraint | What it protects |
| --- | --- | --- | --- |
| `customers` | `id` | Primary key | One stable identity for each customer |
| `customers` | `email` | Unique | No two customer records use the same email |
| `orders` | `customer_id` | Foreign key | Every order points to a real customer |
| `order_items` | `order_id` | Foreign key | Every item belongs to a real order |
| `order_items` | `quantity` | Check | Quantity cannot be zero or negative |

These rules are useful even when the API already validates input. If a bug, script, queue retry, or admin tool tries to write invalid data, the database can reject the write before it becomes a permanent business fact.

## Transactions

A transaction is a group of database changes that succeed together or fail together. It is the reason a checkout can update several tables without leaving the database half changed.

Example: when payment succeeds, the application may insert a payment row, update the order status, decrement inventory, and write an audit record. If the inventory update fails, the payment row and order status update should not remain committed by themselves. The transaction lets the database roll the whole group back.

Relational databases use a transaction log to make committed changes durable. Before the engine treats a commit as complete, it records the change in a sequential log. If the database process or host has a problem before every changed data page is written to its final place, recovery can replay committed log records and undo incomplete work. This is the practical meaning of durability for a relational database.

## Connections

An Azure SQL connection is the path from application code to the database endpoint, plus the identity used to authenticate and the rules that allow traffic. A working connection needs more than a connection string.

![Azure SQL private network path showing app, VNet, private DNS, private endpoint, SQL firewall, and database](/content-assets/articles/article-cloud-providers-azure-storage-databases-azure-sql-database/private-sql-network-path.png)

*Private SQL access depends on both the private endpoint path and the DNS answer clients receive.*


The simplest mental model has four checks:

| Check | Beginner question |
| --- | --- |
| Name | Is the app using the right server and database name? |
| Network | Can the app reach the endpoint through an allowed path? |
| Identity | Is the caller using the expected SQL login or Entra identity? |
| Permission | Does that identity have the database role needed for the query? |

Production systems should usually avoid exposing the database broadly on the public internet. Azure Private Link can give the logical server a private endpoint inside a virtual network. Private DNS then makes the normal database name resolve to the private address for approved clients. This keeps application traffic on the private path and makes the connection design reviewable.

Connection pooling is another important part of the path. Opening a new database connection for every request is expensive. A pool keeps a small set of reusable connections available for the application process. Too few connections can create waiting requests. Too many can exhaust database or app resources. The pool belongs in the application design, even though the database is managed.

## Service Tiers

A service tier is the resource and availability shape of the database. It affects cost, latency, compute behavior, storage behavior, and failover characteristics.

The vCore purchasing model is usually the clearest model for beginners because it separates compute choices from storage choices. Provisioned compute keeps a fixed amount of compute allocated. Serverless compute can automatically scale based on workload demand and can pause during inactive periods when configured, which can be useful for intermittent workloads.

The service tier also changes the storage and availability architecture. General Purpose is a common default for many business applications. Business Critical is designed for low-latency, high-transaction workloads and uses a different architecture with replicas. Hyperscale is a separate architecture for very large databases and faster scale behavior.

The right tier depends on the workload, not on a generic maturity label. A small internal app may be well served by General Purpose. A payment path with high transaction rates and strict latency needs may justify Business Critical. A large database with growth and restore-size concerns may need a Hyperscale review.

## Migrations

A migration is a controlled change to the database schema or data. It exists because application code changes often need new columns, tables, indexes, or constraints, but the database already contains live business records.

Example: adding `client_id` to `orders` should usually happen before old code stops reading `customer_id`. The safe path is additive: add the new nullable column, deploy code that can write or read both forms, backfill old rows, move reads, then remove the old column after every old application version is gone.

The important beginner rule is that database deployments are not the same as container deployments. Replacing a container image can be quick and reversible. Changing a table with live data transforms persistent state. A rollback of application code does not automatically roll back a destructive schema change.

Use versioned migration tools and test them against staging data. Avoid ad hoc production changes. For high-traffic tables, understand whether an operation will lock the table, rebuild an index, or scan every row. A small schema change in code review can become a long database operation in production.

## Restore

Restore is the process of building a usable database from backups at a selected point. Azure SQL Database creates automated backups for point-in-time restore within the configured retention period. The service takes weekly full backups, differential backups every 12 or 24 hours, and transaction log backups approximately every 10 minutes for non-Hyperscale databases.

![Azure SQL transaction log restore timeline showing full backup, transaction logs, failure, point-in-time restore, and restored database](/content-assets/articles/article-cloud-providers-azure-storage-databases-azure-sql-database/transaction-log-restore.png)

*Point-in-time restore works by replaying backups and transaction logs to the selected moment, usually into a new database.*


Example: if a migration corrupts order statuses at `14:05`, point-in-time restore can create a separate database as it existed around `14:04`. The team can compare the restored copy with the active database and decide whether to switch the application or copy only the affected rows back.

Restore does not remove the need for judgment. A full restore can discard valid transactions that happened after the problem began. Sometimes the safer path is surgical recovery: restore a copy, identify the missing or corrupted rows, and repair the active database carefully.

Backup storage also has a cost and redundancy setting. Short-term retention protects the point-in-time restore window. Long-term retention can keep selected full backups for compliance needs. Deleting a database can still leave backup storage cost until retained backups age out.

## Putting It All Together

Azure SQL Database is the right Azure starting point for relational application records. It stores table-shaped facts, enforces rules, runs SQL queries, protects multi-step changes with transactions, and gives the team a managed backup and restore path.

The managed service removes server chores, but it does not remove database engineering. Your team still needs a schema that matches the business, indexes that match query behavior, connections that are private and pooled correctly, migrations that are safe with live traffic, and restore drills that prove backups can become usable data.

## What's Next

Next we look at Cosmos DB, where the central question changes from relational rules to item-shaped access patterns, partition keys, request units, TTL, and consistency tradeoffs.


![Azure SQL safety path showing app, private network, logical server, database, firewall, migration, backup, and point-in-time restore](/content-assets/articles/article-cloud-providers-azure-storage-databases-azure-sql-database/azure-sql-safety-path.png)

*Use this as the Azure SQL safety path: protect the network path, treat schema changes as releases, rely on the transaction log, and verify backup and restore behavior.*

---

**References**

* [What is Azure SQL Database?](https://learn.microsoft.com/en-us/azure/azure-sql/database/sql-database-paas-overview?view=azuresql-db) - Managed relational database overview and service responsibilities.
* [vCore purchasing model](https://learn.microsoft.com/en-us/azure/azure-sql/database/service-tiers-sql-database-vcore?view=azuresql) - vCore, provisioned compute, serverless, and service tier concepts.
* [Azure SQL Database serverless](https://learn.microsoft.com/en-us/azure/azure-sql/database/serverless-tier-overview?view=azuresql) - Automatic compute scaling and auto-pause behavior.
* [Azure Private Link for Azure SQL Database](https://learn.microsoft.com/en-us/azure/azure-sql/database/private-endpoint-overview?view=azuresql) - Private endpoint and private DNS behavior for SQL connections.
* [Automated backups in Azure SQL Database](https://learn.microsoft.com/en-us/azure/azure-sql/database/automated-backups-overview?view=azuresql) - Backup frequency, retention, redundancy, and restore options.
* [Restore a database from backups](https://learn.microsoft.com/en-us/azure/azure-sql/database/recovery-using-backups?view=azuresql) - Point-in-time restore and recovery operations.
