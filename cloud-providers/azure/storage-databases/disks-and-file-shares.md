---
title: "Disks and File Shares"
description: "Configure managed cloud disk volumes and shared network file directories using Premium SSDs, host caching rules, and SMB/NFS protocols."
overview: "Managed Disks and Azure Files provide VM-bound block and shared folder storage. This article contrasts Premium SSD v1/v2 IOPS bounds, VM host caching write safety, and network SMB/NFS mounts."
tags: ["azure", "disks", "file-shares", "smb", "nfs"]
order: 3
id: article-cloud-providers-azure-storage-databases-disks-file-shares
aliases:
  - azure-managed-disks-and-file-shares
  - cloud-providers/azure/storage-databases/azure-managed-disks-and-file-shares.md
---

## Table of Contents

1. [What Is A Disk or File Share](#what-is-a-disk-or-file-share)
2. [Managed Disks](#managed-disks)
3. [Disk Performance And IOPS](#disk-performance-and-iops)
4. [Host Caching](#host-caching)
5. [Azure Files And File Shares](#azure-files-and-file-shares)
6. [SMB vs NFS Protocols](#smb-vs-nfs-protocols)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## What Is A Disk or File Share

Azure Managed Disks and Azure Files provide operating-system-attached cloud storage for virtual machine workloads. Managed Disks represent persistent, virtualized block storage volumes that are cabled directly to virtual machine hypervisors, allowing a single guest operating system to partition, format, and mount the drive. Azure Files represents a managed network file share that allows multiple distinct compute hosts to mount the same shared directory concurrently over local virtual networks. Both resources decouple machine-level storage from the physical server blade hardware, ensuring that local directories and operating system volumes survive physical blade failures.

:::expand[Under the Hood: Host Caching Physics and SMB/NFS Protocol Locking]{kind="design"}
Managed Disk block storage performance is governed by disk type, disk size, provisioned IOPS, throughput limits, VM size limits, and optional bursting behavior. VM host caching can improve some workloads by keeping frequently accessed data closer to the VM host:
* **Read-Only Caching**: Helps read-heavy workloads by serving repeated reads from the host cache when the workload pattern benefits from it.
* **Read-Write Caching**: Can improve throughput for carefully chosen workloads, but it is not appropriate for every disk. Use it only when the application and disk role can tolerate the caching semantics documented for Azure VMs.

Azure Files network shares handle concurrent mounts through the file protocol you choose. SMB supports Windows-style file sharing behavior, leases, and integration with Active Directory based identity options. NFS 4.1 supports Linux-oriented POSIX permissions and must be accessed through private networking. In both cases, applications still need a safe concurrency model when multiple compute instances write the same files.
:::

If you run operating system volumes on AWS, Azure Managed Disks are the direct equivalent of AWS EBS (Elastic Block Store) volumes, and Azure Files is the equivalent of AWS EFS (Elastic File System). Contrast their configuration models: while AWS EBS relies on custom AWS task execution fabrics, Azure Managed Disks offer Premium SSD v2 options that allow you to scale IOPS and throughput independently of disk size, whereas AWS EBS GP3 provides similar independent scaling but cabled to different performance limits.

Decouple your application data from your machine OS disks. If your application code is standard and does not require low-level guest filesystem API calls, Blob Storage is the simpler, faster, and more cost-effective object storage choice.

| Storage Option | Access Protocol | Concurrency Bound | Systems Use Case |
| --- | --- | --- | --- |
| Managed Disk | Azure-managed virtual block disk | Usually attached to one VM; shared disk is a specialized clustered workload option | Operating system boot drives, local databases, and raw scratch directories |
| Azure Files Share | SMB (v2.1/v3.0) or NFS (v4.1) | Concurrent multi-node mounts | Shared legacy templates, central configurations, and migration directory bridges |

## Managed Disks

Azure Managed Disks are high-performance virtual block volumes designed to run guest operating systems and stateful databases. Azure manages disk provisioning, physical server rack placement, and storage cluster scaling, presenting each disk as a single, durable logical unit number (LUN) cabled to your Virtual Machine.

Every Virtual Machine requires an OS disk containing the boot sector, system configuration files, and installed runtime libraries. A common architectural anti-pattern is writing application-generated logs, database tables, or customer uploads directly to the OS disk. If the OS disk fills up, the guest operating system kernel will panic, crashing your application and blocking remote SSH administration routes.

To isolate system files from application files, attach dedicated Managed Data Disks to your VM. Data disks own their own IOPS limits and storage billing. If an application data disk runs out of space, the OS continues to run, allowing you to scale the disk volume dynamically using the Azure CLI without experiencing host downtime.

## Disk Performance And IOPS

Selecting the correct Managed Disk tier is key to preventing I/O bottleneck delays during database batch operations:
* **Premium SSD (v1)**: IOPS and throughput caps are hard-locked to the provisioned disk size (e.g., a 128 GB P10 disk is capped at 500 IOPS). Sizing a disk larger than needed is often required just to purchase higher performance.
* **Premium SSD (v2)**: The modern standard. It allows you to provision disk size, IOPS, and throughput independently, optimizing costs for high-transaction, low-capacity databases.
* **Ultra Disk**: Designed for extremely performance-critical databases. It supports sub-millisecond write latencies and allows you to adjust IOPS and throughput dynamically while the disk remains online.

![An infographic showing disk IOPS, throughput, latency, cache, and size limits around a VM workload](/content-assets/articles/article-cloud-providers-azure-storage-databases-disks-file-shares/disk-performance-envelope.png)

*Disk performance is an envelope of IOPS, throughput, latency, cache behavior, and VM limits, not just capacity.*

If your database experiences read/write latency spikes, inspect the host-level Disk Queue Depth metric. A high queue depth indicates that the guest OS is submitting block requests faster than the disk's IOPS limit can process, causing requests to stack up in hypervisor buffers. Upgrading the disk to a Premium SSD v2 or scaling IOPS independently resolves this bottleneck.

:::expand[Over-Provisioning Disk Size for IOPS]{kind="pitfall"}
On legacy **Premium SSD v1 (P-Series)** disks, performance is hard-locked to capacity. A 128 GB P10 disk is capped at 500 IOPS, whereas a 1 TB P30 disk provides 5,000 IOPS. Database teams frequently buy a 1 TB disk when they only have 50 GB of data, purely to secure the 5,000 IOPS performance budget, paying for 950 GB of useless, empty storage.

This matches the old **AWS EBS gp2** behavior, which locked baseline performance to 3 IOPS per GB with a minimum of 100 IOPS. Teams similarly over-provisioned volume sizes to bypass the performance ceiling. Both Azure's transition to **Premium SSD v2** and AWS's shift to **gp3** decoupled these parameters, letting you scale size, IOPS, and throughput independently.

Consider this cost comparison for a high-performance 50 GB database:

*   **Before (Over-Provisioned Premium SSD v1):** Provisioning a 1 TB P30 disk solely for performance:
    *   *Storage:* 1,024 GB (90% wasted capacity)
    *   *Performance:* 5,000 IOPS (Hard-locked)
    *   *Cost:* **~$135 / month**
*   **After (Optimized Premium SSD v2):** Provisioning a right-sized 128 GB disk with custom IOPS:
    *   *Storage:* 128 GB (Plenty of database headroom)
    *   *Performance:* 5,000 IOPS (Provisioned independently)
    *   *Cost:* ~$10 base storage + ~$30 custom IOPS = **~$40 / month** (70% savings)

To verify if your current VM disk is experiencing an I/O bottleneck before sizing up, monitor this Azure Monitor metric:

```text
Disk Queue Depth > 1 (sustained over 5 minutes)
```

A queue depth greater than one signals that your guest OS is submitting read/write requests faster than the storage LUN can process them, causing threads to block in hypervisor I/O queues.

**Rule of thumb:** Standardize all stateful virtual machines on Premium SSD v2 (or gp3 in AWS) to right-size capacity and performance separately. Never pay for empty, wasted storage blocks just to purchase IOPS.
:::

## Host Caching

Host Caching uses cache resources on the VM host to accelerate supported disk operations:
* **None**: Disables host caching. This is the standard choice for transaction log drives (such as SQL Server `.ldf` files) where the workload needs writes to follow the database engine's durability expectations.
* **Read-Only**: Caches read operations. This is highly effective for read-heavy database data paths (`.mdf` files) and static template directories.
* **Read-Write**: Caches both reads and writes. This provides maximum throughput but must be used with extreme caution. It is only safe for applications that manage their own transactional flush rules or handle volatile temporary scratch data.

![An infographic showing why a disk snapshot can capture disk blocks while recent writes remain in memory](/content-assets/articles/article-cloud-providers-azure-storage-databases-disks-file-shares/snapshot-consistency-window.png)

*Snapshots capture storage at a moment in time, so databases need flush or application-consistent coordination for safe recovery.*

## Azure Files And File Shares

Azure Files provides fully managed serverless file shares accessible over industry-standard SMB and NFS protocols. It removes the administrative burden of running dedicated Windows File Servers or Linux Samba VMs inside your virtual networks.

Azure Files shares support two primary performance tiers: Standard (hosted on shared hard-disk scale units, designed for general-purpose files) and Premium (hosted on dedicated SSD hardware, designed for high-throughput, low-latency concurrent mounts).

When mounting an Azure Files share to an App Service container or an AKS pod, the integration utilizes secure internal network mounts. If your containerized API needs to read shared document templates, the platform mounts the share as a local directory path, allowing your standard Node.js or Python code to read and write files using ordinary filesystem libraries.

## SMB vs NFS Protocols

When provisioning an Azure Files share, you must select either the SMB or the NFS protocol based on your guest operating system and concurrency requirements:
* **SMB Protocol**: The default standard. It supports Windows and Linux clients, integrates with Active Directory or Microsoft Entra Domain Services for advanced file-level access control lists (ACLs), and uses encrypted transport over TCP port `445`.
* **NFS Protocol**: Designed exclusively for Linux-native environments. It requires a Premium SSD storage account, maps directly to Linux POSIX file permissions, and must be deployed inside a private virtual network subnet since it does not support public internet routing.

| Metric | SMB Protocol | NFS Protocol |
| --- | --- | --- |
| OS Compatibility | Windows and Linux | Linux only |
| Security Integration | Active Directory Domain Services ACLs | POSIX permissions mapped to UID/GID |
| Transport Encryption | In-transit encryption over port 445 | Relies on private virtual network subnets |
| Concurrency Model | SMB leases and file sharing semantics | NFS 4.1 locking and POSIX-oriented semantics |

For modern cloud architectures, avoid using mounted file shares as a generic storage backplane. If your application code can be written to use the Azure Storage SDK, prefer Blob Storage for object operations. Object storage is more portable, scales infinitely, and avoids the file-locking performance bottlenecks of network file shares.

## Putting It All Together

Virtual machine and shared folder storage require matching performance limits to your physical access patterns.

* **Managed Block Storage**: Guest operating systems see Managed Disks as attached block devices, while Azure manages the backing storage, durability, and disk redundancy options.
* **Host Caching write safety**: Host caching can improve selected disk workloads, but read-write caching must match the application's durability requirements and the documented VM caching guidance.
* **Premium SSD v2 Scaling**: Modern Premium SSD v2 volumes allow developers to scale disk capacity, IOPS, and throughput independently, avoiding unnecessary disk over-provisioning.
* **Network SMB/NFS Shares**: Azure Files manages shared directory mounts over SMB and NFS protocols, while your application design still owns safe concurrent writes.

## What's Next

In the next chapter, we will look at Azure SQL Database. We will explore managed relational database engines, contrast General Purpose and Business Critical storage structures, and inspect synchronous transaction log write architectures.

![An infographic comparing managed disks attached to one VM with Azure Files shared by multiple clients over SMB or NFS](/content-assets/articles/article-cloud-providers-azure-storage-databases-disks-file-shares/disk-vs-file-share.png)

*Use this as the storage boundary: a managed disk is private block storage for one machine, while Azure Files is a shared network filesystem for multiple clients.*


---

**References**

- [Azure Managed Disks Overview](https://learn.microsoft.com/en-us/azure/virtual-machines/managed-disks-overview) - Official overview of virtual block storage.
- [VM Host Caching Details](https://learn.microsoft.com/en-us/azure/virtual-machines/caching-and-performance) - Technical guide to read/write caching and write-safety.
- [What is Azure Files?](https://learn.microsoft.com/en-us/azure/storage/files/storage-files-introduction) - Overview of managed SMB and NFS file shares.
- [Azure Files SMB and NFS Planning](https://learn.microsoft.com/en-us/azure/storage/files/storage-files-planning) - Performance and network guide for network mounts.
