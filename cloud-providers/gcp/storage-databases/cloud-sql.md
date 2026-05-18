---
title: "Cloud SQL"
description: "Use Cloud SQL for relational application records by understanding instances, databases, schemas, transactions, connections, private access, migrations, backups, and high availability."
overview: "Order records need more than a place to store JSON. This article teaches Cloud SQL as the GCP home for relational app data, using checkout records, transactions, migrations, private access, and restore thinking."
tags: ["gcp", "cloud-sql", "postgresql", "mysql", "sql"]
order: 3
id: article-cloud-providers-gcp-storage-databases-cloud-sql-relational-databases
aliases:
  - cloud-sql-relational-databases
  - cloud-sql-relational-database
  - cloud-providers/gcp/storage-databases/cloud-sql-relational-databases.md
---

## Table of Contents

1. [The Problem](#the-problem)
2. [What Is Cloud SQL](#what-is-cloud-sql)
3. [Relational Shape](#relational-shape)
4. [Instances](#instances)
5. [Databases And Schemas](#databases-and-schemas)
6. [Transactions](#transactions)
7. [Connections](#connections)
8. [Private Access](#private-access)
9. [Migrations](#migrations)
10. [Backups And HA](#backups-and-ha)
11. [Sample Database Shape](#sample-database-shape)
12. [Putting It All Together](#putting-it-all-together)
13. [What's Next](#whats-next)

## The Problem

Cloud Storage is a good home for receipt PDFs and export files. Checkout records have a different shape.

One checkout creates related facts:

- An order belongs to a customer.
- The order has line items and totals.
- A payment attempt belongs to the order.
- A refund should not point at a missing payment.
- A schema migration should not break the running app.
- The database should be reachable from the app without becoming a casual public target.

This is relational data. The problem is not only saving bytes. The problem is preserving relationships, constraints, transactions, query behavior, connection safety, and recovery.

## What Is Cloud SQL

Cloud SQL is GCP's managed relational database service for MySQL, PostgreSQL, and SQL Server. Managed means Google Cloud handles many infrastructure responsibilities around the database service. Your team still owns the data model and how the application uses it.

That split is important. Cloud SQL can give you a managed instance, backups, maintenance features, networking choices, logging, monitoring, and high availability options. It does not design tables, choose indexes, write safe migrations, manage app connection behavior, or decide what a restore should prove.

| Cloud SQL helps with | Your team still owns |
| --- | --- |
| Managed database infrastructure | Tables, constraints, indexes, and queries |
| Backups and HA options | Restore objectives and drills |
| Connectivity options | Runtime connection behavior and credentials |
| Monitoring surfaces | Interpreting slow queries and app failures |

Use Cloud SQL when the data is relational, not merely because the word database feels familiar.

## Relational Shape

Relational data has meaning between records. An order row, line item row, payment row, and refund row form a small graph of business facts. The database can enforce some of those relationships with constraints. SQL can query them together. Transactions can keep related writes consistent.

This is why checkout usually wants a relational database. If the payment write succeeds but the order write fails, the business state becomes hard to explain. If two migrations change related tables out of order, the app can fail in production. If a query needs to join customers, orders, and payments, a relational model makes that normal.

The first design question is not "PostgreSQL or MySQL?" It is "what relationships and consistency rules does this feature need?"

## Instances

A Cloud SQL instance is the managed database server resource. It has an engine, region, machine shape, storage settings, networking configuration, backup settings, and maintenance behavior.

The instance is not the same as a database schema. A single instance can host databases depending on engine and design. The instance-level choices shape availability, cost, performance, maintenance, and connectivity.

For the Orders API, instance evidence should name the engine and purpose:

```text
instance: orders-prod-sql
engine: PostgreSQL
region: us-central1
workload: request-time order records
network: private access from orders app path
```

That evidence is small, but it stops "the database" from being a vague object.

## Databases And Schemas

Inside the relational engine, databases and schemas organize tables, indexes, constraints, views, and other database objects. The exact terms vary by engine, but the practical lesson is stable: the data model is part of the application.

Tables should express business facts. Constraints should protect facts the app must not violate. Indexes should support real query patterns. A migration should change this model intentionally, with a rollback or recovery story.

For checkout, the model might include:

| Table | Job |
| --- | --- |
| `orders` | Current order state |
| `order_items` | Line items attached to orders |
| `payment_attempts` | Payment lifecycle and provider references |
| `receipts` | Business link to Cloud Storage object names |

The receipt bytes live in Cloud Storage. The receipt relationship belongs in the database.

## Transactions

A transaction is a unit of work that should succeed or fail together. Checkout needs this because several records change as one business action.

Imagine checkout inserts an order, inserts line items, records a payment attempt, and marks the order paid. If only half of that work commits, support cannot explain the order. A transaction lets the app group related changes so the database keeps a consistent state.

Transactions are not a reason to put every kind of data in Cloud SQL. They are a reason to put related business records there. Keep large receipt PDFs in Cloud Storage and keep the relational facts in Cloud SQL.

## Connections

Connections are a runtime concern. The Cloud Run service, VM, or GKE workload needs a way to reach the database, authenticate, and manage connection count.

Serverless scaling makes this easy to underestimate. If a Cloud Run service scales quickly and each instance opens many database connections, the database can hit connection limits even though the app code looks normal. Connection pooling, connector configuration, timeouts, and max instances all belong in the design.

Useful connection evidence looks like:

```text
caller: devpolaris-orders-api
runtime: Cloud Run
database: orders-prod-sql
connection path: private IP or connector path
pooling: configured with max connections
timeout behavior: visible in logs
```

The database is part of the runtime path, not only the data layer.

## Private Access

Cloud SQL can be reached through public or private patterns, depending on configuration. For production app databases, private access is often the healthier starting point. The app reaches the database through an approved private path, and the database is not casually exposed as a public target.

Private access is not one checkbox. The VPC, private service connection, DNS, egress path, firewall or service controls, and database credentials all matter. The networking module covered those pieces. Here, remember that database design includes connectivity design.

If the app times out, inspect the network path. If the app gets authentication or permission errors, inspect credentials, IAM-related connection setup, or database grants. The error shape tells you where to start.

## Migrations

Migrations change the database structure over time. They add columns, create indexes, change constraints, and sometimes backfill data.

The risk is that the database and app code do not change at exactly the same moment. If a release expects a new column before the migration runs, requests can fail. If a migration removes a column while an old revision still serves traffic, rollback can break. Cloud Run revisions make code rollback visible, but the database schema may have moved forward.

Good migration discipline uses small, compatible steps:

| Change | Safer habit |
| --- | --- |
| Add a column | Add first, deploy code that uses it later |
| Rename a field | Add new field, dual write/read, remove old after rollout |
| Add an index | Create without blocking critical traffic where engine supports it |
| Backfill data | Run in batches with monitoring and recovery plan |

Database changes deserve release planning, not hope.

## Backups And HA

Cloud SQL supports backup and high availability features, but a checkbox is not a recovery plan. The team needs to know how far back backups go, whether point-in-time recovery is enabled where needed, what restore target is acceptable, and how restore has been tested.

High availability reduces some outage risk by using standby infrastructure, depending on configuration. It does not undo a bad migration or accidental data corruption. Backups, point-in-time recovery, exports, and restore drills answer different failure modes.

Ask two questions:

- If the instance fails, how does the service stay available or recover?
- If the data is wrong, what previous good copy can we restore?

Those are related, but they are not the same problem.

## Sample Database Shape

For the Orders API, a practical Cloud SQL shape might be:

| Part | Example |
| --- | --- |
| Instance | `orders-prod-sql` |
| Engine | PostgreSQL |
| Region | `us-central1` |
| Data | Orders, line items, payments, receipt references |
| Connection | Private path from Cloud Run |
| Runtime identity | App identity or connector path with narrow access |
| Migrations | Backward-compatible release steps |
| Recovery | Automated backups, PITR if required, restore drill |

This is the record-keeping center of the app. Treat it with the discipline that checkout deserves.

## Putting It All Together

Return to the opening problems.

Orders, payments, and line items need relationships. Cloud SQL fits because relational rules matter.

Checkout needs transactions. A set of writes should become one consistent business action.

Schema changes need migration discipline because Cloud Run revisions and database schemas do not roll back in the same way.

Database reachability is a runtime design. Private access, credentials, pooling, and logs all belong in the Cloud SQL review.

Backups and HA support different recovery questions. Availability protects service continuity; restore protects data correctness after mistakes.

## What's Next

Cloud SQL handles relational business records. Some application state is document-shaped and is read by predictable paths. Next, we look at Firestore.

---

**References**

- [Google Cloud: Cloud SQL overview](https://cloud.google.com/sql/docs/introduction)
- [Google Cloud: Connect to Cloud SQL](https://cloud.google.com/sql/docs/connect-overview)
- [Google Cloud: Cloud SQL backups](https://cloud.google.com/sql/docs/mysql/backup-recovery/backups)
- [Google Cloud: High availability overview](https://cloud.google.com/sql/docs/mysql/high-availability)
