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

1. [Start With Checkout Records](#start-with-checkout-records)
2. [Why Relational Databases Fit](#why-relational-databases-fit)
3. [RDS for Managed Engines](#rds-for-managed-engines)
4. [Aurora for AWS-Designed Relational Clusters](#aurora-for-aws-designed-relational-clusters)
5. [Private Access and Credentials](#private-access-and-credentials)
6. [Backups, Multi-AZ, and Read Scaling](#backups-multi-az-and-read-scaling)
7. [Schema Changes](#schema-changes)
8. [Operating Checklist](#operating-checklist)
9. [References](#references)

## Start With Checkout Records
<!-- section-summary: Relational databases fit business records that need transactions, constraints, joins, and flexible SQL queries. -->

Maple Market's checkout workflow has several records that must agree. An order is created, payment is authorized, inventory is reserved, and an invoice event is saved. If payment fails, the order should not look paid. If inventory cannot be reserved, the payment should not quietly continue.

This is why relational databases are still common in cloud systems. They give applications **transactions**, **constraints**, **indexes**, and **SQL queries**. A transaction lets several changes commit together or roll back together. Constraints protect rules such as unique order numbers or required customer IDs. Indexes help queries find rows efficiently.

A small order lookup might look like this:

```sql
select o.id, o.status, p.status as payment_status, o.created_at
from orders o
join payments p on p.order_id = o.id
where o.id = 'ord_123';
```

This data shape needs relationships and correctness more than simple key lookup speed. That points toward RDS or Aurora.

The important beginner move is to keep the database responsible for rules that protect money and customer state. The application can validate inputs, but the database should also protect unique order IDs, required fields, foreign key relationships, and transactional updates. That gives the system a second line of defense when retries, deploys, or background jobs behave badly.

## Why Relational Databases Fit
<!-- section-summary: The database engine protects relationships between rows while the application still owns schema design and release safety. -->

A relational database stores structured rows in tables. Tables can reference each other. The database can enforce primary keys, foreign keys, uniqueness, and transactional changes. SQL lets the team ask new questions without creating a new access path for every query.

For Maple Market, `orders`, `order_items`, `payments`, and `inventory_reservations` are related. The team wants a transaction around checkout and reports that join the records later. A document store or key-value table might handle some flows, but the relational fit is strong because the records need constraints and joins.

The managed service reduces infrastructure work while the application team still designs tables, writes migrations, adds indexes, reviews slow queries, handles connection pooling, and protects credentials.

A small schema shows the shape:

```sql
create table orders (
  id uuid primary key,
  customer_id uuid not null,
  status text not null,
  created_at timestamptz not null default now()
);

create table order_items (
  id uuid primary key,
  order_id uuid not null references orders(id),
  sku text not null,
  quantity integer not null check (quantity > 0)
);
```

The foreign key and check constraint protect the data when application code changes, a worker retries, or an admin script runs during an incident.

![The transaction map shows why relational databases fit workflows that need consistent updates across related records](/content-assets/articles/article-cloud-providers-aws-storage-databases-rds-relational-databases/checkout-transaction-map.png)

*The transaction map shows why relational databases fit workflows that need consistent updates across related records.*


## RDS for Managed Engines
<!-- section-summary: RDS runs familiar relational database engines while AWS handles much of the host, backup, patching, and failover work. -->

**Amazon RDS** runs managed relational database engines such as PostgreSQL, MySQL, MariaDB, Oracle, SQL Server, and Db2 depending on current AWS support and Region. AWS handles much of the infrastructure work: provisioning, backups, patching options, monitoring integration, and Multi-AZ deployment options.

RDS is a good fit when the team wants a familiar engine with managed operations. If the app already uses PostgreSQL, RDS for PostgreSQL lets the team keep normal PostgreSQL behavior while reducing server management work.

A minimal creation command for a private PostgreSQL database might include a DB subnet group, no public accessibility, and storage encryption:

```bash
aws rds create-db-instance \
  --db-instance-identifier maple-prod-postgres \
  --engine postgres \
  --db-instance-class db.m7g.large \
  --allocated-storage 100 \
  --db-subnet-group-name maple-prod-db-subnets \
  --vpc-security-group-ids sg-0mapledb \
  --no-publicly-accessible \
  --storage-encrypted
```

`--db-instance-identifier` names the database instance in RDS. `--engine` selects PostgreSQL in this example. `--db-instance-class` chooses the compute size. `--allocated-storage` sets the initial storage size in GiB. `--db-subnet-group-name` places the database in the approved private database subnets. `--vpc-security-group-ids` attaches the database security group. `--no-publicly-accessible` keeps it off the public internet, and `--storage-encrypted` enables storage encryption.

Real production creation also needs parameter groups, backup windows, maintenance windows, monitoring choices, and secrets handling.

The RDS creation choices shape future work. Engine version controls extension support and upgrade planning. Instance class controls CPU, memory, and connection headroom. Storage type and size control IOPS, throughput, and growth. The DB subnet group controls private placement. The maintenance window controls when approved service work can happen. Infrastructure code should make these choices visible instead of leaving them as console defaults.

## Aurora for AWS-Designed Relational Clusters
<!-- section-summary: Aurora is a MySQL-compatible and PostgreSQL-compatible relational engine with a distributed cluster storage design. -->

**Amazon Aurora** is AWS's relational database engine with MySQL-compatible and PostgreSQL-compatible editions. Aurora uses a cluster design with distributed storage and separate writer and reader endpoints.

Aurora can help when a workload needs relational behavior, managed high availability, and read scaling through replicas. The application still uses MySQL or PostgreSQL-compatible drivers, but the operations model differs from a single RDS instance.

Choose Aurora when the workload benefits from its cluster model, availability features, replica behavior, or performance profile. For small workloads, standard RDS may be simpler and cheaper.

Aurora applications should use the right endpoint. Write traffic uses the writer endpoint. Read-heavy traffic can use a reader endpoint when the application tolerates replica lag. Checkout confirmation often reads from the writer immediately after a write, while dashboards or support views may tolerate a reader. That endpoint choice belongs in application configuration and runbooks.

## Private Access and Credentials
<!-- section-summary: Production relational databases need private network paths, managed secrets, and connection controls before traffic arrives. -->

A production database should sit in private database subnets. The database security group should allow the application security group on the database port. Avoid public accessibility unless there is a reviewed and temporary operational reason.

Credentials should live in a managed secret store such as AWS Secrets Manager. Applications read the secret through their task or instance role. Rotation can be added when the engine, app, and operational process support it.

Connection counts need planning. Web apps can create too many database connections during traffic spikes. Use application pooling, RDS Proxy where it fits, and database limits that match the engine. A connection storm can take down a healthy database.

An application config should name the database endpoint, secret source, and pool limit clearly:

```bash
DATABASE_HOST=orders.cluster-abc123.us-east-1.rds.amazonaws.com
DATABASE_PORT=5432
DATABASE_NAME=orders
DATABASE_SECRET_ARN=arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/orders-db
DATABASE_POOL_MAX=15
```

The app should fetch credentials through its runtime role, create a bounded pool, and fail startup when required settings are missing. That is ordinary code, and it prevents many database incidents.

RDS Proxy can help when many short-lived connections create pressure on the database, especially from Lambda or bursty application fleets. It sits between the application and the database, pools connections, and integrates with Secrets Manager for credentials. The application still needs correct transaction behavior and timeout handling because a proxy cannot repair inefficient SQL or unbounded connection use.

```bash
aws rds describe-db-proxies \
  --db-proxy-name maple-orders-proxy \
  --region us-east-1 \
  --query 'DBProxies[].{Name:DBProxyName,Status:Status,Endpoint:Endpoint,Auth:Auth}'
```

A healthy response is short enough to read during a deploy:

```json
[
  {
    "Name": "maple-orders-proxy",
    "Status": "available",
    "Endpoint": "maple-orders-proxy.proxy-abc123.us-east-1.rds.amazonaws.com",
    "Auth": [
      {
        "AuthScheme": "SECRETS",
        "SecretArn": "arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/orders-db",
        "IAMAuth": "DISABLED"
      }
    ]
  }
]
```

`Status` should be `available` before the application depends on the proxy. `Endpoint` is the hostname the app connects to instead of the database endpoint. `Auth` shows how the proxy is configured to use Secrets Manager or IAM authentication. Empty output usually means the proxy name, account, or Region is wrong.

For a beginner, the key idea is simple: the database has a finite number of connections. Every web worker, Lambda invocation, background job, and admin script can compete for that limit. Pool settings are production configuration, not small code details.

![The private database path shows how app subnet placement, security groups, Secrets Manager, and IAM/KMS permissions protect database access](/content-assets/articles/article-cloud-providers-aws-storage-databases-rds-relational-databases/private-database-path.png)

*The private database path shows how app subnet placement, security groups, Secrets Manager, and IAM/KMS permissions protect database access.*


## Backups, Multi-AZ, and Read Scaling
<!-- section-summary: Availability, historical recovery, and read capacity solve different database problems and need separate design choices. -->

Backups, Multi-AZ, and read replicas solve different problems. Automated backups and point-in-time recovery help restore from mistakes, corruption, or bad deploys. Multi-AZ deployment helps availability when an instance or Availability Zone has a problem. Read replicas help some read-heavy workloads by moving read queries away from the writer.

Write these choices separately in the design review:

- Recovery: point-in-time restore target, backup retention, restore test schedule.
- Availability: Multi-AZ or Aurora cluster design, failover expectations, maintenance window.
- Read scale: replica purpose, query routing, replica lag tolerance.

A backup setting needs a tested restore beside it. Practice restoring into a new database and running validation queries so the team knows the runbook works.

High availability and historical recovery should not be mixed together. Multi-AZ helps the service fail over when infrastructure has a problem. Automated backups and snapshots help restore older data after a bad write, bad deploy, or accidental delete. A bad `delete from orders` can replicate to every live copy, so the restore plan still matters.

A restore drill should have a target and a query. For example, restore the database to a new instance at yesterday 13:00, connect from a private test client, and run a small set of business checks:

```sql
select count(*) from orders where created_at::date = date '2026-06-23';
select status, count(*) from payments group by status;
select max(created_at) from inventory_reservations;
```

The point is to prove that the restored database is usable, not merely that AWS created a new instance. After a restore, the team still needs subnet access, security group access, credentials, parameter settings, and a plan for copying selected data back or switching a test application to the restored database.

## Schema Changes
<!-- section-summary: Safe schema changes use staged migrations so old and new application versions can run during a deployment. -->

Relational databases need safe schema releases. A risky migration can block writes, break old application versions, or hold locks during peak traffic. Treat migrations like production code.

A safer pattern is expand, deploy, backfill, switch, and contract. Add a nullable column first. Deploy code that writes both old and new fields. Backfill in batches. Switch reads after validation. Remove the old column in a later release.

Example first step:

```sql
alter table orders add column fulfillment_status text;
create index concurrently idx_orders_fulfillment_status on orders (fulfillment_status);
```

The exact syntax depends on the engine. PostgreSQL supports `concurrently` for some index operations, while other engines use different online DDL behavior. Always test the migration on production-like data volume.

Backfills need batching. A migration that updates ten million rows in one transaction can create locks, replication lag, table bloat, and a painful rollback. A safer backfill updates small batches, records progress, watches database metrics, and can pause between batches. The application release should tolerate old and new columns during that period.

A production migration ticket should show the exact order:

1. Add backward-compatible schema such as nullable columns or new tables.
2. Deploy code that can read old and new shapes.
3. Backfill in batches with progress logging.
4. Compare old and new values with validation queries.
5. Switch reads after validation.
6. Remove old structures in a later release after rollback risk has passed.

That order protects rolling deployments. During an ECS or Lambda rollout, old and new code may run at the same time for several minutes. The database schema must support both versions during that overlap, or the deployment itself creates the outage.

Slow query work is part of the same operating surface. Enable the engine's supported slow query logging path, review high-latency statements, and add indexes based on real query plans. Adding an index without checking write impact can slow checkout writes, so database changes deserve the same review as application code.

## Operating Checklist
<!-- section-summary: RDS and Aurora solve relational infrastructure operations, while the team still owns schema, queries, access, and releases. -->

Review these items before launch:

- Engine, version, instance or cluster class, and upgrade policy are documented.
- Database subnets are private and spread across Availability Zones.
- Security groups allow only approved application paths.
- Credentials live in Secrets Manager or an approved secret process.
- Connection pooling and max connection behavior are tested.
- Automated backups and restore drills are scheduled.
- Slow query, lock, CPU, memory, storage, and connection metrics have alarms.
- Schema migration rollback and backfill plans are written before release.

RDS and Aurora reduce database infrastructure work. The team still owns database engineering: data correctness, query health, schema releases, and access design.

Useful operating commands include:

```bash
aws rds describe-db-instances \
  --db-instance-identifier maple-prod-postgres \
  --query 'DBInstances[*].{Public:PubliclyAccessible,MultiAZ:MultiAZ,Subnets:DBSubnetGroup.Subnets[*].SubnetIdentifier,Backup:BackupRetentionPeriod}'

aws rds describe-db-snapshots \
  --db-instance-identifier maple-prod-postgres \
  --snapshot-type automated \
  --query 'DBSnapshots[0:3].{Snapshot:DBSnapshotIdentifier,Status:Status,CreateTime:SnapshotCreateTime,Encrypted:Encrypted}'
```

The first command checks whether the database is private, whether Multi-AZ is enabled, which subnets it uses, and how many backup retention days are configured. A healthy production output might look like this:

```json
[
  {
    "Public": false,
    "MultiAZ": true,
    "Subnets": ["subnet-0aaa1111", "subnet-0bbb2222", "subnet-0ccc3333"],
    "Backup": 7
  }
]
```

The second command proves automated snapshots exist and keeps the output to the first few snapshot records:

```json
[
  {
    "Snapshot": "rds:maple-prod-postgres-2026-06-24-04-10",
    "Status": "available",
    "CreateTime": "2026-06-24T04:10:31.123000+00:00",
    "Encrypted": true
  }
]
```

`Public: false` confirms the public access setting. `MultiAZ: true` confirms the availability choice. `Backup: 7` means automated backups are retained for seven days. Snapshot `Status` should be `available` before the team counts on it for restore. If either command returns empty or surprising values, the team should fix the recovery design before trusting the database with production orders.

![The review summary collects backup, Multi-AZ, credentials, schema changes, monitoring, and restore-test evidence for RDS and Aurora](/content-assets/articles/article-cloud-providers-aws-storage-databases-rds-relational-databases/relational-database-review.png)

*The review summary collects backup, Multi-AZ, credentials, schema changes, monitoring, and restore-test evidence for RDS and Aurora.*


## References

- [Amazon RDS documentation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html)
- [Amazon Aurora documentation](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_AuroraOverview.html)
- [Amazon RDS documentation: Backing up and restoring](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_CommonTasks.BackupRestore.html)
- [Amazon RDS documentation: Multi-AZ deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html)
- [AWS Secrets Manager documentation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html)
