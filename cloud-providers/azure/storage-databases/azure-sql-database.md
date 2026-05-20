---
title: "Azure SQL Database"
description: "Use Azure SQL Database for relational application records that need tables, transactions, constraints, query flexibility, and restore."
overview: "Azure SQL Database is a managed relational database for business records such as orders, payments, and line items. This article explains logical servers, databases, tables, transactions, connections, schema changes, and restore."
tags: ["azure", "azure-sql", "sql", "transactions", "restore"]
order: 3
id: article-cloud-providers-azure-storage-databases-azure-sql-database
---

## Table of Contents

1. [The Problem](#the-problem)
2. [What Is Azure SQL Database](#what-is-azure-sql-database)
3. [Logical Server](#logical-server)
4. [Database](#database)
5. [Tables](#tables)
6. [Transactions](#transactions)
7. [Connections](#connections)
8. [Schema Changes](#schema-changes)
9. [Restore](#restore)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Problem

The previous article put receipt PDFs and export files in Blob Storage. The order itself is different. It is not a file the app stores and downloads as one object. It is a set of related business facts.

The checkout path needs rules:

- An order belongs to one customer.
- An order has line items.
- A payment attempt belongs to one order.
- The system should not store a paid order without its line items.
- Support may ask for failed payment attempts for one customer this week.

That data wants relational structure. The app needs transactions, constraints, indexes, queries, migrations, connection rules, and restore. Azure SQL Database is the usual Azure starting point for that shape.

## What Is Azure SQL Database

Azure SQL Database is a managed relational database service. Relational data lives in tables, and tables can relate to each other through keys and constraints. Managed means Azure operates the database service infrastructure, but your team still owns schema design, queries, permissions, migrations, connection behavior, and recovery decisions.

If you know AWS RDS, Azure SQL Database lives in the same broad mental bucket: managed relational database for application records. The Azure shape has its own nouns. A logical server is a management and connection boundary. A database holds the actual application data. Network access, Microsoft Entra authentication, firewall rules, private endpoints, and backup retention are Azure-specific details.

The useful beginner sentence is this: use Azure SQL when the data is a set of connected records and the app needs the database to protect relationships.

## Logical Server

An Azure SQL logical server is not the server that runs your application. It is a logical management boundary for one or more databases. It provides the server name clients connect to, admin settings, firewall rules, identity integration, and other shared database management behavior.

This distinction matters because beginners often see the word server and imagine a VM. Azure SQL Database is a managed database service. You do not SSH into the logical server and install packages. You manage databases, access, configuration, performance, and restore through Azure and SQL tools.

For the orders system, the logical server might be `sql-orders-prod-weu`. The database might be `orders`. The app connection string points at the server and database, but the app should not treat that logical server as an application host.

## Database

The database is where the application records live. It has tables, indexes, users, permissions, performance settings, backup behavior, and the schema your application expects.

A database boundary is important for ownership. A production orders database should not be a casual shared dumping ground for unrelated services. If many teams share one database, schema changes and permissions become tangled. If every tiny feature creates its own database, reporting and transactions may become harder. The right boundary follows the business domain and operational ownership.

For `orders-api`, the database owns order state. It can store a pointer to a receipt blob, but it should not store the PDF bytes unless there is a very specific reason. The database keeps the facts. Blob Storage keeps the file.

## Tables

Tables turn business facts into structured rows and columns. For checkout, a small model might have `customers`, `orders`, `order_items`, and `payment_attempts`.

```text
customers
  id
  email

orders
  id
  customer_id
  status
  created_at

order_items
  order_id
  sku
  quantity

payment_attempts
  id
  order_id
  status
  provider_reference
```

The point of the sketch is not to teach SQL syntax. It shows why this is relational data. The rows refer to each other. The database can enforce rules. Queries can join facts when support, finance, or the application needs a new view.

## Transactions

A transaction lets the app group changes so they succeed or fail together. Checkout often needs this. If the app creates an order row but fails before inserting line items, the system has an incomplete business fact. If it records a payment success but not the order status update, support sees conflicting state.

Transactions do not remove all application bugs. They give the app a tool for protecting a unit of work. The developer still has to choose the right boundary. A transaction that includes slow external API calls can create its own problems. A transaction that is too small may not protect the actual business invariant.

For a beginner, the habit is enough: when several related records must change together, ask whether the database should protect that change with a transaction.

## Connections

An app reaches Azure SQL through a connection path. That path includes the server name, database name, authentication method, network access, firewall or private endpoint behavior, and the app's identity or secret.

Connection failures often look like one generic "database unavailable" problem. In reality, the failure might sit in different layers:

| Layer | Question |
| --- | --- |
| Name | Is the app connecting to the right server and database? |
| Network | Is public access, firewall, or private endpoint behavior allowing the path? |
| Identity | Is the app using SQL auth, Microsoft Entra auth, or managed identity correctly? |
| Permission | Does that principal have database access? |
| Capacity | Is the database throttled or under resource pressure? |

Do not hide the connection model in one unreviewed secret. A production app should make the intended path clear: which database, which network path, which identity, and which permissions.

## Schema Changes

Schema changes are application deployments. Adding a column, changing a constraint, creating an index, or splitting a table can change how old and new application versions behave.

The danger includes migrations that fail and migrations that succeed at the wrong time. If the database schema changes before all app instances understand it, a rollout can break. If a column is removed while old code still reads it, the application can fail after the database did exactly what the migration requested.

Treat schema changes as part of the release plan. Make migrations repeatable, review them like code, and think about forward and backward compatibility when the app rolls across multiple instances.

## Restore

Azure SQL Database includes automated backups and point-in-time restore behavior. That does not mean recovery is solved. The team still needs to know the retention period, whether long-term retention is needed, where a restored database will land, who can access it, and how the app or humans will compare restored data with current data.

Changing backup retention can affect available restore points. Restoring can create a new database rather than magically undoing one bad row in place. A real recovery plan says what the team will restore, where it will restore it, and how it will safely move or compare the recovered data.

The useful phrase is: backups are a feature only after restore has been tested.

## Putting It All Together

The opener had order records, payment attempts, line items, support queries, and the need to avoid half-written checkout state. Azure SQL Database gives those records a relational home.

The logical server is the management and connection boundary. The database holds the application records. Tables model business facts. Transactions protect units of work. Connections combine name, network, identity, and permission. Schema changes belong to deployment. Restore turns backup promises into an operational path.

Use Azure SQL when the data needs relational rules, not because every piece of application data must go into one database.

## What's Next

Next we will look at Cosmos DB, where the data is item-shaped and the design starts from known access patterns rather than relational joins.

---

**References**

- [Azure SQL Database documentation](https://learn.microsoft.com/en-us/azure/azure-sql/database/)
- [What is Azure SQL Database?](https://learn.microsoft.com/en-us/azure/azure-sql/database/sql-database-paas-overview?view=azuresql)
- [Automated backups in Azure SQL Database](https://learn.microsoft.com/en-us/azure/azure-sql/database/automated-backups-change-settings?view=azuresql)
- [Point-in-time restore in Azure SQL Database](https://learn.microsoft.com/en-us/azure/azure-sql/database/recovery-using-backups?view=azuresql)
