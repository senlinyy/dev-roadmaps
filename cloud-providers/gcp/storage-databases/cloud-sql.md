---
title: "Cloud SQL"
description: "Use Cloud SQL for relational records that need transactions, private connectivity, connection pooling, migrations, backups, high availability, and restore practice."
overview: "Cloud SQL gives Google Cloud applications a managed relational database for records with relationships and coordinated writes. The guide follows seat reservations through engines, instances, databases, tables, transactions, private access, pooling, migrations, backups, and HA."
tags: ["gcp", "cloud-sql", "databases", "relational", "postgres"]
order: 3
id: article-cloud-providers-gcp-storage-databases-cloud-sql-relational-databases
aliases:
  - cloud-sql-and-relational-databases
  - cloud-sql-relational-databases
  - cloud-providers/gcp/storage-databases/cloud-sql-and-relational-databases.md
---

## Table of Contents

1. [Why Related Records Need Cloud SQL](#why-related-records-need-cloud-sql)
2. [Relational Databases](#relational-databases)
3. [Instances, Engines, Databases, and Tables](#instances-engines-databases-and-tables)
4. [Transactions](#transactions)
5. [Private Connectivity](#private-connectivity)
6. [Connection Pooling](#connection-pooling)
7. [Migrations](#migrations)
8. [Backups and High Availability](#backups-and-high-availability)
9. [Putting It Together](#putting-it-together)
10. [References](#references)

## Why Related Records Need Cloud SQL
<!-- section-summary: Cloud SQL fits records where relationships, rules, and coordinated writes matter to the business. -->

Imagine a venue reservation app. A customer chooses two seats, starts payment, and expects those seats to stay reserved only if the payment flow succeeds. The app needs to update seats, reservations, payment attempts, and audit records as one controlled piece of work.

Those records have relationships. A reservation belongs to a customer and an event. A reservation has seats. A payment belongs to a reservation. A refund points back to the payment. The application needs rules that keep those records consistent even if two users click the same seat at nearly the same time.

That is the reason a relational database enters the design. The app is not only saving information; it is protecting rules between pieces of information. Two customers should not receive the same seat. A payment should not point to a reservation that does not exist. A refund should point back to the original payment. Those relationships are business rules, and the database can enforce them close to the data.

Cloud SQL gives the team a managed place for those relational rules. Google Cloud operates the managed database service around the engine, and your team still designs the schema, transactions, indexes, migration process, connection behavior, and recovery plan. The service removes server-building work, but it does not remove database-design work.

**Cloud SQL** is Google Cloud's managed relational database service for PostgreSQL, MySQL, and SQL Server. It gives your app a relational database without asking your team to build and patch database servers from scratch. Your team still owns schema design, queries, indexes, migrations, credentials, connection behavior, backups, and restore drills.

![Cloud SQL checkout path](/content-assets/articles/article-cloud-providers-gcp-storage-databases-cloud-sql-relational-databases/cloud-sql-checkout-path.png)
*The API handles the request, while Cloud SQL owns the relational records and transaction boundary.*

## Relational Databases
<!-- section-summary: A relational database stores data in tables and protects relationships with schema rules, constraints, indexes, and SQL. -->

A **relational database** stores data in tables. Each table holds rows, and each row has columns. That sounds simple, yet the important idea is the word **relational**. The database is good at protecting rules between records, not only storing records one by one.

Think about a spreadsheet for a tiny event venue. One sheet lists events, one sheet lists seats, one sheet lists reservations, and one sheet lists payments. At first, a person can keep those sheets tidy by being careful. Production software needs the database to enforce the same care every second. A payment should point to a real reservation. A reservation should point to a real event. A seat should not be sold twice for the same event. Those are relationship rules.

Relational databases use several tools for that job:

- **Schemas** define which columns exist and what type of value each column can hold.
- **Constraints** enforce rules such as required values, unique values, and allowed status values.
- **Foreign keys** connect one table to another, such as `payments.reservation_id` pointing to `reservations.id`.
- **Indexes** help the database find rows without scanning every row in a table.
- **SQL** gives the team a shared language for querying and changing the data.

For seat reservations, relational design gives the team a place to express business rules. One seat can only have one active reservation for the same event. A payment must point to an existing reservation. A reservation status must move through allowed values such as `HELD`, `CONFIRMED`, `CANCELLED`, or `EXPIRED`.

A small schema sketch makes the relationship clearer:

```sql
CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('HELD', 'CONFIRMED', 'CANCELLED', 'EXPIRED')),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations(id),
  amount_cents INT NOT NULL,
  status TEXT NOT NULL
);
```

Important details in this sketch:

- `PRIMARY KEY` gives each record a stable identity.
- `NOT NULL` prevents important fields from being silently empty.
- `CHECK` limits reservation status to approved values.
- `REFERENCES reservations(id)` prevents a payment from pointing at a reservation that does not exist.

This is why Cloud SQL belongs in the roadmap before analytics and document stores for this example. The venue is not only saving data; it is protecting a business rule.

For AWS readers, Cloud SQL fills the same broad job as Amazon RDS for PostgreSQL, MySQL, and SQL Server. Aurora is also a common AWS relational anchor, though its architecture differs from Cloud SQL.

## Instances, Engines, Databases, and Tables
<!-- section-summary: Cloud SQL uses an instance to run a chosen engine, databases to organize data inside that engine, and tables to hold records. -->

A **Cloud SQL instance** is the managed database server resource. It has a region, machine shape, storage settings, networking settings, backup settings, and database engine. An **engine** is the database product, such as PostgreSQL, MySQL, or SQL Server.

Inside the instance, a **database** is a named logical container for application tables and other database objects. A **table** holds rows of one kind of record. A small reservation schema might use `events`, `seats`, `reservations`, `reservation_seats`, and `payments`.

After the team chooses PostgreSQL for the reservation app, a first private instance needs a private network path. In Google Cloud, Cloud SQL private IP uses a private services access path between your VPC and Google's service producer network. The network and allocated producer range should be created and verified before the database instance depends on it.

The instance command should name the VPC network that owns the private path:

```bash
gcloud sql instances create reservations-prod \
  --project=venue-prod \
  --database-version=POSTGRES_16 \
  --region=us-central1 \
  --tier=db-custom-2-8192 \
  --storage-size=100GB \
  --storage-auto-increase \
  --availability-type=REGIONAL \
  --network=projects/venue-prod/global/networks/venue-vpc \
  --no-assign-ip
```

Important details in this command:

- `--database-version=POSTGRES_16` chooses the engine and major version.
- `--availability-type=REGIONAL` asks Cloud SQL to use high availability in the region.
- `--network=projects/venue-prod/global/networks/venue-vpc` tells Cloud SQL which VPC private-services path to use.
- `--no-assign-ip` keeps the instance off the public internet path.
- `--storage-auto-increase` helps avoid a simple storage-full outage, while alerts still need to watch growth.

After creation, verify that the instance matches the private design:

```bash
gcloud sql instances describe reservations-prod \
  --project=venue-prod \
  --format="yaml(name,region,ipAddresses,settings.ipConfiguration)"
```

Expected output should show a private address, no public IPv4 address, and the intended VPC:

```yaml
ipAddresses:
- ipAddress: 10.91.0.3
  type: PRIVATE
name: reservations-prod
region: us-central1
settings:
  ipConfiguration:
    authorizedNetworks: []
    ipv4Enabled: false
    privateNetwork: projects/venue-prod/global/networks/venue-vpc
```

If the command fails because private services access is missing, fix the allocated range and service networking connection first. Do not solve that failure by adding a public IP unless the architecture review explicitly approves a public database path.

Create the application database after the instance exists:

```bash
gcloud sql databases create reservations_app \
  --instance=reservations-prod \
  --project=venue-prod
```

Important details in this command:

- `reservations_app` is the database name application configuration should use.
- `--instance=reservations-prod` attaches the database to the managed Cloud SQL instance.
- A named application database gives migrations and app code a clear target separate from system databases.

## Transactions
<!-- section-summary: A transaction groups related SQL changes so the database commits all of them or rolls them back together. -->

A **transaction** is a boundary around related database work. Inside one transaction, the app can check seats, create a reservation, attach seats, record a payment attempt, and commit only after the whole change is valid. If the payment write fails or a seat is already taken, the database can roll back the grouped work.

The everyday idea is "all of this counts as one business move." A customer does not care that the app updated five tables. They care that two seats were either reserved together or not reserved at all. A transaction gives the database a way to protect that all-or-nothing rule.

Transactions also help with concurrency. Two customers can click the same seat seconds apart. The database needs to stop both requests from confidently selling the same seat. Row locks, constraints, and transaction isolation give the app tools to make that decision safely instead of trusting timing luck in application code.

A simplified PostgreSQL flow might look like this:

```sql
BEGIN;

SELECT id
FROM seats
WHERE event_id = 'event_20260704'
  AND seat_code IN ('A-10', 'A-11')
  AND status = 'AVAILABLE'
FOR UPDATE;

INSERT INTO reservations (id, customer_id, event_id, status)
VALUES ('res_913812', 'customer_8842', 'event_20260704', 'HELD');

INSERT INTO reservation_seats (reservation_id, seat_id)
SELECT 'res_913812', id
FROM seats
WHERE event_id = 'event_20260704'
  AND seat_code IN ('A-10', 'A-11');

UPDATE seats
SET status = 'HELD'
WHERE event_id = 'event_20260704'
  AND seat_code IN ('A-10', 'A-11');

COMMIT;
```

Important details in this SQL:

- `BEGIN` and `COMMIT` define the transaction boundary.
- `FOR UPDATE` asks the database to lock the selected seat rows during the transaction.
- The app should confirm it found exactly two seats before inserting the reservation.
- Real payment flows often add idempotency keys so a retry does not create duplicate reservations.

The missing line in many beginner examples is the validation step between the `SELECT ... FOR UPDATE` and the inserts. The app should count the rows it locked. If it asked for two seats and found only one available row, it should roll back and return a clean "seat unavailable" response. Without that check, the SQL can look transactional while the business rule still has a hole.

This is the core reason a relational database fits reservations, clinic appointments, and subscription billing. The business action touches several records, and the database protects the coordinated change.

## Private Connectivity
<!-- section-summary: Private connectivity keeps database traffic on private network paths and reduces public exposure. -->

**Private connectivity** means the app reaches Cloud SQL through private network paths instead of exposing the database with a public IP. The database receives a private address in a VPC path, and only approved application runtimes should be able to reach that address.

The beginner rule is simple: the database should sit behind a narrow access path. The app runtime needs database access. Humans need controlled administration paths. Random internet clients should have no route to the database.

Cloud Run can use Direct VPC egress or a Serverless VPC Access connector to reach private addresses. Private Service Connect is another pattern for some Cloud SQL network designs. Cloud SQL language connectors solve a different part of the problem: they help application code connect with encryption and IAM-aware behavior, and they can be configured to prefer private IP. Keep these choices separate during design review so the team can explain which path the service actually uses.

A Cloud Run checkout API might connect to a private Cloud SQL PostgreSQL instance this way. First, the instance should show a private address and no public IPv4 address:

A verification command can show whether the instance has a public IP:

```bash
gcloud sql instances describe reservations-prod \
  --format="yaml(name,region,ipAddresses,settings.ipConfiguration)"
```

Example output:

```yaml
ipAddresses:
- ipAddress: 10.91.0.3
  type: PRIVATE
name: reservations-prod
region: us-central1
settings:
  ipConfiguration:
    authorizedNetworks: []
    ipv4Enabled: false
    privateNetwork: projects/venue-prod/global/networks/venue-vpc
```

Important fields to inspect:

- `ipAddresses` should show the intended private address path.
- `settings.ipConfiguration.ipv4Enabled` should be `false` for instances with no public IPv4 address.
- Authorized networks should be empty unless the team has an explicit reviewed reason.

Then deploy the Cloud Run service on the VPC path that can reach that private address:

```bash
gcloud run deploy reservations-api \
  --project=venue-prod \
  --image=us-docker.pkg.dev/venue-prod/apps/reservations-api:20260704 \
  --region=us-central1 \
  --network=venue-vpc \
  --subnet=run-private-us-central1 \
  --vpc-egress=private-ranges-only \
  --service-account=reservations-api@venue-prod.iam.gserviceaccount.com \
  --set-env-vars=DB_HOST=10.91.0.3,DB_NAME=reservations_app,DB_USER=reservations_api
```

Important details in this command:

- `--network` and `--subnet` place the Cloud Run revision on the VPC path used for private addresses.
- `--vpc-egress=private-ranges-only` routes private-address traffic through that VPC path while leaving normal public egress behavior separate.
- `DB_HOST=10.91.0.3` points the app at the Cloud SQL private address from the instance description.
- The password should come from Secret Manager or the platform's secret integration.

Verify the Cloud Run side with:

```bash
gcloud run services describe reservations-api \
  --project=venue-prod \
  --region=us-central1
```

The useful output should show the VPC network, subnet, and `private-ranges-only` egress setting for the active revision. That proves the service has a private network route. The database login proof comes from an application health check or a one-row database check from the running service.

Example health response:

```json
{
  "database": {
    "connected": true,
    "serverAddress": "10.91.0.3",
    "database": "reservations_app",
    "checkedAt": "2026-07-04T18:20:13Z"
  }
}
```

This output proves three different things. The Cloud SQL instance has no public IPv4 address. The Cloud Run revision is attached to the VPC path for private ranges. The application can reach and authenticate to the intended database from the deployed runtime.

For AWS readers, this maps to the same safety habit as putting RDS in private subnets and controlling access with security groups. GCP uses its own networking primitives, but the job is the same: only approved runtimes and operators should reach the database.

## Connection Pooling
<!-- section-summary: Connection pooling protects Cloud SQL from too many short-lived application connections. -->

A **database connection** is a live session between application code and the database. Serverless and container workloads can scale out quickly, so an app can create far more database connections than the instance can handle. Too many connections cause slow requests, failed checkouts, and noisy recovery work.

**Connection pooling** reuses a smaller set of database connections. For PostgreSQL, teams often use PgBouncer. Some teams run it beside the app, as a small shared service, or through a platform pattern that the operations team owns. The app should also set conservative maximum connections per instance.

Think of each connection as an open conversation with the database. Opening a new conversation has overhead, and the database can only hold a certain number comfortably. A Cloud Run service that scales from 2 instances to 30 instances can multiply connections quickly if each instance opens a large pool.

Pooling keeps the number of conversations under control. The app borrows a connection from the pool, performs the SQL work, and returns it for another request. The pool does not fix slow queries, missing indexes, or bad transactions. It protects the database from connection storms while the team still optimizes the actual workload.

A Cloud Run service might set a low app-side pool size through environment variables:

```bash
gcloud run services update reservations-api \
  --region=us-central1 \
  --set-env-vars=DB_POOL_MAX=10,DB_POOL_IDLE_TIMEOUT_SECONDS=30
```

Important details in this command:

- The exact variable names depend on your application framework.
- `DB_POOL_MAX=10` is a starting cap, not a universal value.
- The total possible connections equals pool size multiplied by the number of running app instances and any background workers.

For AWS readers, RDS Proxy is the familiar managed pooling anchor. GCP designs commonly use Cloud SQL language connectors plus an application pool, or PgBouncer for PostgreSQL workloads that need stronger pooling behavior.

## Migrations
<!-- section-summary: Migrations change database schema in small reversible steps so application releases do not break live records. -->

A **migration** is a controlled database schema change. It might add a table, add a column, create an index, or backfill data. The dangerous part is timing: old app code, new app code, and the database may overlap during a deploy.

A safe migration style for reservations uses small steps:

| Step | Example | Why it helps |
|---|---|---|
| Add | Add nullable `expires_at` to `reservations` | Old code keeps working while new code starts writing the field |
| Backfill | Fill `expires_at` for existing held reservations | Existing data catches up before the field is required |
| Enforce | Add `NOT NULL` or a check constraint later | The rule arrives after the app and data are ready |
| Remove | Drop old fields after all code stops using them | Cleanup waits until production no longer depends on the old shape |

Example migration:

```sql
ALTER TABLE reservations
ADD COLUMN expires_at TIMESTAMPTZ;

CREATE INDEX CONCURRENTLY idx_reservations_expires_at
ON reservations (expires_at)
WHERE status = 'HELD';
```

Important details in this SQL:

- The nullable column avoids breaking old inserts.
- `CREATE INDEX CONCURRENTLY` reduces blocking for PostgreSQL, though it has its own operational rules.
- The partial index focuses on held reservations, which is the query the cleanup worker needs.

Migration tools such as Flyway, Liquibase, Prisma Migrate, Rails migrations, Alembic, or plain SQL migration runners can all work. The important habit is review, test restore, small steps, and a rollback or repair plan.

![Cloud SQL operating checks](/content-assets/articles/article-cloud-providers-gcp-storage-databases-cloud-sql-relational-databases/cloud-sql-operating-checks.png)
*Operations checks cover schema, connections, private access, backups, and restore evidence.*

## Backups and High Availability
<!-- section-summary: Backups recover earlier data states, while high availability helps the instance survive infrastructure failure inside a region. -->

A **backup** is a previous database copy. Cloud SQL can create automated backups, and PostgreSQL/MySQL/SQL Server editions support point-in-time recovery options so the team can restore to a specific time inside the retained log window. Backups help with bad migrations, accidental deletes, corrupt writes, and recovery drills.

**High availability**, or HA, helps the instance keep serving through some infrastructure failures. A regional Cloud SQL instance maintains a standby in another zone in the same region and can fail over. HA helps with zonal failure; backups help with earlier data states. You usually need both.

Enable and verify backup settings:

```bash
gcloud sql instances patch reservations-prod \
  --backup-start-time=03:00 \
  --enable-point-in-time-recovery \
  --retained-transaction-log-days=7
```

Important details in this command:

- `--backup-start-time=03:00` chooses the automated backup window.
- `--enable-point-in-time-recovery` keeps transaction log data for PITR where supported.
- The retained log window should match the business recovery target and Cloud SQL edition limits.

Practice a restore into a separate target before an incident:

```bash
gcloud sql instances clone reservations-prod reservations-restore-20260704 \
  --point-in-time="2026-07-04T15:20:00Z"
```

Important details in this command:

- The target instance is separate, so validation does not overwrite production.
- The timestamp should come from logs, deploy records, or incident evidence.
- After clone creation, application-level SQL checks should prove the recovered data is useful.

![Cloud SQL recovery flow](/content-assets/articles/article-cloud-providers-gcp-storage-databases-cloud-sql-relational-databases/cloud-sql-recovery-flow.png)
*A recovery flow should restore to a safe target, validate records, then choose repair or cutover.*

## Putting It Together
<!-- section-summary: Cloud SQL works best as one operating shape that covers relational design, private access, pooling, migrations, backups, and HA. -->

Cloud SQL fits records that need relationships and coordinated writes. For a reservation, appointment, or billing system, the core path is relational database first, Cloud SQL instance second, engine and database next, tables and transactions after that, then private connectivity, connection pooling, migrations, backups, and HA.

Keep the practical question close: what business rule must the database protect as two users, two releases, or one failed job touch the same records?

## References

- [Cloud SQL overview](https://cloud.google.com/sql/docs/introduction) - Official overview for managed PostgreSQL, MySQL, and SQL Server on Google Cloud.
- [Create Cloud SQL for PostgreSQL instances](https://cloud.google.com/sql/docs/postgres/create-instance) - Documents instance creation settings for PostgreSQL.
- [Cloud SQL private IP](https://cloud.google.com/sql/docs/postgres/configure-private-ip) - Documents private IP configuration for Cloud SQL instances.
- [Connect to Cloud SQL](https://cloud.google.com/sql/docs/postgres/connect-overview) - Documents supported connection paths and connector options.
- [Connect from Cloud Run](https://cloud.google.com/sql/docs/postgres/connect-run) - Documents Cloud Run to Cloud SQL connection patterns.
- [Cloud Run Direct VPC egress](https://cloud.google.com/run/docs/configuring/vpc-direct-vpc) - Documents direct VPC egress for Cloud Run services.
- [Cloud SQL backups](https://cloud.google.com/sql/docs/postgres/backup-recovery/backups) - Documents automated backups and backup recovery behavior.
- [Configure Cloud SQL point-in-time recovery](https://cloud.google.com/sql/docs/postgres/backup-recovery/configure-pitr) - Documents PITR setup for PostgreSQL instances.
- [Cloud SQL high availability](https://cloud.google.com/sql/docs/postgres/high-availability) - Documents regional HA architecture and failover behavior.
