---
title: "Relational Databases with RDS and Aurora"
description: "Understand relational state, ACID transactions, managed database responsibilities, RDS and Aurora architecture, private access, backups, Multi-AZ, replicas, schema changes, and scaling."
overview: "Relational databases keep structured shared state correct while many clients read and change it. This article explains how RDS manages familiar engines and how Aurora changes their cloud storage and clustering architecture."
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

1. [Why Does an Application Need a Database?](#why-does-an-application-need-a-database)
2. [What Does Amazon RDS Manage?](#what-does-amazon-rds-manage)
3. [Why Is Aurora Architecturally Different?](#why-is-aurora-architecturally-different)
4. [How Should You Choose RDS or Aurora?](#how-should-you-choose-rds-or-aurora)
5. [How Do Multi-AZ, Read Replicas, and Backups Differ?](#how-do-multi-az-read-replicas-and-backups-differ)
6. [How Should Schema Changes Be Deployed?](#how-should-schema-changes-be-deployed)
7. [How Should You Scale a Relational Database?](#how-should-you-scale-a-relational-database)
8. [What Should You Review Before Production?](#what-should-you-review-before-production)
9. [Check Your Understanding](#check-your-understanding)
10. [References](#references)

The sections below answer these questions in order:

1. **Why Does an Application Need a Database?**
2. **What Does Amazon RDS Manage?**
3. **Why Is Aurora Architecturally Different?**
4. **How Should You Choose RDS or Aurora?**
5. **How Do Multi-AZ, Read Replicas, and Backups Differ?**
6. **How Should Schema Changes Be Deployed?**
7. **How Should You Scale a Relational Database?**
8. **What Should You Review Before Production?**

## Why Does an Application Need a Database?
<!-- section-summary: A database keeps structured shared state correct under queries, concurrent changes, crashes, and business rules rather than merely storing bytes. -->

An order can be encoded as bytes in `orders/8472.json` and stored on EBS or S3. That answers “Where should these bytes live?” Applications soon need harder answers:

- Has the order already been paid?
- Does the referenced customer exist?
- Can two buyers purchase the final item at the same time?
- If checkout crashes halfway, was the customer charged without an order?
- Which paid orders did customer 123 place in the last 30 days?
- How can the system prevent duplicate email registration?

These are state-management questions, not only storage questions. A database adds a data model, queries, indexes, constraints, concurrency control, transactions, crash recovery, and durability above the underlying bytes.

```text
storage: “Preserve these bytes.”

database: “Preserve structured state and its rules
           while many programs read and change it concurrently.”
```

The application shares the database with web servers, workers, administrators, reporting jobs, and new software versions. Central database rules are valuable because correctness does not depend on every caller independently remembering every invariant.

### Why Do Relational Models Fit Transactional Work?
<!-- section-summary: Relational databases model connected entities and enforce constraints and transactions that keep concurrent business state valid. -->

An online shop naturally contains customers, products, orders, order items, and payments. Their relationships can be expressed as tables and references:

```text
Customer 1 ─── many Orders
Order    1 ─── many OrderItems
OrderItem many ─── 1 Product
```

The important property is not that tables resemble spreadsheets. The database understands rules about the rows. A foreign key from `orders.customer_id` to `customers.id` prevents an order from pointing to a nonexistent customer. A unique constraint on `customers.email` prevents duplicate identities. A check constraint can prevent an inventory value from falling below an allowed boundary.

Concurrency makes these rules critical. If inventory is one and Alice and Bob both read it before either writes, both can appear entitled to purchase it. The database needs a transaction and concurrency-control strategy that prevents an invalid final state.

```sql
BEGIN;

-- verify and reserve inventory
-- create order
-- create payment record

COMMIT;
```

**ACID** summarizes important transaction goals:

| Property | Plain meaning |
|---|---|
| Atomicity | All related work commits, or none of it does. |
| Consistency | Defined database invariants remain valid. |
| Isolation | Concurrent work does not arbitrarily interfere. |
| Durability | A committed result survives supported failures. |

Without atomicity, a workflow can charge a card, crash before creating the order, and leave the customer without a recorded purchase. With a correctly designed transaction, related database changes receive one commit boundary.

Relational databases are therefore natural for users, orders, payments, inventory, accounts, subscriptions, reservations, invoices, permissions, and other domains containing structured entities, relationships, invariants, flexible queries, and multi-row transactions.

![The transaction map shows why relational databases fit workflows that need consistent updates across related records](/content-assets/articles/article-cloud-providers-aws-storage-databases-rds-relational-databases/checkout-transaction-map.png)

*The database turns several related row changes into a controlled state transition rather than unrelated byte writes.*

## What Does Amazon RDS Manage?
<!-- section-summary: RDS operates supported relational engine infrastructure while customers retain responsibility for schemas, queries, permissions, capacity, and release design. -->

Running PostgreSQL on EC2 solves the relational state problem and creates a database-infrastructure problem. Someone must install and patch PostgreSQL and the operating system, configure disks, monitor storage and hosts, schedule backups, test restores, replace failed machines, set up replication and failover, plan engine upgrades, and watch CPU, memory, and connections.

**Amazon Relational Database Service (RDS)** manages much of that infrastructure work for supported engines including PostgreSQL, MySQL, MariaDB, Oracle, Microsoft SQL Server, and Db2.

```text
application responsibility
├── data model and schema
├── SQL and indexes
├── transactions and isolation choices
├── database users and permissions
├── capacity selection
├── migration safety
└── connection behavior

RDS-managed infrastructure
├── database host provisioning
├── underlying OS and storage operations
├── supported maintenance and patch processes
├── automated backup machinery
├── monitoring integration
└── supported replacement and failover mechanisms
```

The application still speaks the native database protocol and sends ordinary SQL to an RDS endpoint. It need not discover the physical host or understand how AWS scheduled backup infrastructure.

A basic RDS architecture remains familiar to the application:

```text
application
    ↓ PostgreSQL, MySQL, or another selected engine protocol
RDS endpoint
    ↓
managed database instance
├── engine process
├── CPU and memory
└── managed storage integration
```

The application can issue `SELECT * FROM orders WHERE customer_id = 42` just as it would against the same engine elsewhere. The endpoint is the stable service address; the app should not depend on a physical host. RDS value comes from preserving that engine interface while moving much host, storage, maintenance, backup, and replacement work into a managed service boundary.

RDS removes much database **infrastructure engineering**. It does not remove **database engineering**. A missing index, unsafe migration, poor schema, unbounded connections, inefficient query, or overly broad database user can still damage production.

The useful model is “managed familiar relational engine,” not “a database that AWS designs for you.”

## Why Is Aurora Architecturally Different?
<!-- section-summary: Aurora keeps MySQL or PostgreSQL compatibility while redesigning storage and replication around an AWS-distributed cluster volume. -->

Traditional relational architectures commonly place a database process above attached storage. Replication then copies database changes from a primary with storage A to a replica with storage B.

AWS asked what could change if the durable storage and replication system were designed specifically for cloud infrastructure. **Amazon Aurora** provides MySQL-compatible and PostgreSQL-compatible relational engines while redesigning substantial parts of the underlying system, especially storage. Aurora is managed through the RDS service family and APIs, but it is not simply a larger RDS instance.

The defining idea is separation of compute from a shared distributed cluster volume:

```text
writer compute ─┐
reader compute ─┼──> shared Aurora cluster storage
reader compute ─┘    distributed across multiple AZs
```

The writer and Aurora Replicas access the same distributed durable storage layer rather than each maintaining an entirely independent full database copy in the traditional pattern. Aurora storage is replicated as six copies across three Availability Zones.

This separation matters when adding database compute. If a conventional design needs to copy a 10 TB database before a new replica is useful, replica creation is tied to moving the full dataset. In Aurora, the durable cluster data already exists in the shared storage layer; another compatible compute instance can access it.

```text
conventional idea:
compute A → storage A ── replicate ──> storage B ← compute B

Aurora idea:
compute A ─┐
compute B ─┼──> one distributed cluster volume
compute C ─┘
```

The application still uses familiar MySQL- or PostgreSQL-compatible protocols. The architectural change is mostly below that interface.

### How Do Aurora Writers, Readers, and Endpoints Work?
<!-- section-summary: One writer orders changes, Aurora Replicas serve reads and failover, and logical endpoints hide the current instance topology. -->

Coordinating writes is harder than answering independent reads. Several machines changing the same row need an agreed order and concurrency rules. Aurora’s common cluster design uses one **writer** for inserts, updates, deletes, and data-definition changes.

Read-only work can use **Aurora Replicas**. A cluster can have up to 15 replicas, providing read capacity and eligible failover targets.

```text
writes → writer

reads  ─┬→ reader 1
        ├→ reader 2
        └→ reader 3
```

This illustrates a broad database principle: scaling reads is usually easier than scaling writes because reads do not create a new shared state that every participant must order.

Applications should not hard-code a physical database machine because the writer can change during failover. Aurora exposes logical endpoints:

```text
writer or cluster endpoint → current writer
reader endpoint            → distributes new read connections across readers
```

An application can configure one connection destination for authoritative writes and another for read traffic that tolerates the replica behavior. The endpoint layer follows topology changes, so the application does not need to build its own instance-discovery system.

Endpoint choice still needs application semantics. A request that writes a value and must immediately read the new value may need the writer. A reporting query that tolerates a brief delay can use the reader endpoint.

## How Should You Choose RDS or Aurora?
<!-- section-summary: Standard RDS fits specific familiar engines and conventional managed architectures, while Aurora fits MySQL or PostgreSQL compatibility plus its clustered storage model. -->

The comparison is architectural:

| Question | Standard RDS engine | Aurora |
|---|---|---|
| Core model | AWS operates a familiar relational engine | AWS-designed relational architecture with compatible interface |
| Engines | PostgreSQL, MySQL, MariaDB, Oracle, SQL Server, Db2 | MySQL-compatible or PostgreSQL-compatible |
| Storage shape | More conventional per-instance architecture | Shared distributed cluster volume separated from compute |
| Read scaling | Engine- and deployment-specific read replicas | Aurora Replicas |
| Availability | Supported Multi-AZ deployment options | Replicated cluster storage plus reader promotion |
| Client protocol | Native selected engine | MySQL- or PostgreSQL-compatible |

A rough decision is:

```text
Need a specific traditional engine, version, extension, or compatibility behavior?
→ choose the relevant RDS engine when it satisfies the requirement

Need MySQL/PostgreSQL compatibility and value Aurora’s storage,
reader, failover, or scaling architecture?
→ evaluate Aurora
```

For a small workload, conventional RDS can be simpler or more economical. For another workload, Aurora’s clustered architecture can be the central reason for choosing it. Base the decision on compatibility tests, workload shape, availability and scaling needs, operating model, and cost—not the slogan that Aurora is “for big databases.”

### How Should Applications Reach and Authenticate to the Database?
<!-- section-summary: A secure database path separates private reachability, security-group permission, database authentication, database authorization, and encrypted transport. -->

A production database contains valuable state, so begin with who can reach the endpoint at all. Internet users normally need access to the application, not directly to PostgreSQL or MySQL.

```text
internet → load balancer → private application → private RDS or Aurora endpoint
```

Place the database in approved private subnets and allow its security group only from the expected application security group on the engine port. Then reason through separate layers:

```text
VPC and subnets:       can a route reach the endpoint?
security groups:       is the connection permitted?
database authentication: who is connecting?
database grants:       what SQL operations may that identity perform?
TLS:                   is traffic encrypted and authenticated in transit?
```

AWS control-plane permission and database data-plane permission are not the same. `rds:ModifyDBInstance` can authorize an AWS API operation and does not grant `SELECT * FROM payroll`. AWS IAM governs creation, modification, snapshots, and other resource operations. Database users and roles govern SELECT, INSERT, UPDATE, DELETE, and DDL inside the engine.

Applications commonly keep database passwords in **AWS Secrets Manager** rather than source code or plain configuration. The application’s AWS runtime role retrieves the secret, and the database user receives narrow SQL privileges.

Supported MySQL-family and PostgreSQL-family RDS configurations can also use IAM database authentication, where a short-lived token replaces a long-lived password for the authentication exchange. This does not erase database users or authorization; it changes how a supported identity proves who it is.

The principle is to manage secrets as secrets, give applications least-privilege database roles, and keep administration separate from application data access.

![The private database path shows how app subnet placement, security groups, Secrets Manager, and IAM/KMS permissions protect database access](/content-assets/articles/article-cloud-providers-aws-storage-databases-rds-relational-databases/private-database-path.png)

*Private reachability narrows who can attempt a connection; database identity and grants control what a connected application can do.*

## How Do Multi-AZ, Read Replicas, and Backups Differ?
<!-- section-summary: Multi-AZ targets availability, read replicas target supported read capacity, and backups target recovery of historical state. -->

Three failures require three different tools.

If a database machine fails, the application needs another database host to take over. This is an **availability and failover** problem.

If a healthy writer receives too many SELECT queries, the system needs read capacity. This is a **scaling** problem.

If someone commits `DELETE FROM customers`, every healthy replica can copy the deletion. This is a **historical recovery** problem.

```text
Multi-AZ / failover ≠ read replica ≠ backup
```

Classic RDS Multi-AZ DB instance deployment maintains a primary in one zone and a synchronously replicated standby in another. The standby is primarily a failover target, not a reporting replica.

RDS also offers Multi-AZ DB clusters for supported MySQL and PostgreSQL designs. Those use a writer and two readable instances across three zones, so do not confuse “Multi-AZ DB instance” with “Multi-AZ DB cluster.” Their topologies and read capabilities differ.

Traditional RDS read replicas generally use asynchronous replication. They can serve SELECT and reporting work, but they may briefly lag the primary.

```text
1. application writes new name to primary
2. commit succeeds
3. application immediately reads a replica
4. replica has not applied the change yet
5. application sees the old value
```

The design must distinguish reads that tolerate staleness from reads that require the latest committed state. Aurora’s shared storage commonly keeps Aurora Replica lag much lower, often under 100 ms, but workload affects it and the consistency question remains.

Automated backups protect history. RDS automated backups can support point-in-time recovery within their configured retention period, commonly up to 35 days for ordinary supported configurations. Aurora continuously and incrementally backs up its cluster volume and supports point-in-time recovery within a 1–35 day retention range. Manual snapshots can preserve important states beyond the automated window.

These tools also protect different notions of reliability. **Durability** asks whether a committed transaction survives supported failures. **Availability** asks whether the application can access functioning database compute right now. **Disaster recovery** asks how the service returns after a larger failure boundary. **Logical recovery** asks how to return to a correct state after an accepted but harmful query. A design can have durable files and no reachable database process, or excellent failover that rapidly reproduces a damaging SQL change.

Write each requirement separately rather than labeling all of them “high availability.” The resulting design may need synchronous standby or clustered compute for availability, replicas for read capacity, automated recovery points for recent history, manual snapshots for longer retention, and a cross-Region plan for a broader disaster scenario.

A backup that has never been restored is an assumption. Restore into a separate database, connect through a permitted private path, run business validation queries, and measure whether actual recovery meets RPO and RTO.

### How Does Aurora Separate Storage and Compute Availability?
<!-- section-summary: Aurora’s distributed storage protects database data, while redundant database compute is still required to keep SQL processing available after writer failure. -->

Aurora’s storage can remain distributed and durable while the only writer compute is unavailable. Data surviving is not the same as the SQL endpoint being available.

```text
distributed Aurora storage survives
          ✓
only writer instance fails
          ↓
SQL needs another compute instance to become writer
```

Adding an Aurora Replica provides read capacity and a promotion target. If the writer becomes unavailable, Aurora can promote a suitable replica. The cluster endpoint then follows the new writer.

```text
AZ A writer ─┐
AZ B reader ─┼──> distributed cluster storage

writer fails → reader promoted → writer endpoint follows
```

This leads to a useful separation:

> **Replicated storage protects the data; redundant compute helps keep the data accessible.**

Also separate durability from availability. Durability asks whether committed data survives supported failures. Availability asks whether the application can reach working database compute now. Data can be durable and temporarily unavailable.

Neither redundant compute nor distributed storage protects against a logically valid destructive query. Historical backups remain necessary.

## How Should Schema Changes Be Deployed?
<!-- section-summary: Treat the schema as a shared API and evolve it through backward-compatible expand, migrate, and contract phases. -->

The schema is an API used by every application version and job that talks to the database. During a rolling release, old and new application versions can run together.

Suppose version 1 expects `users(id, name)`, while version 2 wants `first_name` and `last_name`. Dropping `name` before version 1 stops can break live requests.

Use a compatibility sequence:

```text
expand: add new columns while keeping old ones
   ↓
deploy code that understands the expanded shape
   ↓
migrate or backfill existing rows in controlled batches
   ↓
switch reads and validate results
   ↓
contract: remove the old column after no old code depends on it
```

DDL is not automatically harmless. `CREATE INDEX` or `ALTER TABLE` can scan millions of rows, write large volumes, hold locks, increase replica lag, create storage pressure, or block application queries. Safety depends on table size, engine and version, exact operation, active workload, locking behavior, and replication topology.

Test migrations against production-like data. Design batch backfills that record progress and can pause. Keep a rollback-compatible application path until the migration is validated.

For supported engine or infrastructure changes, RDS and Aurora Blue/Green Deployments can create a synchronized staging environment, allow modifications and testing, and then switch over. Blue/green does not remove compatibility work; unsupported or replication-breaking schema changes can still invalidate the workflow.

Even an index creation deserves production-size testing. Depending on engine, version, and exact syntax, it can scan every row, generate substantial I/O and transaction logs, hold locks, raise replica lag, and compete with requests. Record the expected runtime, lock behavior, monitoring signals, abort condition, and rollback path. “It ran quickly on a developer database” says little about a table with hundreds of millions of rows under checkout traffic.

## How Should You Scale a Relational Database?
<!-- section-summary: Find the saturated resource and improve queries, indexes, connection behavior, and schema before assuming more instances solve the problem. -->

Slow SQL flows through parsing and planning, table or index access, CPU and memory, storage I/O, locks, and result transfer. Many bottlenecks can look like “the database is slow”:

```text
inefficient query
missing or unsuitable index
too many scanned rows
CPU saturation
insufficient memory and cache
storage latency or throughput
lock contention or hot rows
too many connections
replica lag
poor schema design
```

Adding read replicas helps a suitable read-bound workload and does not repair a missing index on a write query, a lock hotspot, or writer CPU exhaustion.

For example, `SELECT * FROM orders WHERE customer_id = 728` against 500 million rows may scan far too much data without a supporting index. The correct index can change the work dramatically.

> **Scale the query before scaling the database whenever possible.**

Connections are another finite resource. A stateless compute tier can create hundreds or thousands of processes quickly. Each database connection consumes memory and other engine resources. Ten thousand application instances cannot safely assume the stateful coordinator accepts one large pool from each.

Use bounded application pools, size the total connection budget across replicas and jobs, and consider RDS Proxy when pooling and burst absorption fit the workload. A proxy cannot repair bad SQL, unbounded transactions, or incorrect timeout handling; it manages connection pressure.

Connection pressure creates a characteristic cloud mismatch. A stateless application tier may expand from 20 to 1,000 tasks in minutes. If every task opens a pool of 50 connections, the deployment can request 50,000 sessions from one state coordinator. Pool sizes that seem modest in one process become dangerous when multiplied across autoscaled processes, background workers, migration jobs, and administrator tools.

Budget connections from the database outward. Reserve headroom for operations and failover, divide the remaining capacity among known callers, and test how pools respond when the database endpoint changes. Idle connection lifetime, transaction timeout, retry behavior, and reconnect storms can matter as much as the nominal pool maximum.

Monitor query latency and plans alongside CPU, memory, I/O, free storage, locks, connections, replica lag, and failover events. The correct scale response follows the saturated resource.

### When Is a Relational Database the Right Model?
<!-- section-summary: Relational databases fit structured entities, relationships, constraints, transactions, secondary indexes, and flexible SQL more than every possible data workload. -->

A relational model is compelling when the system contains connected business entities and frequently needs joins, foreign keys, uniqueness, transactions, flexible queries, secondary indexes, and strong correctness rules.

Common examples include banking ledgers, e-commerce orders, SaaS business data, subscription billing, bookings, inventory, ERP and CRM records, and identity or authorization data.

It is not the universal answer. If the primary operation is a known `key → value` lookup at enormous scale, a key-value database may fit. Giant object bytes belong naturally in object storage. Telemetry streams and large analytical datasets may prefer other purpose-built interfaces.

Choose the data model whose fundamental guarantees match the problem. Familiarity with PostgreSQL is useful, but it is not evidence that every byte belongs inside PostgreSQL.

## What Should You Review Before Production?
<!-- section-summary: A production review connects data model, engine, networking, identity, availability, recovery, performance, connections, migrations, and tested failure behavior. -->

Use this checklist:

- Choose relational storage because the workload genuinely needs its relationships, transactions, constraints, and SQL.
- Select the engine deliberately; use RDS when a native traditional engine or feature is required, and evaluate Aurora when its MySQL/PostgreSQL-compatible clustered architecture adds value.
- Put the database on private networking and restrict inbound security-group sources to the real application path.
- Encrypt storage and use TLS for client connections.
- Keep credentials in a managed secret path or use supported IAM database authentication; never hard-code passwords.
- Separate administrative and application users and grant the application only required SQL privileges.
- Configure automated backup retention from recovery objectives, retain longer-lived snapshots when needed, and test restore.
- Choose a Multi-AZ or Aurora topology from required availability, not as a substitute for backup.
- Use replicas only for suitable read workloads and route read-after-write operations according to consistency needs.
- Monitor CPU, memory, storage, I/O, free capacity, connections, locks, query latency, replica lag, and failovers.
- Review query plans and indexes before making the database larger.
- Bound connection pools and test application reconnection after failover.
- Treat migrations as expand → migrate → contract deployments and test large DDL on production-sized data.
- Define explicit RPO and RTO so backup, retention, and failover choices follow business requirements.

```text
application → SQL engine
              ├── tables, queries, indexes
              ├── constraints and transactions
              └── concurrency and recovery
                     ↓
                 durable storage
                  ├── replication → availability
                  └── backups     → recovery
```

RDS operationalizes familiar relational engines. Aurora goes further by separating compatible database compute from AWS-designed distributed cluster storage. In both cases, the team still owns the mutable shared state model: schema, queries, indexes, permissions, migrations, connection behavior, and business correctness.

The three deployment pictures worth retaining are:

```text
Basic RDS:
app → managed familiar database engine → storage

Classic RDS Multi-AZ DB instance:
app → primary ── synchronous replication ──> standby
      standby exists for failover, not ordinary reporting reads

Aurora:
app → writer and readers → one distributed cluster volume
      readers can add read capacity and provide promotion targets
```

Those shapes explain why “RDS,” “Multi-AZ,” and “Aurora” cannot be treated as instance-size labels. They allocate responsibility and data movement differently.

![The review summary collects backup, Multi-AZ, credentials, schema changes, monitoring, and restore-test evidence for RDS and Aurora](/content-assets/articles/article-cloud-providers-aws-storage-databases-rds-relational-databases/relational-database-review.png)

*Managed infrastructure does not replace database engineering; it gives that engineering a managed operational foundation.*

## Check Your Understanding

:::expand[Why Does an Application Need a Database?]{kind="recap"}
A database keeps structured shared state correct under queries, concurrent changes, crashes, and business rules rather than merely storing bytes.

It adds structured models, queries, indexes, constraints, transactions, concurrency control, crash recovery, and durability rules so many programs can share and change application state safely.

Relational databases model connected entities and enforce constraints and transactions that keep concurrent business state valid.

The database is shared by many callers and software versions. Foreign keys, uniqueness, and checks enforce invariants centrally even when a retry, script, worker, or future application code misses a validation rule.

Atomicity gives one commit boundary, consistency preserves defined invariants, isolation controls interference among concurrent transactions, and durability preserves committed results through supported failures.
:::

:::expand[What Does Amazon RDS Manage?]{kind="recap"}
RDS operates supported relational engine infrastructure while customers retain responsibility for schemas, queries, permissions, capacity, and release design.
:::

:::expand[Why Is Aurora Architecturally Different?]{kind="recap"}
Aurora keeps MySQL or PostgreSQL compatibility while redesigning storage and replication around an AWS-distributed cluster volume.

MySQL- or PostgreSQL-compatible compute instances attach to one distributed shared cluster volume replicated across Availability Zones, separating the database compute layer from durable storage.

One writer orders changes, Aurora Replicas serve reads and failover, and logical endpoints hide the current instance topology.

Writes to shared mutable state need coordinated ordering and concurrency control. Read replicas can answer independent queries more easily because they do not decide a new state.

The writer or cluster endpoint follows the active writer, while the reader endpoint distributes new read connections among available readers. Applications use logical roles instead of hard-coding machines.
:::

:::expand[How Should You Choose RDS or Aurora?]{kind="recap"}
Standard RDS fits specific familiar engines and conventional managed architectures, while Aurora fits MySQL or PostgreSQL compatibility plus its clustered storage model.

A secure database path separates private reachability, security-group permission, database authentication, database authorization, and encrypted transport.
:::

:::expand[How Do Multi-AZ, Read Replicas, and Backups Differ?]{kind="recap"}
Multi-AZ targets availability, read replicas target supported read capacity, and backups target recovery of historical state.

Multi-AZ provides failover availability, replicas add eligible read capacity and sometimes failover targets, and backups preserve historical state for recovery after destructive or corrupt changes.

Asynchronous replication can apply a committed primary change after a delay. The application must route reads that require the latest write to an authoritative path.

Aurora’s distributed storage protects database data, while redundant database compute is still required to keep SQL processing available after writer failure.

IAM can authorize RDS resource operations such as modify or snapshot. Database users and grants authorize SQL operations such as SELECT or UPDATE. One does not automatically grant the other.

The data can survive while SQL compute is unavailable. A reader or other eligible compute target must be promoted so the application has a working writer endpoint again.
:::

:::expand[How Should Schema Changes Be Deployed?]{kind="recap"}
Treat the schema as a shared API and evolve it through backward-compatible expand, migrate, and contract phases.

Add backward-compatible structures, deploy code that works with old and new forms, backfill and validate data, switch behavior, then remove old structures only after no old client depends on them.
:::

:::expand[How Should You Scale a Relational Database?]{kind="recap"}
Find the saturated resource and improve queries, indexes, connection behavior, and schema before assuming more instances solve the problem.

A missing index, poor plan, lock hotspot, or excessive scan can waste any added capacity. Identify the saturated resource and reduce unnecessary work before adding infrastructure.

Relational databases fit structured entities, relationships, constraints, transactions, secondary indexes, and flexible SQL more than every possible data workload.
:::

:::expand[What Should You Review Before Production?]{kind="recap"}
A production review connects data model, engine, networking, identity, availability, recovery, performance, connections, migrations, and tested failure behavior.

The team still owns engine selection, schemas, SQL, indexes, transaction behavior, database users, connection pools, capacity choices, migrations, query performance, and application correctness.
:::

## References

- [Amazon RDS API overview](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/Welcome.html)
- [What is Amazon Aurora?](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_AuroraOverview.html)
- [Amazon Aurora DB clusters](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Overview.html)
- [Aurora high availability](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.AuroraHighAvailability.html)
- [Aurora reader endpoints](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Endpoints.Reader.html)
- [RDS public and private access](https://docs.aws.amazon.com/AmazonRDS/latest/gettingstartedguide/security-public-private.html)
- [RDS database authentication](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/database-authentication.html)
- [RDS Multi-AZ DB instances](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html)
- [RDS Multi-AZ DB clusters](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/multi-az-db-clusters-concepts.html)
- [RDS read replicas](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html)
- [Aurora replication](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Replication.html)
- [RDS automated backup retention](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.BackupRetention.html)
- [Aurora backup storage](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-storage-backup.html)
- [RDS Blue/Green Deployments](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/blue-green-deployments-overview.html)
- [Aurora blue/green best practices](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/blue-green-deployments-best-practices.html)
