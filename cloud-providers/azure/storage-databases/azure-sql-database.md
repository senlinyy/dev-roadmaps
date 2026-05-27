---
title: "Azure SQL Database"
description: "Use Azure SQL Database for relational application records that need tables, transactions, constraints, query flexibility, and restore."
overview: "Azure SQL Database is a managed relational database for business records such as orders, payments, and line items. This article explains logical servers, databases, tables, transactions, connections, schema changes, and restore."
tags: ["azure", "azure-sql", "sql", "transactions", "restore"]
order: 3
id: article-cloud-providers-azure-storage-databases-azure-sql-database
---

## Table of Contents

1. [What Is Azure SQL Database](#what-is-azure-sql-database)
2. [Logical Server and Database Provisioning](#logical-server-and-database-provisioning)
3. [Relational Tables and Constraints](#relational-tables-and-constraints)
4. [ACID Transactions and Log Writes](#acid-transactions-and-log-writes)
5. [Connections and Network Pathways](#connections-and-network-pathways)
6. [Schema Deployments and Migrations](#schema-deployments-and-migrations)
7. [Automated Backups and Recovery](#automated-backups-and-recovery)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## What Is Azure SQL Database

Azure SQL Database is a fully managed relational database platform built on Microsoft's SQL Server database engine. Relational databases store structured records inside tables with strict schemas, enforcing transactional boundaries and referential integrity between tables using keys and constraints. Managed service delivery means Microsoft automates host operating system patching, physical storage capacity scaling, high-availability replication, and backup scheduling, freeing your engineering team to focus entirely on database schema design, index tuning, transaction boundaries, and query performance.

If you deploy workloads on AWS, Azure SQL Database serves as the managed relational equivalent of Amazon RDS and Amazon Aurora. However, their underlying physical architectures differ. While a standard Amazon RDS SQL Server instance runs the database engine on a single Amazon EC2 virtual machine with network-attached EBS storage, Azure SQL Database separates compute resources from physical data storage at the platform layer. For high-throughput workloads requiring distributed performance, Amazon Aurora utilizes a log-structured shared storage volume across multiple availability zones. In Azure, this decoupled compute-to-storage architecture is fully realized through specialized service tiers that tailor the physical network and physical storage structures to your latency and durability budgets.

:::expand[Under the Hood: General Purpose vs. Business Critical Architectures]{kind="design"}
Azure SQL Database configures physical compute, network, and storage layouts differently depending on the chosen architectural tier:

* **General Purpose Tier (Remote Storage)**: This tier decouples the compute engine from the storage engine. The stateless compute layer (running the SQL Server database engine process, `sqlservr.exe`) executes on a virtual machine node managed by Azure Service Fabric. This compute node mounts remote data and log files (`.mdf` and `.ldf`) hosted on Azure Premium Storage SSD cabinets. If the compute host experiences hardware degradation or requires a platform update, Service Fabric spins up a new stateless compute node and re-mounts the remote Premium Storage files over the storage network. Read and write operations travel over the network between compute and storage layers, introducing typical network disk latencies.

* **Business Critical Tier (Local Storage Always On)**: This tier co-locates compute and storage onto the same physical Virtual Machine Scale Set (VMSS) node, leveraging direct-attached local NVMe drives for ultra-low read and write latencies. To guarantee high availability, Service Fabric deploys a four-node cluster running a Microsoft SQL Server Always On Availability Group. One node is designated as the primary replica, which accepts all client read-write traffic. The remaining three nodes operate as secondary replicas. When a write transaction executes on the primary replica, the transaction log records are replicated synchronously over a high-speed InfiniBand network backplane to at least one secondary replica before the transaction is acknowledged to the application client as committed. If the primary node fails, failover to a hot standby secondary replica is near-instantaneous (typically occurring in under five seconds) without data loss.

```mermaid
flowchart TD
    subgraph GP["General Purpose (Decoupled Remote Storage)"]
        GPCompute["Compute Node (sqlservr.exe)"] -- "Network I/O" --> GPStorage["Remote Azure Premium Storage (SSD)"]
    end
```

```mermaid
flowchart TD
    subgraph BC["Business Critical (Direct Local NVMe & Always On Replicas)"]
        Primary["Primary Replica (Active Write NVMe)"] -- "Synchronous Log Replication" --> Sec1["Secondary Replica 1 (NVMe Standby)"]
        Primary -- "Synchronous Log Replication" --> Sec2["Secondary Replica 2 (NVMe Standby)"]
        Primary -- "Asynchronous Replication" --> Sec3["Secondary Replica 3 (Read-Scale Out)"]
    end
```
:::

Understanding these structural separations enables teams to select tiers based on business impact: General Purpose provides budget-friendly relational hosting for standard dev-test and balanced production workloads, while Business Critical delivers low-latency local disk throughput and rapid failover recovery for high-transaction payment rails and real-time checkout engines.

## Logical Server and Database Provisioning

An Azure SQL logical server operates exclusively as a centralized control plane and administrative management boundary for one or more underlying databases. It provides a unique, globally addressable Domain Name System (DNS) endpoint, governs administrative logins, manages server-level firewall rules, configures Microsoft Entra ID authentication integrations, and applies security policies. It is not a dedicated virtual machine. You cannot SSH into a logical server or install operating system packages; all configuration changes occur through ARM APIs, the Azure portal, or database tools.

When provisioning database capacity under an Azure SQL logical server, you must choose between two distinct resource allocation models:

* **vCore Model**: Independently allocates virtual processor cores (vCores), memory, and physical storage capacity. This model maps directly to traditional server provisioning paradigms, matching the resource choices you make when choosing EC2 or RDS instance classes. It supports two compute paths:
    * **Provisioned Compute**: Allocates a fixed number of vCores and memory that remain continuously online, billing for resources regardless of active database queries.
    * **Serverless Compute**: Dynamically scales vCores and memory on demand based on query workloads. It automatically pauses the database compute layer during prolonged periods of inactivity, billing only for storage, and resumes compute in seconds when a new client query arrives.
* **DTU Model**: Bundles CPU, memory, and read-write IOPS into a single, pre-packaged metric called a Database Transaction Unit (DTU). Tiered into Basic, Standard, and Premium packages, it abstracts resource configurations. While simple for early development, DTUs prevent you from scaling memory or CPU independently of storage, making it difficult to optimize resources for specific high-performance application patterns.

For enterprise environments, the vCore model is recommended. It provides direct control over resource allocation and allows you to use Azure Hybrid Benefit to save on licensing costs.

## Relational Tables and Constraints

A relational database structures application records into rigid tables consisting of columns and rows. Unlike NoSQL engines that allow arbitrary JSON documents to coexist in the same collection, a relational engine enforces structural uniformity. Every row in a table must comply with the defined columns, data types, and system-level constraints.

In a checkout system, data assets are modeled as interconnected tables rather than single documents:

| Table Name | Column Name | Data Type | Constraint Type | Architectural Role |
| --- | --- | --- | --- | --- |
| `customers` | `id` | `INT` | `PRIMARY KEY` | Globally identifies one customer profile. |
| `customers` | `email` | `VARCHAR(255)` | `UNIQUE` | Guarantees email addresses are never duplicated in the system. |
| `orders` | `id` | `INT` | `PRIMARY KEY` | Globally identifies a specific checkout transaction. |
| `orders` | `customer_id` | `INT` | `FOREIGN KEY` | Relates the order to `customers.id`, blocking orders for non-existent customers. |
| `order_items`| `order_id` | `INT` | `FOREIGN KEY` | Relates item to `orders.id`. Cascades deletions if an order is scrubbed. |
| `order_items`| `quantity` | `INT` | `CHECK` | Enforces that quantities must be greater than zero at the database level. |

These database constraints act as a final line of defense for data consistency. Even if a software bug in your application bypasses a validation check, the database engine will reject a write attempt that violates unique constraints, foreign key mappings, or invalid data boundaries.

## ACID Transactions and Log Writes

Relational databases guarantee data integrity using ACID transactional properties. When an application commits a transaction, the engine ensures that all updates either succeed completely or roll back entirely (Atomicity), transition the database from one valid state to another (Consistency), execute without interference from concurrent operations (Isolation), and remain written even during power failures or system crashes (Durability).

Under the hood, Azure SQL Database enforces durability using a Write-Ahead Logging (WAL) mechanism. When your application inserts a new order and its corresponding line items within a transaction, the engine executes the following physical steps:

1. **Memory Manipulation**: The engine locates the target database pages inside the system memory buffer pool. If the pages are not in RAM, they are read from persistent storage. The engine updates the data pages in memory, marking them as dirty pages.
2. **Synchronous Log Write**: The engine generates a sequential transaction log record detailing the exact physical changes. The transaction log record must be flushed from memory and written synchronously to persistent physical SSD storage (the `.ldf` file) before the engine acknowledges the commit success back to the client application.
3. **Asynchronous Checkpoints**: The dirty data pages inside the RAM buffer pool are not immediately written to the main database file (`.mdf`). Instead, an asynchronous background lazy writer process or a scheduled database checkpoint writes the modified pages to physical disks. 

If the database node experiences a sudden power loss, no data is lost. Upon reboot, the engine scans the synchronous transaction log. It rolls forward any committed changes that were not yet written to the `.mdf` data files, and rolls back any uncommitted changes from incomplete transactions.

## Connections and Network Pathways

Applications connect to Azure SQL Database using standard TCP/IP connection strings. Managing database connections requires configuring secure network routes, robust authentication mechanisms, and connection pooling settings to prevent resources from exhausting.

An application client's connection path relies on two connection redirection modes:

* **Redirect Mode (Inside Azure)**: When the application client establishes a connection, it queries the Azure SQL Gateway over port 1433 to authenticate and locate the active database node. The gateway returns the direct IP address of the compute node hosting the database. The client then routes all subsequent database queries directly to the compute node over ports 11000 to 11999. This minimizes gateway bottlenecks and delivers optimal query latencies.
* **Proxy Mode (Outside Azure)**: When connecting from an external network, all queries and responses route directly through the Azure SQL Gateway over port 1433. While this increases gateway round-trip latency, it simplifies enterprise firewall security, requiring you to open only a single port (1433) to the gateway's IP address.

To secure these pathways, avoid public internet access paths. Connect your application compute resources (such as App Services or AKS clusters) using Private Endpoint configurations via Azure Private Link. This assigns a private IP address from your Virtual Network (VNet) to your logical database server, routing all query traffic entirely over Microsoft's private global fiber network. 

Additionally, eliminate database passwords and connection string secrets from your codebases by using Managed Identities cabled to Microsoft Entra ID. The application authenticates using its system-assigned identity, and the database maps permissions directly to the application's Entra object, removing credential leakage vectors.

## Schema Deployments and Migrations

Relational schema changes—such as adding table columns, altering indices, or dropping old constraints—must be treated as critical deployment steps. Because the database holds persistent business facts, schema updates cannot simply overwrite old structures like container updates do; they must transform active data in place.

To manage database deployments safely in a continuous integration and continuous delivery (CI/CD) pipeline, adopt the following operational practices:

* **Repeatable Migrations**: Use migration tools (such as Entity Framework Core Migrations, Flyway, or DACPAC packages) to generate incremental, versioned SQL migration scripts. These scripts must be checked into version control alongside your application code.
* **Online Schema Changes**: SQL Server supports online index creation and online table rebuilding. Ensure that DDL changes do not acquire exclusive table locks that block active read and write operations on high-traffic production databases.
* **Backward-Compatible Rollouts**: When deploying a schema update, ensure that the change is backward-compatible with the active version of your application. For example, if you must rename a database column, do not drop the old column immediately. Execute the change in phases: add the new column, update your application code to write to both columns, migrate the historical data, update the application to read from the new column, and only then drop the old column.

Never execute ad-hoc schema alterations directly on production systems. Run all migrations through verified pipelines that test schema changes against staging environments before execution.

## Automated Backups and Recovery

A database's recovery system is the foundation of operational reliability. Azure SQL Database provides automated backups that are maintained continuously without manual configuration.

The platform creates three distinct types of backups to enable Point-in-Time Restore (PITR) operations:
* **Full Backups**: A complete copy of the database structure and data, generated weekly.
* **Differential Backups**: Captures all changes made since the last weekly full backup, generated daily.
* **Transaction Log Backups**: Captures sequential transaction log modifications, generated every 5 to 10 minutes.

These backups are written to read-access geo-redundant storage (RA-GRS) configurations by default, distributing your backup files across secondary regional datacenters to protect against whole-region disasters.

Using these three backup types, PITR enables you to restore a database to its exact state at any specific millisecond within your retention window (typically 7 to 35 days). When you trigger a point-in-time restore, the Azure platform provisions a new database, restores the closest weekly full backup, applies the latest daily differential backup, and rolls forward the sequential transaction logs up to the targeted millisecond.

```mermaid
flowchart TD
    subgraph Storage["Backup Storage Media (RA-GRS)"]
        Full["Weekly Full Backup"]
        Diff["Daily Differential Backup"]
        Logs["5-Min Transaction Logs"]
    end

    subgraph Process["Restore Pipeline Engine"]
        RestoreFull["1. Restore Full Baseline"]
        ApplyDiff["2. Apply Differential Changes"]
        RollLogs["3. Roll Forward Log Transactions"]
    end

    TargetDB["Active Restored Database"]

    Full --> RestoreFull
    Diff --> ApplyDiff
    Logs --> RollLogs

    RestoreFull --> ApplyDiff
    ApplyDiff --> RollLogs
    RollLogs --> TargetDB
```

Keep in mind that restoring a database does not overwrite your active production database in place. It spins up a new database beside the active instance. To complete a recovery, your operations team must re-point your application connection strings to the new database, or surgically export recovered rows from the restored database back into the active database.

## Putting It All Together

Azure SQL Database delivers a managed relational environment for application data that requires strict transactional consistency and structured schema guarantees.

* **Decoupled Architecture**: Select the General Purpose tier to decouple compute from remote Premium Storage, or select the Business Critical tier to co-locate compute and storage using direct-attached local NVMe drives and synchronous Always On availability groups.
* **Logical Management**: Provision database capacity using the vCore model to control virtual cores and scale memory independently of storage.
* **Strict Constraints**: Structure business records using rigid tables, and enforce referential integrity and data validity using system-level database constraints.
* **WAL Durability**: Rely on Write-Ahead Logging to guarantee ACID transaction durability, flushing log records synchronously to physical media before committing.
* **Secure Connections**: Establish network isolation using Private Link and Private Endpoints, and authenticate using passwordless Managed Identities cabled to Microsoft Entra ID.
* **Automated Recovery**: Leverage Point-in-Time Restore capabilities powered by automated full, differential, and transaction log backups to recover from data corruptions or accidental deletions.

## What's Next

Now that we have structured our relational business records, we will explore Azure Cosmos DB. We will examine how to manage semi-structured documents, distribute data globally, optimize partition key hashing, and select the correct tunable consistency level.

---

**References**

* [Azure SQL Database documentation](https://learn.microsoft.com/en-us/azure/azure-sql/database/)
* [Azure SQL Database Service Tiers](https://learn.microsoft.com/en-us/azure/azure-sql/database/service-tiers-general-purpose-business-critical)
* [vCore purchasing model overview](https://learn.microsoft.com/en-us/azure/azure-sql/database/vcore-resource-limits-single-databases)
* [Automated backups in Azure SQL Database](https://learn.microsoft.com/en-us/azure/azure-sql/database/automated-backups-change-settings?view=azuresql)
* [Private Link for Azure SQL Database](https://learn.microsoft.com/en-us/azure/azure-sql/database/private-endpoint-overview)
