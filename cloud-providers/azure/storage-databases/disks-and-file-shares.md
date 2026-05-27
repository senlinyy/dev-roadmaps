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
Managed Disk block storage performance is governed by strict IOPS and throughput ceilings. Under high traffic, the virtual disk controller enforces limits using a Token Bucket algorithm for storage bursting, allowing temporary IOPS bursts that drain a performance credit pool. To accelerate disk reads and writes without saturating network bandwidth, configure VM Host Caching:
* **Read-Only Caching**: Stores frequently read blocks directly in the physical host blade's RAM and local NVMe SSDs. If a read request hits the host cache, the hypervisor returns the data instantly, bypassing network round-trips to the storage cluster.
* **Read-Write Caching**: Intercepts guest OS write block requests and writes them to local host NVMe cache buffers before flushing them asynchronously to remote storage. While highly performant, this write-back mechanism introduces a structural write-safety risk; if the host blade experiences sudden power loss before the NVMe cache buffer flushes, uncommitted blocks are lost, potentially corrupting guest filesystems.

Azure Files network shares handle concurrent mounts using protocol-level active file-locking tables. Under the SMB protocol, when a VM process opens a file for writing, the share engine registers an exclusive file-locking lease in its central metadata index. Any other compute node attempting to write to the same file receives a sharing violation error from the filesystem API. NFS, conversely, implements stateless network locking, which requires application-level lock coordination to prevent data corruption when multiple Linux containers write to the same network share.
:::

If you run operating system volumes on AWS, Azure Managed Disks are the direct equivalent of AWS EBS (Elastic Block Store) volumes, and Azure Files is the equivalent of AWS EFS (Elastic File System). Contrast their configuration models: while AWS EBS relies on custom AWS task execution fabrics, Azure Managed Disks offer Premium SSD v2 options that allow you to scale IOPS and throughput independently of disk size, whereas AWS EBS GP3 provides similar independent scaling but cabled to different performance limits.

Decouple your application data from your machine OS disks. If your application code is standard and does not require low-level guest filesystem API calls, Blob Storage is the simpler, faster, and more cost-effective object storage choice.

| Storage Option | Access Protocol | Concurrency Bound | Systems Use Case |
| --- | --- | --- | --- |
| Managed Disk | Block I/O (FC / iSCSI) | Single VM mount only | Operating system boot drives, local databases, and raw scratch directories |
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

If your database experiences read/write latency spikes, inspect the host-level Disk Queue Depth metric. A high queue depth indicates that the guest OS is submitting block requests faster than the disk's IOPS limit can process, causing requests to stack up in hypervisor buffers. Upgrading the disk to a Premium SSD v2 or scaling IOPS independently resolves this bottleneck.

## Host Caching

Host Caching leverages the physical RAM and local NVMe solid-state drives cabled directly to the VM's host hypervisor blade to accelerate disk operations:
* **None**: Bypasses all local cache buffers. Every read and write block request traverses the network to the Azure Storage scale units. This is the mandatory configuration for transaction log drives (such as SQL Server `.ldf` files) to guarantee that commits are immediately written to durable storage.
* **Read-Only**: Caches read operations. This is highly effective for read-heavy database data paths (`.mdf` files) and static template directories.
* **Read-Write**: Caches both reads and writes. This provides maximum throughput but must be used with extreme caution. It is only safe for applications that manage their own transactional flush rules or handle volatile temporary scratch data.

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
| Concurrency Model | Strict stateful lease file-locking | Stateless network locking |

For modern cloud architectures, avoid using mounted file shares as a generic storage backplane. If your application code can be written to use the Azure Storage SDK, prefer Blob Storage for object operations. Object storage is more portable, scales infinitely, and avoids the file-locking performance bottlenecks of network file shares.

## Putting It All Together

Virtual machine and shared folder storage require matching performance limits to your physical access patterns.

* **SCSI Block Translations**: Guest OS block reads and writes on Managed Disks are converted by hypervisor virtual controllers into network packets, streaming over dark fiber to triple-replicated remote LUN volumes.
* **Host Caching write safety**: Host Caching leverages hypervisor host RAM and local NVMe drives. Read-Write caching provides maximum performance but introduces write-safety risks under host power failure.
* **Premium SSD v2 Scaling**: Modern Premium SSD v2 volumes allow developers to scale disk capacity, IOPS, and throughput independently, avoiding unnecessary disk over-provisioning.
* **Network SMB/NFS Shares**: Azure Files manages shared directory mounts over SMB and NFS protocols, utilizing stateful metadata lease tables to coordinate concurrent file-system write locks.

## What's Next

In the next chapter, we will look at Azure SQL Database. We will explore managed relational database engines, contrast General Purpose and Business Critical storage structures, and inspect synchronous transaction log write architectures.

---

**References**

- [Azure Managed Disks Overview](https://learn.microsoft.com/en-us/azure/virtual-machines/managed-disks-overview) - Official overview of virtual block storage.
- [VM Host Caching Details](https://learn.microsoft.com/en-us/azure/virtual-machines/caching-and-performance) - Technical guide to read/write caching and write-safety.
- [What is Azure Files?](https://learn.microsoft.com/en-us/azure/storage/files/storage-files-introduction) - Overview of managed SMB and NFS file shares.
- [Azure Files SMB and NFS Planning](https://learn.microsoft.com/en-us/azure/storage/files/storage-files-planning) - Performance and network guide for network mounts.
