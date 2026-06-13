---
title: "Azure SQL Database"
description: "Azure SQL Database fits relational application records that need tables, transactions, constraints, query flexibility, secure access, and restore."
overview: "Azure SQL Database is Azure's managed relational database for business records such as orders, payments, customers, and line items. This article explains logical servers, databases, tables, constraints, transactions, connections, service tiers, migrations, and point-in-time restore."
tags: ["azure", "sql", "database", "transactions", "restore"]
order: 3
id: article-cloud-providers-azure-storage-databases-azure-sql-database
---

## Table of Contents

1. [What Is Azure SQL Database](#what-is-azure-sql-database)
2. [Logical Servers and Databases](#logical-servers-and-databases)
3. [Tables, Keys, and Constraints](#tables-keys-and-constraints)
4. [Transactions](#transactions)
5. [Connections, Identity, and Network Access](#connections-identity-and-network-access)
6. [Service Tiers and Capacity](#service-tiers-and-capacity)
7. [Migrations](#migrations)
8. [Backup and Restore](#backup-and-restore)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## What Is Azure SQL Database
<!-- section-summary: Azure SQL Database is the managed Azure home for relational records that need SQL, rules, transactions, and recovery. -->

Azure SQL Database is Azure's managed relational database service for applications that store structured business records. Relational data means the records have relationships: a customer places orders, an order has line items, a payment belongs to an order, and a refund changes the state of that payment. SQL gives the application a language for asking questions across those records, and the database engine gives the team rules for keeping those records valid.

We will follow one production example through the article. The Orders team runs `orders-api-prod`, an API that handles checkout for an online store. Receipt PDFs live in Blob Storage, because those are file-shaped bytes. The actual order facts live in Azure SQL Database, because the team needs tables, joins, transactions, constraints, indexes, and point-in-time restore.

That split matters in a real system. A receipt file answers, "What did the customer download?" The relational database answers, "Which customer placed this order, which items did it include, which payment authorized it, which shipment belongs to it, and what happened if the payment succeeded but inventory failed?" Those questions connect many facts, so Azure SQL becomes the better starting point than object storage or a simple key-value document.

![Orders API split between Blob Storage receipt files and Azure SQL relational order records](/content-assets/articles/article-cloud-providers-azure-storage-databases-azure-sql-database/azure-sql-relational-records.png)

*This visual separates file-shaped data from relational business records: Blob Storage keeps receipt bytes, while Azure SQL keeps connected order facts with keys, constraints, transactions, and restore.*

Azure SQL Database is a platform as a service database. Microsoft operates the service platform, high availability infrastructure, patching path, and automated backup system. The application team still owns the database design: table shape, indexes, queries, access permissions, connection behavior, migration safety, data growth, and restore practice. A managed database still needs real database engineering from the application team.

The whole article follows that responsibility split. First we name the Azure resources, then we look at the data rules inside the database, then we look at transactions, connections, capacity, migrations, and recovery. Those pieces connect because a production database needs all of them at the same time.

## Logical Servers and Databases
<!-- section-summary: The logical server gives Azure a management and connection boundary, while each database owns schema, data, compute choices, and backup settings. -->

Before the Orders team creates tables, it needs an Azure SQL shape to hold them. The first resource beginners usually meet is the **logical server**. A logical server is the Azure management wrapper and DNS name for one or more Azure SQL databases in a region. It holds settings such as the server name, administrator configuration, firewall rules, private endpoint relationships, and Microsoft Entra authentication setup.

The logical server gives the app a connection endpoint such as `sql-orders-prod.database.windows.net`. That name feels like a normal SQL Server machine name, and the logical server acts as an Azure control boundary around managed database resources. Azure runs the operating system layer, server platform, patching path, and service software for the team.

The **database** is the resource that holds the application schema and data. The Orders team might create a database named `orders` on `sql-orders-prod.database.windows.net`. Inside `orders`, the team creates tables such as `customers`, `orders`, `order_items`, `payments`, and `shipments`. The database also owns important choices such as service tier, compute model, maximum size, backup retention, and many performance settings.

Here is a simple production naming picture:

| Azure resource | Example name | What the team reviews there |
| --- | --- | --- |
| Resource group | `rg-orders-prod-weu` | Ownership, lifecycle, tags, policy, deployment scope |
| Logical server | `sql-orders-prod` | DNS name, firewall, private endpoint, administrators, Entra setup |
| Database | `orders` | Tables, data, indexes, service tier, backups, restore, query behavior |

This separation helps in design reviews. The network team may care about the logical server's firewall and private endpoint. The application team may care about the database schema and migrations. The platform team may care about tags, cost, backup retention, and deployment policy. Everyone talks about "the database," but Azure splits the responsibilities across resources and settings.

The Orders team can also place multiple databases on one logical server. For example, `orders` and `billing` could share the same server endpoint while keeping separate schemas and data. That arrangement can make administration simpler for related systems, but it also means server-level firewall and administrator choices deserve extra care. A server-level rule affects every database behind that logical server unless the team narrows access at the database layer too. Once the Azure wrapper exists, the real business rules move inside the database where tables, keys, and constraints protect the records themselves.

## Tables, Keys, and Constraints
<!-- section-summary: Tables store the facts, while keys and constraints keep relationships valid even when bugs, retries, or scripts try to write bad data. -->

A **table** stores records as rows and columns. In the orders database, `customers` might hold one row per customer, `orders` might hold one row per checkout, and `order_items` might hold one row per purchased product. A table gives the data a predictable shape so the application, reports, and support tools all read the same facts.

A **primary key** gives each row a stable identity inside a table. A customer row may use `customer_id`, and an order row may use `order_id`. A **foreign key** connects one table to another. The `orders.customer_id` column can point back to `customers.customer_id`, which means every order belongs to a real customer row.

A **constraint** is a database rule that protects data correctness. A unique constraint can prevent two customer accounts from using the same email address. A check constraint can reject an order item with quantity `0`. A foreign key can reject an order that points to a missing customer. These rules matter because application validation is only one door into the database. Admin scripts, data imports, queue retries, migration jobs, and bug fixes can all write data too.

The Orders team might start with a schema like this:

```sql
CREATE TABLE customers (
  customer_id bigint PRIMARY KEY,
  email nvarchar(320) NOT NULL UNIQUE,
  created_at datetime2 NOT NULL
);

CREATE TABLE orders (
  order_id bigint PRIMARY KEY,
  customer_id bigint NOT NULL,
  status nvarchar(32) NOT NULL,
  total_cents int NOT NULL,
  created_at datetime2 NOT NULL,
  CONSTRAINT fk_orders_customers
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
  CONSTRAINT ck_orders_total_cents
    CHECK (total_cents >= 0)
);

CREATE TABLE order_items (
  order_item_id bigint PRIMARY KEY,
  order_id bigint NOT NULL,
  sku nvarchar(64) NOT NULL,
  quantity int NOT NULL,
  unit_price_cents int NOT NULL,
  CONSTRAINT fk_order_items_orders
    FOREIGN KEY (order_id) REFERENCES orders(order_id),
  CONSTRAINT ck_order_items_quantity
    CHECK (quantity > 0)
);
```

This example has a few important ideas packed inside it. The `orders` table accepts only customer IDs that already exist. The `order_items` table accepts only order IDs that already exist. The database rejects negative order totals and zero-quantity items. The API still validates input before it sends SQL, and the database becomes the last line that protects permanent business facts.

Indexes come next because correct data also needs useful lookup paths. An **index** is a data structure the database maintains so queries can find rows without scanning everything. If support often searches all orders for one customer, the team may add an index on `orders(customer_id, created_at)`. If checkout frequently checks the latest payment state for an order, the team may add an index that matches that query. Indexes speed up reads, but every index adds write work and storage, so production teams review them against real query patterns.

Tables and constraints protect individual writes. The next problem appears when one business action changes several tables at once.

## Transactions
<!-- section-summary: Transactions let a checkout change several tables as one unit, so the database avoids half-written business events. -->

A **transaction** is a group of database changes that commit together or roll back together. The Orders team needs this because checkout writes more than one row. A successful payment may update the order status, insert a payment record, insert order items, and write an audit event. The business wants one completed checkout instead of a mixed result with three successful writes and one failed write hiding in the corner.

Here is a simplified checkout transaction:

```sql
BEGIN TRANSACTION;

UPDATE orders
SET status = 'paid'
WHERE order_id = 417
  AND status = 'pending';

INSERT INTO payments (payment_id, order_id, provider_reference, status, created_at)
VALUES (9001, 417, 'pi_8K2...', 'authorized', SYSUTCDATETIME());

INSERT INTO order_events (order_id, event_type, created_at)
VALUES (417, 'payment_authorized', SYSUTCDATETIME());

COMMIT TRANSACTION;
```

If the payment insert fails, a `paid` status by itself would mislead support, finance, and the customer. The transaction lets the database undo the whole group before it becomes permanent. That all-or-nothing behavior is one reason relational databases remain so useful for money, inventory, enrollment, approvals, and other workflows where partial state creates real support pain.

Behind that behavior sits the **transaction log**. The transaction log records database changes in order so the database can recover committed work after a failure and discard incomplete work. Azure SQL Database manages the service log files for you, and the concept still matters. The log supports transaction durability, crash recovery, replication features, and point-in-time restore.

Transactions also interact with concurrency. Concurrency means many requests touch the database at the same time. Two customers might buy the last item, two support agents might edit the same order, and a reporting query might read rows while checkout writes them. Azure SQL uses SQL Server database engine behavior to coordinate locks, row versions, isolation levels, and consistency rules. The beginner takeaway is practical: the app keeps transactions focused, avoids long pauses while a transaction stays open, and tests race conditions that matter to the business.

At this point, the Orders database can store valid records and protect multi-step changes. The next question moves outside the tables: how does the app reach the database safely?

## Connections, Identity, and Network Access
<!-- section-summary: A working Azure SQL connection needs the right database name, network path, authentication method, and database permissions. -->

An Azure SQL connection has four parts: the endpoint name, the network path, the authentication method, and the database permissions. A connection string only names some of that story. Production failures often come from one of the other parts: DNS returns the wrong address, the firewall blocks the caller, the identity fails authentication, or the database user lacks permission to run the query.

For the Orders API, a modern connection string might look like this:

```ini
Server=tcp:sql-orders-prod.database.windows.net,1433;
Database=orders;
Authentication=Active Directory Default;
Encrypt=True;
```

The server name points at the logical server. The database name points at the `orders` database. `Authentication=Active Directory Default` tells supported drivers to use Microsoft Entra authentication from the environment, which can include a managed identity when the app runs in Azure. `Encrypt=True` keeps the client connection encrypted.

**Authentication** proves who is connecting. Azure SQL supports SQL authentication with SQL logins, and it also supports Microsoft Entra authentication. In production Azure apps, Microsoft Entra authentication with managed identity often gives a cleaner path because the app can connect without a database password stored in configuration. The App Service, Function App, Container Apps workload, VM, or AKS workload receives an Azure identity, and the database accepts that identity after the team configures the right Entra administrator and database user.

**Authorization** decides what that identity can do after it connects. Azure RBAC can control management actions on the Azure SQL resources, but data access inside the database still uses database permissions and roles. The Orders API identity might receive permission to execute stored procedures or read and write specific tables. A reporting identity may receive read access only. A migration identity may receive broader schema-change permissions during deployment, then those permissions can be removed or tightly controlled.

The database user setup may look like this:

```sql
CREATE USER [mi-orders-api-prod] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [mi-orders-api-prod];
ALTER ROLE db_datawriter ADD MEMBER [mi-orders-api-prod];
```

That example creates a database user for a Microsoft Entra identity and grants broad read/write roles. Many production teams go narrower than this over time. They create custom roles, grant access to selected schemas, or expose stored procedures for specific operations. The app identity needs database permissions alongside any Azure role on the server resource.

**Network access** controls whether traffic can reach the logical server. Azure SQL databases reject connections unless the network rules allow them. A small development database may temporarily allow one office IP address through a server firewall rule. A production checkout database usually deserves a more controlled path, such as a private endpoint through Azure Private Link. With a private endpoint, the app resolves the normal SQL hostname to a private IP address inside the virtual network, and traffic reaches Azure SQL through that approved private path.

![Private Azure SQL connection path through managed identity, private DNS, private endpoint, logical server, and database permission checks](/content-assets/articles/article-cloud-providers-azure-storage-databases-azure-sql-database/azure-sql-private-access-path.png)

*This visual shows the connection path as four checks: the app needs the right name, network route, identity, and database permission before a SQL query can run.*

Private access adds DNS to the design. If `orders-api-prod` uses a private endpoint, the app still connects to `sql-orders-prod.database.windows.net`, and private DNS resolves that name to the private endpoint address for approved clients. If DNS points to the public address, the app may hit firewall errors even though the private endpoint exists. If DNS points to the private address from a network without a route there, the connection fails for a different reason.

Connection pooling finishes the connection story. A **connection pool** keeps reusable database connections open for the application process. Opening a new database connection for every request wastes time and can exhaust database resources during traffic spikes. A pool lets the app reuse connections, but the team still needs limits. If every container instance opens too many connections, scaling the app can overload the database before CPU or memory looks busy.

Now the app can reach the database. The next question is how much database capacity the team buys and what kind of performance shape it needs.

## Service Tiers and Capacity
<!-- section-summary: Service tier and compute choices shape cost, latency, availability behavior, scaling options, and how the database handles growth. -->

A **service tier** is the performance, storage, and availability shape of an Azure SQL database. It affects how much compute the database has, how storage behaves, which high availability architecture Azure uses, which features are available, and how the bill grows. The team chooses it from workload evidence rather than from a label that sounds mature.

The vCore purchasing model is usually the clearest place to start. A **vCore** is a virtual core of compute capacity. In this model, the team chooses a service tier, hardware configuration, compute amount, storage amount, and backup storage behavior. Older DTU-based choices still exist, but vCore maps more directly to the way many teams discuss CPU, memory, storage, and licensing.

The main vCore service tiers are **General Purpose**, **Business Critical**, and **Hyperscale**. General Purpose fits many standard business applications where balanced cost and managed availability matter. Business Critical targets lower-latency and higher-transaction workloads with a different architecture and replicas. Hyperscale uses a separate architecture designed for very large databases, fast storage scaling, and restore behavior with a different timing profile from traditional size-of-data restores.

For the Orders team, the first production database may begin in General Purpose with measured CPU, data I/O, log I/O, storage, and query duration alerts. If checkout traffic grows and write latency becomes a user-visible problem, the team can review whether query design, indexes, connection pooling, or Business Critical capacity gives the right improvement. If the database grows into many terabytes and restore-size concerns become central, Hyperscale deserves a more serious review.

Azure SQL Database also has **provisioned** and **serverless** compute choices in supported tiers. Provisioned compute keeps a fixed amount of compute allocated. Serverless compute can automatically scale within configured limits, and in some configurations it can auto-pause during inactive periods. Serverless can fit intermittent internal tools and development workloads nicely. A checkout path with steady traffic, strict latency expectations, or private networking behavior may prefer provisioned capacity after testing.

Elastic pools solve a different capacity problem. An **elastic pool** lets multiple databases on one logical server share a pool of resources at a set price. This can fit SaaS products with one database per tenant, where most tenant databases sit quiet most of the time and only a few spike at once. One busy database can still create pressure, so teams monitor pool usage and per-database behavior rather than treating the pool as unlimited shared magic.

Capacity planning connects back to connections and queries. If the Orders API scales from two app instances to twenty, the database sees more concurrent work. If every request runs an unindexed query, a bigger service tier may only hide the issue for a while. Healthy database scaling includes query plans, indexes, connection pool limits, retry behavior, slow query tracking, and a clear cost review. After the team chooses a capacity shape, it still needs one unavoidable production habit: schema changes must move safely because live data keeps serving customers during the release.

## Migrations
<!-- section-summary: Migrations turn database changes into planned releases because persistent data survives container image replacement. -->

A **migration** is a controlled change to database schema or data. Application code changes often need new tables, columns, indexes, constraints, or backfilled values. The database already holds live business records, so the migration has to respect existing data and old application versions that may still run during a deployment.

The Orders team might add checkout-session tracking. The desired end state is a new `checkout_session_id` column on `orders`, a unique index for lookups, and application code that writes the value. A risky release tries to add the column as required, deploy new code, and remove old behavior all at once. A safer release breaks the change into steps.

An additive migration might start like this:

```sql
ALTER TABLE orders
ADD checkout_session_id nvarchar(128) NULL;

CREATE INDEX ix_orders_checkout_session_id
ON orders(checkout_session_id)
WHERE checkout_session_id IS NOT NULL;
```

That first step gives the new code a place to write without breaking old rows. Then the team deploys application code that can handle rows with and without `checkout_session_id`. A background job backfills old rows if the business needs it. After monitoring confirms every active code path writes the new value, a later migration can tighten the rule, maybe by adding a constraint or changing the column requirement.

This release style matters because a container rollback and a database rollback behave differently. A bad container image can usually be replaced with the previous image. A destructive database change may have already deleted a column, rewritten values, or locked a large table. The database needs migration reviews, staging tests with realistic data volume, backups that can restore to a usable place, and a clear plan for forward fixes.

Indexes deserve special attention during migrations. Adding an index can help a query, but it can also scan a large table, consume log space, and add write overhead. Changing a column type can touch every row. Adding a foreign key can validate existing data. These operations may behave quickly in a tiny development database and slowly in production. The team tests migrations against data volume that resembles production, then schedules high-impact changes with the same care as application releases.

Migrations change live data shape. That naturally leads to the recovery question: what happens when a migration, script, or bug writes the wrong data?

## Backup and Restore
<!-- section-summary: Azure SQL automated backups support point-in-time restore, but recovery still needs retention choices, restore drills, and careful repair decisions. -->

**Backup** is the stored recovery material Azure SQL keeps for the database. **Restore** is the process of creating a usable database from that material. Azure SQL Database automatically performs full, differential, and transaction log backups so a database can restore to a point in time within the configured retention period.

Point-in-time restore, often called **PITR**, helps when the problem is logical corruption rather than hardware failure. Logical corruption means the database service stayed healthy, but the data became wrong. A migration set every paid order to `cancelled`, an admin script updated the wrong tenant, or a bug inserted duplicate payment events. The database needs a way to recover the data state around the moment before the bad write.

![Azure SQL migration and point-in-time restore flow from good state to bad migration, restored copy, comparison, and active database repair](/content-assets/articles/article-cloud-providers-azure-storage-databases-azure-sql-database/azure-sql-migration-pitr.png)

*This visual shows the recovery loop after a bad change: restore a copy from before the problem, compare rows, then repair the active database with care.*

For new, restored, and copied databases, Azure SQL Database keeps enough backups for point-in-time restore for the last seven days by default. Teams can configure short-term retention, commonly up to thirty-five days for Azure SQL Database. Microsoft documentation also describes regular full, differential, and log backups for the backup chain. Hyperscale uses its own snapshot-based backup architecture, so teams check Hyperscale-specific behavior before assuming every detail matches non-Hyperscale databases.

A restore usually creates another database rather than rewinding the active one in place. If the Orders team discovers at 14:20 that a 14:05 migration corrupted order statuses, it might restore a copy named `orders-restore-1404`. The team can compare the restored copy with the active database and choose the recovery path. Sometimes the app points to the restored database. Often the safer path is surgical repair: copy the affected rows back after careful review, while preserving valid transactions that happened after 14:05.

Long-term retention solves a different problem. Short-term PITR covers recent mistakes. **Long-term retention**, often shortened to LTR, can keep selected full backups for months or years for compliance or audit needs. LTR complements a practical incident restore plan. It gives the team older recovery points, and the team still proves that restored data can become useful during a real event.

Backups also connect to cost and deletion. Backup storage consumes money, and retained backups can remain after a database is deleted until the retention period ages out. This is usually a good safety feature, but it surprises teams that expect cost to disappear the moment they delete a database. Production cleanup includes a backup retention review.

The most important recovery habit is a restore drill. A restore drill means the team actually restores a database, checks how long it takes, checks who can access it, checks whether application configuration can point to it if needed, and practices the repair decision. Backups that nobody has restored are only a hope. A tested restore path gives the team evidence.

## Putting It All Together
<!-- section-summary: A healthy Azure SQL design connects relational modeling, secure access, capacity, migrations, and recovery into one production habit. -->

Azure SQL Database is the Azure service to learn first when an application has relational business records. The Orders team uses it because customers, orders, line items, payments, shipments, refunds, and support workflows all connect. Tables give those facts shape. Keys and constraints protect relationships. Transactions keep multi-step checkout changes together. SQL queries let support, reporting, and application code ask useful questions across the data.

The managed service removes a lot of infrastructure work, but the team still has real database ownership. The logical server needs secure network and identity configuration. The database needs careful schema design, indexes, and permissions. The app needs connection pooling and retry behavior that respect database limits. The service tier needs to match actual workload pressure. Migrations need staged releases because persistent data survives stateless compute replacement. Backup settings need restore drills because recovery only matters when the restored data becomes usable.

A good production review for Azure SQL follows one request through the system. The customer clicks checkout. The API connects through the approved network path with its managed identity. The database user has only the permissions the app needs. The checkout transaction writes order, payment, and event rows together. Indexes support the next read path. Monitoring catches slow queries and capacity pressure. A migration process evolves the schema safely. PITR and retention settings give the team a tested recovery path when a human or script makes a bad change.

Beginners can keep that full shape in mind. Azure SQL Database gives you a managed SQL engine, and the application team still designs the data, access, release, performance, and recovery story around it.

![Azure SQL production review summary with schema rules, transactions, secure access, capacity, migrations, restore drills, and app ownership](/content-assets/articles/article-cloud-providers-azure-storage-databases-azure-sql-database/azure-sql-production-review.png)

*This final review board summarizes the production responsibilities around Azure SQL: schema rules, transactions, secure access, capacity planning, migration safety, and restore drills.*

## What's Next

Next we look at Cosmos DB, where the main design question changes from relational records and transactions to item-shaped data, partition keys, request units, TTL, and consistency choices. The same Orders system can use Cosmos DB for temporary checkout or idempotency records, so the next article shows what changes when the app reads and writes known items instead of joining relational tables.

---

**References**

* [What is Azure SQL Database?](https://learn.microsoft.com/en-us/azure/azure-sql/database/sql-database-paas-overview?view=azuresql) - Official overview of Azure SQL Database as a managed database service, including backups, scaling, and platform responsibilities.
* [Logical server in Azure SQL Database](https://learn.microsoft.com/en-us/azure/azure-sql/database/logical-servers?view=azuresql) - Explains the logical server boundary and how it differs from an on-premises SQL Server instance.
* [vCore purchasing model](https://learn.microsoft.com/en-us/azure/azure-sql/database/service-tiers-sql-database-vcore?view=azuresql) - Documents General Purpose, Business Critical, Hyperscale, compute, storage, and availability differences.
* [Azure SQL Database serverless](https://learn.microsoft.com/en-us/azure/azure-sql/database/serverless-tier-overview?view=azuresql) - Describes automatic compute scaling and auto-pause behavior for supported serverless configurations.
* [Azure Private Link for Azure SQL Database](https://learn.microsoft.com/en-us/azure/azure-sql/database/private-endpoint-overview?view=azuresql) - Explains private endpoints and private DNS behavior for SQL connectivity.
* [Microsoft Entra authentication with Azure SQL](https://learn.microsoft.com/en-us/azure/azure-sql/database/authentication-aad-overview?view=azuresql) - Covers Microsoft Entra authentication, administrators, users, and identity behavior.
* [Authorize database access to Azure SQL Database](https://learn.microsoft.com/en-us/azure/azure-sql/database/logins-create-manage?view=azuresql) - Describes contained database users, groups, roles, and database permissions.
* [Automated backups in Azure SQL Database](https://learn.microsoft.com/en-us/azure/azure-sql/database/automated-backups-overview?view=azuresql) - Documents short-term retention, backup frequency, backup storage, and restore support.
* [Restore a database from backups](https://learn.microsoft.com/en-us/azure/azure-sql/database/recovery-using-backups?view=azuresql) - Explains point-in-time restore operations and restore considerations.
* [Long-term retention backups](https://learn.microsoft.com/en-us/azure/azure-sql/database/long-term-retention-overview?view=azuresql) - Documents long-term retention for selected full backups.
