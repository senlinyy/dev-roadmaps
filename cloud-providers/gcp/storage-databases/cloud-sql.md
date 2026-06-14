---
title: "Cloud SQL"
description: "Use Cloud SQL for transactional relational data: tables, transactions, private connectivity, connection pooling, migrations, backups, HA, and point-in-time recovery."
overview: "Cloud SQL gives Google Cloud applications a managed PostgreSQL, MySQL, or SQL Server database for records that need strict relationships and transactions. This article follows an Orders API from schema design through connections, migrations, backups, high availability, and recovery."
tags: ["gcp", "cloud-sql", "databases", "relational", "postgres"]
order: 3
id: article-cloud-providers-gcp-storage-databases-cloud-sql-relational-databases
aliases:
  - cloud-sql-and-relational-databases
  - cloud-sql-relational-databases
  - cloud-providers/gcp/storage-databases/cloud-sql-and-relational-databases.md
---

## Table of Contents

1. [Why Orders Need a Relational Database](#why-orders-need-a-relational-database)
2. [Instances, Engines, and First Setup](#instances-engines-and-first-setup)
3. [Tables, Keys, and Transactions](#tables-keys-and-transactions)
4. [Private Connectivity and Authentication](#private-connectivity-and-authentication)
5. [Connection Pooling for Cloud Run and GKE](#connection-pooling-for-cloud-run-and-gke)
6. [Schema Migrations Without Taking Checkout Down](#schema-migrations-without-taking-checkout-down)
7. [Backups, PITR, and High Availability](#backups-pitr-and-high-availability)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## Why Orders Need a Relational Database
<!-- section-summary: Cloud SQL fits business records that need strict relationships, transactions, and recovery controls. -->

Cloud SQL is Google Cloud's managed relational database service. It runs familiar database engines for you: **PostgreSQL**, **MySQL**, and **SQL Server**. Google handles much of the operational work around database VMs, maintenance, backups, network integration, monitoring hooks, and high availability options, while your team still owns the schema, queries, credentials, migrations, and recovery plan.

Let's use one service for the whole article: an **Orders API** for an online shop. A checkout request has several pieces that must agree with each other. The API needs a customer, an order, line items, inventory changes, a payment attempt, and an audit trail that support teams can inspect later.

That shape gives us a good reason to use a relational database. A **relational database** stores data in tables, and tables can reference each other with keys. For example, one row in `orders` can point to one row in `customers`, and several rows in `order_items` can point back to that order. The database can enforce those relationships so the application does not quietly create line items for an order that no longer exists.

A relational database also gives the Orders API **transactions**. A transaction groups several reads and writes into one unit of work. In checkout, that means the API can reserve inventory, create the order, store the line items, and record the payment attempt as one coordinated change. If the payment insert fails, the database can roll the whole unit back instead of leaving inventory reserved with no order.

This is the first split to keep clear. Cloud SQL fits records where correctness depends on relationships, constraints, and multi-row transactions. Firestore, the next article, fits document-shaped app state where the application usually reads and writes one document or a small document group by a known path or planned query.

Here is the simple path we will follow:

| Question | Cloud SQL answer in the Orders API |
|---|---|
| Which database engine should we run? | PostgreSQL for this example, with MySQL and SQL Server as Cloud SQL options |
| How do we keep records consistent? | Tables, keys, constraints, and transactions |
| How does the app reach the database? | Private IP or Private Service Connect, plus direct connections or Cloud SQL connectors |
| How do we survive traffic spikes? | Small app pools, bounded Cloud Run scale, and a pooler where the workload needs one |
| How do we change schema safely? | Expand-and-contract migrations with lock and statement timeouts |
| How do we recover from mistakes? | Backups, point-in-time recovery, restore drills, and HA for zonal failures |

So we start with the thing your team creates first: the Cloud SQL instance.

## Instances, Engines, and First Setup
<!-- section-summary: A Cloud SQL instance runs one managed database engine, and the first setup choices shape reliability, cost, and network access. -->

A **Cloud SQL instance** is the managed database server boundary. In practical terms, it is the thing with a name like `orders-prod`, a region like `us-central1`, a database engine like PostgreSQL 16, CPU and memory sizing, storage settings, backup settings, and network settings. Your application connects to databases inside that instance, and Google Cloud operates the underlying infrastructure around it.

For our Orders API, PostgreSQL is a strong default because it has excellent transaction behavior, mature indexing, good JSON support for small flexible fields, and a large ecosystem of migration and operational tools. A team already standardized on MySQL can use Cloud SQL for MySQL. A team moving a .NET system that depends on SQL Server features can use Cloud SQL for SQL Server. Cloud SQL gives these engines a managed Google Cloud home, but the engine choice still matters because SQL syntax, extensions, locking behavior, and operational habits differ.

The first setup should answer a few boring questions before anyone writes application code. Which region keeps the database close to the app? Which tier has enough CPU and memory for the expected workload? Should the instance use high availability from day one? Should it expose only private connectivity? Which backup retention and recovery window meet the business requirement?

A small production PostgreSQL instance for the Orders API might start like this:

```bash
gcloud services enable sqladmin.googleapis.com servicenetworking.googleapis.com

gcloud sql instances create orders-prod \
  --database-version=POSTGRES_16 \
  --region=us-central1 \
  --tier=db-custom-2-7680 \
  --availability-type=REGIONAL \
  --storage-type=SSD \
  --storage-size=100GB

gcloud sql databases create orders \
  --instance=orders-prod

gcloud sql users set-password postgres \
  --instance=orders-prod \
  --password='use-a-real-secret-from-your-secret-workflow'
```

The exact tier and storage size depend on the workload. A production team usually chooses a conservative starting point, turns on query monitoring, watches CPU, memory, disk, connection count, lock waits, and slow queries, then resizes with evidence. The database tier costs real money, so guessing too high wastes budget, and guessing too low turns checkout into the first load test.

Terraform gives teams a better production path because the instance configuration goes through code review. This example keeps the important settings visible: PostgreSQL, regional availability, private networking, backups, PITR, and deletion protection.

```hcl
resource "google_compute_network" "orders" {
  name                    = "orders-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_global_address" "private_services" {
  name          = "orders-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.orders.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.orders.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
}

resource "google_sql_database_instance" "orders" {
  name             = "orders-prod"
  region           = "us-central1"
  database_version = "POSTGRES_16"

  deletion_protection = true

  settings {
    tier              = "db-custom-2-7680"
    availability_type = "REGIONAL"
    disk_type         = "PD_SSD"
    disk_size         = 100

    backup_configuration {
      enabled                        = true
      start_time                     = "03:00"
      point_in_time_recovery_enabled = true
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.orders.id
    }
  }

  depends_on = [google_service_networking_connection.private_services]
}

resource "google_sql_database" "orders" {
  name     = "orders"
  instance = google_sql_database_instance.orders.name
}
```

Notice what Terraform does for the team. It makes the private services range, private services access connection, instance settings, and database creation part of the same reviewed change. That reduces the chance that someone creates a public database in the console because they only needed to get a demo working.

Instance setup gives us a running database. The next question is what shape the Orders API should put inside it.

## Tables, Keys, and Transactions
<!-- section-summary: Tables model the business facts, keys connect those facts, and transactions protect checkout from partial writes. -->

A **table** stores rows of one kind of thing. A `customers` table stores customers. An `orders` table stores orders. An `order_items` table stores the product lines inside each order. This sounds obvious, but it matters because table boundaries turn business rules into database checks that run every time code writes data.

The Orders API needs a few core tables before it handles real checkout traffic:

```sql
CREATE TABLE customers (
  customer_id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  product_id uuid PRIMARY KEY,
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  stock_count integer NOT NULL CHECK (stock_count >= 0)
);

CREATE TABLE orders (
  order_id uuid PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES customers(customer_id),
  status text NOT NULL CHECK (status IN ('pending', 'paid', 'cancelled')),
  total_cents integer NOT NULL CHECK (total_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  order_id uuid NOT NULL REFERENCES orders(order_id),
  product_id uuid NOT NULL REFERENCES products(product_id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
  PRIMARY KEY (order_id, product_id)
);

CREATE TABLE payment_attempts (
  payment_attempt_id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(order_id),
  provider text NOT NULL,
  provider_reference text NOT NULL,
  status text NOT NULL CHECK (status IN ('authorized', 'declined', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

There are three important ideas in that schema. A **primary key** uniquely identifies one row. A **foreign key** says one row must point to a real row somewhere else. A **check constraint** blocks values that violate a local rule, such as negative inventory or an unknown order status.

Those constraints turn the database into a second line of defense. The application should still validate input and return friendly errors, but the database stops bad writes if a bug, a retry, or a one-off script slips through. In production, this saves teams from long cleanup projects where invalid records sit quietly for months.

The checkout flow also needs a transaction. The Orders API has to read inventory, reduce stock, create the order, add line items, and record the payment attempt. A simple PostgreSQL transaction can look like this:

```sql
BEGIN;

SELECT stock_count
FROM products
WHERE product_id = '5f7f9dd4-7f67-4a1e-a99a-8a9d4f5a9c11'
FOR UPDATE;

UPDATE products
SET stock_count = stock_count - 2
WHERE product_id = '5f7f9dd4-7f67-4a1e-a99a-8a9d4f5a9c11'
  AND stock_count >= 2;

INSERT INTO orders (order_id, customer_id, status, total_cents)
VALUES (
  '4543c620-94e6-4d58-8d24-a0dd53632e6d',
  'f2ef2d3d-89c7-4b6e-bb8f-730881d6a752',
  'pending',
  4998
);

INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents)
VALUES (
  '4543c620-94e6-4d58-8d24-a0dd53632e6d',
  '5f7f9dd4-7f67-4a1e-a99a-8a9d4f5a9c11',
  2,
  2499
);

INSERT INTO payment_attempts (
  payment_attempt_id,
  order_id,
  provider,
  provider_reference,
  status
)
VALUES (
  '9bf3c8f0-c813-4e2f-86cc-bf1bd0f6d7b1',
  '4543c620-94e6-4d58-8d24-a0dd53632e6d',
  'stripe',
  'pi_3QxExample',
  'authorized'
);

COMMIT;
```

The `FOR UPDATE` part matters. It asks PostgreSQL to lock the selected product row for the duration of the transaction. If two people try to buy the last unit at the same time, one transaction holds the row while the other waits. The application should still check that the `UPDATE` affected a row; if `stock_count >= 2` matched nothing, the app rolls back and returns an out-of-stock response.

In application code, the transaction boundary should sit around database work only. The Orders API should authorize the payment before the final commit or store a payment attempt that a background worker reconciles later, depending on the business flow. It should avoid charging a card inside a database transaction callback that may retry, because a database retry should never create a duplicate external side effect.

Now the database can protect the records. The next problem is how the Orders API reaches it without putting the database on the open internet.

## Private Connectivity and Authentication
<!-- section-summary: Cloud SQL network access and database login solve different problems, so production systems configure both deliberately. -->

**Private connectivity** means the application reaches Cloud SQL through a private path instead of connecting to a public database endpoint. For Cloud SQL, private IP uses **private services access**, which connects your VPC network to the Google-managed service producer network where Cloud SQL resources live. Google Cloud also supports **Private Service Connect** for patterns where multiple VPCs, projects, or organizations need a private endpoint style.

The Orders API runs on Cloud Run in our scenario. If Cloud SQL uses private IP, Cloud Run needs a path into the VPC, such as **Direct VPC egress** or a Serverless VPC Access connector. From there, the app can connect to the database's private address, and the database can run with no public IP.

This setup has three separate layers:

| Layer | What it answers | Orders API example |
|---|---|---|
| Network path | Can packets reach the database endpoint? | Cloud Run uses Direct VPC egress to the VPC connected to Cloud SQL private IP |
| Cloud IAM connection permission | Can this service account connect through Cloud SQL tooling? | The service account has `roles/cloudsql.client` when it uses the Auth Proxy or a language connector |
| Database login and privileges | Which database user can run SQL? | `orders_app` can read and write order tables, while migration users can change schema |

Private IP setup with `gcloud` often starts with the one-time private services access connection:

```bash
gcloud compute addresses create orders-private-services \
  --global \
  --purpose=VPC_PEERING \
  --prefix-length=16 \
  --network=orders-vpc

gcloud services vpc-peerings connect \
  --service=servicenetworking.googleapis.com \
  --ranges=orders-private-services \
  --network=orders-vpc

gcloud sql instances patch orders-prod \
  --network=orders-vpc \
  --no-assign-ip
```

The private services range needs enough room for Cloud SQL and other Google-managed services that may use the same private services access design. A tiny range can create future network work at the worst time, so teams usually reserve a larger range early and document who owns it.

Cloud SQL offers two broad connection styles. A **direct connection** uses the database endpoint directly, often over private IP with SSL/TLS configured by the team. A **Cloud SQL connector** means the Cloud SQL Auth Proxy or a language connector handles secure connection setup, IAM checks, and certificate handling for the application. Google recommends private IP for improved security unless the client has a specific public access requirement, and connectors help especially when the client uses public IP, dynamic egress addresses, or IAM database authentication.

For local troubleshooting, the Cloud SQL Auth Proxy gives an engineer a safe short path to the instance:

```bash
gcloud auth application-default login

cloud-sql-proxy PROJECT_ID:us-central1:orders-prod \
  --private-ip \
  --port=5432

psql "host=127.0.0.1 port=5432 dbname=orders user=orders_app sslmode=disable"
```

That local `psql` command connects to the proxy listener on the engineer's machine. The proxy then connects to Cloud SQL using the engineer's Google credentials and the instance connection name. The database still requires a database user, so the proxy removes the network and certificate burden but does not replace database privileges.

For Cloud Run, the service account needs the right IAM role when you use Cloud SQL connectors:

```bash
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:orders-api@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"
```

Database privileges should stay narrow. The application user should not own the schema, drop tables, create extensions, or grant privileges. A separate migration identity can hold schema-change permissions, and an operations identity can hold read-only inspection permissions.

```sql
CREATE ROLE orders_app LOGIN PASSWORD 'store-this-in-secret-manager';
CREATE ROLE orders_readonly LOGIN PASSWORD 'store-this-in-secret-manager-too';

GRANT CONNECT ON DATABASE orders TO orders_app, orders_readonly;
GRANT USAGE ON SCHEMA public TO orders_app, orders_readonly;

GRANT SELECT, INSERT, UPDATE ON customers, products, orders, order_items, payment_attempts TO orders_app;
GRANT SELECT ON customers, products, orders, order_items, payment_attempts TO orders_readonly;
```

Some teams use **IAM database authentication** so Google Cloud IAM users or service accounts can log in to the database with short-lived tokens instead of normal passwords. That can centralize access for humans and automation, but the database still needs privileges granted to the resulting database identities. IAM answers who may log in through Google Cloud, and SQL grants answer what that database identity may do after login.

Now the Orders API can reach the database securely. The next production issue arrives when traffic spikes and every app instance opens too many sessions.

## Connection Pooling for Cloud Run and GKE
<!-- section-summary: Relational databases have finite connection capacity, so elastic app platforms need small pools, scale limits, and sometimes a pooler. -->

A **database connection** is a live session between an application process and the database engine. Each session consumes memory, file descriptors, scheduler work, and engine-specific resources. Cloud SQL also has connection limits that the application cannot exceed, so connection count is a real production capacity number, not just a driver detail.

Serverless and Kubernetes platforms can scale the Orders API faster than the database can accept new sessions. Imagine Cloud Run scales to 80 instances during a sale, and each instance opens a pool of 10 PostgreSQL connections. That one service can now try to hold 800 database sessions before workers, admin tools, migration jobs, and dashboards connect.

The first fix lives in the application pool. A pool should stay small, have a timeout, and match the platform's max instance count. This Node.js example uses `pg` with a bounded pool:

```javascript
import pg from "pg";

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? "5432"),
  database: "orders",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: Number(process.env.DB_POOL_MAX ?? "5"),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

export async function createOrder(handler) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
```

That `max` value means one app instance can hold up to five database sessions. If Cloud Run allows 40 instances, the service can hold up to 200 sessions before any other workload connects. This kind of math should appear in the service runbook because a future autoscaling change can break the database without changing one line of SQL.

The platform should also carry an explicit scale boundary:

```bash
gcloud run services update orders-api \
  --region=us-central1 \
  --max-instances=40
```

The right `--max-instances` value depends on request concurrency, database tier, query duration, and pool size. If the Orders API needs more throughput, the team can tune SQL, reduce transaction duration, add read paths that do not hit the primary, increase the database tier, introduce a pooler, or split workloads. Simply raising app scale can turn a database bottleneck into a wider outage.

Cloud SQL for PostgreSQL also has **Managed Connection Pooling** for supported Enterprise Plus instances. It helps workloads with many short-lived connections or connection surges by pooling at transaction or session level. Transaction pooling can improve connection scaling, but it restricts some session-level SQL behavior, so teams should test features like prepared statements, session settings, advisory locks, and temporary tables before enabling it for a production workload.

Self-managed PgBouncer remains common when teams need a pooler with direct control. PgBouncer can run beside the application on GKE, as a small internal service, or in another controlled deployment pattern. The main lesson stays the same: the app should not treat Cloud SQL as an infinite socket target.

Connection pooling keeps the runtime stable. The next source of outages comes from schema changes, because every version of the Orders API shares one database schema.

## Schema Migrations Without Taking Checkout Down
<!-- section-summary: Safe migrations split schema changes into small compatible steps so old and new application versions can run together. -->

A **schema migration** changes the structure of the database. It can add a column, create an index, add a constraint, rename a table, or remove a field that old code still reads. Application code can roll out one container at a time, but the database schema is shared state. That shared state makes migration planning part of application deployment.

Let's say the product team wants to track the checkout channel: `web`, `ios`, `android`, or `support_agent`. A risky deployment adds a required column and immediately deploys code that assumes it always exists. If old containers still run, new containers start at different times, or the migration locks a hot table, checkout can fail for real customers.

The safer pattern is **expand and contract**. In the expand phase, the database accepts both old and new application versions. In the middle, the application writes both shapes or reads with a fallback. In the contract phase, the team removes the old shape only after the fleet no longer depends on it.

For PostgreSQL on a busy order table, the migration runner should use timeouts so a schema change cannot wait behind active queries and block new traffic for a long time:

```sql
SET lock_timeout = '2s';
SET statement_timeout = '30s';

ALTER TABLE orders
ADD COLUMN checkout_channel text;
```

This migration adds a nullable column. That keeps old and new code compatible. Old code ignores the column, and new code can write it. The application should use a safe fallback while old rows still have `NULL`:

```sql
SELECT
  order_id,
  customer_id,
  COALESCE(checkout_channel, 'web') AS checkout_channel
FROM orders
WHERE order_id = $1;
```

Then a background job can backfill old rows in batches. Batches keep transactions short and reduce lock pressure, replication pressure, and undo work.

```sql
WITH batch AS (
  SELECT order_id
  FROM orders
  WHERE checkout_channel IS NULL
  ORDER BY created_at
  LIMIT 500
)
UPDATE orders
SET checkout_channel = 'web'
WHERE order_id IN (SELECT order_id FROM batch);
```

After the backfill, the team can add and validate a constraint:

```sql
ALTER TABLE orders
ADD CONSTRAINT orders_checkout_channel_known
CHECK (checkout_channel IN ('web', 'ios', 'android', 'support_agent')) NOT VALID;

ALTER TABLE orders
VALIDATE CONSTRAINT orders_checkout_channel_known;
```

This sequence gives reviewers more than a SQL file. It gives them an operational plan: deploy migration one, deploy app version one, run a measured backfill, validate the constraint, then remove fallback code later. It also gives rollback room. If the first app deploy has a bug, old code can still run because the column addition did not force an immediate contract.

Indexes deserve the same care. A new query for the order history page may need an index on `(customer_id, created_at DESC)`. PostgreSQL can build an index concurrently so normal reads and writes can continue during the build, although the build takes longer and has its own rules.

```sql
CREATE INDEX CONCURRENTLY orders_customer_created_at_idx
ON orders (customer_id, created_at DESC);
```

The Orders API now has a safer way to change shape while traffic keeps flowing. But even careful teams still delete rows by mistake, ship bugs, or lose a zone. That takes us to recovery.

## Backups, PITR, and High Availability
<!-- section-summary: Backups recover from data mistakes, PITR recovers to a timestamp, and HA reduces downtime during zonal failure. -->

**Backups** protect the database from data loss caused by mistakes, corruption, and operational incidents. Cloud SQL supports on-demand backups and automated backups. Backups are incremental and encrypted, and teams can use them to restore a database to a previous state, create a new instance for testing, or support disaster recovery work.

The Orders API should take an on-demand backup before risky operations, such as a large migration or a manual data repair:

```bash
gcloud sql backups create \
  --instance=orders-prod
```

Automated backups should already run on a schedule. The backup window should avoid the busiest checkout period where possible, and retention should match the business requirement. A store that needs to investigate payment disputes for weeks has a different retention need from a short-lived staging system.

**Point-in-time recovery**, usually shortened to **PITR**, lets the team restore a primary Cloud SQL instance to a specific timestamp. This matters when the failure is logical instead of physical. If a bad admin script cancels every open order at 10:17 UTC, restoring yesterday's backup loses too much valid data. A PITR clone can restore to a timestamp just before the bad write.

```bash
gcloud sql instances clone orders-prod \
  orders-prod-restore-20260614 \
  --point-in-time="2026-06-14T10:16:30Z"
```

The recovery drill should not stop at creating the clone. The team needs to verify the data, decide whether to fail the application over to the restored instance, copy selected rows back, or rebuild affected records through an application repair job. A restore that no one has practiced is only a hope with a command attached to it.

**High availability**, or **HA**, handles a different failure class. A regional Cloud SQL instance uses a primary instance and a standby in another zone. If the primary instance or zone stops responding, Cloud SQL can fail over so the standby serves data through the shared instance address. Google documents that failover usually creates a short unavailability window, so the application should retry connections with exponential backoff instead of hammering the database.

```javascript
const retryDelaysMs = [250, 500, 1000, 2000, 5000];

export async function withConnectionRetry(operation) {
  let lastError;

  for (const delay of retryDelaysMs) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
```

HA and backups solve different problems. HA helps when an instance or zone fails and the application needs the primary database role back quickly. Backups and PITR help when the data itself is wrong and the team needs to restore or inspect an earlier state. Read replicas solve yet another problem: they can help with read scale or recovery patterns, but they use replication and can lag behind the primary.

Production teams usually write a short recovery runbook for each case:

| Incident | First move | Recovery path |
|---|---|---|
| Bad deploy writes wrong order status | Stop the writer and preserve evidence | PITR clone, compare rows, repair or fail over |
| Large migration causes lock waits | Cancel migration and keep app serving | Retry with smaller steps, timeouts, or a lower-traffic window |
| Primary zone fails | Let HA failover complete and watch app retries | Verify connection recovery, review logs, and open an incident review |
| Analyst needs production-like data | Restore backup into isolated instance | Mask sensitive fields before broad access |

This is where Cloud SQL stops feeling like "just a database" and starts looking like an operational system. The SQL engine protects transactions, the network keeps traffic private, the pool protects capacity, migrations protect availability, and recovery tools protect the business when humans and infrastructure have a bad day.

## Putting It All Together
<!-- section-summary: A production Cloud SQL design connects schema, access, pooling, migrations, and recovery into one operating path. -->

Let's walk through the Orders API one more time, end to end. A customer submits checkout to Cloud Run. The Orders API reaches Cloud SQL through a private path, authenticates through the configured connection method, checks out a small connection from the pool, starts a transaction, locks the product row, writes the order records, commits, and releases the connection.

The database schema supports that flow with tables, primary keys, foreign keys, and constraints. Those rules keep records connected even when application code changes over time. Transactions keep a checkout from landing halfway, and short transactions keep the database responsive during normal traffic.

The runtime design supports the same flow from the outside. Cloud Run has a max instance boundary, the app pool has a small maximum, and the team can add Managed Connection Pooling or PgBouncer when connection surges justify it. The database remains finite, so the application treats connection count as capacity planning instead of background noise.

The deployment design protects releases. Schema changes expand first, application versions roll out with compatibility, background jobs backfill in small batches, constraints validate later, and contract steps wait until old code no longer needs the old shape. Migration timeouts keep one DDL statement from turning into a checkout outage.

The recovery design closes the loop. Automated backups and on-demand backups protect restore points. PITR clones support timestamp recovery after bad writes. HA reduces downtime for zonal failures, while application retry logic gives failover room to complete. Together, those pieces make Cloud SQL a reliable place for the records the business cannot afford to guess about.

## What's Next

Cloud SQL is a strong home for relational records: orders, payments, inventory, invoices, account ledgers, subscriptions, and anything else where relationships and transactions carry the business truth. The tradeoff is that relational shape asks you to plan schemas, migrations, indexes, and connection capacity with care.

The next article moves to Firestore. We will keep the checkout theme, but we will shift from finalized order records to document-shaped state like checkout drafts, user preferences, and app session data.

---

**References**

- [Cloud SQL overview](https://cloud.google.com/sql/docs/introduction) - Defines Cloud SQL as a managed relational database service for MySQL, PostgreSQL, and SQL Server, and lists managed operations such as backups, HA, connectivity, maintenance, monitoring, and logging.
- [Choose how to connect to Cloud SQL](https://cloud.google.com/sql/docs/mysql/connection-options) - Explains private IP recommendations, direct connections, Cloud SQL connectors, public IP, authorized networks, and IAM database authentication choices.
- [Learn about using private IP](https://cloud.google.com/sql/docs/mysql/private-ip) - Documents private services access, allocated IP ranges, Shared VPC notes, and private IP requirements for Cloud SQL.
- [Connect from Cloud Run to Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres/connect-run) - Describes Cloud Run connection setup, region guidance, Cloud SQL Admin API setup, and private IP egress options.
- [About the Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/mysql/sql-proxy) - Explains how the Auth Proxy establishes authorized, encrypted connections to Cloud SQL instances.
- [Log in using IAM database authentication for PostgreSQL](https://cloud.google.com/sql/docs/postgres/iam-logins) - Documents IAM database authentication, required IAM roles, connector behavior, and database privilege requirements.
- [Manage database connections for Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres/manage-connections) - Covers connection limits, pool sizing examples, and exponential backoff guidance.
- [Managed Connection Pooling overview](https://cloud.google.com/sql/docs/postgres/managed-connection-pooling) - Documents Cloud SQL Managed Connection Pooling requirements, pool modes, ports, defaults, and limitations.
- [Create Cloud SQL for PostgreSQL instances](https://cloud.google.com/sql/docs/postgres/create-instance) - Shows `gcloud` and Terraform-based instance creation patterns.
- [Cloud SQL backups overview for PostgreSQL](https://cloud.google.com/sql/docs/postgres/backup-recovery/backups) - Documents on-demand and automated backups, incremental backups, encryption, retention, and restore use cases.
- [Perform point-in-time recovery for PostgreSQL](https://cloud.google.com/sql/docs/postgres/backup-recovery/pitr) - Shows PITR restore options and the `gcloud sql instances clone --point-in-time` flow.
- [About high availability in Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres/high-availability) - Explains HA failover behavior, standby instances, failover process, and application availability considerations.
