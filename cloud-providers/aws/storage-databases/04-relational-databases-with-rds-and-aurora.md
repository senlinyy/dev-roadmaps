---
title: "Relational Databases with RDS and Aurora"
description: "Run relational databases on AWS by choosing RDS or Aurora, designing private network access, managing credentials, planning backups and Multi-AZ, and shipping schema changes safely."
overview: "Relational data needs transactions, constraints, indexes, SQL, and careful operations. This article follows Maple Market's checkout records through RDS, Aurora, private connectivity, credentials, connection management, backups, and migrations."
tags: ["aws", "rds", "aurora", "sql", "databases"]
order: 4
id: article-cloud-providers-aws-storage-databases-rds-relational-databases
aliases:
  - rds-relational-databases
  - rds-relational-database
  - relational-databases-with-rds-and-aurora
  - cloud-providers/aws/storage-databases/rds-relational-databases.md
  - cloud-providers/aws/storage-databases/relational-databases-with-rds-and-aurora.md
---

## Table of Contents

1. [When Data Needs Rules](#when-data-needs-rules)
2. [RDS as Managed Relational Databases](#rds-as-managed-relational-databases)
3. [Aurora as a Clustered Relational Engine](#aurora-as-a-clustered-relational-engine)
4. [Network, Credentials, and Connections](#network-credentials-and-connections)
5. [Backups, Multi-AZ, and Read Scaling](#backups-multi-az-and-read-scaling)
6. [Schema Changes in Production](#schema-changes-in-production)
7. [Operating Signals and Day-Two Work](#operating-signals-and-day-two-work)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## When Data Needs Rules
<!-- section-summary: Relational databases fit business records that need transactions, constraints, joins, and flexible SQL queries. -->

Maple Market's checkout workflow has a very different data shape from product photos. A photo can sit in S3 as one object. An order is a group of related facts: customer, order header, line items, payment attempt, inventory reservation, shipping address, refund state, and audit trail. Those facts need rules.

A **relational database** stores structured records in tables and lets the application connect records through keys and constraints. A customer row can own many order rows. An order row can own many order item rows. A payment row can point back to the order it belongs to. SQL gives the application a query language for reading and joining those records.

The most important feature for checkout is the **transaction**. A transaction groups several database changes into one unit of work. Maple Market can create the order, insert the order items, record the payment authorization, and reserve inventory in one transaction. If a step fails, the database can roll the group back so the system avoids half-written orders.

Here is a small version of that shape. The schema shows why keys and constraints matter for order data.

```sql
create table orders (
  id uuid primary key,
  customer_id uuid not null,
  status text not null,
  total_cents integer not null,
  created_at timestamptz not null default now()
);

create table order_items (
  id uuid primary key,
  order_id uuid not null references orders(id),
  sku text not null,
  quantity integer not null,
  unit_price_cents integer not null
);
```

The `order_items.order_id` reference protects the relationship. An item must point to an existing order. That kind of rule belongs in the database when it protects money, inventory, compliance, or customer-visible state.

AWS gives teams two main managed relational paths in this module: Amazon RDS and Amazon Aurora. Both run relational databases, but they package the infrastructure differently.

## RDS as Managed Relational Databases
<!-- section-summary: RDS runs familiar relational database engines while AWS handles much of the host, backup, patching, and failover work. -->

Amazon Relational Database Service, usually called **RDS**, runs managed relational databases. You choose an engine such as PostgreSQL, MySQL, MariaDB, Oracle, Microsoft SQL Server, or Db2 where supported. AWS provisions the database instance, storage, networking surface, backups, monitoring integration, and many maintenance operations.

RDS reduces infrastructure work. The team does not install the database server on a raw EC2 instance, write its own backup scripts, manually replace failed disks, or build every failover process from scratch. AWS handles much of that operational layer. The application team still owns the schema, indexes, SQL queries, migrations, credentials, capacity choices, and data correctness.

That boundary matters. If Maple Market writes a slow query with a missing index, RDS will faithfully run the slow query. If a migration drops a column the application still reads, RDS will not know the release plan. If a connection pool opens too many sessions, the database can still hit connection pressure. Managed infrastructure does not remove database engineering.

When creating an RDS database, teams choose several things. These choices shape cost, performance, recovery, and access before the first table is created.

| Choice | What it controls |
|---|---|
| Engine and version | SQL dialect, features, extension support, upgrade path |
| Instance class | CPU, memory, network capacity, and connection headroom |
| Storage type and size | IOPS, throughput, growth, and cost behavior |
| VPC and subnet group | Which private subnets host database network interfaces |
| Security groups | Which clients can reach the database port |
| Backups and retention | Restore window and snapshot behavior |
| Maintenance window | When AWS can apply approved maintenance work |
| Monitoring | Metrics, logs, performance insights, and alarms |

For new designs, teams usually choose current SSD-backed RDS storage options such as general purpose or provisioned IOPS storage based on measured needs. AWS documentation now marks magnetic storage as previous-generation or deprecated, so it should not be the default choice for a new production database.

RDS is the managed path for familiar database engines. Aurora is also relational, but its storage and cluster architecture are different enough to explain separately.

## Aurora as a Clustered Relational Engine
<!-- section-summary: Aurora is a MySQL-compatible and PostgreSQL-compatible relational engine with a distributed cluster storage design. -->

Amazon Aurora is a managed relational database engine compatible with MySQL and PostgreSQL. Compatibility means many existing tools, drivers, and SQL habits can carry over, depending on engine version and feature use. Aurora still lives under the RDS service family in the AWS console and APIs, but the engine architecture differs from standard RDS engines.

Aurora uses a **DB cluster**. A cluster has a distributed cluster volume and one or more DB instances attached to it. One instance is the writer. Reader instances can serve read traffic and can be promoted during failover. The cluster volume stores data across multiple Availability Zones, and the Aurora storage layer handles replication and repair work behind the service boundary.

This architecture changes how teams think about scale and failover. In a standard RDS PostgreSQL deployment, scaling reads usually means adding read replicas that replicate from the source database. In Aurora, reader instances attach to the cluster storage design and use cluster endpoints such as writer and reader endpoints. Applications should connect to the right endpoint for the job.

Aurora often fits Maple Market if the checkout database needs strong relational behavior plus higher read scale, faster failover characteristics, or Aurora-specific features. Standard RDS still fits many production systems very well, especially when the team wants a familiar managed engine shape and does not need Aurora-specific architecture.

Here is the beginner comparison. The point is to decide which operating shape fits the workload, not to rank one service above the other.

| Need | RDS | Aurora |
|---|---|---|
| Familiar managed engine | Strong fit | Strong fit for MySQL/PostgreSQL-compatible workloads |
| Engine variety | More engine families | MySQL-compatible and PostgreSQL-compatible |
| Storage model | DB instance storage model | Distributed cluster volume |
| Read scaling | Read replicas where supported | Reader instances and reader endpoint |
| Failover model | Multi-AZ options by deployment type | Cluster failover among instances |
| Operational feel | Closer to a managed traditional database | More cluster-oriented |

Aurora is still a relational database. It still needs schema design, indexes, query review, migrations, credentials, backups, and connection planning.

## Network, Credentials, and Connections
<!-- section-summary: Production relational databases need private network paths, managed secrets, and connection controls before traffic arrives. -->

A production database should have a clear access path. Maple Market's checkout database belongs in private subnets. The application service should connect from its own private runtime through security groups. The database should avoid direct public exposure for normal application traffic.

The main AWS network pieces are **DB subnet groups** and **security groups**. A DB subnet group tells RDS which subnets it can use. Security groups control which sources can connect to the database port. A common setup allows inbound PostgreSQL traffic from the application service security group and from a narrow operations access path, while every other source stays outside the database port.

Credentials need the same care. A database password sitting in a container image, GitHub secret, or shared `.env` file creates avoidable risk. In AWS production systems, teams commonly store database credentials in AWS Secrets Manager, grant the application role permission to read the specific secret, and load the value at runtime. Where supported, Secrets Manager can help with password rotation.

Connection counts can surprise teams. Relational databases allocate memory and process resources for connections. If Maple Market scales from 5 application tasks to 80 tasks and each task opens 50 connections, the database may spend more energy managing sessions than serving useful queries. This is why applications use connection pools, and why some AWS architectures add **RDS Proxy** between serverless or bursty applications and the database.

An application configuration might look like this. The values make the runtime endpoint, secret source, and pool behavior visible.

```bash
DATABASE_HOST=orders.cluster-abc123.us-east-1.rds.amazonaws.com
DATABASE_PORT=5432
DATABASE_NAME=orders
DATABASE_SECRET_ARN=arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/orders-db
DATABASE_POOL_MAX=15
```

That small configuration names the endpoint, database, secret source, and connection pool limit. The code should fetch the secret through the AWS SDK using the runtime role, create a bounded pool, and fail startup if required configuration is missing. This is ordinary engineering work, but it prevents a lot of late-night database incidents.

## Backups, Multi-AZ, and Read Scaling
<!-- section-summary: Availability, historical recovery, and read capacity solve different database problems and need separate design choices. -->

Database resilience has a few layers, and each layer solves a different problem. **Backups** help recover historical data. **Multi-AZ** helps with infrastructure availability. **Read replicas or reader instances** help with read scale and sometimes regional read locality. Mixing these up leads to weak recovery plans.

RDS automated backups support point-in-time recovery inside the configured retention window. RDS stores transaction logs so a team can restore to a new database at a specific time within that window. Aurora has its own backup behavior around the cluster volume and point-in-time restore. The important production habit is the same: pick a retention window, document the restore process, and test restore into a non-production target.

Multi-AZ deployments help the database stay available during host, storage, or Availability Zone problems. A Multi-AZ DB instance deployment maintains a standby DB instance in another Availability Zone for failover support. Multi-AZ DB cluster deployments use a writer and two readable standby instances in separate Availability Zones for supported engines. Aurora clusters use their own cluster architecture and failover behavior. These designs protect uptime, but they are live copies of current state, so bad application writes can still replicate.

Read scaling is its own design. RDS read replicas and Aurora reader instances can move read-heavy work away from the writer. Maple Market might send dashboard reads or product browsing queries to a reader while checkout writes stay on the writer. The application needs to understand that read replicas can have lag, so a user who just placed an order may need to read from the writer for the immediate confirmation path.

Backup, availability, and read scale should each appear in the design. A short written note keeps the team from treating one feature as a substitute for another.

```markdown
Recovery: automated backups retained for approved window; monthly restore drill into staging
Availability: Multi-AZ enabled for production writer path
Read scale: dashboard queries use reader endpoint; checkout confirmation reads writer
```

That plain note prevents the common mistake of treating one resilience feature as if it solved every resilience problem. It also gives on-call engineers a faster way to understand why the database was built this way.

## Schema Changes in Production
<!-- section-summary: Safe schema changes use staged migrations so old and new application versions can run during a deployment. -->

Relational databases make it easy to protect data with schema rules. They also make deployments more sensitive because application code and schema must stay compatible while releases roll through. Maple Market cannot break checkout because one app task still expects an old column while another task writes the new shape.

The safest habit is **expand and contract**. The first step expands the schema in a backward-compatible way, often with a new nullable column, new table, or new index while old code still works. The next application release writes both old and new shapes or reads from the new shape with fallback. A backfill job updates existing rows after that. After the system runs safely and all old code is gone, the final step contracts the schema by removing the old column or old path.

For example, Maple Market wants to store invoice delivery state separately from order status. A safer first migration adds a new column without breaking old reads. The existing application can keep running while the new column appears:

```sql
alter table orders
add column invoice_delivery_status text;

create index concurrently idx_orders_invoice_delivery_status
on orders (invoice_delivery_status);
```

Then the application starts writing `invoice_delivery_status` for new orders and a backfill job updates older rows in batches. The batch size should be tested against production-like data.

```sql
with batch as (
  select id
  from orders
  where invoice_delivery_status is null
    and status = 'invoiced'
  order by created_at
  limit 1000
)
update orders
set invoice_delivery_status = 'sent'
from batch
where orders.id = batch.id;
```

The exact SQL batching pattern varies by engine. The important idea is that backfills should be measured, restartable, and gentle on production. Large locks, table rewrites, and long transactions can hurt live traffic. Teams should test migrations on production-like data, review query plans, and keep rollback steps ready before the release window.

Schema changes are where database engineering meets deployment engineering. RDS and Aurora provide managed infrastructure, but the team still owns this release choreography.

## Operating Signals and Day-Two Work
<!-- section-summary: Relational databases need ongoing review of query latency, locks, storage growth, connections, backups, and engine lifecycle. -->

After launch, the database sits near the center of the operating surface for the system. Maple Market should watch signals that explain user-facing symptoms and database health.

The core signals include CPU, memory, free storage, read and write IOPS, disk queue depth, connections, transaction rate, replica lag, deadlocks, lock waits, slow queries, failed logins, backup completion, and failover events. RDS Performance Insights and database engine logs can help teams connect slow application endpoints to specific SQL statements.

Indexes need maintenance as product behavior changes. A query that was fine with 10,000 rows can hurt with 50 million rows. Teams should review slow queries, inspect query plans, add indexes deliberately, and remove unused indexes that slow writes. For PostgreSQL, teams also need to watch vacuum health and table bloat. For MySQL-compatible engines, teams watch different engine-specific metrics and configuration choices.

Engine versions need lifecycle planning. Open-source database major versions eventually leave standard support windows. AWS offers paths such as upgrades and, in some cases, paid extended support. A production team should keep an engine-version calendar so a database upgrade is planned work, not a surprise ticket near end of support.

A simple monthly database review can cover several recurring questions. The review should produce decisions or tickets, not just a screenshot of graphs.

| Review item | Question |
|---|---|
| Backups | Did the latest restore drill work? |
| Connections | Are pools sized for current task counts? |
| Queries | Which SQL statements dominate latency and load? |
| Storage | Is growth expected, and does autoscaling or capacity planning match it? |
| Replicas | Are lag and failover behavior acceptable for the app paths using them? |
| Patching | Are maintenance windows and engine versions still healthy? |
| Security | Are secrets, security groups, and audit logs still scoped correctly? |

This regular care keeps the managed database healthy as the application grows. It also helps the team catch slow drift before it turns into a customer-facing incident.

## Putting It All Together
<!-- section-summary: RDS and Aurora solve relational infrastructure operations, while the team still owns schema, queries, access, and releases. -->

Maple Market uses a relational database for checkout because orders, payments, inventory, and refunds need transactions, constraints, and SQL. RDS gives the team familiar managed database engines. Aurora gives the team a MySQL-compatible or PostgreSQL-compatible clustered engine with a distributed storage design. Both choices need private networking, scoped security groups, managed secrets, connection pooling, backups, availability planning, migrations, monitoring, and version lifecycle work.

The beginner mistake is thinking the service choice is the whole design. The service choice is only the first part. The real production design says which engine runs, where the endpoint lives, which role can get the secret, how many connections each app can open, how restores are tested, how schema changes roll out, and which metrics wake someone up.

That is the shape of managed relational databases on AWS: AWS carries a large part of the infrastructure burden, and your team still carries the data contract. The best teams respect both halves.

## What's Next
<!-- section-summary: The next article explains DynamoDB for high-scale key-based access patterns that do not need relational joins. -->

Relational databases are excellent for structured records and transactions. Some data needs fast key-based access at very high request rates, with fewer joins and a different modeling style. The next article covers NoSQL with DynamoDB.

---

**References**

- [What is Amazon RDS?](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html) - Describes RDS engines, instances, backups, Multi-AZ, and managed database operations.
- [Amazon RDS storage](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_Storage.html) - Documents RDS storage types and current storage guidance.
- [Working with a DB instance in a VPC](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html) - Explains subnet groups, VPC placement, and private database networking.
- [RDS Multi-AZ DB instance deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html) - Explains synchronous standby replication and failover for Multi-AZ DB instances.
- [Multi-AZ DB cluster deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/multi-az-db-clusters-concepts.html) - Documents the writer plus readable standby cluster deployment mode for supported engines.
- [Amazon RDS read replicas](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html) - Covers read replica use cases and replication behavior.
- [What is Amazon Aurora?](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_AuroraOverview.html) - Defines Aurora as a MySQL-compatible and PostgreSQL-compatible managed relational database engine.
- [Amazon Aurora DB clusters](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Overview.html) - Explains cluster instances, endpoints, and Aurora cluster architecture.
- [Amazon Aurora storage and reliability](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Overview.StorageReliability.html) - Details Aurora cluster volume storage behavior and reliability design.
- [AWS Secrets Manager integration with Amazon RDS](https://docs.aws.amazon.com/secretsmanager/latest/userguide/integration_rds.html) - Covers credential storage and rotation integration.
- [Managing connections with RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html) - Explains connection pooling and proxy behavior for RDS and Aurora.
